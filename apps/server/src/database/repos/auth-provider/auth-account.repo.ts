import {
  AuthAccount,
  InsertableAuthAccount,
} from '@docmost/db/types/entity.types';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';

@Injectable()
export class AuthAccountRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findByProviderUserId(
    providerUserId: string,
    authProviderId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<AuthAccount | undefined> {
    const db = dbOrTx(this.db, trx);
    return db
      .selectFrom('authAccounts')
      .selectAll()
      .where('providerUserId', '=', providerUserId)
      .where('authProviderId', '=', authProviderId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async findByUserId(
    userId: string,
    authProviderId: string,
    trx?: KyselyTransaction,
  ): Promise<AuthAccount | undefined> {
    const db = dbOrTx(this.db, trx);
    return db
      .selectFrom('authAccounts')
      .selectAll()
      .where('userId', '=', userId)
      .where('authProviderId', '=', authProviderId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async hasEnabledProviderAccount(
    userId: string,
    workspaceId: string,
    providerType: string,
  ): Promise<boolean> {
    const row = await this.db
      .selectFrom('authAccounts')
      .innerJoin(
        'authProviders',
        'authProviders.id',
        'authAccounts.authProviderId',
      )
      .select('authAccounts.id')
      .where('authAccounts.userId', '=', userId)
      .where('authAccounts.workspaceId', '=', workspaceId)
      .where('authAccounts.deletedAt', 'is', null)
      .where('authProviders.type', '=', providerType)
      .where('authProviders.isEnabled', '=', true)
      .where('authProviders.deletedAt', 'is', null)
      .executeTakeFirst();

    return !!row;
  }

  async insert(
    insertableAuthAccount: InsertableAuthAccount,
    trx?: KyselyTransaction,
  ): Promise<AuthAccount> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('authAccounts')
      .values(insertableAuthAccount)
      .returningAll()
      .executeTakeFirst();
  }
}
