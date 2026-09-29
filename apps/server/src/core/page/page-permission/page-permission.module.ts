import { Module } from '@nestjs/common';
import { PagePermissionController } from './page-permission.controller';
import { PagePermissionService } from './page-permission.service';

@Module({
  controllers: [PagePermissionController],
  providers: [PagePermissionService],
})
export class PagePermissionModule {}
