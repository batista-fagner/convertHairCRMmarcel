import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BulkMessageController } from './bulk-message.controller';
import { BulkMessageService } from './bulk-message.service';
import { Lead } from '../common/entities/lead.entity';
import { BulkCampaign } from '../common/entities/bulk-campaign.entity';
import { RealtimeModule } from '../realtime/realtime.module';
import { SdrModule } from '../sdr/sdr.module';

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([Lead, BulkCampaign]), RealtimeModule, SdrModule],
  controllers: [BulkMessageController],
  providers: [BulkMessageService],
})
export class BulkMessageModule {}
