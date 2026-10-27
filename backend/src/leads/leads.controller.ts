import { Controller, Get, Param, Query, Delete, Patch, Post, Body, Res, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { LeadsService } from './leads.service';
import { FacebookService } from '../facebook/facebook.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { KanbanStage } from '../common/entities/lead.entity';

@Controller('leads')
export class LeadsController {
  private readonly logger = new Logger(LeadsController.name);

  constructor(
    private leadsService: LeadsService,
    private facebookService: FacebookService,
    private realtime: RealtimeGateway,
  ) {}

  @Post()
  async createManual(@Body() body: { name: string; phone: string; instagram?: string; revenueRange?: string }) {
    const name = (body.name || '').trim();
    const phone = (body.phone || '').replace(/\D/g, '');
    if (!name || !phone) {
      throw new HttpException('Nome e telefone são obrigatórios', HttpStatus.BAD_REQUEST);
    }

    const existing = await this.leadsService.findByPhone(phone);
    if (existing) {
      throw new HttpException('Já existe um lead com esse telefone', HttpStatus.CONFLICT);
    }

    const lead = await this.leadsService.create({
      name,
      phone,
      instagram: body.instagram?.trim() || undefined,
      revenueRange: body.revenueRange?.trim() || undefined,
      agentMode: 'sdr',
      kanbanStage: 'novo',
      kanbanStageManual: true,
    });
    this.realtime.emitLeadCreated(lead);
    return lead;
  }

  // Importação de planilha (CSV parseado no frontend — chega como JSON).
  // Duplicado mantém o lead existente e recebe aviso em notes; lead novo entra
  // com importedAt (fora do Kanban e da abertura automática até ser contatado).
  @Post('import')
  async importLeads(@Body() body: { rows: { name?: string; phone?: string }[] }) {
    if (!Array.isArray(body?.rows) || body.rows.length === 0) {
      throw new HttpException('Nenhuma linha pra importar', HttpStatus.BAD_REQUEST);
    }
    if (body.rows.length > 5000) {
      throw new HttpException('Máximo de 5000 linhas por importação', HttpStatus.BAD_REQUEST);
    }
    return this.leadsService.importLeads(body.rows);
  }

  // Webhook do GoHighLevel (página de captura do Marcel) — payload livre,
  // aceita name/phone/email em variações de nome de campo que o GHL manda.
  @Post('ghl-capture')
  async ghlCapture(@Body() body: Record<string, any>) {
    this.logger.log(`ghl-capture payload recebido: ${JSON.stringify(body)}`);

    // GHL manda formatos diferentes conforme o tipo de ação/evento do workflow
    // (contato direto, ou aninhado em "contact"/"data") — tenta todas as variações.
    const c = body.contact || body.data || body;
    const first = c.first_name || c.firstName || '';
    const last = c.last_name || c.lastName || '';
    const name = String(c.name || c.full_name || c.fullName || [first, last].filter(Boolean).join(' ') || '').trim();
    const phone = String(c.phone || c.phone_number || c.phoneNumber || '').replace(/\D/g, '');
    const email = String(c.email || '').trim().toLowerCase() || undefined;

    if (!name || !phone) {
      this.logger.warn(`ghl-capture: campos faltando (name="${name}", phone="${phone}")`);
      throw new HttpException('Nome e telefone são obrigatórios', HttpStatus.BAD_REQUEST);
    }

    const existing = await this.leadsService.findByPhone(phone);
    if (existing) {
      return existing;
    }

    const lead = await this.leadsService.create({
      name,
      phone,
      email,
      agentMode: 'sdr',
      kanbanStage: 'novo',
      // NÃO trava manual aqui — isso é cadastro automático do funil (ninguém
      // arrastou o card), diferente de createManual acima. Travar aqui
      // desligava a movimentação automática da raia pro lead inteiro, desde a
      // criação — bug real que travou Glaucia, Giovana, Neuza, Jaqueline e
      // Flavia em "Novo" mesmo depois de a conversa avançar.
      ghlContext: body as any,
    });
    this.realtime.emitLeadCreated(lead);
    return lead;
  }

  @Get()
  async findAll(
    @Query('campaignId') campaignId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('source') source?: 'all' | 'ig_dm' | 'paid',
    @Query('search') search?: string,
  ) {
    return this.leadsService.findAll({
      campaignId,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 6,
      source: source || 'all',
      search,
    });
  }

  @Get('stats')
  async getStats() {
    return this.leadsService.getStats();
  }

  @Get('dashboard')
  async getDashboard(@Query('from') from?: string, @Query('to') to?: string) {
    return this.leadsService.getDashboard(from, to);
  }

  // Lista de conversas pro Inbox WhatsApp (tela separada do Kanban, pra
  // operador escrever manualmente e ativar leads importados). filter:
  // all | imported | never-contacted
  @Get('inbox')
  async inbox(
    @Query('filter') filter?: 'all' | 'imported' | 'never-contacted',
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.leadsService.findInboxList({
      filter,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 30,
    });
  }

  @Get('analytics/ads')
  async getAdPerformance(@Query('from') from?: string, @Query('to') to?: string) {
    const rows = await this.leadsService.getAdPerformance(from, to);
    const range = from && to ? { since: from, until: to } : undefined;
    const withSpend = await Promise.all(
      rows.map(async (row) => {
        const spend = await this.facebookService.getAdSpend(row.adId, range).catch(() => 0);
        const cpql = row.qualifiedCount > 0 ? spend / row.qualifiedCount : null;
        return { ...row, spend, cpql };
      }),
    );
    return withSpend;
  }

  @Get('analytics/hourly')
  async getHourlyDistribution(@Query('from') from?: string, @Query('to') to?: string) {
    return this.leadsService.getLeadsByHour(from, to);
  }

  @Get('analytics/ads/:adId/leads')
  async getLeadsByAd(@Param('adId') adId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.leadsService.getLeadsByAd(adId, from, to);
  }

  @Get('kanban/campaigns')
  async kanbanCampaigns() {
    return this.leadsService.listCampaigns();
  }

  @Get('kanban')
  async kanban(@Query('campaign') campaign?: string) {
    return this.leadsService.findKanban(campaign);
  }

  @Patch(':id/kanban')
  async moveKanban(@Param('id') id: string, @Body() body: { kanbanStage: KanbanStage }) {
    const lead = await this.leadsService.moveKanban(id, body.kanbanStage);
    this.realtime.emitLeadUpdated(lead);
    return lead;
  }

  @Patch(':id/ai-pause')
  async setAiPause(@Param('id') id: string, @Body() body: { paused: boolean }) {
    const lead = await this.leadsService.update(id, { aiPaused: !!body.paused });
    this.realtime.emitLeadUpdated(lead);
    return lead;
  }

  @Patch(':id')
  async edit(@Param('id') id: string, @Body() body: { name?: string; assignedTo?: string | null; notes?: string | null; tags?: string[]; temperature?: string | null }) {
    const data: { name?: string; assignedTo?: string | null; notes?: string | null; tags?: string[]; temperature?: any; temperatureManual?: boolean } = {};
    // Temperatura manual: valor válido trava (a IA não sobrescreve mais);
    // null destrava e volta pro automático (a IA preenche na próxima mensagem).
    if ('temperature' in body) {
      if (body.temperature === 'quente' || body.temperature === 'morno' || body.temperature === 'frio') {
        data.temperature = body.temperature;
        data.temperatureManual = true;
      } else if (body.temperature === null) {
        data.temperature = null;
        data.temperatureManual = false;
      }
    }
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
    if ('assignedTo' in body) data.assignedTo = body.assignedTo?.trim() || null;
    if ('notes' in body) data.notes = body.notes ?? null;
    if ('tags' in body) {
      data.tags = Array.from(
        new Set((Array.isArray(body.tags) ? body.tags : []).map((t) => String(t).trim().toLowerCase()).filter(Boolean)),
      ).map((t) => t.slice(0, 30)).slice(0, 20);
    }
    const lead = await this.leadsService.update(id, data);
    this.realtime.emitLeadUpdated(lead);
    return lead;
  }

  // Tags distintas já usadas em algum lead — alimenta o autocomplete do editor
  // de tags (Kanban/Inbox) e da tela de Configurações (regra "IA não conversa
  // com quem tem essa tag").
  @Get('tags/all')
  async allTags() {
    return this.leadsService.getAllTags();
  }

  // Export de conversas pra um período (Settings → Exportar Conversas) — o
  // Marcel baixa isso pra alimentar o treinamento da própria IA (ver o que
  // errou, o que melhorar). from/to seguem a mesma convenção do resto do CRM:
  // data em America/Sao_Paulo, "to" exclusivo (dia seguinte ao último dia).
  @Get('export-conversations')
  async exportConversations(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format?: 'json' | 'txt',
  ) {
    const leads = await this.leadsService.findConversationsForExport(from, to);
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'txt') {
      const body = this.buildConversationsTxt(leads);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="conversas-${stamp}.txt"`);
      res.send(body);
      return;
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="conversas-${stamp}.json"`);
    res.send(JSON.stringify({ exportedAt: new Date().toISOString(), from: from || null, to: to || null, total: leads.length, leads }, null, 2));
  }

  private buildConversationsTxt(leads: Awaited<ReturnType<LeadsService['findConversationsForExport']>>): string {
    const fmtDate = (d?: Date | string | null) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');
    const blocks = leads.map((lead) => {
      const header = [
        `Lead: ${lead.name} (${lead.phone})`,
        `Instagram: ${lead.instagram || '—'}`,
        `Estágio: ${lead.kanbanStage} | Classificação: ${lead.classification} | MQL: ${lead.isMql ? 'sim' : 'não'}`,
        `Criado em: ${fmtDate(lead.createdAt)} | Última mensagem: ${fmtDate(lead.waLastMessageAt)}`,
        '-'.repeat(60),
      ].join('\n');

      const lines = lead.messages.map((m) => {
        const who = m.role === 'assistant' ? 'Sofia (IA)' : 'Lead';
        const when = m.timestamp ? fmtDate(m.timestamp) : '';
        return `[${when}] ${who}: ${m.content}`;
      });

      return `${header}\n${lines.join('\n')}`;
    });

    return blocks.join('\n\n' + '='.repeat(60) + '\n\n');
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.leadsService.findById(id);
  }

  @Patch(':id/convert')
  async convert(@Param('id') id: string, @Body() body: { value?: number }) {
    const lead = await this.leadsService.markAsConverted(id);
    this.facebookService.sendPurchaseEvent(lead, body.value ?? 3000).catch(() => null);
    return lead;
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.leadsService.delete(id);
    this.realtime.emitLeadDeleted(id);
    return { success: true };
  }

  @Delete('__clear-all__')
  async clearAll() {
    return this.leadsService.clearAll();
  }
}
