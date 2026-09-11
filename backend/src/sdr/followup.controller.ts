import { Controller, Get, Post, Put, Patch, Delete, Body, Param, BadRequestException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SdrFollowupService, VIDEO_LIMIT_KEY, DEFAULT_VIDEO_LIMIT,
  DEFAULT_CADENCE_STEPS, DEFAULT_CADENCE_WINDOWS, MAX_CADENCE_STEPS, MAX_STEP_MINUTES, MAX_GUIDE_LENGTH,
} from './sdr-followup.service';
import type { CadenceConfig } from './sdr-followup.service';
import { FollowupVideoService } from './followup-video.service';
import type { UploadedVideoFile } from './followup-video.service';
import { FollowupAudioService } from './followup-audio.service';
import type { UploadedAudioFile } from './followup-audio.service';
import { SettingsService } from '../settings/settings.service';
import { FollowupRule } from '../common/entities/followup-rule.entity';
import { Lead } from '../common/entities/lead.entity';

@Controller('followup')
export class FollowupController {
  constructor(
    private readonly followupService: SdrFollowupService,
    private readonly videoService: FollowupVideoService,
    private readonly audioService: FollowupAudioService,
    private readonly settings: SettingsService,
    @InjectRepository(FollowupRule) private readonly rulesRepo: Repository<FollowupRule>,
    @InjectRepository(Lead) private readonly leadsRepo: Repository<Lead>,
  ) {}

  @Get('status')
  async status() {
    return this.followupService.getStatus();
  }

  @Get('rules')
  async listRules() {
    await this.followupService.ensureRulesSeeded();
    return this.rulesRepo.find({ order: { createdAt: 'ASC' } });
  }

  // Valores distintos de utm_campaign já gravados nos leads — popula o dropdown
  // de campanha no formulário de regra (a página "Campanhas" ainda não é usada).
  @Get('campaign-options')
  async campaignOptions() {
    const rows = await this.leadsRepo
      .createQueryBuilder('lead')
      .select('DISTINCT lead.utm_campaign', 'utmCampaign')
      .where('lead.utm_campaign IS NOT NULL')
      .getRawMany();
    return rows.map((r) => r.utmCampaign).filter(Boolean).sort();
  }

  // Valores distintos de ctwa_ad_title já gravados nos leads — popula o dropdown de criativo.
  @Get('ad-title-options')
  async adTitleOptions() {
    const rows = await this.leadsRepo
      .createQueryBuilder('lead')
      .select('DISTINCT lead.ctwa_ad_title', 'adTitle')
      .where('lead.ctwa_ad_title IS NOT NULL')
      .getRawMany();
    return rows.map((r) => r.adTitle).filter(Boolean).sort();
  }

  @Post('rules')
  async createRule(@Body() body: Partial<FollowupRule>) {
    if (!body?.name?.trim()) throw new BadRequestException('Nome da regra é obrigatório');
    if (body.audioId && body.videoId) throw new BadRequestException('Escolha áudio OU vídeo, não os dois');
    const hasVideo = Boolean(body.videoId);
    const hasAudio = Boolean(body.audioId);
    // Regra com vídeo/áudio manda só a mídia — modo/texto (do texto puro) ficam irrelevantes.
    if (!hasVideo && !hasAudio && body.mode === 'manual' && !body.text?.trim()) {
      throw new BadRequestException('Texto é obrigatório no modo manual');
    }
    const rule = this.rulesRepo.create({
      name: body.name.trim(),
      enabled: body.enabled ?? true,
      kanbanStage: body.kanbanStage || null,
      utmCampaign: body.utmCampaign || null,
      adTitle: body.adTitle || null,
      createdAfter: body.createdAfter ? new Date(body.createdAfter) : null,
      delayMinutes: Math.max(1, body.delayMinutes || 60),
      sendAtHour: body.sendAtHour != null ? Math.min(23, Math.max(0, body.sendAtHour)) : null,
      sendAtMinute: body.sendAtMinute != null ? Math.min(59, Math.max(0, body.sendAtMinute)) : 0,
      mode: body.mode === 'ai' ? 'ai' : 'manual',
      text: body.text || null,
      videoId: hasAudio ? null : body.videoId || null,
      videoCaptionOverride: body.videoCaptionOverride || null,
      audioId: hasVideo ? null : body.audioId || null,
      audioText: body.audioText || null,
      audioOrder: body.audioOrder === 'text_first' ? 'text_first' : 'audio_first',
      audioGapSeconds: body.audioGapSeconds != null ? Math.min(180, Math.max(0, Number(body.audioGapSeconds))) : 20,
      priority: body.priority ?? 0,
    });
    return this.rulesRepo.save(rule);
  }

