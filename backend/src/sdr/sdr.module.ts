import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SdrController } from './sdr.controller';
import { FollowupController } from './followup.controller';
import { ManualMessageController } from './manual-message.controller';
import { WhatsappInstanceController } from './whatsapp-instance.controller';
import { SdrService } from './sdr.service';
import { SdrFollowupService } from './sdr-followup.service';
import { FollowupVideoService } from './followup-video.service';
import { SdrWebhookGuardService } from './sdr-webhook-guard.service';
import { Lead } from '../common/entities/lead.entity';
import { FollowupRule } from '../common/entities/followup-rule.entity';
import { FollowupVideo } from '../common/entities/followup-video.entity';
import { Appointment } from '../common/entities/appointment.entity';
import { LeadsModule } from '../leads/leads.module';
import { FacebookModule } from '../facebook/facebook.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SettingsModule } from '../settings/settings.module';
import { AvailabilityModule } from '../availability/availability.module';
import { AppointmentsModule } from '../appointments/appointments.module';

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([Lead, FollowupRule, FollowupVideo, Appointment]),
    LeadsModule,
    FacebookModule,
    RealtimeModule,
    SettingsModule,
    AvailabilityModule,
    AppointmentsModule,
  ],
  controllers: [SdrController, FollowupController, ManualMessageController, WhatsappInstanceController],
  providers: [SdrService, SdrFollowupService, FollowupVideoService, SdrWebhookGuardService],
  exports: [SdrFollowupService],
})
export class SdrModule {}
