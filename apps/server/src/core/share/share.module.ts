import { Module } from '@nestjs/common';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';
import { ShareAccessService } from './share-access.service';
import { TokenModule } from '../auth/token.module';
import { ShareSeoController } from './share-seo.controller';
import { TransclusionModule } from '../page/transclusion/transclusion.module';

@Module({
  imports: [TokenModule, TransclusionModule],
  controllers: [ShareController, ShareSeoController],
  providers: [ShareService, ShareAccessService],
  exports: [ShareService, ShareAccessService],
})
export class ShareModule {}