  @Patch('rules/:id')
  async updateRule(@Param('id') id: string, @Body() body: Partial<FollowupRule> & { resetCycle?: boolean }) {
    const rule = await this.rulesRepo.findOne({ where: { id } });
    if (!rule) throw new BadRequestException('Regra não encontrada');

    // Checar ANTES de aplicar qualquer campo — se checássemos só no final, o
    // "zerar o outro" abaixo sempre resolveria o conflito silenciosamente e o
    // 400 nunca dispararia mesmo com os dois vindo preenchidos no mesmo body.
    if (body.audioId && body.videoId) throw new BadRequestException('Escolha áudio OU vídeo, não os dois');

    if (body.name !== undefined) rule.name = body.name.trim();
    if (body.enabled !== undefined) rule.enabled = body.enabled;
    if (body.kanbanStage !== undefined) rule.kanbanStage = body.kanbanStage || null;
    if (body.utmCampaign !== undefined) rule.utmCampaign = body.utmCampaign || null;
    if (body.adTitle !== undefined) rule.adTitle = body.adTitle || null;
    if (body.createdAfter !== undefined) rule.createdAfter = body.createdAfter ? new Date(body.createdAfter) : null;
    if (body.delayMinutes !== undefined) rule.delayMinutes = Math.max(1, body.delayMinutes);
    if (body.sendAtHour !== undefined) rule.sendAtHour = body.sendAtHour != null ? Math.min(23, Math.max(0, body.sendAtHour)) : null;
    if (body.sendAtMinute !== undefined) rule.sendAtMinute = body.sendAtMinute != null ? Math.min(59, Math.max(0, body.sendAtMinute)) : 0;
    if (body.mode !== undefined) rule.mode = body.mode === 'ai' ? 'ai' : 'manual';
    if (body.text !== undefined) rule.text = body.text || null;
    // audioId/videoId são mutuamente exclusivos — setar um zera o outro
    // (defesa server-side; a UI já impede o usuário de marcar os dois).
    if (body.videoId !== undefined) {
      rule.videoId = body.videoId || null;
      if (rule.videoId) rule.audioId = null;
    }
    if (body.videoCaptionOverride !== undefined) rule.videoCaptionOverride = body.videoCaptionOverride || null;
    if (body.audioId !== undefined) {
      rule.audioId = body.audioId || null;
      if (rule.audioId) rule.videoId = null;
    }
    if (body.audioText !== undefined) rule.audioText = body.audioText || null;
    if (body.audioOrder !== undefined) rule.audioOrder = body.audioOrder === 'text_first' ? 'text_first' : 'audio_first';
    if (body.audioGapSeconds !== undefined) rule.audioGapSeconds = Math.min(180, Math.max(0, Number(body.audioGapSeconds) || 0));
    if (body.priority !== undefined) rule.priority = body.priority;

    if (rule.audioId && rule.videoId) throw new BadRequestException('Escolha áudio OU vídeo, não os dois');

    // Só exige texto quando não tem vídeo/áudio (com mídia, manda a mídia).
    if (!rule.videoId && !rule.audioId && rule.mode === 'manual' && !rule.text?.trim() && rule.enabled) {
      throw new BadRequestException('Texto é obrigatório no modo manual');
    }

    await this.rulesRepo.save(rule);

    // Libera pra um novo ciclo só os leads que casam com a raia/campanha desta regra.
    let resetCount = 0;
    if (body.resetCycle) {
      const qb = this.leadsRepo
        .createQueryBuilder()
        .update(Lead)
        .set({ followupSentAt: null })
        .where('agent_mode = :mode', { mode: 'sdr' })
        .andWhere('ai_paused = false')
        .andWhere("wa_stage != 'encerrado'")
        .andWhere('followup_sent_at IS NOT NULL');
      if (rule.kanbanStage) qb.andWhere('kanban_stage = :stage', { stage: rule.kanbanStage });
      if (rule.utmCampaign) qb.andWhere('utm_campaign = :campaign', { campaign: rule.utmCampaign });
      if (rule.adTitle) qb.andWhere('ctwa_ad_title = :adTitle', { adTitle: rule.adTitle });
      if (rule.createdAfter) qb.andWhere('created_at >= :createdAfter', { createdAfter: rule.createdAfter });
      const res = await qb.execute();
      resetCount = res.affected ?? 0;
    }

    return { ...rule, resetCount };
  }

