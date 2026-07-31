import { Controller, Get, Post, Body, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/**
 * Conexão da instância WhatsApp do SDR via QR code direto do CRM — sem
 * precisar do painel da uazapi nem de comando manual no terminal. Instância
 * única (sem multi-tenant): sempre usa o SDR_UAZAPI_TOKEN já configurado no
 * ambiente, só expõe connect/status/disconnect dessa mesma instância.
 */
@Controller('whatsapp-instance')
export class WhatsappInstanceController {
  private readonly logger = new Logger(WhatsappInstanceController.name);
  private readonly uazapiBaseUrl: string;
  private readonly uazapiToken: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.uazapiBaseUrl = config.get('SDR_UAZAPI_BASE_URL') || config.get('UAZAPI_BASE_URL') || 'https://free.uazapi.com';
    this.uazapiToken = config.get('SDR_UAZAPI_TOKEN') || '';
  }

  @Get('status')
  async getStatus() {
    if (!this.uazapiToken) {
      return { configured: false, connected: false };
    }
    try {
      const res = await firstValueFrom(
        this.http.get(`${this.uazapiBaseUrl}/instance/status`, { headers: { token: this.uazapiToken } }),
      );
      const data = res.data as any;
      return {
        configured: true,
        connected: !!data?.status?.connected,
        connecting: data?.instance?.status === 'connecting',
        profileName: data?.instance?.profileName || null,
        profilePicUrl: data?.instance?.profilePicUrl || null,
        owner: data?.instance?.owner || null,
        qrcode: data?.instance?.qrcode || null,
        paircode: data?.instance?.paircode || null,
        lastDisconnectReason: data?.instance?.lastDisconnectReason || null,
      };
    } catch (err: any) {
      this.logger.error(`Erro ao buscar status da instância: ${err.message}`);
      return { configured: true, connected: false, error: 'Erro ao consultar uazapi' };
    }
  }

  @Post('connect')
  async connect(@Body() body: { phone?: string }) {
    if (!this.uazapiToken) {
      return { error: 'SDR_UAZAPI_TOKEN não configurado' };
    }
    try {
      const payload: Record<string, string> = { browser: 'auto' };
      if (body?.phone) payload.phone = body.phone.replace(/\D/g, '');
      const res = await firstValueFrom(
        this.http.post(`${this.uazapiBaseUrl}/instance/connect`, payload, { headers: { token: this.uazapiToken } }),
      );
      const data = res.data as any;
      this.logger.log('Conexão da instância WhatsApp iniciada (QR/paircode gerado)');
      return {
        qrcode: data?.instance?.qrcode || null,
        paircode: data?.instance?.paircode || null,
        status: data?.instance?.status || null,
      };
    } catch (err: any) {
      this.logger.error(`Erro ao iniciar conexão da instância: ${err.message}`);
      return { error: err.response?.data?.message || err.message };
    }
  }

  @Post('disconnect')
  async disconnect() {
    if (!this.uazapiToken) {
      return { error: 'SDR_UAZAPI_TOKEN não configurado' };
    }
    try {
      await firstValueFrom(
        this.http.post(`${this.uazapiBaseUrl}/instance/disconnect`, {}, { headers: { token: this.uazapiToken } }),
      );
      this.logger.log('Instância WhatsApp desconectada manualmente pelo operador');
      return { ok: true };
    } catch (err: any) {
      this.logger.error(`Erro ao desconectar instância: ${err.message}`);
      return { error: err.response?.data?.message || err.message };
    }
  }
}
