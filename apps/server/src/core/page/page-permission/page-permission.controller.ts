import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { PagePermissionService } from './page-permission.service';
import {
  AddPagePermissionsDto,
  PagePermissionPageIdDto,
  PagePermissionTargetDto,
  UpdatePagePermissionRoleDto,
} from './dto/page-permission.dto';

@UseGuards(JwtAuthGuard)
@Controller('pages/permissions')
export class PagePermissionController {
  constructor(private readonly pagePermissionService: PagePermissionService) {}

  @HttpCode(HttpStatus.OK)
  @Post('info')
  async info(
    @Body() dto: PagePermissionPageIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pagePermissionService.getPage(
      dto.pageId,
      workspace.id,
    );
    return this.pagePermissionService.getInfo(page, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('members')
  async members(
    @Body() dto: PagePermissionPageIdDto,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pagePermissionService.getPage(
      dto.pageId,
      workspace.id,
    );
    return this.pagePermissionService.listMembers(page, user, pagination);
  }

  @HttpCode(HttpStatus.OK)
  @Post('restrict')
  async restrict(
    @Body() dto: PagePermissionPageIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pagePermissionService.getPage(
      dto.pageId,
      workspace.id,
    );
    await this.pagePermissionService.restrict(page, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('unrestrict')
  async unrestrict(
    @Body() dto: PagePermissionPageIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pagePermissionService.getPage(
      dto.pageId,
      workspace.id,
    );
    await this.pagePermissionService.unrestrict(page, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('add')
  async add(
    @Body() dto: AddPagePermissionsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pagePermissionService.getPage(
      dto.pageId,
      workspace.id,
    );
    await this.pagePermissionService.addMembers(page, user, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('remove')
  async remove(
    @Body() dto: PagePermissionTargetDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pagePermissionService.getPage(
      dto.pageId,
      workspace.id,
    );
    await this.pagePermissionService.removeMember(page, user, {
      userId: dto.userId,
      groupId: dto.groupId,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('update-role')
  async updateRole(
    @Body() dto: UpdatePagePermissionRoleDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pagePermissionService.getPage(
      dto.pageId,
      workspace.id,
    );
    await this.pagePermissionService.updateRole(
      page,
      user,
      { userId: dto.userId, groupId: dto.groupId },
      dto.role,
    );
  }
}
