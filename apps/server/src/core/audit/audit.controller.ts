import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../casl/interfaces/workspace-ability.type';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import { AuditLogService } from './audit.service';
import { ListAuditLogsDto, UpdateAuditRetentionDto } from './dto/audit.dto';

@UseGuards(JwtAuthGuard)
@Controller('audit')
export class AuditController {
  constructor(
    private readonly auditLogService: AuditLogService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('/')
  async list(
    @Body() dto: ListAuditLogsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertCanView(user, workspace);
    return this.auditLogService.list(workspace.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('settings')
  async settings(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertCanView(user, workspace);
    return {
      retentionDays: await this.auditLogService.getRetentionDays(workspace.id),
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('retention')
  async updateRetention(
    @Body() dto: UpdateAuditRetentionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertCanView(user, workspace);
    const before = await this.auditLogService.getRetentionDays(workspace.id);
    await this.auditService.updateRetention(workspace.id, dto.retentionDays);

    this.auditService.log({
      event: AuditEvent.WORKSPACE_UPDATED,
      resourceType: AuditResource.WORKSPACE,
      resourceId: workspace.id,
      changes: {
        before: { auditRetentionDays: before },
        after: { auditRetentionDays: dto.retentionDays },
      },
    });

    return { retentionDays: dto.retentionDays };
  }

  /** Audit logs are visible to workspace owners only. */
  private assertCanView(user: User, workspace: Workspace) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Audit)
    ) {
      throw new ForbiddenException();
    }
  }
}
