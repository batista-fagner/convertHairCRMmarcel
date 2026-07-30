import { Controller, Get, Post, Patch, Delete, Param, Body, Query, BadRequestException } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import type { CreateAvailabilityRuleDto, UpdateAvailabilityRuleDto } from './availability.service';

@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get('rules')
  listRules() {
    return this.availabilityService.listRules();
  }

  @Post('rules')
  createRule(@Body() dto: CreateAvailabilityRuleDto) {
    if (!dto.specificDate && dto.dayOfWeek == null) {
      throw new BadRequestException('specificDate ou dayOfWeek é obrigatório');
    }
    if (!dto.startTime || !dto.endTime) {
      throw new BadRequestException('startTime e endTime são obrigatórios');
    }
    return this.availabilityService.createRule(dto);
  }

  @Patch('rules/:id')
  updateRule(@Param('id') id: string, @Body() dto: UpdateAvailabilityRuleDto) {
    return this.availabilityService.updateRule(id, dto);
  }

  @Delete('rules/:id')
  async deleteRule(@Param('id') id: string) {
    await this.availabilityService.deleteRule(id);
    return { ok: true };
  }

  @Get('slots')
  async getSlots(@Query('date') date: string) {
    if (!date) throw new BadRequestException('date é obrigatório (YYYY-MM-DD)');
    const [y, m, d] = date.split('-').map(Number);
    return this.availabilityService.getSlotsForDate(y, m, d);
  }
}
