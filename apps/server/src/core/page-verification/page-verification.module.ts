import { Module } from '@nestjs/common';
import { PageVerificationController } from './page-verification.controller';
import { PageVerificationService } from './page-verification.service';
import { PageVerificationSchedulerService } from './page-verification-scheduler.service';

@Module({
  controllers: [PageVerificationController],
  providers: [PageVerificationService, PageVerificationSchedulerService],
  exports: [PageVerificationSchedulerService],
})
export class PageVerificationModule {}