  @Delete('rules/:id')
  async deleteRule(@Param('id') id: string) {
    await this.rulesRepo.delete(id);
    return { ok: true };
  }

  // ─── Biblioteca de vídeos ───────────────────────────────────────────

  @Get('videos')
  async listVideos() {
    return this.videoService.list();
  }

  @Post('videos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async uploadVideo(
    @UploadedFile() file: UploadedVideoFile,
    @Body('name') name: string,
    @Body('caption') caption?: string,
  ) {
    return this.videoService.upload(file, name, caption);
  }

  @Patch('videos/:id')
  async updateVideo(@Param('id') id: string, @Body() body: { name?: string; caption?: string }) {
    return this.videoService.update(id, body);
  }

  @Delete('videos/:id')
  async deleteVideo(@Param('id') id: string) {
    await this.videoService.delete(id);
    return { ok: true };
  }

  // ─── Biblioteca de áudios ───────────────────────────────────────────

  @Get('audios')
  async listAudios() {
    return this.audioService.list();
  }

  @Post('audios')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 16 * 1024 * 1024 } }))
  async uploadAudio(
    @UploadedFile() file: UploadedAudioFile,
    @Body('name') name: string,
    @Body('durationSeconds') durationSeconds?: string,
  ) {
    const seconds = durationSeconds != null ? parseInt(durationSeconds, 10) : undefined;
    return this.audioService.upload(file, name, Number.isFinite(seconds) ? seconds : undefined);
  }

  @Patch('audios/:id')
  async updateAudio(@Param('id') id: string, @Body() body: { name?: string }) {
    return this.audioService.update(id, body);
  }

  @Delete('audios/:id')
  async deleteAudio(@Param('id') id: string) {
    await this.audioService.delete(id);
    return { ok: true };
  }

  // Manda a nota de voz pra um número qualquer, sem tocar em lead/histórico —
  // usado na biblioteca pra confirmar que virou bolha de áudio de verdade
  // (e não um anexo de arquivo) antes de anexar a uma regra.
  @Post('audios/:id/test')
  async testAudio(@Param('id') id: string, @Body() body: { phone?: string }) {
    if (!body?.phone?.trim()) throw new BadRequestException('Telefone é obrigatório');
    const audio = await this.audioService.list().then((all) => all.find((a) => a.id === id));
    if (!audio) throw new BadRequestException('Áudio não encontrado');
    try {
      await this.followupService.sendAudioTest(body.phone.trim(), audio);
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Falha ao enviar áudio de teste');
    }
    return { ok: true };
  }

  // ─── Teto diário de envio de vídeo ──────────────────────────────────

  @Get('video-limit')
  async getVideoLimit() {
    const value = await this.settings.get(VIDEO_LIMIT_KEY);
    return { limit: parseInt(value || String(DEFAULT_VIDEO_LIMIT), 10) };
  }

  @Put('video-limit')
  async setVideoLimit(@Body() body: { limit: number }) {
    const limit = Math.max(1, Math.floor(Number(body.limit) || DEFAULT_VIDEO_LIMIT));
    await this.settings.set(VIDEO_LIMIT_KEY, String(limit));
    return { limit };
  }

  // ─── Cadência de múltiplos toques ───────────────────────────────────
  // Passos e janelas de horário que antes eram constantes no código; agora
  // editáveis na tela. `defaults` acompanha a resposta pro botão "Restaurar padrão".

  @Get('cadence')
  async getCadence() {
    const config = await this.followupService.getCadenceConfig();
    return {
      ...config,
      defaults: { steps: DEFAULT_CADENCE_STEPS, windows: DEFAULT_CADENCE_WINDOWS },
      limits: { maxSteps: MAX_CADENCE_STEPS, maxStepMinutes: MAX_STEP_MINUTES, maxGuideLength: MAX_GUIDE_LENGTH },
    };
  }

  @Put('cadence')
  async setCadence(@Body() body: Partial<CadenceConfig>) {
    try {
      const config = await this.followupService.saveCadenceConfig(body);
      return {
        ...config,
        defaults: { steps: DEFAULT_CADENCE_STEPS, windows: DEFAULT_CADENCE_WINDOWS },
        limits: { maxSteps: MAX_CADENCE_STEPS, maxStepMinutes: MAX_STEP_MINUTES, maxGuideLength: MAX_GUIDE_LENGTH },
      };
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Cadência inválida');
    }
  }
}
