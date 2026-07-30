import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Disponibilidade pra agendamento (tipo Calendly). Duas formas de regra:
// - Data específica (specificDate preenchido): vale só pra aquele dia exato do
//   calendário — é o que a tela de Configurações usa hoje (usuário clica no dia).
// - Recorrente por dia da semana (specificDate null, dayOfWeek preenchido):
//   mantido por compatibilidade com regras antigas, não tem mais tela própria.
@Entity('availability_rules')
export class AvailabilityRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Data exata "YYYY-MM-DD" — quando preenchida, a regra vale só pra esse dia
  // específico do calendário (não repete toda semana).
  @Column({ name: 'specific_date', type: 'date', nullable: true })
  specificDate: string | null;

  // 0=domingo ... 6=sábado, igual Date#getDay(). Preenchido mesmo quando
  // specificDate está setado (útil pra exibir o nome do dia da semana), mas só
  // é USADO pra casar disponibilidade quando specificDate é null.
  @Column({ name: 'day_of_week', type: 'int', nullable: true })
  dayOfWeek: number | null;

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
