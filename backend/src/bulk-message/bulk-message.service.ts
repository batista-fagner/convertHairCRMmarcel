import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { Lead } from '../common/entities/lead.entity';
import { BulkCampaign } from '../common/entities/bulk-campaign.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export type RecipientFilter = 'imported' | 'never-contacted' | 'all';

interface SendBulkDto {
  leadIds: string[];
  message: string;
  name?: string;
  delayMin?: number;
  delayMax?: number;
}

/**
 * Disparo em massa via fila da uazapi (/sender/advanced) — portado do
 * fisio-secretary/bulk-message, adaptado pro Marcel CRM (instância única,
 * token do SDR). A uazapi cuida do espaçamento entre envios (delayMin/Max em
 * segundos, aleatório por mensagem) — protege o número de bloqueio por rajada.
 *
 * Cada lead disparado recebe a mensagem gravada no aiContext + waLastMessageAt,
 * então: aparece na conversa do CRM, o lead importado entra no Kanban (com a
 * tag "Importado") e, se responder, a Clara continua o papo normalmente.
 */
@Injectable()
export class BulkMessageService {
  private readonly logger = new Logger(BulkMessageService.name);
  private readonly uazapiBaseUrl: string;
  private readonly uazapiToken: string;

  constructor(
    private http: HttpService,
    private config: ConfigService,
    private realtime: RealtimeGateway,
    @InjectRepository(Lead)
    private leadsRepo: Repository<Lead>,
    @InjectRepository(BulkCampaign)
    private campaignRepo: Repository<BulkCampaign>,
  ) {
    this.uazapiBaseUrl = config.get('SDR_UAZAPI_BASE_URL') || config.get('UAZAPI_BASE_URL') || '';
    this.uazapiToken = config.get('SDR_UAZAPI_TOKEN') || '';
  }

  private get headers() {
    return { token: this.uazapiToken };
  }

  // {nome} = primeiro nome (mensagem de WhatsApp soa natural), {telefone} = número completo.
  private interpolate(template: string, lead: Lead): string {
    const isPlaceholder = /^Lead \d+$/i.test(lead.name || '');
    const firstName = isPlaceholder ? '' : (lead.name || '').trim().split(/\s+/)[0] || '';
    return template
      .replace(/\{nome\}/gi, firstName)
      .replace(/\{telefone\}/gi, lead.phone)
      // Nome vazio (placeholder) pode deixar espaço duplo tipo "Oi , tudo bem" — limpa.
      .replace(/ {2,}/g, ' ')
      .replace(/ ,/g, ',');
  }

  /** Leads elegíveis pra seleção na tela, conforme o filtro. */
  async listRecipients(filter: RecipientFilter): Promise<Partial<Lead>[]> {
    const query = this.leadsRepo
      .createQueryBuilder('lead')
      .select(['lead.id', 'lead.name', 'lead.phone', 'lead.kanbanStage', 'lead.importedAt', 'lead.waLastMessageAt', 'lead.createdAt'])
      .where('lead.agent_mode = :mode', { mode: 'sdr' })
      .orderBy('lead.created_at', 'DESC');

    if (filter === 'imported') {
      query.andWhere('lead.imported_at IS NOT NULL');
    } else if (filter === 'never-contacted') {
      query.andWhere('lead.wa_last_message_at IS NULL');
    }
    return query.getMany();
  }

