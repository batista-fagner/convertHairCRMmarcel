import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/**
 * Garante que o webhook da instância uazapi do SDR aponte pra ESTE backend.
 *
 * Por que existe: em 10/08 as respostas das clientes sumiram do CRM — a
 * instância tinha sido recriada/reconectada ("logged out from another
 * device" no dia 09/08) e o webhook voltou pro padrão do painel
 * (api.converthair.com.br), que aceitava os POSTs com 201 e engolia tudo.
 * Nenhum erro em lugar nenhum: a Clara só "não via" as respostas e repetia
 * a mesma pergunta em follow-up. Este guard confere na subida e a cada 15min,
 * e reescreve a config se o URL/eventos estiverem errados — reconexão ou
 * troca de instância se auto-corrige em no máximo 15min.
 */
@Injectable()
export class SdrWebhookGuardService implements OnModuleInit {
  private readonly logger = new Logger(SdrWebhookGuardService.name);
  private readonly uazapiBaseUrl: string;
  private readonly uazapiToken: string;
  private readonly publicUrl: string;

  private static readonly EVENTS = ['messages'];
  // wasSentByApi: não ecoar de volta o que o próprio bot mandou via API.
  // isGroupYes: ignorar mensagens de grupo. (Mensagem digitada à mão pelo
  // operador no celular NÃO é excluída — o controle por palavra-chave
  // "opa"/"ok" do sdr.controller depende dela chegar.)
  private static readonly EXCLUDE_MESSAGES = ['wasSentByApi', 'isGroupYes'];

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.uazapiBaseUrl = config.get('SDR_UAZAPI_BASE_URL') || config.get('UAZAPI_BASE_URL') || '';
    this.uazapiToken = config.get('SDR_UAZAPI_TOKEN') || '';
    // Railway injeta RAILWAY_PUBLIC_DOMAIN automaticamente; SDR_WEBHOOK_PUBLIC_URL
    // permite forçar outro endereço (ex.: domínio próprio) sem mexer no código.
    const override = config.get('SDR_WEBHOOK_PUBLIC_URL');
    const railwayDomain = config.get('RAILWAY_PUBLIC_DOMAIN');
    this.publicUrl = override || (railwayDomain ? `https://${railwayDomain}` : '');
  }

  private get desiredUrl(): string {
    return `${this.publicUrl}/api/webhooks/sdr`;
  }

  async onModuleInit() {
    await this.ensureWebhook('boot');
  }

  @Cron('*/15 * * * *')
  async ensureWebhookCron() {
    await this.ensureWebhook('cron');
  }

  private async ensureWebhook(origin: 'boot' | 'cron') {
    if (!this.uazapiToken || !this.uazapiBaseUrl) return;
    if (!this.publicUrl) {
      // Ambiente local (sem RAILWAY_PUBLIC_DOMAIN) — nunca sobrescrever o
      // webhook de produção com um endereço de dev.
      if (origin === 'boot') this.logger.warn('[WebhookGuard] Sem URL pública (RAILWAY_PUBLIC_DOMAIN/SDR_WEBHOOK_PUBLIC_URL) — guard desativado neste ambiente');
      return;
    }

    try {
      const res = await firstValueFrom(
        this.http.get(`${this.uazapiBaseUrl}/webhook`, { headers: { token: this.uazapiToken } }),
      );
      const hooks: any[] = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
      const current = hooks[0];

      const ok =
        current &&
        current.enabled === true &&
        current.url === this.desiredUrl &&
        Array.isArray(current.events) && current.events.includes('messages');
      if (ok) return;

      this.logger.warn(
        `[WebhookGuard] Webhook da instância SDR está errado (url atual: ${current?.url || 'nenhum'}) — corrigindo para ${this.desiredUrl}`,
      );

      // POST /webhook exige um `action` explícito ("update"/"add"/"delete") —
      // sem isso responde 400 "Invalid action" mesmo com payload correto
      // (descoberto testando direto contra a API, doc não deixa isso claro).
      // Com id existente, "update" edita a entrada; sem id, "add" cria uma nova.
      const payload: Record<string, any> = {
        action: current?.id ? 'update' : 'add',
        enabled: true,
        url: this.desiredUrl,
        events: SdrWebhookGuardService.EVENTS,
        excludeMessages: SdrWebhookGuardService.EXCLUDE_MESSAGES,
        addUrlEvents: false,
        addUrlTypesMessages: false,
      };
      if (current?.id) payload.id = current.id;

      await firstValueFrom(
        this.http.post(`${this.uazapiBaseUrl}/webhook`, payload, { headers: { token: this.uazapiToken } }),
      );

      // Confere se pegou de verdade — se não pegou, loga como erro pra aparecer
      // em qualquer monitoramento, em vez de fingir que resolveu.
      const check = await firstValueFrom(
        this.http.get(`${this.uazapiBaseUrl}/webhook`, { headers: { token: this.uazapiToken } }),
      );
      const after: any[] = Array.isArray(check.data) ? check.data : check.data ? [check.data] : [];
      const fixed = after.some((h) => h?.enabled === true && h?.url === this.desiredUrl);
      if (fixed) {
        this.logger.log(`[WebhookGuard] Webhook corrigido com sucesso → ${this.desiredUrl}`);
      } else {
        this.logger.error(`[WebhookGuard] POST /webhook não surtiu efeito — config atual: ${JSON.stringify(after).slice(0, 500)}`);
      }
    } catch (err: any) {
      this.logger.error(`[WebhookGuard] Falha ao conferir/corrigir webhook: ${err.message}`);
    }
  }
}
