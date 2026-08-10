import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type LeadClassification = 'otimo' | 'bom' | 'frio';
export type LeadStatus = 'novo' | 'contatado' | 'convertido' | 'perdido';
export type WaStage = 'aguardando_nome' | 'aguardando_faturamento' | 'abertura' | 'escuta' | 'rapport' | 'video' | 'fechamento' | 'confirmado' | 'perdido' | 'encerrado';
export type KanbanStage = 'novo' | 'atendimento' | 'nao-qualificado' | 'qualificado' | 'agendado' | 'vendeu';
export type LeadTemperature = 'quente' | 'morno' | 'frio';
export type AgentMode = 'efraim' | 'sdr';

export interface Post {
  code: string;
  caption: string;
  takenAt: number;
  imageUrl: string;
  commentCount?: number;
  likeCount?: number;
}

export interface EnrichmentData {
  followers?: number;
  engagement_rate?: number;
  content_type?: string;
  recent_stories?: string[];
  enrichment_bonus?: number;
  posts?: Post[];
}

// Payload bruto recebido do webhook de captura do GoHighLevel (página do
// cliente) — guardado como veio pra alimentar o drawer de rastreamento sem
// precisar mapear campo a campo (formato definido pelo cliente, não por nós).
export interface GhlContext {
  event?: string;
  event_id?: string;
  created_at?: string;
  source?: string;
  lead_id?: string | number;
  contact?: { name?: string; email?: string; phone?: string };
  qualification?: Record<string, any>;
  funnel?: Record<string, any>;
  attribution?: Record<string, any>;
  location?: Record<string, any>;
}

