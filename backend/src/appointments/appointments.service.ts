import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import { Appointment, AppointmentStatus } from '../common/entities/appointment.entity';
import { Lead } from '../common/entities/lead.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export interface CreateAppointmentDto {
  leadId?: string | null;
  clientName: string;
  clientPhone?: string | null;
  service: string;
  value?: number | null;
  status?: AppointmentStatus;
  startDateTime: Date | string;
  notes?: string | null;
}

export type UpdateAppointmentDto = Partial<CreateAppointmentDto>;

// Lembrete de 1h antes (anti no-show) via setTimeout — nada de cron/polling.
// Cada agendamento tem no máximo 1 timer agendado por vez (mapa em memória);
// create/update/delete mantêm o timer sempre sincronizado com o dado atual, e
// o boot (onApplicationBootstrap) reagenda tudo que ficou pendente caso o
// processo tenha reiniciado (deploy no Railway derruba os timers em memória).
const REMINDER_LEAD_MS = 60 * 60 * 1000;
// setTimeout usa int32 internamente — um delay maior que isso (~24.8 dias)
// estoura e dispara na hora, em vez de esperar. Acima desse teto, agenda um
// timer intermediário que só recalcula o delay real mais perto da data.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

@Injectable()
export class AppointmentsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AppointmentsService.name);
  private readonly uazapiBaseUrl: string;
  private readonly uazapiToken: string;

  constructor(
    @InjectRepository(Appointment)
    private readonly repo: Repository<Appointment>,
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly realtime: RealtimeGateway,
  ) {
    this.uazapiBaseUrl = config.get('SDR_UAZAPI_BASE_URL') || config.get('UAZAPI_BASE_URL') || 'https://free.uazapi.com';
    this.uazapiToken = config.get('SDR_UAZAPI_TOKEN') || '';
  }

  /** Reagenda o lembrete de todo agendamento pendente — roda 1x quando o processo sobe. */
  async onApplicationBootstrap(): Promise<void> {
    const pending = await this.repo
      .createQueryBuilder('a')
      .where('a.status = :status', { status: 'agendado' })
      .andWhere('a.reminder_sent_at IS NULL')
      .andWhere('a.client_phone IS NOT NULL')
      .andWhere('a.start_date_time > :now', { now: new Date() })
      .getMany();
    for (const appt of pending) this.scheduleReminder(appt);
    if (pending.length) {
      this.logger.log(`[AGENDA] ${pending.length} lembrete(s) de reunião reagendado(s) após reinício`);
    }
  }

  private timerName(id: string): string {
    return `appointment-reminder-${id}`;
  }

  /** Cancela o timer em memória do agendamento, se existir. */
  private cancelReminderTimer(id: string): void {
    const name = this.timerName(id);
    if (this.schedulerRegistry.doesExist('timeout', name)) {
      this.schedulerRegistry.deleteTimeout(name);
    }
  }

  /**
   * (Re)agenda o lembrete de 1h antes com base no estado atual do agendamento.
   * Sempre cancela o timer anterior primeiro — evita 2 timers pro mesmo
   * agendamento se create/update rodar mais de uma vez pra ele.
   */
  private scheduleReminder(appt: Appointment): void {
    this.cancelReminderTimer(appt.id);

    if (appt.status !== 'agendado' || !appt.clientPhone || appt.reminderSentAt) return;
    if (appt.startDateTime.getTime() <= Date.now()) return; // reunião já passou, não faz sentido lembrar

    const delay = Math.max(0, appt.startDateTime.getTime() - REMINDER_LEAD_MS - Date.now());
    if (delay > MAX_TIMEOUT_MS) {
      // Data muito distante — só reagenda de fato mais perto, evitando o
      // overflow do setTimeout nativo.
      const timeout = setTimeout(() => this.scheduleReminder(appt), MAX_TIMEOUT_MS);
      this.schedulerRegistry.addTimeout(this.timerName(appt.id), timeout);
      return;
    }
    const timeout = setTimeout(() => {
      this.fireReminder(appt.id).catch((err) =>
        this.logger.error(`[AGENDA] Erro ao disparar lembrete do agendamento ${appt.id}: ${err.message}`),
      );
    }, delay);
    this.schedulerRegistry.addTimeout(this.timerName(appt.id), timeout);
  }

  /** Busca o agendamento fresco (pode ter mudado entre o agendamento do timer e o disparo) e envia o lembrete. */
  private async fireReminder(id: string): Promise<void> {
    const appt = await this.repo.findOne({ where: { id } });
    if (!appt || appt.status !== 'agendado' || !appt.clientPhone || appt.reminderSentAt) return;

    const firstName = (appt.clientName || '').trim().split(' ')[0] || '';
    const hora = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(appt.startDateTime);
    const greeting = firstName ? `Oi! ${firstName}` : 'Oi!';
    const text = `${greeting} Só lembrando que sua reunião com o Mentor Marcel é hoje às ${hora} — daqui a 1h. Até já!`;

    const ok = await this.sendWhatsapp(appt.clientPhone, text);
    if (ok) {
      await this.markReminderSent(appt.id);
      await this.recordReminderInLeadHistory(appt, text);
      this.logger.log(`[AGENDA] Lembrete de 1h enviado pra ${appt.clientPhone} (agendamento ${appt.id})`);
    } else {
      this.logger.error(`[AGENDA] Falha ao enviar lembrete pra ${appt.clientPhone} (agendamento ${appt.id})`);
    }
  }

  /** Grava o lembrete no aiContext do lead — senão o WhatsApp é enviado mas some do Kanban/Inbox do CRM. */
  private async recordReminderInLeadHistory(appt: Appointment, text: string): Promise<void> {
    const lead = appt.leadId
      ? await this.leadsRepo.findOne({ where: { id: appt.leadId } })
      : await this.leadsRepo.findOne({ where: { phone: appt.clientPhone! } });
    if (!lead) return;

    const ctx = Array.isArray(lead.aiContext) ? lead.aiContext : [];
    const entry = { role: 'assistant', source: 'reminder', content: text, timestamp: new Date().toISOString() };
    await this.leadsRepo.update(lead.id, { aiContext: [...ctx, entry], waLastMessageAt: new Date() });

    const fresh = await this.leadsRepo.findOne({ where: { id: lead.id } });
    if (fresh) this.realtime.emitLeadUpdated(fresh);
  }

  private async sendWhatsapp(phone: string, text: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/send/text`,
          { number: phone, text },
          { headers: { token: this.uazapiToken } },
        ),
      );
      return true;
    } catch (err: any) {
      this.logger.error(`[AGENDA] Erro ao enviar WhatsApp pra ${phone}: ${err.message}`);
      return false;
    }
  }

  async findByMonth(year: number, month: number): Promise<Appointment[]> {
    const start = new Date(year, month - 1, 1, 0, 0, 0);
    const end = new Date(year, month, 0, 23, 59, 59);
    return this.repo.find({
      where: { startDateTime: Between(start, end) },
      order: { startDateTime: 'ASC' },
      relations: ['lead'],
    });
  }

  async markReminderSent(id: string): Promise<void> {
    await this.repo.update({ id }, { reminderSentAt: new Date() });
  }

  async findOne(id: string): Promise<Appointment> {
    const appt = await this.repo.findOne({ where: { id }, relations: ['lead'] });
    if (!appt) throw new NotFoundException('Agendamento não encontrado');
    return appt;
  }

  async create(dto: CreateAppointmentDto): Promise<Appointment> {
    const appt = this.repo.create({
      leadId: dto.leadId ?? null,
      clientName: dto.clientName,
      clientPhone: dto.clientPhone ?? null,
      service: dto.service,
      value: dto.value ?? null,
      status: dto.status ?? 'agendado',
      startDateTime: typeof dto.startDateTime === 'string' ? new Date(dto.startDateTime) : dto.startDateTime,
      notes: dto.notes ?? null,
    });
    const saved = await this.repo.save(appt);
    this.scheduleReminder(saved);
    return saved;
  }

  async update(id: string, dto: UpdateAppointmentDto): Promise<Appointment> {
    const appt = await this.findOne(id);
    if (dto.clientName !== undefined) appt.clientName = dto.clientName;
    if (dto.clientPhone !== undefined) appt.clientPhone = dto.clientPhone;
    if (dto.service !== undefined) appt.service = dto.service;
    if (dto.value !== undefined) appt.value = dto.value;
    if (dto.status !== undefined) appt.status = dto.status;
    if (dto.startDateTime !== undefined) {
      const newStart = typeof dto.startDateTime === 'string' ? new Date(dto.startDateTime) : dto.startDateTime;
      // Reagendou pra outro horário → o lembrete antigo (se já foi enviado) não vale mais.
      if (newStart.getTime() !== appt.startDateTime.getTime()) appt.reminderSentAt = null;
      appt.startDateTime = newStart;
    }
    if (dto.notes !== undefined) appt.notes = dto.notes;
    if (dto.leadId !== undefined) appt.leadId = dto.leadId;
    const saved = await this.repo.save(appt);
    this.scheduleReminder(saved);
    return saved;
  }

  async delete(id: string): Promise<void> {
    const result = await this.repo.delete({ id });
    if (result.affected === 0) throw new NotFoundException('Agendamento não encontrado');
    this.cancelReminderTimer(id);
  }
}
