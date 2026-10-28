import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { ApplicationModule } from '@/application/application.module';
import { HttpModule } from '@/http/http.module';

@Module({
  imports: [ScheduleModule.forRoot(), ApplicationModule, HttpModule],
})
export class AppModule {}
