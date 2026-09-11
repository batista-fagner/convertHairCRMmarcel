import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// Biblioteca de áudios reutilizáveis no follow-up. O áudio fica no Supabase
// Storage (bucket sdr-followup-audios) e é enviado como nota de voz (ptt) pela
// uazapi via URL pública. Sem `caption` (como no vídeo) — a mensagem que
// acompanha o áudio é enviada separada e mora na FollowupRule (audioText).
@Entity('followup_audios')
export class FollowupAudio {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'varchar' })
  name: string;

  @Column({ name: 'storage_path', type: 'varchar' })
  storagePath: string;

  @Column({ name: 'public_url', type: 'varchar' })
  publicUrl: string;

  // Mimetype normalizado (sem ";codecs=...") — repassado como `mimetype` pra
  // uazapi no envio. Ver followup-audio.service.ts.
  @Column({ name: 'mime_type', type: 'varchar' })
  mimeType: string;

  // Só pra exibir "0:34" na biblioteca — não usado no envio.
  @Column({ name: 'duration_seconds', type: 'int', nullable: true })
  durationSeconds?: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
