import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';

export const VERIFICATION_TYPES = ['expiring', 'approval'] as const;
export type VerificationType = (typeof VERIFICATION_TYPES)[number];

export const PERIOD_UNITS = ['day', 'week', 'month', 'year'] as const;
export type PeriodUnit = (typeof PERIOD_UNITS)[number];

export const VERIFICATION_STATES = [
  'unverified',
  'verified',
  'expiring',
  'expired',
  'draft',
  'in_approval',
  'approved',
  'obsolete',
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export class VerificationPageIdDto {
  @IsString()
  @IsNotEmpty()
  pageId: string;
}

export class SetupVerificationDto extends VerificationPageIdDto {
  @IsIn(VERIFICATION_TYPES)
  type: VerificationType;

  @ValidateIf((o) => o.type === 'expiring')
  @IsInt()
  @Min(1)
  @Max(365)
  periodAmount?: number;

  @ValidateIf((o) => o.type === 'expiring')
  @IsIn(PERIOD_UNITS)
  periodUnit?: PeriodUnit;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  verifierIds: string[];
}

export class RejectVerificationDto extends VerificationPageIdDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class ListVerificationsDto extends PaginationOptions {
  @IsOptional()
  @IsUUID()
  spaceId?: string;

  @IsOptional()
  @IsIn(VERIFICATION_STATES)
  state?: VerificationState;
}
