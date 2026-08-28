import { Controller, Get, Put, Post, Body } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SDR_PROMPT_KEY, DEFAULT_SDR_PROMPT, SDR_MODEL_KEY, SDR_DEFAULT_MODEL } from '../sdr/sdr.prompt';
import { SDR_NOTIFY_PHONES_KEY } from '../sdr/sdr.controller';

@Controller('settings')
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get('sdr-prompt')
  async getSdrPrompt() {
    const value = await this.settingsService.get(SDR_PROMPT_KEY);
    return { value: value ?? DEFAULT_SDR_PROMPT, isCustom: value != null, default: DEFAULT_SDR_PROMPT };
  }

  @Put('sdr-prompt')
  async setSdrPrompt(@Body() body: { value: string }) {
    const value = (body.value ?? '').trim();
    const saved = await this.settingsService.set(SDR_PROMPT_KEY, value || DEFAULT_SDR_PROMPT);
    return { value: saved.value, isCustom: true };
  }

  @Get('sdr-model')
  async getSdrModel() {
    const value = await this.settingsService.get(SDR_MODEL_KEY);
    return { value: value ?? SDR_DEFAULT_MODEL };
  }

  @Put('sdr-model')
  async setSdrModel(@Body() body: { value: string }) {
    const allowed = ['gpt-5.4-mini', 'gpt-4.1-mini'];
    const model = allowed.includes(body.value) ? body.value : SDR_DEFAULT_MODEL;
    await this.settingsService.set(SDR_MODEL_KEY, model);
    return { value: model };
  }

  // Provedor de IA customizado — o cliente cola a própria chave (de qualquer
  // provedor compatível com a API da OpenAI: OpenAI, Gemini, Groq, DeepSeek,
  // OpenRouter etc.). A chave nunca volta pro frontend inteira, só uma prévia
  // mascarada + se está configurada ou não.
  @Get('ai-provider')
  async getAiProvider() {
    return this.settingsService.getAiProviderConfig();
  }

  @Put('ai-provider')
  async setAiProvider(@Body() body: { apiKey?: string; baseUrl?: string; model?: string; clearApiKey?: boolean }) {
    return this.settingsService.setAiProviderConfig(body);
  }

  @Post('sdr-simulate')
  async simulate(@Body() body: { message: string; history: { role: 'user' | 'assistant'; content: string }[] }) {
    return this.settingsService.simulate(body.message ?? '', body.history ?? []);
  }

  @Get('sdr-notify')
  async getNotifyPhones() {
    const value = await this.settingsService.get(SDR_NOTIFY_PHONES_KEY);
    const phones = value ? value.split(',').map((p) => p.trim()).filter(Boolean) : [];
    return { phone1: phones[0] ?? '', phone2: phones[1] ?? '' };
  }

  @Put('sdr-notify')
  async setNotifyPhones(@Body() body: { phone1: string; phone2: string }) {
    const phones = [body.phone1, body.phone2]
      .map((p) => (p || '').replace(/\D/g, ''))
      .filter(Boolean);
    const value = phones.join(',');
    await this.settingsService.set(SDR_NOTIFY_PHONES_KEY, value);
    return { phone1: phones[0] ?? '', phone2: phones[1] ?? '' };
  }

  // Guarda as credenciais do Meta Ads API no banco (chave-valor), pra não
  // depender de variável de ambiente no Railway. Token nunca volta inteiro
  // pro frontend — só um indicador de "configurado" pra não vazar segredo.
  @Get('meta-ads')
  async getMetaAdsConfig() {
    const [pixelId, pageId, adAccountId, accessToken, adsToken] = await Promise.all([
      this.settingsService.get('FB_PIXEL_ID'),
      this.settingsService.get('FB_PAGE_ID'),
      this.settingsService.get('FB_AD_ACCOUNT_ID'),
      this.settingsService.get('FB_ACCESS_TOKEN'),
      this.settingsService.get('FB_ADS_TOKEN'),
    ]);
    return {
      pixelId: pixelId ?? '',
      pageId: pageId ?? '',
      adAccountId: adAccountId ?? '',
      accessTokenSet: !!accessToken,
      adsTokenSet: !!adsToken,
    };
  }

  @Put('meta-ads')
  async setMetaAdsConfig(@Body() body: { pixelId?: string; pageId?: string; adAccountId?: string; accessToken?: string; adsToken?: string }) {
    if (typeof body.pixelId === 'string') await this.settingsService.set('FB_PIXEL_ID', body.pixelId.trim());
    if (typeof body.pageId === 'string') await this.settingsService.set('FB_PAGE_ID', body.pageId.trim());
    if (typeof body.adAccountId === 'string') await this.settingsService.set('FB_AD_ACCOUNT_ID', body.adAccountId.trim());
    // Tokens só são sobrescritos se o usuário digitar um novo valor — campo
    // vazio no formulário significa "manter o que já está salvo".
    if (body.accessToken) await this.settingsService.set('FB_ACCESS_TOKEN', body.accessToken.trim());
    if (body.adsToken) await this.settingsService.set('FB_ADS_TOKEN', body.adsToken.trim());
    return this.getMetaAdsConfig();
  }
}
