import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type BulkCampaignStatus = 'scheduled' | 'sending' | 'paused' | 'done' | 'deleting';

/**
 * Campanha de disparo em massa (portado do fisio-secretary/bulk-message, sem
 * multi-tenant). folderId = id da fila na uazapi (/sender/advanced) — é por ele
 * que o status sincroniza e os controles stop/continue/delete funcionam.
 */
@Entity('bulk_campaigns')
export class BulkCampaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'varchar' })
  name: string;

  @Column({ name: 'message', type: 'text' })
  message: string;

  @Column({ name: 'total_recipients', type: 'int', default: 0 })
  totalRecipients: number;

  @Column({ name: 'folder_id', type: 'varchar', nullable: true })
  folderId?: string | null;

  @Column({ name: 'status', type: 'varchar', default: 'sending' })
  status: BulkCampaignStatus | string;

  // Canal de envio: 'uazapi' (instância atual da Clara) hoje; 'official' fica
  // reservado pra quando o número da WhatsApp Business API oficial existir.
  @Column({ name: 'provider', type: 'varchar', default: 'uazapi' })
  provider: string;

  @Column({ name: 'delay_min', type: 'int', default: 20 })
  delayMin: number;

  @Column({ name: 'delay_max', type: 'int', default: 40 })
  delayMax: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
