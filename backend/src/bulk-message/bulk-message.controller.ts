import { Controller, Post, Get, Body, Param, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import { BulkMessageService, RecipientFilter } from './bulk-message.service';

@Controller('bulk-message')
export class BulkMessageController {
  constructor(private readonly bulkMessageService: BulkMessageService) {}

  // Leads elegíveis pra tela de seleção. filter: imported | never-contacted | all
  @Get('recipients')
  async recipients(@Query('filter') filter?: string) {
    const valid: RecipientFilter[] = ['imported', 'never-contacted', 'all'];
    const f = (valid.includes(filter as RecipientFilter) ? filter : 'imported') as RecipientFilter;
    return this.bulkMessageService.listRecipients(f);
  }

  @Post()
  async send(@Body() body: { leadIds: string[]; message: string; name?: string; delayMin?: number; delayMax?: number }) {
    if (!body.message?.trim()) throw new BadRequestException('Mensagem não pode ser vazia');
    if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
      throw new BadRequestException('Nenhum lead selecionado');
    }
    return this.bulkMessageService.sendBulk(body);
  }

  @Get('campaigns')
  async listCampaigns() {
    return this.bulkMessageService.getCampaigns();
  }

  @Get('campaigns/:id')
  async getCampaign(@Param('id') id: string) {
    const campaign = await this.bulkMessageService.getCampaignById(id);
    if (!campaign) throw new NotFoundException('Campanha não encontrada');
    return campaign;
  }

  @Get('campaigns/:id/messages')
  async getCampaignMessages(@Param('id') id: string) {
    const campaign = await this.bulkMessageService.getCampaignById(id);
    if (!campaign) throw new NotFoundException('Campanha não encontrada');
    if (!campaign.folderId) return { messages: [], note: 'folder_id não disponível para esta campanha' };
    return this.bulkMessageService.getCampaignMessages(campaign.folderId);
  }

  @Post('campaigns/:id/action')
  async controlCampaign(@Param('id') id: string, @Body() body: { action: 'stop' | 'continue' | 'delete' }) {
    if (!['stop', 'continue', 'delete'].includes(body.action)) {
      throw new BadRequestException('Ação inválida. Use: stop, continue ou delete');
    }
    const campaign = await this.bulkMessageService.getCampaignById(id);
    if (!campaign) throw new NotFoundException('Campanha não encontrada');
    if (!campaign.folderId) throw new BadRequestException('Campanha sem folder_id — controle não disponível');
    return this.bulkMessageService.controlCampaign(campaign.folderId, body.action);
  }
}
