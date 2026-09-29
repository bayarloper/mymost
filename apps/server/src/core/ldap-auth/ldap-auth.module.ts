import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module';
import { LdapAuthController } from './ldap-auth.controller';
import { LdapAuthService } from './ldap-auth.service';
import { LdapDirectoryService } from './ldap-directory.service';

@Module({
  imports: [WorkspaceModule],
  controllers: [LdapAuthController],
  providers: [LdapAuthService, LdapDirectoryService],
})
export class LdapAuthModule {}
