import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { KanbanStage } from './lead.entity';

export type FollowupMode = 'manual' | 'ai';
export type FollowupAudioOrder = 'audio_first' | 'text_first';

// kanbanStage/utmCampaign nulos = curinga (casa com qualquer raia/campanha).
// O matching escolhe a regra mais específica pra cada lead (ver sdr-followup.service.ts).
@Entity('followup_rules')
export class FollowupRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'varchar' })
  name: string;

  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'kanban_stage', type: 'varchar', nullable: true })
  kanbanStage?: KanbanStage | null;

  @Column({ name: 'utm_campaign', type: 'varchar', nullable: true })
  utmCampaign?: string | null;

  // Título do anúncio (ctwa_ad_title) — filtra por criativo específico. Nulo = qualquer criativo.
  @Column({ name: 'ad_title', type: 'varchar', nullable: true })
  adTitle?: string | null;

  // Só casa com leads criados a partir desta data/hora. Nulo = sem filtro de data.
  // Usado pra restringir uma regra aos leads que estão chegando agora (ex: "hoje"),
  // sem afetar leads antigos já parados na mesma raia.
  @Column({ name: 'created_after', type: 'timestamp', nullable: true })
  createdAfter?: Date | null;

  @Column({ name: 'delay_minutes', type: 'int', default: 60 })
  delayMinutes: number;

  // Horário preferido de disparo (fuso America/Sao_Paulo). Nulo = sem restrição,
  // dispara assim que o prazo de inatividade vencer (comportamento padrão).
  // Preenchido = só dispara na próxima ocorrência desse horário (hoje se ainda
  // não passou, amanhã se já passou) — mesmo que o prazo já tenha vencido antes.
  @Column({ name: 'send_at_hour', type: 'int', nullable: true })
  sendAtHour?: number | null;

  @Column({ name: 'send_at_minute', type: 'int', default: 0 })
  sendAtMinute: number;

  @Column({ name: 'mode', type: 'varchar', default: 'manual' })
  mode: FollowupMode;

  @Column({ name: 'text', type: 'text', nullable: true })
  text?: string | null;

  // Se preenchido, a regra manda esse vídeo (com legenda) em vez de texto —
  // o mode/text passam a ser ignorados. FK lógica pro FollowupVideo.
  @Column({ name: 'video_id', type: 'uuid', nullable: true })
  videoId?: string | null;

  // Legenda específica desta regra; se null, usa a caption padrão do vídeo.
  @Column({ name: 'video_caption_override', type: 'text', nullable: true })
  videoCaptionOverride?: string | null;

  // Se preenchido, a regra manda esse áudio como nota de voz (ptt) seguido da
  // mensagem de texto (audioText) — mode/text/videoId passam a ser ignorados.
  // Mutuamente exclusivo com videoId (validado no controller). FK lógica pro
  // FollowupAudio. Sem teto diário (diferente do vídeo) — decisão do usuário.
  @Column({ name: 'audio_id', type: 'uuid', nullable: true })
  audioId?: string | null;

  // Mensagem que acompanha o áudio. Vazio/null = manda só o áudio, sem texto.
  @Column({ name: 'audio_text', type: 'text', nullable: true })
  audioText?: string | null;

  // Ordem de envio das duas mensagens.
  @Column({ name: 'audio_order', type: 'varchar', default: 'audio_first' })
  audioOrder: FollowupAudioOrder;

  // Intervalo (segundos) entre o áudio e o texto. Clamp 0-180 no controller —
  // o envio bloqueia o cron, então não pode ser um valor arbitrariamente alto.
  @Column({ name: 'audio_gap_seconds', type: 'int', default: 20 })
  audioGapSeconds: number;

  // Desempate manual quando duas regras têm a mesma especificidade pro mesmo lead (menor = prioridade maior).
  @Column({ name: 'priority', type: 'int', default: 0 })
  priority: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
