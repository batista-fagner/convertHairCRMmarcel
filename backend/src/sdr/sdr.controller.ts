import { Controller, Post, Body, Logger, Param, HttpException, HttpStatus } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SdrService, deriveKanbanStage, SdrStage } from './sdr.service';
import { SdrFollowupService } from './sdr-followup.service';
import { AvailabilityService } from '../availability/availability.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { LeadsService } from '../leads/leads.service';
import { FacebookService } from '../facebook/facebook.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SettingsService } from '../settings/settings.service';
import { Lead, WaStage } from '../common/entities/lead.entity';

export const SDR_NOTIFY_PHONES_KEY = 'sdr_notify_phones';

export interface CtwaReferral {
  clid?: string;
  sourceUrl?: string;
  sourceId?: string;
  adTitle?: string;
}

/**
 * Extrai os dados de anúncio Click-to-WhatsApp de um webhook uazapi. Esses
 * campos vêm no protocolo do WhatsApp (proto ExternalAdReplyInfo: ctwaClid,
 * sourceUrl, sourceId, title), como irmãos no mesmo objeto. O caminho exato
 * no payload uazapi não é documentado, então localizamos o NÓ que contém o
 * ctwaClid (chave bem específica, ~0 falso-positivo) e lemos os irmãos dali —
 * mais preciso que busca global, já que "title" é uma chave genérica que
 * poderia aparecer noutro ponto do payload. Só chega na 1ª mensagem (o clique).
 */
