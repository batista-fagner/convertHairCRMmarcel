import { Controller, Post, Param, Body, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { Lead } from '../common/entities/lead.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SdrFollowupService } from './sdr-followup.service';

type MediaType = 'image' | 'video' | 'document' | 'audio';

interface SendMessageDto {
  type: 'text' | MediaType;
  text?: string;
  base64?: string;
  mimeType?: string;
  filename?: string;
  caption?: string;
}

@Controller('leads')
export class ManualMessageController {
  private readonly logger = new Logger(ManualMessageController.name);
  private readonly uazapiBaseUrl: string;
  private readonly uazapiToken: string;

  constructor(
    @InjectRepository(Lead)
    private leadsRepo: Repository<Lead>,
    private http: HttpService,
    private config: ConfigService,
    private realtime: RealtimeGateway,
    private sdrFollowup: SdrFollowupService,
  ) {
    this.uazapiBaseUrl = config.get('SDR_UAZAPI_BASE_URL') || config.get('UAZAPI_BASE_URL') || '';
    this.uazapiToken = config.get('SDR_UAZAPI_TOKEN') || '';
  }

  @Post(':id/send-message')
  async sendManualMessage(@Param('id') id: string, @Body() body: SendMessageDto) {
    const lead = await this.leadsRepo.findOne({ where: { id } });
    if (!lead) throw new HttpException('Lead not found', HttpStatus.NOT_FOUND);

    if (!this.uazapiToken) {
      throw new HttpException('WhatsApp não configurado (SDR_UAZAPI_TOKEN ausente)', HttpStatus.SERVICE_UNAVAILABLE);
    }

    // lead.phone já vem completo (com DDI correto) — não prefixar 55.
    await this.dispatchToUazapi(lead.phone, body);

    const ctx = Array.isArray(lead.aiContext) ? lead.aiContext : [];
    const entry: Record<string, any> = { role: 'assistant', source: 'operator', timestamp: new Date().toISOString() };

    if (body.type === 'text') {
      entry.content = body.text || '';
    } else {
      entry.content = body.caption || '';
      entry.mediaType = body.type;
      entry.filename = body.filename || body.type;
      // Store base64 for inline display in the conversation modal.
      // Frontend enforces a 5 MB file size limit before sending.
      if (body.base64) entry.base64 = body.base64;
    }

    await this.leadsRepo.update(id, {
      aiContext: [...ctx, entry],
      waLastMessageAt: new Date(),
    });

    // Igual ao sendProactiveOpening/bulk-message: envio manual pelo operador
    // também precisa agendar o próximo toque da cadência, senão o lead fica
    // pra sempre sem next_nurture_at (ver leads Ledslane/Leka, 2026-08-16).
    await this.sdrFollowup.resetCadenceOnReply(id);

    const fresh = await this.leadsRepo.findOne({ where: { id } });
    if (fresh) this.realtime.emitLeadUpdated(fresh);

    this.logger.log(`[Manual] Operador enviou ${body.type} para ${lead.phone}`);
    return { ok: true };
  }

  @Post(':id/fetch-avatar')
  async fetchAvatar(@Param('id') id: string) {
    const lead = await this.leadsRepo.findOne({ where: { id } });
    if (!lead) throw new HttpException('Lead not found', HttpStatus.NOT_FOUND);
    if (!this.uazapiToken) {
      throw new HttpException('WhatsApp não configurado (SDR_UAZAPI_TOKEN ausente)', HttpStatus.SERVICE_UNAVAILABLE);
    }

    // lead.phone já vem completo (com DDI correto) — não prefixar 55.
    const phone = lead.phone;

    try {
      const res = await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/chat/details`,
          { number: phone, preview: true },
          { headers: { token: this.uazapiToken } },
        ),
      );
      const data = res.data as { imagePreview?: string; image?: string; name?: string; wa_contactName?: string; wa_name?: string };
      const avatarUrl = data.imagePreview || data.image || null;
      const realName = data.name || data.wa_contactName || data.wa_name;

      const patch: Record<string, any> = { avatarUrl };
      // Só sobrescreve o nome se ainda estiver no placeholder "Lead XXXX" —
      // não pisa em cima de um nome já coletado pela IA ou editado manualmente.
      if (realName && /^Lead \d+$/.test(lead.name)) patch.name = realName;

      await this.leadsRepo.update(id, patch);
      const fresh = await this.leadsRepo.findOne({ where: { id } });
      if (fresh) this.realtime.emitLeadUpdated(fresh);
      return { avatarUrl, name: patch.name };
    } catch (err: any) {
      this.logger.warn(`[Manual] Falha ao buscar foto de perfil de ${phone}: ${err.message}`);
      return { avatarUrl: null };
    }
  }

  private async dispatchToUazapi(phone: string, body: SendMessageDto) {
    const headers = { token: this.uazapiToken };
    const base = this.uazapiBaseUrl;

    try {
      if (body.type === 'text') {
        await firstValueFrom(
          this.http.post(`${base}/send/text`, { number: phone, text: body.text }, { headers }),
        );
      } else {
        // uazapi não tem /send/image, /send/video, /send/document, /send/audio
        // separados (isso dava 405) — todo mídia vai por /send/media com
        // `type`, igual ao resto do backend (ver sdr-followup.service.ts,
        // efraim.controller.ts).
        await firstValueFrom(
          this.http.post(
            `${base}/send/media`,
            {
              number: phone,
              type: body.type,
              file: body.base64,
              mimetype: body.mimeType,
              text: body.caption || '',
              docName: body.type === 'document' ? (body.filename || 'arquivo') : undefined,
              delay: 1000,
            },
            { headers },
          ),
        );
      }
    } catch (err: any) {
      const status = err.response?.status;
      const uazapiDetail = err.response?.data?.message || err.response?.data?.error || err.message;
      this.logger.error(`[Manual] Falha ao enviar ${body.type} para ${phone}: [${status ?? 'sem status'}] ${uazapiDetail}`);
      throw new HttpException(this.friendlyUazapiError(status, uazapiDetail), HttpStatus.BAD_GATEWAY);
    }
  }

  // Traduz a falha técnica da uazapi (status HTTP + corpo do erro) numa
  // mensagem que o operador do CRM entende, sem expor jargão de API.
  private friendlyUazapiError(status: number | undefined, detail: string): string {
    const text = (detail || '').toLowerCase();
    if (status === 413 || /too large|payload|file size|large file/.test(text)) {
      return 'O WhatsApp recusou o arquivo por ser muito grande. Tente um arquivo menor.';
    }
    if (status === 401 || status === 403) {
      return 'A conexão do WhatsApp expirou ou está sem permissão. Reconecte a instância em Configurações.';
    }
    if (status === 404 || status === 405) {
      return 'Não foi possível enviar pelo WhatsApp agora (instância indisponível). Tente novamente em instantes.';
    }
    if (!status) {
      return 'Não foi possível conectar ao WhatsApp. Verifique sua internet e tente novamente.';
    }
    return 'Não foi possível enviar a mensagem pelo WhatsApp. Tente novamente em instantes.';
  }
}
