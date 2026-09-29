// Ported from Forkmost (AGPL-3.0): https://github.com/Vito0912/forkmost
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform, TransformFnParams } from 'class-transformer';

export class CreateApiKeyDto {
  @MinLength(1)
  @MaxLength(250)
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: TransformFnParams) => value?.trim())
  name: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
