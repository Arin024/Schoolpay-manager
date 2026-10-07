import { db } from './db.js';

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
  try {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (actor_id, actor_email, school_id, action, entity, entity_id, ip_address, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.actorId || null,
      params.actorEmail || null,
      params.schoolId || null,
      params.action,
      params.entity,
      params.entityId || null,
      params.ipAddress || '127.0.0.1',
      params.metadata ? JSON.stringify(params.metadata) : null
    );
  } catch (err) {
    console.error('[AuditLog] Failed to record audit log:', err);
  }
}
