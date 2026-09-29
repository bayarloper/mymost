import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';

export class ListAuditLogsDto extends PaginationOptions {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  event?: string;

  // e.g. "page" matches page.* events
  @IsOptional()
  @Matches(/^[a-z_]+$/)
  @MaxLength(50)
  eventPrefix?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  resourceType?: string;

  @IsOptional()
  @IsUUID()
  spaceId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

// 0 keeps audit logs forever.
export const AUDIT_RETENTION_OPTIONS = [0, 30, 90, 180, 365, 730, 1825];

export class UpdateAuditRetentionDto {
  @IsInt()
  @IsIn(AUDIT_RETENTION_OPTIONS)
  retentionDays: number;
}
