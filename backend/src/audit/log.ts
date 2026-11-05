import type { Db } from 'mongodb';
import { ObjectId as OID } from 'mongodb';
import { collections, type AuditLogDoc } from '../db/types.js';
import { log } from '../util/logger.js';

export async function writeAudit(db: Db, e: Omit<AuditLogDoc, '_id' | 'createdAt'>): Promise<void> {
  try {
    await db.collection<AuditLogDoc>(collections.auditLog).insertOne({
      _id: new OID(),
      ...e,
      createdAt: new Date(),
    });
  } catch (err) {
    log.warn({ err, action: e.action }, 'audit log write failed');
  }
}