@Entity('leads')
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'campaign_id', type: 'uuid', nullable: true })
  campaignId?: string;

  @Column({ name: 'name', type: 'varchar' })
  name: string;

  @Column({ name: 'email', type: 'varchar', unique: true, nullable: true })
  email?: string;

  @Column({ name: 'phone', type: 'varchar', unique: true })
  phone: string;

  @Column({ name: 'instagram', type: 'varchar', nullable: true })
  instagram?: string;

  @Column({ name: 'revenue_range', type: 'varchar', nullable: true })
  revenueRange?: string;

  @Column({ name: 'score', type: 'int', default: 0 })
  score: number;

  @Column({ name: 'classification', type: 'varchar', default: 'frio' })
  classification: LeadClassification;

  @Column({ name: 'is_mql', type: 'boolean', default: false })
  isMql: boolean;

  // Evento "Lead" (CAPI) já enviado ao Meta — dispara uma única vez quando o
  // lead entra na raia "atendimento". Espelha o padrão de is_mql (que controla
  // o disparo único do evento MQL na raia "qualificado").
  @Column({ name: 'lead_event_sent', type: 'boolean', default: false })
  leadEventSent: boolean;

  // Respostas da qualificação do SDR (Sofia). null = ainda não perguntado/respondido.
  // vendeCabelo=true já move pra "qualificado" e dispara MQL; investeAnuncio=true
  // soma a tag "mql_premium"; semInstagram cobre o caso do lead dizer que não tem.
  @Column({ name: 'vende_cabelo', type: 'boolean', nullable: true })
  vendeCabelo?: boolean | null;

  // Campo do fluxo antigo (perguntava "já investe em anúncio?") — não é mais
  // perguntado pelo prompt SPIN Selling atual, mantido só por causa de leads
  // antigos que já têm esse dado salvo. mql_premium/mql_basico hoje vem de
  // mensagens_por_dia (ver abaixo), não mais deste campo.
  @Column({ name: 'investe_anuncio', type: 'boolean', nullable: true })
  investeAnuncio?: boolean | null;

  // Estimativa de mensagens recebidas por dia no WhatsApp (fluxo SPIN Selling).
  // >=30 soma a tag "mql_premium", <30 soma "mql_basico" (ver sdr.controller.ts).
  @Column({ name: 'mensagens_por_dia', type: 'int', nullable: true })
  mensagensPorDia?: number | null;

  // Timestamp de quando o lead virou MQL (entrou em "qualificado" pela 1ª vez).
  // Usado pra calcular tempo médio até qualificar no relatório de anúncios.
  @Column({ name: 'qualified_at', type: 'timestamp', nullable: true })
  qualifiedAt?: Date | null;

  @Column({ name: 'sem_instagram', type: 'boolean', nullable: true })
  semInstagram?: boolean | null;

  // true = lead disse que ainda está começando/não vende de fato (fluxo SPIN).
  // Junto com mensagens_por_dia < 10, desqualifica o lead automaticamente
  // (ver deriveKanbanStage em sdr.service.ts) mesmo que venda cabelo.
  @Column({ name: 'iniciante', type: 'boolean', nullable: true })
  iniciante?: boolean | null;

  // Sinal de qualificação da Clara (Pro Cleaning): true = já é dona do próprio
  // schedule/negócio, false = ainda trabalha como helper. Não desqualifica —
  // só define a raia (qualificado x atendimento), ver deriveKanbanStage.
  @Column({ name: 'dona_de_schedule', type: 'boolean', nullable: true })
  donaDeSchedule?: boolean | null;

  @Column({ name: 'tags', type: 'jsonb', nullable: true })
  tags?: string[] | null;

  @Column({ name: 'status', type: 'varchar', default: 'novo' })
  status: LeadStatus;

  @Column({ name: 'utm_source', type: 'varchar', nullable: true })
  utmSource?: string;

  @Column({ name: 'utm_medium', type: 'varchar', nullable: true })
  utmMedium?: string;

  @Column({ name: 'utm_campaign', type: 'varchar', nullable: true })
  utmCampaign?: string;

  @Column({ name: 'utm_content', type: 'varchar', nullable: true })
  utmContent?: string;

  @Column({ name: 'utm_term', type: 'varchar', nullable: true })
  utmTerm?: string;

  @Column({ name: 'fbclid', type: 'varchar', nullable: true })
  fbclid?: string;

  @Column({ name: 'fbc', type: 'varchar', nullable: true })
  fbc?: string;

  @Column({ name: 'fbp', type: 'varchar', nullable: true })
  fbp?: string;

  @Column({ name: 'click_id', type: 'varchar', nullable: true })
  clickId?: string;

  // Click ID do anúncio Click-to-WhatsApp (CTWA). Chega junto da 1ª mensagem
  // do lead que veio de anúncio direto pro WhatsApp — é o "fbclid do WhatsApp"
  // e a única forma de atribuir esses leads ao anúncio no CAPI (não há
  // fbclid/fbc/fbp porque não passou por navegador/LP).
  @Column({ name: 'ctwa_clid', type: 'varchar', nullable: true })
  ctwaClid?: string;

  // URL do anúncio de origem (source_url do referral CTWA) — usado como
  // event_source_url no CAPI e útil pra saber qual criativo trouxe o lead.
  @Column({ name: 'ctwa_source_url', type: 'varchar', nullable: true })
  ctwaSourceUrl?: string;

  // ID do anúncio (source_id do referral CTWA) — identifica o anúncio exato.
  @Column({ name: 'ctwa_source_id', type: 'varchar', nullable: true })
  ctwaSourceId?: string;

  // Título/headline do anúncio que trouxe o lead — exibido no card do Kanban
  // pra saber a origem sem abrir o Ads Manager.
  @Column({ name: 'ctwa_ad_title', type: 'varchar', nullable: true })
  ctwaAdTitle?: string;

  @Column({ name: 'vsl_percentage', type: 'int', default: 0 })
  vslPercentage: number;

  @Column({ name: 'enrichment_data', type: 'jsonb', nullable: true })
  enrichmentData?: EnrichmentData;

  @Column({ name: 'ghl_context', type: 'jsonb', nullable: true })
  ghlContext?: GhlContext;

  @Column({ name: 'ai_insight', type: 'jsonb', nullable: true })
  aiInsight?: any;

  @Column({ name: 'last_event_at', type: 'timestamp', nullable: true })
  lastEventAt?: Date;

  @Column({ name: 'wa_stage', type: 'varchar', nullable: true })
  waStage?: WaStage;

  @Column({ name: 'wa_messages_after_confirmed', type: 'int', default: 0 })
  waMessagesAfterConfirmed: number;

  @Column({ name: 'ai_context', type: 'jsonb', nullable: true })
  aiContext?: any[];

  @Column({ name: 'wa_last_message_at', type: 'timestamp', nullable: true })
  waLastMessageAt?: Date;

  // Quantas vezes a abertura proativa automática (checkNeverStartedLeads) falhou
  // em sequência pra esse lead (uazapi não confirmou o envio). Ao atingir
  // MAX_OPENING_ATTEMPTS, o cron para de tentar (ver sdr.controller.ts) — evita
  // ficar batendo no uazapi pra sempre num número que nunca vai entregar
  // (ex.: número sem WhatsApp/fixo). Zera se o lead responder por conta própria
  // antes disso (nesse caso ele já sai da query por wa_last_message_at).
  @Column({ name: 'opening_attempts', type: 'int', default: 0 })
  openingAttempts: number;

  @Column({ name: 'kanban_stage', type: 'varchar', default: 'novo' })
  kanbanStage: KanbanStage;

  @Column({ name: 'kanban_stage_manual', type: 'boolean', default: false })
  kanbanStageManual: boolean;

  @Column({ name: 'agent_mode', type: 'varchar', nullable: true })
  agentMode?: AgentMode;

  @Column({ name: 'temperature', type: 'varchar', nullable: true })
  temperature?: LeadTemperature;

  @Column({ name: 'ai_paused', type: 'boolean', default: false })
  aiPaused: boolean;

  @Column({ name: 'assigned_to', type: 'varchar', nullable: true })
  assignedTo?: string | null;

  @Column({ name: 'followup_sent_at', type: 'timestamp', nullable: true })
  followupSentAt?: Date | null;

  // Cadência de follow-up automático (múltiplos toques) — independente do
  // followupSentAt acima (que é do sistema de 1 disparo só por regra/campanha).
  // nurtureStep = índice do próximo toque a disparar; nextNurtureAt = quando
  // dispara; nurturePaused = true trava a cadência (STOP do lead), sem afetar
  // aiPaused (a IA pode continuar respondendo normalmente numa conversa ativa).
  @Column({ name: 'nurture_step', type: 'int', default: 0 })
  nurtureStep: number;

  @Column({ name: 'next_nurture_at', type: 'timestamp', nullable: true })
  nextNurtureAt?: Date | null;

  @Column({ name: 'nurture_paused', type: 'boolean', default: false })
  nurturePaused: boolean;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null;

  @Column({ name: 'avatar_url', type: 'varchar', nullable: true })
  avatarUrl?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
