import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Repository } from 'typeorm';
import { AvailabilityRule } from '../common/entities/availability-rule.entity';
import { Appointment } from '../common/entities/appointment.entity';

export interface CreateAvailabilityRuleDto {
  // Um dos dois é obrigatório: specificDate (regra pra 1 dia exato do calendário,
  // usada pela tela de Configurações) ou dayOfWeek (regra recorrente, legado).
  specificDate?: string | null;
  dayOfWeek?: number | null;
  startTime: string;
  endTime: string;
  slotMinutes?: number;
  active?: boolean;
}

export type UpdateAvailabilityRuleDto = Partial<CreateAvailabilityRuleDto>;

const WEEKDAY_LABELS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

// Agenda do Marcel é em horário de Nova York (cliente pediu explicitamente,
// 2026-07-29) — DIFERENTE de BRT: Nova York tem horário de verão (EDT/EST),
// não dá pra usar um offset fixo como no resto do sistema (BRT não tem DST
// desde 2019). Por isso todo cálculo de fuso aqui passa por Intl.DateTimeFormat
// de verdade, nunca por um "+N horas" fixo.
const TIMEZONE = 'America/New_York';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// "14:00" → "2:00 PM", "09:00" → "9:00 AM" — cliente pediu formato AM/PM (EUA).
function formatAmPm(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${period}`;
}

// Offset (em minutos, timeZone menos UTC) de um instante numa timezone IANA.
function offsetMinutesAt(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - date.getTime()) / 60_000);
}

// Converte um horário de parede (ano/mês/dia/hora/minuto) NA timezone `timeZone`
// pro Date (UTC) correto — funciona em qualquer época do ano mesmo com DST,
// porque descobre o offset real daquele instante em vez de assumir um fixo.
function zonedWallTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  let utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  // 2 iterações convergem mesmo perto de uma virada de DST (offset muda no máximo 1x).
  for (let i = 0; i < 2; i++) {
    const offset = offsetMinutesAt(new Date(utcGuess), timeZone);
    utcGuess = Date.UTC(year, month - 1, day, hour, minute) - offset * 60_000;
  }
  return new Date(utcGuess);
}

// Data/hora atual na timezone informada, como partes separadas.
function nowZonedParts(timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

// "HH:MM" (24h) de um Date, na timezone informada — usado internamente pra
// comparar/casar slots (a exibição em AM/PM só acontece na hora de montar texto).
function zonedTimeOf(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
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
    return this.rulesRepo.find({ order: { specificDate: 'ASC', dayOfWeek: 'ASC', startTime: 'ASC' } });
  }

  async createRule(dto: CreateAvailabilityRuleDto): Promise<AvailabilityRule> {
    // dayOfWeek sempre preenchido (mesmo pra regra de data específica) — só pra
    // exibir o nome do dia da semana na tela; quem decide o casamento de
    // disponibilidade é specificDate quando presente (ver getSlotsForDate).
    const specificDate = dto.specificDate ?? null;
    const dayOfWeek = specificDate
      ? new Date(`${specificDate}T00:00:00Z`).getUTCDay()
      : dto.dayOfWeek ?? null;

    const rule = this.rulesRepo.create({
      specificDate,
      dayOfWeek,
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
    if (dto.specificDate !== undefined) {
      rule.specificDate = dto.specificDate ?? null;
      if (rule.specificDate) rule.dayOfWeek = new Date(`${rule.specificDate}T00:00:00Z`).getUTCDay();
    }
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

  /** Slots livres ("HH:MM", 24h) pra uma data (Y-M-D, horário de Nova York) — já descontando agendamentos existentes e horários passados (se for hoje). */
  async getSlotsForDate(year: number, month: number, day: number): Promise<string[]> {
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;
    // Uma regra vale pro dia se: specificDate bate exatamente com essa data, OU
    // (specificDate é null E dayOfWeek recorrente bate) — data específica nunca
    // "vaza" pra outras semanas, dayOfWeek é só o legado recorrente.
    const [specificRules, recurringRules] = await Promise.all([
      this.rulesRepo.find({ where: { specificDate: dateStr, active: true } }),
      this.rulesRepo.find({ where: { dayOfWeek, specificDate: IsNull(), active: true } }),
    ]);
    const rules = [...specificRules, ...recurringRules];
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

    // Remove horários já ocupados por um agendamento não-cancelado nesse dia
    // (janela do dia inteiro em horário de Nova York, convertida pra UTC certo).
    const dayStart = zonedWallTimeToUtc(year, month, day, 0, 0, TIMEZONE);
    const dayEnd = zonedWallTimeToUtc(year, month, day, 23, 59, TIMEZONE);
    const existing = await this.appointmentsRepo.find({ where: { startDateTime: Between(dayStart, dayEnd) } });
    const booked = new Set(existing.filter((a) => a.status !== 'cancelado').map((a) => zonedTimeOf(a.startDateTime, TIMEZONE)));

    // Se o dia é hoje (NY), remove horários que já passaram (com 30min de folga
    // pra não oferecer um slot "daqui a 2min" impossível de confirmar a tempo).
    const now = nowZonedParts(TIMEZONE);
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
   * IA devolve, sempre significando horário de parede em Nova York — pro Date
   * (UTC) correto. NUNCA usar `new Date(string)` direto aqui: sem timezone
   * explícito na string, o parser usaria o fuso local do processo Node (pode
   * ser UTC no Railway), interpretando 14:00 como 14:00 UTC em vez de 14:00 NY.
   */
  parseNyNaiveDateTime(naive: string): Date | null {
    const match = naive.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!match) return null;
    const [, y, m, d, h, mi] = match.map(Number) as unknown as number[];
    return zonedWallTimeToUtc(y, m, d, h, mi, TIMEZONE);
  }

  async isSlotAvailable(dateTime: Date): Promise<boolean> {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(dateTime);
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
    const slots = await this.getSlotsForDate(get('year'), get('month'), get('day'));
    return slots.includes(zonedTimeOf(dateTime, TIMEZONE));
  }

  /**
   * Bloco de texto pro prompt da Clara: próximos `daysAhead` dias (a partir de
   * hoje, horário de Nova York) que tiverem pelo menos 1 horário livre, em
   * formato AM/PM (pedido do cliente). Recalculado a cada turno — a Clara
   * NUNCA inventa horário, só oferece o que está nesta tabela.
   */
  async buildAvailabilityBlock(daysAhead = 14): Promise<{ text: string; hasSlots: boolean }> {
    const { year, month, day } = nowZonedParts(TIMEZONE);
    const base = zonedWallTimeToUtc(year, month, day, 12, 0, TIMEZONE); // meio-dia NY, só de referência pra somar dias
    const lines: string[] = [];

    for (let i = 0; i < daysAhead; i++) {
      const d = new Date(base.getTime() + i * 24 * 60 * 60 * 1000);
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(d);
      const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
      const y = get('year'), m = get('month'), da = get('day');

      const slots = await this.getSlotsForDate(y, m, da);
      if (!slots.length) continue;

      const weekday = WEEKDAY_LABELS[new Date(Date.UTC(y, m - 1, da)).getUTCDay()];
      lines.push(`${weekday}, ${pad(da)}/${pad(m)} = ${slots.map(formatAmPm).join(', ')}`);
    }

    if (!lines.length) {
      return { text: 'Nenhum horário disponível nos próximos dias.', hasSlots: false };
    }
    return { text: `${lines.join('\n')}\n(horário de Nova York)`, hasSlots: true };
  }
}
