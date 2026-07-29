import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { AvailabilityRule } from '../common/entities/availability-rule.entity';
import { Appointment } from '../common/entities/appointment.entity';

export interface CreateAvailabilityRuleDto {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotMinutes?: number;
  active?: boolean;
}

export type UpdateAvailabilityRuleDto = Partial<CreateAvailabilityRuleDto>;

const WEEKDAY_LABELS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// Brasil não tem horário de verão desde 2019 — offset fixo UTC-3, dá pra
// converter um horário de parede BRT pra Date (UTC) sem lib de timezone.
function buildBrtDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour + 3, minute));
}

// Data/hora atual em America/Sao_Paulo, como partes separadas.
function nowBrtParts(): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

function brtTimeOf(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const h = parts.find((p) => p.type === 'hour')!.value;
  const m = parts.find((p) => p.type === 'minute')!.value;
  return `${h}:${m}`;
}

@Injectable()
export class AvailabilityService {
  constructor(
    @InjectRepository(AvailabilityRule)
    private readonly rulesRepo: Repository<AvailabilityRule>,
    @InjectRepository(Appointment)
    private readonly appointmentsRepo: Repository<Appointment>,
  ) {}

  async listRules(): Promise<AvailabilityRule[]> {
    return this.rulesRepo.find({ order: { dayOfWeek: 'ASC', startTime: 'ASC' } });
  }

  async createRule(dto: CreateAvailabilityRuleDto): Promise<AvailabilityRule> {
    const rule = this.rulesRepo.create({
      dayOfWeek: dto.dayOfWeek,
      startTime: dto.startTime,
      endTime: dto.endTime,
      slotMinutes: dto.slotMinutes ?? 60,
      active: dto.active ?? true,
    });
    return this.rulesRepo.save(rule);
  }

  async updateRule(id: string, dto: UpdateAvailabilityRuleDto): Promise<AvailabilityRule> {
    const rule = await this.rulesRepo.findOne({ where: { id } });
    if (!rule) throw new NotFoundException('Regra de disponibilidade não encontrada');
    if (dto.dayOfWeek !== undefined) rule.dayOfWeek = dto.dayOfWeek;
    if (dto.startTime !== undefined) rule.startTime = dto.startTime;
    if (dto.endTime !== undefined) rule.endTime = dto.endTime;
    if (dto.slotMinutes !== undefined) rule.slotMinutes = dto.slotMinutes;
    if (dto.active !== undefined) rule.active = dto.active;
    return this.rulesRepo.save(rule);
  }

  async deleteRule(id: string): Promise<void> {
    const result = await this.rulesRepo.delete({ id });
    if (result.affected === 0) throw new NotFoundException('Regra de disponibilidade não encontrada');
  }

  /** Slots livres ("HH:MM") pra uma data (Y-M-D) — já descontando agendamentos existentes e horários passados (se for hoje). */
  async getSlotsForDate(year: number, month: number, day: number): Promise<string[]> {
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const rules = await this.rulesRepo.find({ where: { dayOfWeek, active: true } });
    if (!rules.length) return [];

    const raw: string[] = [];
    for (const rule of rules) {
      const [startH, startM] = rule.startTime.split(':').map(Number);
      const [endH, endM] = rule.endTime.split(':').map(Number);
      const endMinutes = endH * 60 + endM;
      let cursor = startH * 60 + startM;
      while (cursor + rule.slotMinutes <= endMinutes) {
        raw.push(`${pad(Math.floor(cursor / 60))}:${pad(cursor % 60)}`);
        cursor += rule.slotMinutes;
      }
    }
    const slots = Array.from(new Set(raw)).sort();

    // Remove horários já ocupados por um agendamento não-cancelado nesse dia.
    const dayStart = buildBrtDate(year, month, day, 0, 0);
    const dayEnd = buildBrtDate(year, month, day, 23, 59);
    const existing = await this.appointmentsRepo.find({ where: { startDateTime: Between(dayStart, dayEnd) } });
    const booked = new Set(existing.filter((a) => a.status !== 'cancelado').map((a) => brtTimeOf(a.startDateTime)));

    // Se o dia é hoje (BRT), remove horários que já passaram (com 30min de folga
    // pra não oferecer um slot "daqui a 2min" impossível de confirmar a tempo).
    const now = nowBrtParts();
    const isToday = now.year === year && now.month === month && now.day === day;
    const nowMinutes = now.hour * 60 + now.minute + 30;

    return slots.filter((s) => {
      if (booked.has(s)) return false;
      if (isToday) {
        const [h, m] = s.split(':').map(Number);
        if (h * 60 + m <= nowMinutes) return false;
      }
      return true;
    });
  }

  /**
   * Converte uma string ingênua "YYYY-MM-DDTHH:MM" (ou com :SS) — como a que a
   * IA devolve, sempre significando horário de parede em BRT — pro Date (UTC)
   * correto. NUNCA usar `new Date(string)` direto aqui: sem timezone explícito
   * na string, o parser usaria o fuso local do processo Node (pode ser UTC no
   * Railway), interpretando 14:00 como 14:00 UTC em vez de 14:00 BRT — 3h de erro.
   */
  parseBrtNaiveDateTime(naive: string): Date | null {
    const match = naive.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!match) return null;
    const [, y, m, d, h, mi] = match.map(Number) as unknown as number[];
    return buildBrtDate(y, m, d, h, mi);
  }

  async isSlotAvailable(dateTime: Date): Promise<boolean> {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(dateTime);
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
    const slots = await this.getSlotsForDate(get('year'), get('month'), get('day'));
    return slots.includes(brtTimeOf(dateTime));
  }

  /**
   * Bloco de texto pro prompt da Sofia: próximos `daysAhead` dias (a partir de
   * hoje, BRT) que tiverem pelo menos 1 horário livre. Recalculado a cada turno
   * — a Sofia NUNCA inventa horário, só oferece o que está nesta tabela.
   */
  async buildAvailabilityBlock(daysAhead = 14): Promise<{ text: string; hasSlots: boolean }> {
    const { year, month, day } = nowBrtParts();
    const base = buildBrtDate(year, month, day, 12, 0); // meio-dia BRT, só de referência pra somar dias
    const lines: string[] = [];

    for (let i = 0; i < daysAhead; i++) {
      const d = new Date(base.getTime() + i * 24 * 60 * 60 * 1000);
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(d);
      const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
      const y = get('year'), m = get('month'), da = get('day');

      const slots = await this.getSlotsForDate(y, m, da);
      if (!slots.length) continue;

      const weekday = WEEKDAY_LABELS[new Date(Date.UTC(y, m - 1, da)).getUTCDay()];
      lines.push(`${weekday}, ${pad(da)}/${pad(m)} = ${slots.join(', ')}`);
    }

    if (!lines.length) {
      return { text: 'Nenhum horário disponível nos próximos dias.', hasSlots: false };
    }
    return { text: lines.join('\n'), hasSlots: true };
  }
}
