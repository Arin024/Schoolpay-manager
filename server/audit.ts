import { cacheDb, getPgPool, queryPg } from './db.ts';

export interface AuditParams {
  actorId?: string | null;
  actorEmail?: string | null;
  schoolId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  ipAddress?: string;
  metadata?: Record<string, unknown> | null;
}

export function logAudit(params: AuditParams) {
  const metadataJson = params.metadata ? JSON.stringify(params.metadata) : null;
  const ip = params.ipAddress || '127.0.0.1';

  // 1. Local SQLite read-cache write (safe if FK parent isn't in local cache yet)
  try {
    const validActor = params.actorId
      ? cacheDb.prepare('SELECT id FROM users WHERE id = ?').get(params.actorId)
      : null;
    const validSchool = params.schoolId
      ? cacheDb.prepare('SELECT id FROM schools WHERE id = ?').get(params.schoolId)
      : null;

    (cacheDb as any).prepare(`
      INSERT INTO audit_logs (actor_id, actor_email, school_id, action, entity, entity_id, ip_address, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      validActor ? params.actorId : null,
      params.actorEmail || null,
      validSchool ? params.schoolId : null,
      params.action,
      params.entity,
      params.entityId || null,
      ip,
      metadataJson
    );
  } catch (err) {
    // Non-fatal local cache audit notice
  }

  // 2. Authoritative Neon PostgreSQL audit persistence (uses PG SERIAL sequence for id)
  const pool = getPgPool();
  if (pool) {
    queryPg(
      `INSERT INTO audit_logs (actor_id, actor_email, school_id, action, entity, entity_id, ip_address, metadata)
       VALUES (
         (SELECT id FROM users WHERE id = $1),
         $2,
         (SELECT id FROM schools WHERE id = $3),
         $4, $5, $6, $7, $8
       )`,
      [
        params.actorId || null,
        params.actorEmail || null,
        params.schoolId || null,
        params.action,
        params.entity,
        params.entityId || null,
        ip,
        metadataJson,
      ]
    ).catch((err) => {
      console.warn('[AuditLog PG Notice]', err?.message);
    });
  }
}

