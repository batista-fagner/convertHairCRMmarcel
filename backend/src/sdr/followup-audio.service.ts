import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { FollowupAudio } from '../common/entities/followup-audio.entity';
import { FollowupRule } from '../common/entities/followup-rule.entity';

// WhatsApp aceita nota de voz até esse tamanho de forma confiável.
const MAX_AUDIO_SIZE_MB = 16;

// Mimetypes aceitos, já normalizados (sem ";codecs=..."). O Chrome grava
// "audio/webm;codecs=opus" — normalizamos antes de comparar/gravar, senão a
// checagem estrita rejeitaria todo áudio gravado no navegador.
const ALLOWED_MIME_TYPES = ['audio/ogg', 'audio/opus', 'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac'];

const EXTENSION_BY_MIME: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
};

// @types/multer não está instalado no projeto — tipo mínimo do arquivo que o
// FileInterceptor entrega (buffer em memória por padrão).
export interface UploadedAudioFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

@Injectable()
export class FollowupAudioService {
  private readonly logger = new Logger(FollowupAudioService.name);
  private readonly supabase: SupabaseClient;
  private readonly bucket: string;

  constructor(
    @InjectRepository(FollowupAudio) private readonly audioRepo: Repository<FollowupAudio>,
    @InjectRepository(FollowupRule) private readonly ruleRepo: Repository<FollowupRule>,
    private readonly config: ConfigService,
  ) {
    this.supabase = createClient(
      config.get('SUPABASE_URL') ?? '',
      config.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    this.bucket = config.get('SDR_AUDIO_BUCKET') ?? 'sdr-followup-audios';
  }

  list(): Promise<FollowupAudio[]> {
    return this.audioRepo.find({ order: { createdAt: 'DESC' } });
  }

  // Cria o bucket (público) na 1ª vez, se ainda não existir — evita passo manual
  // no painel do Supabase. Idempotente: ignora o erro "já existe".
  private async ensureBucket(): Promise<void> {
    const { data } = await this.supabase.storage.getBucket(this.bucket);
    if (data) return;
    const { error } = await this.supabase.storage.createBucket(this.bucket, {
      public: true,
      fileSizeLimit: MAX_AUDIO_SIZE_MB * 1024 * 1024,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    });
    // Corrida entre requisições simultâneas pode dar "already exists" — ok.
    if (error && !/already exists/i.test(error.message)) {
      this.logger.error(`Erro ao criar bucket ${this.bucket}: ${error.message}`);
      throw new BadRequestException(`Falha ao preparar o storage: ${error.message}`);
    }
  }

  async upload(file: UploadedAudioFile, name: string, durationSeconds?: number): Promise<FollowupAudio> {
    if (!file) throw new BadRequestException('Arquivo não enviado');
    if (!name?.trim()) throw new BadRequestException('Nome é obrigatório');

    // Normaliza antes de validar — "audio/webm;codecs=opus" (Chrome) vira "audio/webm".
    const mimeType = file.mimetype.split(';')[0].trim().toLowerCase();
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException(`Formato de áudio não suportado (${mimeType}). Use ogg, webm, mp3, m4a ou aac.`);
    }
    if (file.size > MAX_AUDIO_SIZE_MB * 1024 * 1024) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      throw new BadRequestException(`Áudio muito grande (${mb}MB). Limite é ${MAX_AUDIO_SIZE_MB}MB.`);
    }

    await this.ensureBucket();
    const ext = EXTENSION_BY_MIME[mimeType] ?? 'bin';
    const storagePath = `${randomUUID()}.${ext}`;
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(storagePath, file.buffer, { contentType: mimeType, upsert: false });
    if (error) {
      this.logger.error(`Erro ao subir áudio pro storage: ${error.message}`);
      throw new BadRequestException(`Falha no upload: ${error.message}`);
    }

    const { data: urlData } = this.supabase.storage.from(this.bucket).getPublicUrl(storagePath);
    return this.audioRepo.save(this.audioRepo.create({
      name: name.trim(),
      storagePath,
      publicUrl: urlData.publicUrl,
      mimeType,
      durationSeconds: durationSeconds ?? null,
    }));
  }

  async update(id: string, patch: { name?: string }): Promise<FollowupAudio> {
    const audio = await this.audioRepo.findOne({ where: { id } });
    if (!audio) throw new NotFoundException('Áudio não encontrado');
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new BadRequestException('Nome não pode ficar vazio');
      audio.name = patch.name.trim();
    }
    return this.audioRepo.save(audio);
  }

  async delete(id: string): Promise<void> {
    const audio = await this.audioRepo.findOne({ where: { id } });
    if (!audio) throw new NotFoundException('Áudio não encontrado');

    // Recusa se alguma regra ainda usa esse áudio — evita regra apontando pra áudio fantasma.
    const inUse = await this.ruleRepo.count({ where: { audioId: id } });
    if (inUse > 0) {
      throw new BadRequestException(`Esse áudio está em uso por ${inUse} regra(s) de follow-up. Remova o áudio dessas regras antes de excluir.`);
    }

    const { error } = await this.supabase.storage.from(this.bucket).remove([audio.storagePath]);
    if (error) this.logger.warn(`Erro ao remover áudio do storage (segue com delete no banco): ${error.message}`);
    await this.audioRepo.delete(id);
  }
}
