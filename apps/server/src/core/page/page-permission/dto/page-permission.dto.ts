import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export const PAGE_PERMISSION_ROLES = ['reader', 'writer'] as const;
export type PagePermissionRole = (typeof PAGE_PERMISSION_ROLES)[number];

export class PagePermissionPageIdDto {
  @IsString()
  @IsNotEmpty()
  pageId: string;
}

export class AddPagePermissionsDto extends PagePermissionPageIdDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  userIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  groupIds?: string[];

  @IsIn(PAGE_PERMISSION_ROLES)
  role: PagePermissionRole;
}

export class PagePermissionTargetDto extends PagePermissionPageIdDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;
}

export class UpdatePagePermissionRoleDto extends PagePermissionTargetDto {
  @IsIn(PAGE_PERMISSION_ROLES)
  role: PagePermissionRole;
}
