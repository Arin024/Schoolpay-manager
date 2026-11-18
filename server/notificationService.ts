import crypto from 'node:crypto';
import { cacheDb, getPgPool, markPgConnected } from './db.ts';

export type NotificationType =
  | 'INVOICE_CREATED'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_VERIFIED'
  | 'INVOICE_OVERDUE'
  | 'RECEIPT_AVAILABLE'
  | 'ANNOUNCEMENT'
  | 'SYSTEM';

export interface CreateNotificationParams {
  schoolId: string;
  userId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
}

export interface DispatchChannel {
  channel: 'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP';
  status: 'DELIVERED' | 'QUEUED' | 'SIMULATED' | 'DISABLED';
}

function insertNotificationDual(
  id: string,
  schoolId: string,
  userId: string | null,
  type: NotificationType,
  title: string,
  message: string,
  dataJson: string | null
) {
  try {
    cacheDb
      .prepare(
        `INSERT INTO notifications (id, school_id, user_id, type, title, message, data, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO NOTHING`
      )
      .run(id, schoolId, userId, type, title, message, dataJson);
  } catch (e: any) {
    console.warn('[NotificationService SQLite Notice]', e?.message);
  }

  const pool = getPgPool();
  if (pool) {
    pool
      .query(
        `INSERT INTO notifications (id, school_id, user_id, type, title, message, data, channel, template_type, recipient_type, recipient_address, body, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'IN_APP', $4, 'USER', $3, $6, 'SENT', CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO NOTHING`,
        [id, schoolId, userId, type, title, message, dataJson]
      )
      .then(() => markPgConnected())
      .catch((err: any) => {
        console.warn('[NotificationService PG Notice]', err?.message);
      });
  }
}

/**
 * Notification Service Abstraction
 * Supports dual PG + SQLite in-app persistence and tenant-scoped fanouts.
 */
export class NotificationService {
  createNotification(params: CreateNotificationParams): string {
    const id = `notif_${crypto.randomBytes(8).toString('hex')}`;
    const dataJson = params.data ? JSON.stringify(params.data) : null;

    insertNotificationDual(
      id,
      params.schoolId,
      params.userId || null,
      params.type,
      params.title,
      params.message,
      dataJson
    );

    this.dispatchExternalChannels(params);
    return id;
  }

  async notify(params: {
    id?: string;
    school_id?: string;
    schoolId?: string;
    user_id?: string | null;
    userId?: string | null;
    type: NotificationType;
    title: string;
    message: string;
    data?: any;
  }): Promise<string> {
    const schoolId = params.school_id || params.schoolId || '';
    const userId = params.user_id !== undefined ? params.user_id : params.userId;
    const id = params.id || `notif_${crypto.randomBytes(8).toString('hex')}`;
    const dataJson = params.data ? JSON.stringify(params.data) : null;

    insertNotificationDual(id, schoolId, userId || null, params.type, params.title, params.message, dataJson);

    this.dispatchExternalChannels({
      schoolId,
      userId,
      type: params.type,
      title: params.title,
      message: params.message,
      data: params.data,
    });

    return id;
  }

  notifySchoolAdmins(
    schoolId: string,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>
  ) {
    try {
      const adminUsers = cacheDb
        .prepare(
          `SELECT DISTINCT u.id
           FROM user_roles ur
           JOIN users u ON ur.user_id = u.id
           JOIN roles r ON ur.role_id = r.id
           WHERE ur.school_id = ? AND r.name IN ('SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR')`
        )
        .all(schoolId) as { id: string }[];

      for (const admin of adminUsers) {
        this.createNotification({
          schoolId,
          userId: admin.id,
          type,
          title,
          message,
          data,
        });
      }
    } catch (err: any) {
      console.warn('[NotificationService] Admin broadcast error:', err?.message);
    }
  }

  /**
   * Notify ONLY explicitly verified linked parent portal accounts (parents.user_id)
   */
  notifyParentsOfStudent(
    schoolId: string,
    studentId: string,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>
  ) {
    try {
      const parents = cacheDb
        .prepare(
          `SELECT DISTINCT p.id as parent_record_id, p.user_id, p.email, p.phone
           FROM parent_students ps
           JOIN parents p ON ps.parent_id = p.id
           WHERE ps.school_id = ? AND ps.student_id = ?
             AND (p.is_deleted = 0 OR p.is_deleted IS NULL)`
        )
        .all(schoolId, studentId) as any[];

      for (const parent of parents) {
        if (!parent.user_id) continue;
        this.createNotification({
          schoolId,
          userId: parent.user_id,
          type,
          title,
          message,
          data: {
            ...data,
            studentId,
          },
        });
      }
    } catch (err: any) {
      console.warn('[NotificationService] Parent notification error:', err?.message);
    }
  }

