import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Regra recorrente semanal (tipo Calendly): "toda terça, 08:00-18:00, slots de 60min".
@Entity('availability_rules')
export class AvailabilityRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 0=domingo ... 6=sábado, igual Date#getDay().
  @Column({ name: 'day_of_week', type: 'int' })
  dayOfWeek: number;

  // "HH:MM", 24h.
  @Column({ name: 'start_time', type: 'varchar' })
  startTime: string;

  @Column({ name: 'end_time', type: 'varchar' })
  endTime: string;

  @Column({ name: 'slot_minutes', type: 'int', default: 60 })
  slotMinutes: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
