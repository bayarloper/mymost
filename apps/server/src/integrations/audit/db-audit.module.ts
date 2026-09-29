import { Global, Module } from '@nestjs/common';
import { AUDIT_SERVICE } from './audit.service';
import { DbAuditService } from './db-audit.service';

/** Core audit log implementation, used when the enterprise module is absent. */
@Global()
@Module({
  providers: [
    DbAuditService,
    {
      provide: AUDIT_SERVICE,
      useExisting: DbAuditService,
    },
  ],
  exports: [AUDIT_SERVICE, DbAuditService],
})
export class DbAuditModule {}