  /**
   * Notify an explicitly linked student portal account (students.user_id)
   */
  notifyStudent(
    schoolId: string,
    studentId: string,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>
  ) {
    try {
      const stu = cacheDb
        .prepare(
          `SELECT id, user_id FROM students
           WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`
        )
        .get(studentId, schoolId) as { id: string; user_id?: string | null } | undefined;

      if (stu?.user_id) {
        this.createNotification({
          schoolId,
          userId: stu.user_id,
          type,
          title,
          message,
          data: {
            ...data,
            studentId,
          },
        });
      }
    } catch (err: any) {
      console.warn('[NotificationService] Student notification error:', err?.message);
    }
  }

  /**
   * Fan out an announcement notification to the appropriate verified user roles in the school
   */
  notifyAnnouncementAudience(
    schoolId: string,
    audience: string,
    targetClassId: string | null,
    title: string,
    message: string,
    data?: Record<string, any>,
    isConfidential = false
  ) {
    try {
      const userIds = new Set<string>();
      const staffOnly = Boolean(isConfidential || audience === 'STAFF_ONLY' || audience === 'TEACHERS');

      if (!staffOnly && (audience === 'ALL' || audience === 'PARENTS')) {
        const rows = cacheDb
          .prepare(
            `SELECT DISTINCT ur.user_id FROM user_roles ur
             JOIN roles r ON ur.role_id = r.id
             WHERE ur.school_id = ? AND r.name = 'PARENT'`
          )
          .all(schoolId) as { user_id: string }[];
        rows.forEach((r) => userIds.add(r.user_id));
      }

      if (!staffOnly && (audience === 'ALL' || audience === 'STUDENTS')) {
        const rows = cacheDb
          .prepare(
            `SELECT DISTINCT ur.user_id FROM user_roles ur
             JOIN roles r ON ur.role_id = r.id
             WHERE ur.school_id = ? AND r.name = 'STUDENT'`
          )
          .all(schoolId) as { user_id: string }[];
        rows.forEach((r) => userIds.add(r.user_id));
      }

      if (staffOnly || audience === 'ALL') {
        const allowedRoles = staffOnly
          ? `('TEACHER', 'STAFF', 'SCHOOL_ADMIN', 'SCHOOL_OWNER')`
          : `('TEACHER', 'STAFF', 'SCHOOL_ADMIN', 'SCHOOL_OWNER', 'BURSAR')`;
        const rows = cacheDb
          .prepare(
            `SELECT DISTINCT ur.user_id FROM user_roles ur
             JOIN roles r ON ur.role_id = r.id
             WHERE ur.school_id = ? AND r.name IN ${allowedRoles}`
          )
          .all(schoolId) as { user_id: string }[];
        rows.forEach((r) => userIds.add(r.user_id));
      }

      if (!staffOnly && audience === 'CLASS' && targetClassId) {
        const stuRows = cacheDb
          .prepare(
            `SELECT DISTINCT user_id FROM students
             WHERE school_id = ? AND class_id = ? AND user_id IS NOT NULL AND (is_deleted = 0 OR is_deleted IS NULL)`
          )
          .all(schoolId, targetClassId) as { user_id: string }[];
        stuRows.forEach((r) => userIds.add(r.user_id));

        const parRows = cacheDb
          .prepare(
            `SELECT DISTINCT p.user_id
             FROM parent_students ps
             JOIN parents p ON ps.parent_id = p.id
             JOIN students s ON ps.student_id = s.id
             WHERE ps.school_id = ? AND s.class_id = ? AND p.user_id IS NOT NULL`
          )
          .all(schoolId, targetClassId) as { user_id: string }[];
        parRows.forEach((r) => userIds.add(r.user_id));
      }

      for (const uid of userIds) {
        this.createNotification({
          schoolId,
          userId: uid,
          type: 'ANNOUNCEMENT',
          title,
          message,
          data,
        });
      }
    } catch (err: any) {
      console.warn('[NotificationService] Audience fanout error:', err?.message);
    }
  }

  private dispatchExternalChannels(params: CreateNotificationParams): DispatchChannel[] {
    const channels: DispatchChannel[] = [{ channel: 'IN_APP', status: 'DELIVERED' }];
    try {
      const settings = cacheDb
        .prepare('SELECT payment_notification_email, payment_notification_sms FROM school_settings WHERE school_id = ?')
        .get(params.schoolId) as any;

      if (settings?.payment_notification_email) {
        channels.push({ channel: 'EMAIL', status: 'SIMULATED' });
      }
      if (settings?.payment_notification_sms) {
        channels.push({ channel: 'SMS', status: 'SIMULATED' });
      }
    } catch {}

    return channels;
  }
}

export const notificationService = new NotificationService();
