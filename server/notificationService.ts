import crypto from 'node:crypto';
import { db } from './db.ts';

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

/**
 * Notification Service Abstraction
 * Supports in-app persistence, multi-channel dispatch, and tenant-scoped fanouts.
 */
export class NotificationService {
  /**
   * Persist in-app notification to the notifications table
   */
  createNotification(params: CreateNotificationParams): string {
    const id = `notif_${crypto.randomBytes(8).toString('hex')}`;
    const dataJson = params.data ? JSON.stringify(params.data) : null;

    try {
      db.prepare(`
        INSERT INTO notifications (id, school_id, user_id, type, title, message, data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        id,
        params.schoolId,
        params.userId || null,
        params.type,
        params.title,
        params.message,
        dataJson
      );
    } catch (e: any) {
      console.warn('[NotificationService] Failed to insert notification:', e?.message);
    }

    // Future SMS / WhatsApp / Email delivery dispatch behind provider abstraction
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

    try {
      db.prepare(`
        INSERT INTO notifications (id, school_id, user_id, type, title, message, data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        id,
        schoolId,
        userId || null,
        params.type,
        params.title,
        params.message,
        dataJson
      );
    } catch (e: any) {
      console.warn('[NotificationService] Failed to insert notification:', e?.message);
    }

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

  /**
   * Broadcast notification to all school financial admins / bursars
   */
  notifySchoolAdmins(
    schoolId: string,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>
  ) {
    try {
      const adminUsers = db.prepare(`
        SELECT DISTINCT u.id
        FROM user_roles ur
        JOIN users u ON ur.user_id = u.id
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.school_id = ? AND r.name IN ('SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR')
      `).all(schoolId) as { id: string }[];

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
   * Notify parents linked to a student
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
      // Find parent user accounts linked to this student
      const parents = db.prepare(`
        SELECT DISTINCT p.id as parent_record_id, p.email, p.phone
        FROM parent_students ps
        JOIN parents p ON ps.parent_id = p.id
        WHERE ps.school_id = ? AND ps.student_id = ?
      `).all(schoolId, studentId) as any[];

      for (const parent of parents) {
        // Find if parent has a portal user account
        let userId: string | null = null;
        if (parent.email) {
          const userRow = db.prepare('SELECT id FROM users WHERE email = ?').get(parent.email) as any;
          if (userRow) userId = userRow.id;
        }

        this.createNotification({
          schoolId,
          userId,
          type,
          title,
          message,
          data: {
            ...data,
            parentEmail: parent.email,
            parentPhone: parent.phone,
            studentId,
          },
        });
      }
    } catch (err: any) {
      console.warn('[NotificationService] Parent notification error:', err?.message);
    }
  }

  /**
   * Dispatches to email/SMS/WhatsApp abstractions without requiring external credentials
   */
  private dispatchExternalChannels(params: CreateNotificationParams): DispatchChannel[] {
    const channels: DispatchChannel[] = [{ channel: 'IN_APP', status: 'DELIVERED' }];

    // Check if school has email/SMS notifications enabled
    const settings = db.prepare('SELECT payment_notification_email, payment_notification_sms FROM school_settings WHERE school_id = ?').get(params.schoolId) as any;

    if (settings?.payment_notification_email) {
      // Simulated sandbox dispatch log for audit
      channels.push({ channel: 'EMAIL', status: 'SIMULATED' });
    }

    if (settings?.payment_notification_sms) {
      channels.push({ channel: 'SMS', status: 'SIMULATED' });
    }

    return channels;
  }
}

export const notificationService = new NotificationService();
