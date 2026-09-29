import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditLogService } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [AuditLogService],
})
export class AuditLogModule {}
