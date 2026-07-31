import { Module } from '@nestjs/common';
import { FacebookService } from './facebook.service';
import { FacebookController } from './facebook.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [FacebookService],
  controllers: [FacebookController],
  exports: [FacebookService],
})
export class FacebookModule {}
