import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Setting } from './setting.entity';
import {
  SDR_PROMPT_KEY,
  DEFAULT_SDR_PROMPT,
  SDR_JSON_FORMAT,
  SDR_MODEL_KEY,
  SDR_DEFAULT_MODEL,
  AI_PROVIDER_API_KEY_ENC,
  AI_PROVIDER_BASE_URL,
} from '../sdr/sdr.prompt';
import { AvailabilityService } from '../availability/availability.service';
import { encryptSecret, decryptSecret, maskSecretPreview } from '../common/crypto.util';

@Injectable()
export class SettingsService {
  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly forceCodePrompt: boolean;

  constructor(
    @InjectRepository(Setting)
    private settingsRepo: Repository<Setting>,
    private config: ConfigService,
    private availabilityService: AvailabilityService,
  ) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
    this.model = config.get('SDR_OPENAI_MODEL') || 'gpt-5.4-mini';
    this.forceCodePrompt = config.get('SDR_PROMPT_FORCE_CODE') === 'true';
  }

  async get(key: string): Promise<string | null> {
    const row = await this.settingsRepo.findOne({ where: { key } });
    return row?.value ?? null;
  }

  async getRow(key: string): Promise<Setting | null> {
    return this.settingsRepo.findOne({ where: { key } });
  }

  async set(key: string, value: string): Promise<Setting> {
    await this.settingsRepo.upsert({ key, value }, ['key']);
    return this.settingsRepo.findOneOrFail({ where: { key } });
  }

  /**
   * Fonte única do client OpenAI-compatível usado pra chamar a IA (Clara).
   * Se o cliente configurou a própria chave em Configurações → Provedor de IA,
   * usa ela (e o baseURL dele, se veio algum) — senão cai pro client padrão
   * da plataforma (OPENAI_API_KEY do .env). Nunca cacheia o client entre
   * chamadas: a chave pode ter sido trocada na tela sem reiniciar o backend.
   */
  async getAiClient(): Promise<{ client: OpenAI; model: string }> {
    const [encKey, baseUrl, model] = await Promise.all([
      this.get(AI_PROVIDER_API_KEY_ENC),
      this.get(AI_PROVIDER_BASE_URL),
      this.get(SDR_MODEL_KEY),
    ]);

    if (encKey) {
      const apiKey = decryptSecret(encKey);
      return {
        client: new OpenAI({ apiKey, baseURL: baseUrl || undefined }),
        model: model || SDR_DEFAULT_MODEL,
      };
    }
    return { client: this.openai, model: model || this.model };
  }

  async getAiProviderConfig(): Promise<{ baseUrl: string; model: string; apiKeySet: boolean; apiKeyPreview: string }> {
    const [encKey, baseUrl, model] = await Promise.all([
      this.get(AI_PROVIDER_API_KEY_ENC),
      this.get(AI_PROVIDER_BASE_URL),
      this.get(SDR_MODEL_KEY),
    ]);
    return {
      baseUrl: baseUrl ?? '',
      model: model ?? SDR_DEFAULT_MODEL,
      apiKeySet: !!encKey,
      apiKeyPreview: encKey ? maskSecretPreview(decryptSecret(encKey)) : '',
    };
  }

  async setAiProviderConfig(body: { apiKey?: string; baseUrl?: string; model?: string; clearApiKey?: boolean }) {
    // Campo de chave vazio no formulário = manter a que já está salva. Só
    // `clearApiKey` explícito remove e volta pro client padrão da plataforma —
    // nesse caso também reseta o modelo pro default: senão sobra um modelo de
    // outro provedor (ex.: "gemini-2.5-flash") configurado junto com a chave
    // OpenAI da plataforma, e toda chamada quebra com model_not_found.
    if (body.clearApiKey) {
      await this.settingsRepo.delete({ key: AI_PROVIDER_API_KEY_ENC });
      if (typeof body.model !== 'string' || !body.model.trim()) {
        await this.set(SDR_MODEL_KEY, SDR_DEFAULT_MODEL);
      }
    } else if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
      await this.set(AI_PROVIDER_API_KEY_ENC, encryptSecret(body.apiKey.trim()));
    }
    if (typeof body.baseUrl === 'string') await this.set(AI_PROVIDER_BASE_URL, body.baseUrl.trim());
    if (typeof body.model === 'string' && body.model.trim()) await this.set(SDR_MODEL_KEY, body.model.trim());
    return this.getAiProviderConfig();
  }

  /**
   * Fonte única do prompt da Sofia. Com SDR_PROMPT_FORCE_CODE=true (só local/dev,
   * nunca setar em produção), ignora o que está salvo em settings.sdr_prompt e usa
   * sempre o DEFAULT_SDR_PROMPT do código — assim dá pra testar um prompt novo sem
   * afetar o banco compartilhado com produção.
   */
  async getSdrPrompt(): Promise<string> {
    if (this.forceCodePrompt) return DEFAULT_SDR_PROMPT;
    return (await this.get(SDR_PROMPT_KEY)) || DEFAULT_SDR_PROMPT;
  }

  async simulate(message: string, history: { role: 'user' | 'assistant'; content: string }[]) {
    const basePrompt = await this.getSdrPrompt();
    const { client, model } = await this.getAiClient();
    const availability = await this.availabilityService.buildAvailabilityBlock();
    const systemPrompt = `${basePrompt}\n\n# HORÁRIOS DISPONÍVEIS (agenda real do Marcel, atualizada agora)\n${availability.text}\n\n${SDR_JSON_FORMAT}`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message },
    ];

    const response = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      max_completion_tokens: 300,
      response_format: { type: 'json_object' },
    });

    let raw = response.choices[0].message.content?.trim() ?? '';
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Resposta sem JSON válido');

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      reply: parsed.reply ?? '',
      stage: parsed.stage ?? 'qualificacao',
      temperature: parsed.temperature ?? 'morno',
      nome: parsed.nome ?? null,
      donaDeSchedule: parsed.donaDeSchedule ?? null,
      action: parsed.action ?? 'none',
      appointmentDateTime: parsed.appointmentDateTime ?? null,
      shouldIgnore: parsed.shouldIgnore ?? false,
    };
  }
}