export function extractCtwaReferral(body: any): CtwaReferral {
  const findNodeWithCtwa = (obj: any, depth = 0): any => {
    if (!obj || typeof obj !== 'object' || depth > 6) return undefined;
    for (const k of Object.keys(obj)) {
      const kl = k.toLowerCase();
      if ((kl === 'ctwaclid' || kl === 'ctwa_clid') && typeof obj[k] === 'string' && obj[k].trim()) {
        return obj;
      }
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') {
        const found = findNodeWithCtwa(v, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  };

  const node = findNodeWithCtwa(body);
  if (!node) return {};

  const pick = (keys: string[]): string | undefined => {
    for (const k of Object.keys(node)) {
      if (keys.includes(k.toLowerCase()) && typeof node[k] === 'string' && node[k].trim()) {
        return node[k].trim();
      }
    }
    return undefined;
  };

  return {
    clid: pick(['ctwaclid', 'ctwa_clid']),
    sourceUrl: pick(['sourceurl', 'source_url']),
    sourceId: pick(['sourceid', 'source_id']),
    adTitle: pick(['title', 'headline']),
  };
}

/**
 * Webhook do agente SDR — instância/número uazapi SEPARADO do Efraim.
 * Recebe mensagens de leads novos, qualifica via IA e move os cards do Kanban.
 */
@Controller('webhooks')
export class SdrController {
  private readonly logger = new Logger(SdrController.name);
  private readonly processedIds = new Set<string>();
  private readonly pendingBuffer = new Map<string, { timer: NodeJS.Timeout; texts: string[]; ctwa?: CtwaReferral }>();
  private readonly uazapiBaseUrl: string;
  private readonly uazapiToken: string;
  private readonly operatorPhone: string;
  private checkingNeverStarted = false;

  // Tempo de espera antes de considerar que o lead "não vai iniciar sozinho" e
  // mandar a abertura proativa (ver checkNeverStartedLeads abaixo).
  private static readonly NEVER_STARTED_WAIT_MINUTES = 5;

  // Leads criados antes do deploy dessa feature (ex.: Jaqueline/Flavia, que já
  // têm envio agendado separadamente pras 9am de NY) não entram nesse cron —
  // só vale pra quem chegar dali pra frente. Evita disparo retroativo assim
  // que o deploy sobe.
  private static readonly NEVER_STARTED_FEATURE_LAUNCH_AT = new Date();

  // Quando vários leads viram elegíveis pra abertura proativa na mesma janela,
  // manda um de cada vez com esse intervalo entre eles — evita disparar vários
  // números novos "de uma vez" pro WhatsApp, o que pode acionar restrição/ban
  // da conta.
  private static readonly NEVER_STARTED_STAGGER_MS = 40_000;

  // Depois de N falhas seguidas (uazapi não confirmou o envio — ex.: número sem
  // WhatsApp), o cron para de tentar esse lead pra sempre (ver caso Valdirene,
  // 09/08: mesmo número tentado a cada minuto por 3h+ sem sucesso). O operador
  // pode disparar manualmente via /sdr/trigger-opening se corrigir o número.
  private static readonly NEVER_STARTED_MAX_ATTEMPTS = 3;

  constructor(
    private readonly sdrService: SdrService,
    private readonly leadsService: LeadsService,
    private readonly facebookService: FacebookService,
    private readonly realtime: RealtimeGateway,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly sdrFollowup: SdrFollowupService,
    private readonly availabilityService: AvailabilityService,
    private readonly appointmentsService: AppointmentsService,
  ) {
    this.uazapiBaseUrl = config.get('SDR_UAZAPI_BASE_URL') || config.get('UAZAPI_BASE_URL') || 'https://free.uazapi.com';
    this.uazapiToken = config.get('SDR_UAZAPI_TOKEN') || '';
    this.operatorPhone = config.get('SDR_OPERATOR_PHONE') || '';
  }

  /**
   * A cada minuto, varre leads do SDR que nunca trocaram nenhuma mensagem e já
   * passaram do prazo de espera (5min desde created_at) — manda a abertura
   * proativa automaticamente. Se o lead iniciar sozinho antes disso, ele sai
   * da consulta (wa_last_message_at deixa de ser null) e o fluxo normal segue,
   * sem essa abordagem. `checkingNeverStarted` evita rodar 2x sobreposto
   * (o envio real com "digitando..." pode levar alguns segundos por lead).
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkNeverStartedLeads() {
    if (this.checkingNeverStarted) return;
    this.checkingNeverStarted = true;
    try {
      const cutoff = new Date(Date.now() - SdrController.NEVER_STARTED_WAIT_MINUTES * 60 * 1000);
      const leads = await this.leadsService.findNeverStartedOlderThan(
        cutoff,
        SdrController.NEVER_STARTED_FEATURE_LAUNCH_AT,
        SdrController.NEVER_STARTED_MAX_ATTEMPTS,
      );
      let sent = 0;
      for (const lead of leads) {
        if (sent > 0) {
          await new Promise((r) => setTimeout(r, SdrController.NEVER_STARTED_STAGGER_MS));
        }
        const ok = await this.sendProactiveOpening(lead);
        if (ok) {
          sent++;
          continue;
        }

        const attempts = (lead.openingAttempts ?? 0) + 1;
        await this.leadsService.update(lead.id, { openingAttempts: attempts });
        if (attempts >= SdrController.NEVER_STARTED_MAX_ATTEMPTS) {
          this.logger.warn(`[SDR] Abertura proativa desistiu de ${lead.phone} após ${attempts} falhas seguidas — não tenta mais automaticamente`);
        }
      }
      if (leads.length) {
        this.logger.log(`[SDR] Abertura proativa automática: ${sent}/${leads.length} enviada(s)`);
      }
    } finally {
      this.checkingNeverStarted = false;
    }
  }

  /**
   * Abertura fixa (NÃO gerada pela IA) pra quando é o SISTEMA que puxa a
   * conversa primeiro — lead entrou pelo ghl-capture mas nunca mandou nada.
   * Diferente da abertura normal (IA responde livre quando o lead manda "oi"):
   * aqui o texto é sempre este, aprovado pelo Marcel. "|||" = 2 bolhas de
   * WhatsApp, mesmo padrão do resto do sistema (ver splitBubbles).
   */
  private buildProactiveOpening(name?: string | null): string {
    const trimmed = (name || '').trim();
    const validName = trimmed && !/^Lead \d+$/i.test(trimmed) ? trimmed.split(' ')[0] : '';
    const greeting = validName
      ? `🎉 Parabéns ${validName} por ter se inscrito na sessão de mentoria gratuita com o mentor Marcel!`
      : '🎉 Parabéns por ter se inscrito na sessão de mentoria gratuita com o mentor Marcel!';
    return `${greeting}|||Você já é dona do seu próprio schedule ou ainda trabalha como helper?`;
  }

  /**
   * Envia a abertura proativa e registra no histórico como se fosse a 1ª bolha
   * da Clara — dali em diante a conversa segue 100% normal (resposta da lead
   * cai no webhook de sempre e processMessage já acha essa msg no aiContext).
   */
  /**
   * Só grava a abertura como enviada se a uazapi confirmou o envio de TODAS as
   * bolhas — senão o lead fica exatamente como estava (sem aiContext, sem
   * waLastMessageAt), pra poder tentar de novo depois em vez de ficar
   * marcado como "já iniciado" sem a mensagem ter chegado de verdade.
   */
  private async sendProactiveOpening(lead: Lead): Promise<boolean> {
    const reply = this.buildProactiveOpening(lead.name);
    const sent = await this.sendReplyAsBubbles(lead.phone, reply);
    if (!sent) {
      this.logger.warn(`[SDR] Abertura proativa NÃO confirmada pela uazapi para ${lead.phone} — lead não marcado como iniciado`);
      return false;
    }

    const contextReply = reply.replace(/\|\|\|/g, '\n');
    const ctx = [
      ...(Array.isArray(lead.aiContext) ? lead.aiContext : []),
      { role: 'assistant', content: contextReply, timestamp: new Date().toISOString() },
    ];

    const updated = await this.leadsService.update(lead.id, {
      aiContext: ctx,
      waStage: 'abertura' as WaStage,
      waLastMessageAt: new Date(),
      followupSentAt: null,
    });
    // Sem isso, a cadência de follow-up nunca começava a contar pra quem
    // recebeu a abertura proativa mas nunca respondeu — resetCadenceOnReply só
    // roda em processMessage (mensagem REAL do lead). Resultado: Jaqueline e
    // Flavia receberam a abertura e ficaram pra sempre sem follow-up nenhum
    // agendado (next_nurture_at ficava null). Aqui a IA "falou primeiro", então
    // conta como o mesmo marco de início de cadência.
    await this.sdrFollowup.resetCadenceOnReply(lead.id);
    this.realtime.emitLeadUpdated(updated);
    this.logger.log(`[SDR] Abertura proativa enviada para ${lead.phone}`);
    return true;
  }

  /**
   * Dispara manualmente a abertura proativa pra um lead específico (validado
   * com o Marcel, liberado pra qualquer lead). Recusa quem já tem conversa
   * iniciada — essa abertura é só pra quem nunca trocou nenhuma mensagem com
   * a Clara.
   */
  @Post('sdr/trigger-opening')
  async triggerOpening(@Body() body: { phone: string }) {
    const phone = (body.phone || '').replace(/\D/g, '');
    if (!phone) throw new HttpException('Telefone é obrigatório', HttpStatus.BAD_REQUEST);

    let lead = await this.findLeadByPhoneVariants(phone);
    if (!lead) {
      lead = await this.leadsService.create({
        name: `Lead ${phone.slice(-4)}`,
        phone,
        agentMode: 'sdr',
        kanbanStage: 'novo',
      });
      this.realtime.emitLeadCreated(lead);
    }

    if (Array.isArray(lead.aiContext) && lead.aiContext.length > 0) {
      throw new HttpException('Lead já tem conversa iniciada — abertura proativa é só pra quem nunca trocou mensagem', HttpStatus.CONFLICT);
    }

    const sent = await this.sendProactiveOpening(lead);
    if (!sent) {
      throw new HttpException('WhatsApp não confirmou o envio (uazapi retornou erro) — nada foi gravado, pode tentar de novo', HttpStatus.BAD_GATEWAY);
    }
    return { ok: true };
  }

  @Post('sdr/:eventType')
  async handleEvent(@Param('eventType') eventType: string, @Body() body: any) {
    if (eventType === 'messages') {
      return this.handleWebhook(body);
    }
    return { ok: true };
  }

  @Post('sdr')
  async handleWebhook(@Body() body: any) {
    if (body.EventType !== 'messages') return { ok: true };

    const message = body.message;
    if (!message) return { ok: true };

    // Descoberta do formato CTWA: com SDR_LOG_RAW_WEBHOOK=true, loga o payload
    // cru pra confirmar onde o uazapi coloca o ctwa_clid num clique real de
    // anúncio. Manter desligado em operação normal (evita ruído/PII no log).
    if (this.config.get('SDR_LOG_RAW_WEBHOOK') === 'true') {
      this.logger.log(`[SDR][RAW] ${JSON.stringify(body).slice(0, 4000)}`);
    }

    // Mensagem enviada pelo próprio número do bot, digitada manualmente pelo
    // operador/closer (não veio da nossa API — wasSentByApi=false). Permite
    // controlar a IA por palavra-chave direto na conversa do WhatsApp: "opa"
    // pausa, "ok" reativa. Qualquer outro texto é o closer conversando de
    // verdade com o lead (ex.: pós-handoff) — antes isso era descartado sem
    // ser salvo, o que apagava a conversa do closer do histórico do lead.
    if (message.fromMe && !message.wasSentByApi && !message.isGroup) {
      const leadPhone: string = (body.chat?.phone ?? '').replace(/\D/g, '');
      const keyword = (message.text ?? '').trim().toLowerCase();
      if (keyword === 'opa' || keyword === 'ok') {
        if (leadPhone) await this.toggleAiByKeyword(leadPhone, keyword === 'opa');
      } else if (leadPhone && message.text) {
        await this.recordHumanReply(leadPhone, message.text);
      }
      return { ok: true };
    }

    if (message.fromMe || message.isGroup || message.wasSentByApi) return { ok: true };

    const phone: string = (body.chat?.phone ?? '').replace(/\D/g, '');
    let text: string = message.text ?? '';
    const messageId: string = message.messageid ?? '';
    const pushName: string = body.chat?.name ?? message.senderName ?? '';
    const isAudio = message.type === 'media' && ['audio', 'ptt', 'myaudio'].includes(message.mediaType);

    if (!phone) return { ok: true };

    // Áudio/PTT: transcreve via uazapi + Whisper antes de seguir o fluxo normal
    if (isAudio && messageId) {
      try {
        this.logger.log(`[SDR] Áudio recebido de ${phone} — transcrevendo...`);
        const res = await firstValueFrom(
          this.http.post(
            `${this.uazapiBaseUrl}/message/download`,
            { id: messageId, transcribe: true, generate_mp3: false, return_link: false, openai_apikey: this.config.get('OPENAI_API_KEY') },
            { headers: { token: this.uazapiToken } },
          ),
        );
        text = (res.data as any).transcription ?? '';
        if (!text) {
          this.logger.warn(`[SDR] Transcrição vazia de ${phone} — ignorando`);
          return { ok: true };
        }
        this.logger.log(`[SDR] Áudio de ${phone} transcrito: "${text}"`);
      } catch (err: any) {
        this.logger.error(`[SDR] Erro ao transcrever áudio de ${phone}: ${err.message}`);
        return { ok: true };
      }
    }

    if (!text) return { ok: true };

    // Ignora mensagens antigas (> 5 min)
    if (message.messageTimestamp) {
      const ageSeconds = Date.now() / 1000 - message.messageTimestamp;
      if (ageSeconds > 300) return { ok: true };
    }

    // Deduplicação
    if (this.processedIds.has(messageId)) return { ok: true };
    this.processedIds.add(messageId);
    setTimeout(() => this.processedIds.delete(messageId), 5 * 60 * 1000);

    this.logger.log(`[SDR] Mensagem de ${phone}: "${text}"`);

    // Referral de anúncio CTWA (só vem na 1ª mensagem do clique) — captura já
    // aqui e preserva no buffer, mesmo que cheguem mais mensagens no debounce.
    const ctwa = extractCtwaReferral(body);

    // Debounce 25s: acumula mensagens antes de processar
    const pending: { timer: NodeJS.Timeout; texts: string[]; ctwa?: CtwaReferral } =
      this.pendingBuffer.get(phone) ?? { timer: null as any, texts: [] };
    pending.texts.push(text);
    if (ctwa.clid && !pending.ctwa?.clid) pending.ctwa = ctwa;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      const combinedText = pending.texts.join('\n');
      const capturedCtwa = pending.ctwa;
      this.pendingBuffer.delete(phone);
      this.processMessage(phone, combinedText, pushName, capturedCtwa).catch((err) =>
        this.logger.error(`[SDR] Erro ao processar ${phone}: ${err.message}`),
      );
    }, 25_000);
    this.pendingBuffer.set(phone, pending);

    return { ok: true };
  }

  /** Encontra o lead testando as variantes com/sem DDI 55 e com/sem o 9 extra (Brasil). */
  private async findLeadByPhoneVariants(phone: string): Promise<Lead | null> {
    const addNine = (n: string) => (n.length === 10 ? `${n.slice(0, 2)}9${n.slice(2)}` : n);
    const removeNine = (n: string) => (n.length === 11 && n[2] === '9' ? `${n.slice(0, 2)}${n.slice(3)}` : n);
    const base = phone.startsWith('55') ? phone.slice(2) : phone;
    const phoneVariants = [`55${base}`, base, `55${addNine(base)}`, addNine(base), `55${removeNine(base)}`, removeNine(base)];

    for (const p of phoneVariants) {
      const lead = await this.leadsService.findByPhone(p);
      if (lead) return lead;
    }
    return null;
  }

  /**
   * Busca nome real de campanha/conjunto/anúncio na Marketing API e atualiza o
   * lead — roda em segundo plano (fire-and-forget), sem bloquear a resposta ao
   * lead nem depender disso pra nada crítico. Só afeta leads de WhatsApp CTWA;
   * o fluxo de LP/site continua resolvendo isso via UTM da própria URL.
   */
  private async enrichAdAttribution(leadId: string, adId: string) {
    try {
      const details = await this.facebookService.getAdDetails(adId);
      if (!details) return;
      const updated = await this.leadsService.update(leadId, {
        utmCampaign: details.campaignName || undefined,
        utmMedium: details.adsetName || undefined,
        utmTerm: details.adsetId || undefined,
        utmContent: adId,
        // Sobrescreve o título genérico do referral (ex: nome da Página) pelo
        // nome real do anúncio no Ads Manager — mais útil pra identificar e agir.
        ctwaAdTitle: details.adName || undefined,
      });
      this.realtime.emitLeadUpdated(updated);
      this.logger.log(`[SDR] Lead ${updated.phone} enriquecido com dados do anúncio: campanha="${details.campaignName}", conjunto="${details.adsetName}"`);
    } catch (err: any) {
      this.logger.warn(`[SDR] Erro ao enriquecer attribution do lead ${leadId}: ${err.message}`);
    }
  }

  /**
   * Busca foto de perfil e nome real do WhatsApp (via /chat/details) e salva no
   * lead — roda em segundo plano (fire-and-forget), sem atrasar a resposta ao
   * lead. Só sobrescreve o nome se ainda estiver no placeholder "Lead XXXX".
   */
  private async fetchAndSaveAvatar(leadId: string, phone: string, currentName?: string): Promise<string | undefined> {
    if (!this.uazapiToken) return undefined;
    try {
      const res = await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/chat/details`,
          { number: phone, preview: true },
          { headers: { token: this.uazapiToken } },
        ),
      );
      const data = res.data as { imagePreview?: string; image?: string; name?: string; wa_contactName?: string; wa_name?: string };
      const avatarUrl = data.imagePreview || data.image;
      const realName = data.name || data.wa_contactName || data.wa_name;

      const patch: Partial<Lead> = {};
      if (avatarUrl) patch.avatarUrl = avatarUrl;
      if (realName && currentName && /^Lead \d+$/.test(currentName)) patch.name = realName;
      if (!Object.keys(patch).length) return undefined;

      const updated = await this.leadsService.update(leadId, patch);
      this.realtime.emitLeadUpdated(updated);
      return patch.name;
    } catch (err: any) {
      this.logger.warn(`[SDR] Erro ao buscar foto/nome de ${phone}: ${err.message}`);
      return undefined;
    }
  }

  /** "opa"/"ok" digitados pelo operador direto no WhatsApp pausam/reativam a IA daquele lead. */
  private async toggleAiByKeyword(phone: string, pause: boolean) {
    const lead = await this.findLeadByPhoneVariants(phone);
    if (!lead) return;
    const updated = await this.leadsService.update(lead.id, { aiPaused: pause });
    this.realtime.emitLeadUpdated(updated);
    this.logger.log(`[SDR] IA ${pause ? 'pausada' : 'reativada'} via palavra-chave para o lead ${updated.phone}`);
  }

  /** Registra no histórico a mensagem que o closer digitou direto no WhatsApp (fora do CRM). */
  private async recordHumanReply(phone: string, text: string) {
    const lead = await this.findLeadByPhoneVariants(phone);
    if (!lead) return;
    const ctx = [...(Array.isArray(lead.aiContext) ? lead.aiContext : []), { role: 'assistant', source: 'operator', content: text, timestamp: new Date().toISOString() }];
    const updated = await this.leadsService.update(lead.id, { aiContext: ctx, waLastMessageAt: new Date() });
    this.realtime.emitLeadUpdated(updated);
    this.logger.log(`[SDR] Resposta manual do closer registrada para o lead ${updated.phone}`);
  }

  private async processMessage(phone: string, text: string, pushName: string, ctwa?: CtwaReferral) {
    let lead: Lead | null = await this.findLeadByPhoneVariants(phone);

    // Lead novo entrando pelo número do SDR → cria card "novo" no Kanban
    let isNew = false;
    if (!lead) {
      const fromAd = Boolean(ctwa?.clid);
      // Link do WhatsApp usado no botão da DM da automação de Instagram vem
      // com esse texto pré-preenchido — é a única forma de "marcar" a origem
      // num link de 1:1 do WhatsApp (não tem UTM de página aqui, o clique
      // abre a conversa direto). Se mudar a frase no link, atualiza aqui.
      const fromInstagram = !fromAd && /vim do instagram/i.test(text);
      lead = await this.leadsService.create({
        name: pushName || `Lead ${phone.slice(-4)}`,
        // phone já vem completo (com DDI correto) direto do JID do WhatsApp —
        // não prefixar 55 aqui, senão números internacionais (ex.: EUA) ficam
        // inválidos (bug identificado em 2026-07-31: lead dos EUA "14076171172"
        // virou "5514076171172" e o envio de resposta falhava com 500).
        phone,
        agentMode: 'sdr',
        kanbanStage: 'novo',
        waStage: 'abertura' as WaStage,
        // Origem: anúncio Click-to-WhatsApp > automação de Instagram > WhatsApp orgânico
        utmSource: fromAd ? 'ctwa' : fromInstagram ? 'instagram' : 'whatsapp',
        utmMedium: fromAd ? 'whatsapp-ad' : fromInstagram ? 'ig-automation' : 'sdr',
        // Nome do anúncio vira utm_campaign quando disponível — aparece direto no
        // Kanban/relatórios sem precisar abrir o Ads Manager.
        utmCampaign: fromAd ? (ctwa?.adTitle ?? ctwa?.sourceId ?? undefined) : undefined,
        ctwaClid: ctwa?.clid,
        ctwaSourceUrl: ctwa?.sourceUrl,
        ctwaSourceId: ctwa?.sourceId,
        ctwaAdTitle: ctwa?.adTitle,
      });
      isNew = true;
      this.fetchAndSaveAvatar(lead.id, lead.phone, lead.name);
      if (fromAd) {
        this.logger.log(`[SDR] Lead ${phone} veio de anúncio CTWA (ctwa_clid=${ctwa!.clid}, ad="${ctwa?.adTitle ?? ctwa?.sourceId ?? '?'}")`);
        // Enriquece com nome real de campanha/conjunto/anúncio via Marketing API,
        // em segundo plano — não atrasa a resposta ao lead. Só roda se tiver o
        // Ad ID (sourceId) e o FB_ADS_TOKEN configurado.
        if (ctwa?.sourceId) this.enrichAdAttribution(lead.id, ctwa.sourceId);
      } else if (fromInstagram) {
        this.logger.log(`[SDR] Lead ${phone} veio da automação de Instagram (link com "vim do Instagram")`);
      }
      this.realtime.emitLeadCreated(lead);
    } else if (lead.agentMode !== 'sdr') {
      // Lead já existia (ex.: veio de outro fluxo) — passa a ser do SDR
      lead = await this.leadsService.update(lead.id, { agentMode: 'sdr' });
    }

    // Encerrado por handoff: bloqueia a IA, a menos que o operador tenha reativado via switch.
    // Mesmo sem a IA responder, a mensagem do lead precisa ser salva — antes era
    // descartada aqui, apagando a conversa do closer com o lead do histórico.
    if (lead.waStage === 'encerrado' && lead.aiPaused !== false) {
      const ctx = [...(Array.isArray(lead.aiContext) ? lead.aiContext : []), { role: 'user', content: text, timestamp: new Date().toISOString() }];
      lead = await this.leadsService.update(lead.id, { aiContext: ctx, waLastMessageAt: new Date() });
      this.realtime.emitLeadUpdated(lead);
      this.logger.log(`[SDR] Lead ${phone} encerrado — closer assumiu, mensagem registrada sem resposta automática`);
      return;
    }

    // IA pausada: humano assumiu. Registra a mensagem recebida mas não responde.
    if (lead.aiPaused) {
      const ctx = [...(Array.isArray(lead.aiContext) ? lead.aiContext : []), { role: 'user', content: text, timestamp: new Date().toISOString() }];
      lead = await this.leadsService.update(lead.id, { aiContext: ctx, waLastMessageAt: new Date() });
      this.realtime.emitLeadUpdated(lead);
      this.logger.log(`[SDR] Lead ${phone} com IA pausada — mensagem registrada, sem resposta`);
      return;
    }

    // Lead respondeu → reinicia a cadência de follow-up (toque 1 daqui 30min).
    await this.sdrFollowup.resetCadenceOnReply(lead.id);

    // Camada 1 de STOP (determinístico) — roda DEPOIS do reset acima, senão o
    // reset reativaria a pausa desta mesma mensagem.
    if (this.sdrFollowup.checkStopKeyword(text)) {
      await this.sdrFollowup.pauseCadence(lead.id);
      this.logger.warn(`[SDR][FOLLOWUP-STOP] Pedido de parar detectado (regex) — cadência pausada para ${phone}`);
    }

    await this.sendTyping(phone, 2000);

    // Tabela de horários livres do Marcel, recalculada a cada mensagem — a Clara
    // só pode oferecer/confirmar horários que estão literalmente aqui.
    const availability = await this.availabilityService.buildAvailabilityBlock();

    // Processa com IA (1 retry se falhar)
    let ai = await this.sdrService.processMessage(lead, text, availability.text);
    if (!ai.success) {
      await new Promise((r) => setTimeout(r, 2000));
      ai = await this.sdrService.processMessage(lead, text, availability.text);
    }

    // Loop: a IA respondeu a mesma coisa 3 vezes seguidas (não avança a conversa).
    // Pausa imediatamente em vez de mandar a msg repetida de novo — evita ficar
    // martelando o lead e avisa o operador assumir manualmente.
    if (this.isLoopReply(lead, ai.reply)) {
      this.logger.warn(`[SDR] Loop detectado para ${phone} — IA pausada automaticamente`);
      const ctx = [...(Array.isArray(lead.aiContext) ? lead.aiContext : []), { role: 'user', content: text, timestamp: new Date().toISOString() }];
      lead = await this.leadsService.update(lead.id, { aiContext: ctx, waLastMessageAt: new Date(), aiPaused: true });
      this.realtime.emitLeadUpdated(lead);
      await this.notifyOperatorLoop(lead);
      return;
    }

    // Sinal da pergunta única (dona de schedule?) é persistido: só sobrescreve
    // quando a IA manda algo novo nesta mensagem, senão mantém o valor já salvo.
    const donaDeSchedule = ai.donaDeSchedule === true || ai.donaDeSchedule === false ? ai.donaDeSchedule : lead.donaDeSchedule ?? null;
    const nomeValue = ai.nome && typeof ai.nome === 'string' && ai.nome !== 'null' ? ai.nome.trim() : null;

    // Raia calculada: todo lead já vem pré-qualificado pelo anúncio, não existe
    // desqualificação aqui — só diferencia "qualificado" (já é dona do próprio
    // schedule) de "atendimento" (ainda helper, ou ainda não respondeu).
    const derivedStage = deriveKanbanStage(donaDeSchedule, ai.stage, lead.status);

    // Pronta pro próximo passo (agenda) assim que a pergunta única foi
    // respondida — não existe mais critério de qualificação além disso.
    const readyForHandoff = donaDeSchedule !== null;
    const alreadyHandedOff = lead.waStage === 'encerrado';

    // A Clara só faz handoff de vez quando CONFIRMOU um horário real com o
    // Marcel (action="schedule") — ou, se não há disponibilidade nenhuma na
    // agenda, cai no comportamento antigo (handoff sem agendar, "a equipe
    // entra em contato"). Enquanto isso, mesmo já sabendo a resposta da
    // pergunta única, ela continua respondendo (oferecendo/confirmando
    // horário) nos próximos turnos.
    // Roda ANTES de montar contextReply/updatedContext — se a corrida de horário
    // falhar, ai.reply é sobrescrito aqui e o histórico salvo abaixo já reflete
    // a mensagem real enviada, não a que a IA assumiu que ia mandar.
    let bookedNow = false;
    let bookedAtDateTime: Date | null = null;
    if (readyForHandoff && !alreadyHandedOff && ai.action === 'schedule' && ai.appointmentDateTime) {
      const parsedDateTime = this.availabilityService.parseNyNaiveDateTime(ai.appointmentDateTime);
      if (parsedDateTime && (await this.availabilityService.isSlotAvailable(parsedDateTime))) {
        try {
          await this.appointmentsService.create({
            leadId: lead.id,
            clientName: lead.name || phone,
            clientPhone: phone,
            service: 'Sessão de Mentoria Gratuita com Marcel',
            startDateTime: parsedDateTime,
            status: 'agendado',
          });
          bookedNow = true;
          bookedAtDateTime = parsedDateTime;
          this.logger.log(`[SDR][AGENDA] Sessão de Mentoria marcada para ${phone} em ${parsedDateTime.toISOString()}`);
        } catch (err: any) {
          this.logger.error(`[SDR][AGENDA] Falha ao criar agendamento pra ${phone}: ${err.message}`);
        }
      } else {
        // Corrida: horário que a IA ofereceu já não está mais livre (raro, mas
        // possível se dois leads confirmarem quase ao mesmo tempo). Não confirma,
        // não faz handoff — o lead continua a conversa e escolhe outro horário
        // no próximo turno, já vendo a tabela atualizada.
        this.logger.warn(`[SDR][AGENDA] Horário ${ai.appointmentDateTime} não está mais disponível para ${phone} — não agendado`);
        ai.reply = 'Poxa, esse horário acabou de ser preenchido por outra pessoa! 😅 Me diz outro horário que funcione pra você que eu já vejo se ainda tá livre.';
      }
    }

    // Escalada explícita pra humano (preço fora do documentado, reclamação,
    // ameaça jurídica, pedido de falar com o Marcel/atendente, etc.) —
    // independe da pergunta única já ter sido respondida ou não.
    const explicitEscalation = ai.shouldIgnore === true && !alreadyHandedOff;

    const handoff = !alreadyHandedOff && (explicitEscalation || (readyForHandoff && (bookedNow || !availability.hasSlots)));

    // Estágio terminal quando faz handoff
    const newStage: SdrStage = handoff ? 'encerrado' : ai.stage;

    // Guarda o histórico com "|||" trocado por quebra de linha: o marcador é só
    // uma instrução de envio (2 bolhas de WhatsApp), não deve aparecer literal
    // nem no modal de conversa do CRM nem no contexto que a própria IA relê.
    // Vem DEPOIS do bloco de agendamento acima pra já refletir um eventual
    // ai.reply sobrescrito (corrida de horário).
    const contextReply = (ai.reply ?? '').replace(/\|\|\|/g, '\n');
    const updatedContext = this.sdrService.buildUpdatedContext(lead, text, contextReply);

    const updateData: any = {
      aiContext: updatedContext,
      waStage: newStage as any,
      temperature: ai.temperature,
      waLastMessageAt: new Date(),
      followupSentAt: null,
      donaDeSchedule,
    };

    if (nomeValue) updateData.name = nomeValue;

    // Handoff → operador assume, IA desliga
    if (handoff) {
      updateData.aiPaused = true;
    }

    // Camada 2 de STOP (semântica): a própria Clara concluiu que o lead pediu
    // pra parar ou sumiu de vez (ai.stage === 'perdido') — pausa a cadência de
    // follow-up automático, mesmo sem ter batido a regex determinística acima.
    if (ai.stage === 'perdido') {
      updateData.nurturePaused = true;
    }

    // Só atualiza a raia se o operador NÃO travou o card manualmente — exceto
    // quando um agendamento REAL acabou de ser criado (bookedNow): isso é um
    // fato objetivo (existe uma linha em `appointments`) que deve sempre
    // prevalecer sobre uma trava manual antiga, mesmo travada. Sem essa exceção,
    // um card travado (ex.: alguém arrastou sem querer meses atrás) fica preso
    // pra sempre em "Novo" mesmo depois do lead agendar de verdade — já
    // aconteceu 2x (Glaucia, Giovana), sempre precisando de correção manual no
    // banco. Também destrava (kanbanStageManual: false) pra não repetir o
    // problema nos próximos toques da IA com esse lead.
    if (!lead.kanbanStageManual || bookedNow) {
      updateData.kanbanStage = bookedNow ? 'agendado' : derivedStage;
      if (bookedNow) updateData.kanbanStageManual = false;
    }

    // Sem envio de evento Lead/MQL pro Meta neste tenant por enquanto — as
    // credenciais do Meta configuradas aqui ainda são as do Fagner, não as do
    // Marcel. Reativar (mesmo padrão do convertHairCRM original,
    // facebookService.sendLeadEvent/sendMqlEvent) assim que o Marcel passar
    // as próprias credenciais.

    lead = await this.leadsService.update(lead.id, updateData);

    if (ai.reply) await this.sendReplyAsBubbles(phone, ai.reply);

    // Handoff: avisa o closer e destaca o card
    if (handoff) {
      await this.notifyOperator(lead, bookedAtDateTime ?? undefined);
      this.realtime.emitLeadHandoff(lead);
    } else {
      this.realtime.emitLeadUpdated(lead);
    }
  }

  /** Normaliza texto pra comparação de loop: minúsculo, sem acento/pontuação, espaços colapsados. */
  private normalizeForLoop(text: string): string {
    return (text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Detecta loop quando a nova resposta da IA repete (~igual) as 2 últimas
   * respostas dela mesma nesse lead — sinal de conversa travada, não repetição
   * legítima (ex.: confirmação curta tipo "certo!" só 1-2x não conta).
   */
  private isLoopReply(lead: Lead, newReply?: string): boolean {
    const newNorm = this.normalizeForLoop(newReply || '');
    if (!newNorm || newNorm.length < 8) return false;
    const priorContext = Array.isArray(lead.aiContext) ? lead.aiContext : [];
    const priorAssistant = priorContext
      .filter((m: any) => m?.role === 'assistant' && m?.content)
      .slice(-2)
      .map((m: any) => this.normalizeForLoop(m.content));
    return priorAssistant.length === 2 && priorAssistant.every((t) => t === newNorm);
  }

  /** Avisa o operador que a IA travou num loop e foi pausada automaticamente. */
  private async notifyOperatorLoop(lead: Lead) {
    const stored = await this.settings.get(SDR_NOTIFY_PHONES_KEY);
    const phones: string[] = stored
      ? stored.split(',').map((p) => p.trim()).filter(Boolean)
      : this.operatorPhone ? [this.operatorPhone] : [];

    if (phones.length === 0) return;

    const msg = `⚠️ Loop detectado — IA pausada automaticamente!\n\nNome: ${lead.name}\nWhatsApp: ${lead.phone}\n\nA IA ficou repetindo a mesma resposta. Assuma a conversa manualmente.`;

    await Promise.allSettled(
      phones.map((phone) =>
        firstValueFrom(
          this.http.post(
            `${this.uazapiBaseUrl}/send/text`,
            { number: phone, text: msg },
            { headers: { token: this.uazapiToken } },
          ),
        ).catch((err: any) => this.logger.error(`[SDR] Erro ao notificar loop ${phone}: ${err.message}`)),
      ),
    );
  }

  private async notifyOperator(lead: Lead, bookedAt?: Date) {
    // Resolve phones: banco tem prioridade, env var é fallback para o primeiro
    const stored = await this.settings.get(SDR_NOTIFY_PHONES_KEY);
    const phones: string[] = stored
      ? stored.split(',').map((p) => p.trim()).filter(Boolean)
      : this.operatorPhone ? [this.operatorPhone] : [];

    if (phones.length === 0) return;

    const donaDeScheduleLine = lead.donaDeSchedule == null
      ? ''
      : `\nDona do próprio schedule: ${lead.donaDeSchedule ? 'sim' : 'não (helper)'}`;
    const bookedLine = bookedAt
      ? `\n\n📅 Já ficou AGENDADA a Sessão de Mentoria: ${bookedAt.toLocaleString('pt-BR', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short', hour12: true })} (horário de Nova York)`
      : '';
    const msg = `🔥 Lead da Clara (Pro Cleaning)!\n\nNome: ${lead.name}\nWhatsApp: ${lead.phone}${donaDeScheduleLine}${bookedLine}\n\nAssuma a conversa.`;

    await Promise.allSettled(
      phones.map((phone) =>
        firstValueFrom(
          this.http.post(
            `${this.uazapiBaseUrl}/send/text`,
            { number: phone, text: msg },
            { headers: { token: this.uazapiToken } },
          ),
        ).catch((err: any) => this.logger.error(`[SDR] Erro ao notificar ${phone}: ${err.message}`)),
      ),
    );
  }

  /** Retorna se a uazapi confirmou o envio (true) ou não (false) — quem chama decide o que fazer com a falha. */
  private async sendMessage(phone: string, text: string): Promise<boolean> {
    try {
      // phone já vem completo (com DDI correto) direto do JID do WhatsApp —
      // não prefixar 55 aqui (mesmo bug do create acima).
      await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/send/text`,
          { number: phone, text },
          { headers: { token: this.uazapiToken } },
        ),
      );
      this.logger.log(`[SDR] respondeu para ${phone}`);
      return true;
    } catch (err: any) {
      this.logger.error(`[SDR] Erro ao enviar resposta para ${phone}: ${err.message}`);
      return false;
    }
  }

  /**
   * A IA pode separar a resposta em mais de uma "bolha" do WhatsApp usando "|||"
   * como marcador (ex.: saudação numa bolha, pergunta na próxima) — imita alguém
   * mandando duas mensagens seguidas em vez de um bloco só de texto.
   */
  private splitBubbles(reply: string): string[] {
    const raw = reply.split('|||').map((b) => b.trim()).filter(Boolean);

    // Proteção determinística: mesmo com o prompt instruindo o contrário, a IA
    // às vezes quebra uma lista de bullets (dias/horários disponíveis) em
    // várias bolhas via "|||" — uma mensagem de WhatsApp por item, poluído.
    // Aqui junta de volta bolhas consecutivas que começam com "•" numa só,
    // separadas por quebra de linha real — nunca depende só do prompt pra isso.
    const merged: string[] = [];
    for (const bubble of raw) {
      const isBullet = bubble.startsWith('•');
      const prev = merged[merged.length - 1];
      if (isBullet && prev !== undefined && prev.startsWith('•')) {
        merged[merged.length - 1] = `${prev}\n${bubble}`;
      } else {
        merged.push(bubble);
      }
    }
    return merged;
  }

  /**
   * Tempo de "digitação" proporcional ao tamanho do texto, simulando o quanto um
   * humano levaria pra escrever aquilo (~45ms por caractere — mesma fórmula do
   * fisio-secretary, considerada mais natural que a anterior daqui, que era 2x mais
   * rápida), com piso e teto pra não parecer instantâneo nem travar demais numa
   * resposta longa.
   */
  private typingDelayForText(text: string): number {
    const msPerChar = 45;
    return Math.min(6000, Math.max(1200, Math.round(text.length * msPerChar)));
  }

  /**
   * Envia a resposta da IA em uma ou mais bolhas, cada uma com "digitando..." proporcional
   * ao tamanho do texto. Retorna false se QUALQUER bolha falhar — quem chama decide se isso
   * bloqueia gravar a mensagem como enviada (ver sendProactiveOpening).
   */
  private async sendReplyAsBubbles(phone: string, reply: string): Promise<boolean> {
    const bubbles = this.splitBubbles(reply);
    let allOk = true;
    for (const bubble of bubbles) {
      const delay = this.typingDelayForText(bubble);
      await this.sendTyping(phone, delay);
      await new Promise((r) => setTimeout(r, delay));
      const ok = await this.sendMessage(phone, bubble);
      if (!ok) allOk = false;
    }
    return allOk;
  }

  private async sendTyping(phone: string, durationMs: number) {
    try {
      // phone já vem completo (com DDI correto) — não prefixar 55.
      await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/message/presence`,
          { number: phone, presence: 'composing', delay: durationMs },
          { headers: { token: this.uazapiToken } },
        ),
      );
    } catch {
      // typing indicator não é crítico
    }
  }
}
