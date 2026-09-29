import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Transform, TransformFnParams, Type } from 'class-transformer';

const trim = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim() : value;

export class LdapLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  @Transform(trim)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password: string;
}

export class LdapUserAttributesDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(trim)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(trim)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(trim)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(trim)
  uid: string;
}

export class LdapAllowedGroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  @Transform(trim)
  dn: string;

  @IsOptional()
  @IsUUID()
  docmostGroupId?: string | null;
}

export class UpdateLdapConfigDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(trim)
  name: string;

  @IsBoolean()
  isEnabled: boolean;

  @IsBoolean()
  allowSignup: boolean;

  @IsString()
  @Matches(/^ldaps?:\/\/.+/i, {
    message: 'URL must start with ldap:// or ldaps://',
  })
  @MaxLength(500)
  @Transform(trim)
  url: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  @Transform(trim)
  bindDn: string;

  // Blank keeps the stored password.
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  bindPassword?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  @Transform(trim)
  baseDn: string;

  @IsString()
  @Matches(/\{\{username\}\}/, {
    message: 'User search filter must contain {{username}}',
  })
  @MaxLength(1000)
  @Transform(trim)
  userSearchFilter: string;

  @ValidateNested()
  @Type(() => LdapUserAttributesDto)
  userAttributes: LdapUserAttributesDto;

  @IsBoolean()
  tlsEnabled: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  tlsCaCert?: string | null;

  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  allowedUsers: string[];

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LdapAllowedGroupDto)
  allowedGroups: LdapAllowedGroupDto[];

  @IsBoolean()
  nestedGroups: boolean;

  @IsBoolean()
  linkExistingByEmail: boolean;
}

export class TestLdapConfigDto extends UpdateLdapConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  @Transform(trim)
  testUsername?: string;
}
