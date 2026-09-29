import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectKysely } from 'nestjs-kysely';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { EXPIRING_SOON_MS } from './page-verification.utils';

const EXPIRED_LOOKBACK_MS = 48 * 60 * 60 * 1000;

/**
 * Queues "expiring soon" / "expired" notifications for expiring verifications.
 * VerificationNotificationService re-checks the state and de-duplicates per
 * verification, so running this repeatedly is safe.
 */
@Injectable()
export class PageVerificationSchedulerService {
  private readonly logger = new Logger(PageVerificationSchedulerService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
  ) {}

  @Interval('page-verification-reconcile', 60 * 60 * 1000)
  async reconcile(): Promise<void> {
    try {
      const now = Date.now();

      const expiring = await this.db
        .selectFrom('pageVerifications')
        .select('id')
        .where('type', '=', 'expiring')
        .where('expiresAt', '>', new Date(now))
        .where('expiresAt', '<=', new Date(now + EXPIRING_SOON_MS))
        .execute();

      const expired = await this.db
        .selectFrom('pageVerifications')
        .select('id')
        .where('type', '=', 'expiring')
        .where('expiresAt', '<=', new Date(now))
        .where('expiresAt', '>', new Date(now - EXPIRED_LOOKBACK_MS))
        .execute();

      for (const { id } of expiring) {
        await this.notificationQueue.add(QueueJob.PAGE_VERIFICATION_EXPIRING, {
          verificationId: id,
        });
      }
      for (const { id } of expired) {
        await this.notificationQueue.add(QueueJob.PAGE_VERIFICATION_EXPIRED, {
          verificationId: id,
        });
      }

      if (expiring.length + expired.length > 0) {
        this.logger.debug(
          `Queued ${expiring.length} expiring and ${expired.length} expired verification notifications`,
        );
      }
    } catch (err) {
      this.logger.error(
        'Verification reconcile failed',
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
