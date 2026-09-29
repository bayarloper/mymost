import {
  AuthProvider,
  InsertableAuthProvider,
  UpdatableAuthProvider,
} from '@docmost/db/types/entity.types';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import { Json } from '@docmost/db/types/db';
import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';

const JSONB_FIELDS = ['ldapConfig', 'ldapUserAttributes', 'settings'] as const;

function withJsonbFields<T extends Record<string, unknown>>(values: T): T {
  const result: Record<string, unknown> = { ...values };
  for (const field of JSONB_FIELDS) {
    if (result[field] !== undefined && result[field] !== null) {
      result[field] = sql<Json>`${JSON.stringify(result[field])}::text::jsonb`;
    }
  }
  return result as T;
}

@Injectable()
export class AuthProviderRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findByType(
    type: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<AuthProvider | undefined> {
    const db = dbOrTx(this.db, trx);
    return db
      .selectFrom('authProviders')
      .selectAll()
      .where('type', '=', type)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .executeTakeFirst();
  }

  async insert(
    insertableAuthProvider: InsertableAuthProvider,
    trx?: KyselyTransaction,
  ): Promise<AuthProvider> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('authProviders')
      .values(withJsonbFields(insertableAuthProvider))
      .returningAll()
      .executeTakeFirst();
  }

  async update(
    updatableAuthProvider: UpdatableAuthProvider,
    authProviderId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<AuthProvider> {
    const db = dbOrTx(this.db, trx);
    return db
      .updateTable('authProviders')
      .set({ ...withJsonbFields(updatableAuthProvider), updatedAt: new Date() })
      .where('id', '=', authProviderId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }
}
