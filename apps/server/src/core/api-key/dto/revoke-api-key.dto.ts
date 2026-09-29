// Ported from Forkmost (AGPL-3.0): https://github.com/Vito0912/forkmost
import { IsNotEmpty, IsUUID } from 'class-validator';

export class RevokeApiKeyDto {
  @IsNotEmpty()
  @IsUUID()
  apiKeyId: string;
}