  async sendBulk(dto: SendBulkDto): Promise<{ queued: number; campaignId: string }> {
    if (!this.uazapiToken) {
      throw new BadRequestException('WhatsApp não configurado (SDR_UAZAPI_TOKEN ausente)');
    }
    const message = (dto.message || '').trim();
    if (!message) throw new BadRequestException('Mensagem não pode ser vazia');
    if (!dto.leadIds?.length) throw new BadRequestException('Nenhum lead selecionado');

    // Delay entre envios: piso de 10s — base fria disparada rápido demais é o
    // caminho mais curto pro número cair. Teto de 3600 só pra sanidade.
    const delayMin = Math.min(Math.max(dto.delayMin ?? 20, 10), 3600);
    const delayMax = Math.min(Math.max(dto.delayMax ?? 40, delayMin), 3600);

    const leads = await this.leadsRepo.find({ where: { id: In(dto.leadIds) } });
    if (!leads.length) throw new BadRequestException('Nenhum lead válido encontrado');

    const name = dto.name?.trim() || `Disparo ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`;
    const messages = leads.map((lead) => ({
      number: lead.phone,
      type: 'text',
      text: this.interpolate(message, lead),
    }));

    this.logger.log(`[Bulk] Enfileirando campanha "${name}" para ${messages.length} lead(s) (delay ${delayMin}-${delayMax}s)`);

    const res = await firstValueFrom(
      this.http.post(
        `${this.uazapiBaseUrl}/sender/advanced`,
        { delayMin, delayMax, scheduled_for: 1, info: name, messages },
        { headers: this.headers },
      ),
    );
    const data = res.data as any;
    const folderId: string | undefined = data?.folder_id ?? data?.id ?? data?.folderId ?? undefined;

    const campaign = await this.campaignRepo.save(this.campaignRepo.create({
      name,
      message,
      totalRecipients: messages.length,
      folderId: folderId ?? null,
      status: 'sending',
      provider: 'uazapi',
      delayMin,
      delayMax,
    }));

    // Grava a mensagem na conversa de cada lead (a uazapi não ecoa envio de API
    // de volta pro webhook — sem isso a conversa ficaria vazia no CRM e a Clara
    // não teria contexto quando o lead respondesse). waLastMessageAt preenchido
    // também é o que faz o lead importado aparecer no Kanban.
    const now = new Date();
    for (const lead of leads) {
      const text = this.interpolate(message, lead);
      const ctx = Array.isArray(lead.aiContext) ? lead.aiContext : [];
      await this.leadsRepo.update(lead.id, {
        aiContext: [...ctx, { role: 'assistant', content: text, source: 'bulk', campaignId: campaign.id, timestamp: now.toISOString() }],
        waLastMessageAt: now,
        waStage: lead.waStage || ('abertura' as any),
      });
      const fresh = await this.leadsRepo.findOne({ where: { id: lead.id } });
      if (fresh) this.realtime.emitLeadUpdated(fresh);
    }

    this.logger.log(`[Bulk] Campanha ${campaign.id} criada (folder_id: ${folderId ?? 'N/A'})`);
    return { queued: messages.length, campaignId: campaign.id };
  }

  /** Lista campanhas + sincroniza status das ativas com a uazapi. */
  async getCampaigns(): Promise<BulkCampaign[]> {
    const campaigns = await this.campaignRepo.find({ order: { createdAt: 'DESC' } });

    const active = campaigns.filter((c) => c.folderId && c.status !== 'done' && c.status !== 'deleting');
    if (active.length > 0 && this.uazapiToken) {
      try {
        const res = await firstValueFrom(
          this.http.get(`${this.uazapiBaseUrl}/sender/listfolders`, { headers: this.headers }),
        );
        const folders: any[] = Array.isArray(res.data) ? res.data : (res.data?.folders ?? res.data?.data ?? []);
        for (const campaign of active) {
          const folder = folders.find((f: any) => f.folder_id === campaign.folderId || f.id === campaign.folderId);
          if (folder?.status && folder.status !== campaign.status) {
            await this.campaignRepo.update(campaign.id, { status: folder.status });
            campaign.status = folder.status;
          }
        }
      } catch (err: any) {
        this.logger.warn(`[Bulk] Não foi possível sincronizar status com uazapi: ${err.message}`);
      }
    }
    return campaigns;
  }

  async getCampaignById(id: string): Promise<BulkCampaign | null> {
    return this.campaignRepo.findOne({ where: { id } });
  }

  /** Mensagens individuais da campanha (status por destinatário), com nome do lead. */
  async getCampaignMessages(folderId: string, limit = 200, offset = 0): Promise<any> {
    try {
      const res = await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/sender/listmessages`,
          { folder_id: folderId, limit, offset },
          { headers: this.headers },
        ),
      );
      const messages: any[] = Array.isArray(res.data) ? res.data : (res.data?.messages ?? []);

      const phones = messages
        .map((m) => m.chatid?.replace('@s.whatsapp.net', '').replace('@g.us', ''))
        .filter(Boolean);
      const leads = phones.length ? await this.leadsRepo.find({ where: { phone: In(phones) } }) : [];
      const nameMap = new Map(leads.map((l) => [l.phone, l.name]));

      const enriched = messages.map((m) => {
        const phone = m.chatid?.replace('@s.whatsapp.net', '').replace('@g.us', '');
        return { ...m, leadName: nameMap.get(phone) || null };
      });
      return Array.isArray(res.data) ? enriched : { ...res.data, messages: enriched };
    } catch (err: any) {
      this.logger.error(`[Bulk] Erro ao buscar mensagens da campanha ${folderId}: ${err.message}`);
      return null;
    }
  }

  async controlCampaign(folderId: string, action: 'stop' | 'continue' | 'delete'): Promise<any> {
    const res = await firstValueFrom(
      this.http.post(
        `${this.uazapiBaseUrl}/sender/edit`,
        { folder_id: folderId, action },
        { headers: this.headers },
      ),
    );
    const newStatus = action === 'stop' ? 'paused' : action === 'continue' ? 'scheduled' : 'deleting';
    await this.campaignRepo.update({ folderId }, { status: newStatus });
    this.logger.log(`[Bulk] Ação "${action}" executada na campanha ${folderId}`);
    return res.data;
  }
}
