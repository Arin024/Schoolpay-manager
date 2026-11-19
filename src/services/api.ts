import {
  School,
  SchoolSettings,
  User,
  UserRole,
  AuditLog,
  Student,
  ParentItem,
  ClassItem,
  ClassArmItem,
  StaffItem,
  AcademicSessionItem,
  TermItem,
  SchoolDashboardStats,
  FeeItem,
  PlatformStats,
  FeeCategoryItem,
  FeeStructureDef,
  InvoiceDef,
  PaymentItem,
  FinancialStatsDef,
  StudentFinancialProfile,
  ReceiptItem,
  NotificationItem,
  GatewayStatus,
  SchoolSubscription,
  SubscriptionPlan,
  PlatformPayment,
  PlatformInvoice,
  SubscriptionDiscount,
  Partner,
  Commission,
  AcademicSettings,
  SubjectItem,
  ExaminationItem,
  StudentScoreItem,
  ScoreCorrectionLogItem,
  ReportCardItem,
  SessionReportCardItem,
  AttendanceRecordItem,
  AttendancePublicationItem,
  BehaviourRecordItem,
  TeacherRemarkItem,
  SchoolAnnouncementItem,
  PerformanceOverviewData,
  ParentDashboardData,
  StudentDashboardData,
  TeacherDashboardData,
  PublicSchoolSummary,
  PublicDocumentVerificationResult,
  BulkProvisionCredential,
  PublicSchoolWebsiteData,
  SchoolWebsiteProfile,
  SchoolWebsiteUrls,
  SchoolWebsitePost,
  SchoolWebsiteGalleryItem,
  SchoolCalendarEvent,
  SchoolAdmissionInquiry,
  LessonNoteItem,
  TimetableSlotItem,
  StaffRequestItem,
  ConfidentialNoticeItem,
  CbtExamItem,
  CbtQuestionItem,
  CbtStudentExamItem,
  CbtStudentHistoryItem,
  CbtStartSessionResponse,
  CbtReviewItem,
  CbtExamResultsResponse,
  CbtParentResultItem,
  CbtAnswerEntry,
} from '../types/index.js';

const API_BASE = '/api/v1';
const CANONICAL_PRODUCTION_ORIGIN = 'https://www.bursariq.com.ng';
const APEX_PRODUCTION_ORIGIN = 'https://bursariq.com.ng';

export type ApiErrorCode = 'OFFLINE' | 'TIMEOUT' | 'SERVER_WAKING' | 'NETWORK_ERROR' | 'HTTP_ERROR';

export class ApiError extends Error {
  status: number;
  data: any;
  code: ApiErrorCode;

  constructor(status: number, message: string, data?: any, code: ApiErrorCode = 'HTTP_ERROR') {
    super(message);
    this.status = status;
    this.data = data;
    this.code = code;
    this.name = 'ApiError';
  }
}

/**
 * Resolves relative API URLs safely.
 * If a page is running on apex bursariq.com.ng while Render redirects apex -> www,
 * routes directly to https://www.bursariq.com.ng (which allows https://bursariq.com.ng via CORS).
 */
export function resolveRequestUrl(url: string, hostnameOverride?: string): string {
  if (!url.startsWith('/')) return url;
  const currentHost =
    hostnameOverride !== undefined
      ? hostnameOverride.toLowerCase()
      : typeof window !== 'undefined' && window.location?.hostname
      ? window.location.hostname.toLowerCase()
      : '';
  if (currentHost === 'bursariq.com.ng') {
    return `${CANONICAL_PRODUCTION_ORIGIN}${url}`;
  }
  return url;
}

/**
 * Computes an alternate canonical origin URL if the current bursariq.com.ng / www.bursariq.com.ng
 * host hits a Render edge redirect during a domain switch, guaranteeing zero login failures
 * regardless of whether apex or www is set as primary on Render.
 */
export function getAlternateOriginUrl(url: string, attemptedUrl: string, hostnameOverride?: string): string | null {
  if (!url.startsWith('/')) return null;
  const currentHost =
    hostnameOverride !== undefined
      ? hostnameOverride.toLowerCase()
      : typeof window !== 'undefined' && window.location?.hostname
      ? window.location.hostname.toLowerCase()
      : '';
  if (currentHost === 'www.bursariq.com.ng' && !attemptedUrl.startsWith(APEX_PRODUCTION_ORIGIN)) {
    return `${APEX_PRODUCTION_ORIGIN}${url}`;
  }
  if (currentHost === 'bursariq.com.ng' && attemptedUrl.startsWith(CANONICAL_PRODUCTION_ORIGIN)) {
    return url; // Fall back to same-origin apex if Render primary was switched to apex
  }
  return null;
}

const RETRYABLE_GATEWAY_STATUSES = new Set([408, 502, 503, 504, 520, 522, 524]);

function isSafeRetryablePostPath(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes('/auth/login') ||
    lower.includes('/public/portal/admission-login') ||
    lower.includes('/public/portal/staff-code-login') ||
    lower.includes('/public/verify-document') ||
    lower.includes('/public/resolve-host')
  );
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = options.signal;

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (timedOut) {
      const timeoutErr = new Error('REQUEST_TIMEOUT');
      timeoutErr.name = 'TimeoutError';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export interface SafeFetchOptions extends RequestInit {
  timeoutMs?: number;
  maxRetries?: number;
}

export async function safeFetch<T = any>(url: string, options?: SafeFetchOptions): Promise<T> {
  const { timeoutMs, maxRetries, ...fetchInit } = options || {};
  const headers = new Headers(fetchInit.headers || {});
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  const mergedOptions: RequestInit = {
    ...fetchInit,
    headers,
  };

  const method = (mergedOptions.method || 'GET').toUpperCase();
  const isIdempotentRead = method === 'GET' || method === 'HEAD';
  const isSafeRetryPost = method === 'POST' && isSafeRetryablePostPath(url);
  const allowedRetries =
    typeof maxRetries === 'number'
      ? Math.max(0, maxRetries)
      : isIdempotentRead
      ? 2
      : isSafeRetryPost
      ? 1
      : 0;

  let activeUrl = resolveRequestUrl(url);

  for (let attempt = 0; attempt <= allowedRetries; attempt++) {
    // Give Render cold-start retries slightly longer window so wake-ups succeed seamlessly
    const attemptTimeoutMs = timeoutMs ?? (attempt === 0 ? 20000 : 35000);

    let res: Response;
    try {
      // NEVER short-circuit on navigator.onLine === false: many Android browsers falsely report
      // offline while 4G/Wi-Fi data is fully working. Always attempt the real network request first.
      res = await fetchWithTimeout(activeUrl, mergedOptions, attemptTimeoutMs);
    } catch (err: any) {
      // If caller explicitly cancelled the request, rethrow without retrying
      if (mergedOptions.signal?.aborted) {
        throw new ApiError(0, 'Request was cancelled.', { aborted: true }, 'NETWORK_ERROR');
      }

      const isTimeout = err?.name === 'TimeoutError' || err?.message === 'REQUEST_TIMEOUT';

      if (attempt < allowedRetries) {
        // If a non-timeout network/CORS abort occurred on bursariq.com.ng / www.bursariq.com.ng,
        // automatically fail over to the sibling host on the retry attempt.
        if (!isTimeout) {
          const altUrl = getAlternateOriginUrl(url, activeUrl);
          if (altUrl) activeUrl = altUrl;
        }
        await waitMs(attempt === 0 ? 1200 : 2500);
        continue;
      }

      if (isTimeout) {
        throw new ApiError(
          408,
          'The server took too long to respond (it may be waking up or your mobile network is slow). Please tap Try Again.',
          { originalError: err?.message, timeout: true },
          'TIMEOUT'
        );
      }

      const browserReportsOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (browserReportsOffline) {
        throw new ApiError(
          0,
          'Could not reach the BursarIQ server and your browser reports no internet connection. Please check mobile data/Wi-Fi and try again.',
          { originalError: err?.message, offline: true },
          'OFFLINE'
        );
      }

      throw new ApiError(
        0,
        'Could not reach the BursarIQ server right now. Your network may have briefly dropped or the server is finishing an update — please try again in a few seconds.',
        { originalError: err?.message },
        'NETWORK_ERROR'
      );
    }

    // Retry transient gateway / Render cold-start statuses automatically before surfacing an error
    if (RETRYABLE_GATEWAY_STATUSES.has(res.status) && attempt < allowedRetries) {
      await waitMs(attempt === 0 ? 1500 : 3000);
      continue;
    }

    const contentType = res.headers.get('content-type') || '';
    let data: any = null;

    if (contentType.includes('application/json')) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    } else {
      // Non-JSON response (e.g. HTML from 502/503/504 Render gateway, cold start, or proxy page)
      const text = await res.text().catch(() => '');
      if (RETRYABLE_GATEWAY_STATUSES.has(res.status)) {
        throw new ApiError(
          res.status,
          'BursarIQ server is finishing a quick restart or waking up. Please wait a few seconds and try again.',
          { raw: text },
          'SERVER_WAKING'
        );
      }
      if (res.status === 404) {
        throw new ApiError(
          res.status,
          'The requested API endpoint was not found on this server.',
          { raw: text },
          'HTTP_ERROR'
        );
      }
      if (!res.ok) {
        throw new ApiError(
          res.status,
          `Server responded with HTTP ${res.status}. Please try again shortly.`,
          { raw: text },
          'HTTP_ERROR'
        );
      }
      throw new ApiError(
        res.status,
        'Received an unexpected response from the server. Please reload and try again.',
        { raw: text },
        'HTTP_ERROR'
      );
    }

    if (!res.ok) {
      const errorMsg = data?.message || data?.error || `Request failed with status ${res.status}`;
      const code: ApiErrorCode = RETRYABLE_GATEWAY_STATUSES.has(res.status) ? 'SERVER_WAKING' : 'HTTP_ERROR';
      throw new ApiError(res.status, errorMsg, data, code);
    }

    return data as T;
  }

  throw new ApiError(
    0,
    'Unable to connect to the server after multiple attempts. Please check your connection and try again.',
    {},
    'NETWORK_ERROR'
  );
}

const memoryStorageFallback = new Map<string, string>();

export function safeStorageGet(key: string): string | null {
  try {
    const val = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (val !== null) return val;
  } catch {
    // Fallback for restricted WebViews / Private mode
  }
  return memoryStorageFallback.get(key) ?? null;
}

export function safeStorageSet(key: string, value: string): void {
  memoryStorageFallback.set(key, value);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
  } catch {
    // Keep in-memory fallback active even if storage quota/privacy blocks localStorage
  }
}

export function safeStorageRemove(key: string): void {
  memoryStorageFallback.delete(key);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore restricted storage errors
  }
}

function getAuthHeaders(schoolId?: string | null): Record<string, string> {
  const token = safeStorageGet('bursariq_session_token') || safeStorageGet('schoolpay_session_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const effectiveSchoolId =
    schoolId || safeStorageGet('bursariq_active_school') || safeStorageGet('schoolpay_active_school');
  if (effectiveSchoolId) {
    headers['X-School-Id'] = effectiveSchoolId;
  }

  return headers;
}

export const api = {
  // Public Auth
  async registerSchool(data: {
    schoolName: string;
    schoolType: string;
    state: string;
    lga: string;
    address: string;
    phone: string;
    email: string;
    ownerName: string;
    ownerEmail: string;
    password: string;
    website?: string;
  }) {
    return safeFetch(`${API_BASE}/auth/register-school`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  async login(credentials: { email?: string; identifier?: string; password: string; schoolId?: string; schoolSlug?: string }) {
    return safeFetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
  },

  async admissionLogin(credentials: {
    admission_number: string;
    portal_type: 'STUDENT' | 'PARENT';
    school_id?: string;
    school_slug?: string;
  }) {
    return safeFetch(`${API_BASE}/public/portal/admission-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
  },

  async staffCodeLogin(credentials: {
    staff_code: string;
    school_id?: string;
    school_slug?: string;
  }) {
    return safeFetch(`${API_BASE}/public/portal/staff-code-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
  },

  // Unauthenticated Public School Portal Directory, Verification & Self-Activation
  async searchPublicSchools(query = ''): Promise<{ success: boolean; schools: PublicSchoolSummary[] }> {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    return safeFetch(`${API_BASE}/public/schools?${params.toString()}`);
  },

  async getPublicSchoolBySlug(slug: string): Promise<{ success: boolean; school: PublicSchoolSummary }> {
    return safeFetch(`${API_BASE}/public/schools/${encodeURIComponent(slug.trim())}`);
  },

  async verifyPublicDocument(data: {
    document_type: 'RECEIPT' | 'REPORT_CARD';
    code: string;
    school_slug?: string;
  }): Promise<PublicDocumentVerificationResult> {
    return safeFetch(`${API_BASE}/public/verify-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  async activatePublicPortal(data: {
    school_slug?: string;
    school_id?: string;
    portal_type: 'STUDENT' | 'PARENT';
    admission_number?: string;
    last_name: string;
    verification_value?: string;
    contact?: string;
    child_identifier?: string;
    login_email?: string;
    password: string;
  }) {
    return safeFetch(`${API_BASE}/public/portal/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  async logout() {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
    } catch {
      // ignore network errors on logout
    }
    localStorage.removeItem('bursariq_session_token');
    localStorage.removeItem('bursariq_active_school');
    localStorage.removeItem('schoolpay_session_token');
    localStorage.removeItem('schoolpay_active_school');
  },

  async getMe() {
    return safeFetch(`${API_BASE}/auth/me`, {
      headers: getAuthHeaders(),
    });
  },

  // Legacy Password Reset (retained for backward compatibility)
  async requestPasswordReset(email: string) {
    return safeFetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  },

  async completePasswordReset(token: string, newPassword: string) {
    return safeFetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword }),
    });
  },

  // Enhanced Multi-Method Account Recovery
  async identifyRecoveryAccount(identifier: string) {
    return safeFetch(`${API_BASE}/auth/recovery/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier }),
    });
  },

  async verifySecurityQuestions(challengeId: string, answer1: string, answer2: string) {
    return safeFetch(`${API_BASE}/auth/recovery/verify-questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, answer1, answer2 }),
    });
  },

  async verifyBackupRecoveryCode(challengeId: string, code: string) {
    return safeFetch(`${API_BASE}/auth/recovery/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, code }),
    });
  },

  async requestVerifiedRecoveryLink(challengeId: string) {
    return safeFetch(`${API_BASE}/auth/recovery/request-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId }),
    });
  },

  async completeAccountRecovery(data: {
    recoveryTicket: string;
    newPassword: string;
    confirmPassword?: string;
  }) {
    return safeFetch(`${API_BASE}/auth/recovery/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  async lookupForgottenIdentifier(params: {
    phone?: string;
    fullName?: string;
    schoolName?: string;
  }) {
    return safeFetch(`${API_BASE}/auth/recovery/lookup-identifier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  },

  // Authenticated User Security Management
  async getSecurityStatus() {
    return safeFetch(`${API_BASE}/auth/security/status`, {
      headers: getAuthHeaders(),
    });
  },

  async configureSecurityQuestions(data: {
    currentPassword: string;
    question1: string;
    answer1: string;
    question2: string;
    answer2: string;
    recoveryEmail?: string;
    recoveryPhone?: string;
  }) {
    return safeFetch(`${API_BASE}/auth/security/configure-questions`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async generateBackupCodes(currentPassword: string) {
    return safeFetch(`${API_BASE}/auth/security/generate-backup-codes`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ currentPassword }),
    });
  },

  async generateStaffRecoveryTicket(schoolId: string, targetUserId: string) {
    return safeFetch(`${API_BASE}/auth/school/users/${targetUserId}/recovery-ticket`, {
      method: 'POST',
      headers: getAuthHeaders(schoolId),
    });
  },

  // Tenant School Management
  async getSchoolProfile(schoolId: string): Promise<{ school: School; settings: SchoolSettings }> {
    return safeFetch(`${API_BASE}/school/profile`, {
      headers: getAuthHeaders(schoolId),
    });
  },

  async updateSchoolProfile(schoolId: string, data: Partial<School>): Promise<{ school: School; message: string }> {
    return safeFetch(`${API_BASE}/school/profile`, {
      method: 'PUT',
      headers: getAuthHeaders(schoolId),
      body: JSON.stringify(data),
    });
  },

  async getSchoolSettings(schoolId: string): Promise<{ settings: SchoolSettings }> {
    return safeFetch(`${API_BASE}/school/settings`, {
      headers: getAuthHeaders(schoolId),
    });
  },

  async updateSchoolSettings(schoolId: string, data: Partial<SchoolSettings>): Promise<{ settings: SchoolSettings; message: string }> {
    return safeFetch(`${API_BASE}/school/settings`, {
      method: 'PUT',
      headers: getAuthHeaders(schoolId),
      body: JSON.stringify(data),
    });
  },

  async getSchoolUsers(schoolId: string): Promise<{ users: any[] }> {
    return safeFetch(`${API_BASE}/school/users`, {
      headers: getAuthHeaders(schoolId),
    });
  },

  async getSchoolAuditLogs(schoolId: string): Promise<{ logs: AuditLog[] }> {
    return safeFetch(`${API_BASE}/school/audit-logs`, {
      headers: getAuthHeaders(schoolId),
    });
  },

  // School Management & Operational Stats (Step 2)
  async getSchoolStats(): Promise<{ stats: SchoolDashboardStats }> {
    return safeFetch(`${API_BASE}/school/stats`, {
      headers: getAuthHeaders(),
    });
  },

  // Students API
  async getSchoolStudents(params?: {
    search?: string;
    class_id?: string;
    class_arm_id?: string;
    gender?: string;
    status?: string;
    academic_session_id?: string;
    page?: number;
    limit?: number;
    sort?: string;
  }): Promise<{ students: Student[]; count: number; page: number; totalPages: number }> {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') query.append(k, String(v));
      });
    }
    return safeFetch(`${API_BASE}/school/students?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async getSchoolStudentById(studentId: string): Promise<{ student: Student }> {
    return safeFetch(`${API_BASE}/school/students/${studentId}`, {
      headers: getAuthHeaders(),
    });
  },

  async createStudent(
    data: Partial<Student>
  ): Promise<{ student: Student; message: string; autoGeneratedAdmissionNumber?: boolean }> {
    return safeFetch(`${API_BASE}/school/students`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async updateStudent(studentId: string, data: Partial<Student>): Promise<{ student: Student; message: string }> {
    return safeFetch(`${API_BASE}/school/students/${studentId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteStudent(studentId: string): Promise<{ message: string }> {
    return safeFetch(`${API_BASE}/school/students/${studentId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  async importStudents(
    students: any[],
    options?: { auto_create_classes?: boolean }
  ): Promise<{
    importedCount: number;
    failedCount: number;
    skippedCount?: number;
    generatedAdmissionCount?: number;
    createdClassesCount?: number;
    createdArmsCount?: number;
    importedStudentsPreview?: Array<{
      id: string;
      full_name: string;
      admission_number: string;
      class_id?: string | null;
      class_name: string | null;
      class_arm_name?: string | null;
      gender?: string | null;
    }>;
    errors: any[];
    warnings?: any[];
    message: string;
  }> {
    return safeFetch(`${API_BASE}/school/students/import`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        students,
        auto_create_classes: options?.auto_create_classes ?? true,
      }),
    });
  },

  async bulkAssignStudents(data: {
    student_ids: string[];
    class_id?: string | null;
    class_name?: string;
    class_arm_id?: string | null;
    class_arm_name?: string;
    gender?: string;
    student_status?: string;
    create_missing_class?: boolean;
  }): Promise<{
    success: boolean;
    updatedCount: number;
    message: string;
  }> {
    return safeFetch(`${API_BASE}/school/students/bulk-assign`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async assignMissingAdmissionNumbers(): Promise<{
    success: boolean;
    assignedCount: number;
    prefix: string;
    students: Array<{ id: string; full_name: string; admission_number: string; class_name: string | null }>;
    message: string;
  }> {
    return safeFetch(`${API_BASE}/school/students/assign-missing-admission-numbers`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  },

  async exportStudentsCsv(): Promise<Blob> {
    const res = await fetch(`${API_BASE}/school/students/export`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new ApiError(res.status, 'Failed to export students CSV');
    return await res.blob();
  },
  async exportStaffCsv(): Promise<Blob> {
    const res = await fetch(`${API_BASE}/school/staff/export`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new ApiError(res.status, 'Failed to export staff directory CSV');
    return await res.blob();
  },
  async exportParentsCsv(): Promise<Blob> {
    const res = await fetch(`${API_BASE}/school/parents/export`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new ApiError(res.status, 'Failed to export parents directory CSV');
    return await res.blob();
  },

  // Parents API
  async getSchoolParents(): Promise<{ parents: ParentItem[]; count: number }> {
    return safeFetch(`${API_BASE}/school/parents`, {
      headers: getAuthHeaders(),
    });
  },

  async createParent(data: Partial<ParentItem> & { student_ids?: string[] }): Promise<{ parent: ParentItem; message: string }> {
    return safeFetch(`${API_BASE}/school/parents`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async updateParent(parentId: string, data: Partial<ParentItem>): Promise<{ parent: ParentItem; message: string }> {
    return safeFetch(`${API_BASE}/school/parents/${parentId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteParent(parentId: string): Promise<{ message: string }> {
    return safeFetch(`${API_BASE}/school/parents/${parentId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  // Classes & Arms API
  async getSchoolClasses(): Promise<{ classes: ClassItem[]; count: number }> {
    return safeFetch(`${API_BASE}/school/classes`, {
      headers: getAuthHeaders(),
    });
  },

  async bulkSetupClasses(mode: 'SECONDARY' | 'PRIMARY' | 'K12'): Promise<{
    success: boolean;
    createdClassesCount: number;
    createdArmsCount: number;
    message: string;
  }> {
    return safeFetch(`${API_BASE}/school/classes/bulk-setup`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ mode }),
    });
  },

  async createClass(data: {
    name: string;
    level: string;
    description?: string;
    academic_session_id?: string;
    arms?: string | string[];
    arm_capacity?: number;
  }): Promise<{ class: ClassItem; message: string }> {
    return safeFetch(`${API_BASE}/school/classes`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteClass(classId: string): Promise<{ message: string }> {
    return safeFetch(`${API_BASE}/school/classes/${classId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  async createClassArm(
    classId: string,
    data: { name: string; arms?: string[]; capacity?: number; class_teacher_id?: string }
  ): Promise<{ arm: ClassArmItem; arms?: ClassArmItem[]; createdCount?: number; message: string }> {
    return safeFetch(`${API_BASE}/school/classes/${classId}/arms`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async updateClassArm(
    classId: string,
    armId: string,
    data: { name?: string; capacity?: number; class_teacher_id?: string | null }
  ): Promise<{ arm: ClassArmItem; message: string }> {
    return safeFetch(`${API_BASE}/school/classes/${classId}/arms/${armId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteClassArm(classId: string, armId: string, force = false): Promise<{ message: string }> {
    return safeFetch(`${API_BASE}/school/classes/${classId}/arms/${armId}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  // Staff API
  async getSchoolStaff(): Promise<{ staff: StaffItem[]; count: number }> {
    return safeFetch(`${API_BASE}/school/staff`, {
      headers: getAuthHeaders(),
    });
  },

  async createStaff(data: Partial<StaffItem>): Promise<{ staff: StaffItem; message: string }> {
    return safeFetch(`${API_BASE}/school/staff`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async updateStaff(staffId: string, data: Partial<StaffItem>): Promise<{ staff: StaffItem; message: string }> {
    return safeFetch(`${API_BASE}/school/staff/${staffId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteStaff(staffId: string): Promise<{ message: string }> {
    return safeFetch(`${API_BASE}/school/staff/${staffId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  async assignMissingStaffCodes(): Promise<{
    success: boolean;
    assignedCount: number;
    prefix: string;
    linkedUsersCount?: number;
    staff: Array<{ id: string; first_name: string; last_name: string; staff_number: string }>;
    message: string;
  }> {
    return safeFetch(`${API_BASE}/school/staff/assign-missing-codes`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  },

  // Academic Sessions & Terms API
  async getSchoolAcademicSessions(): Promise<{ sessions: AcademicSessionItem[] }> {
    return safeFetch(`${API_BASE}/school/academic-sessions`, {
      headers: getAuthHeaders(),
    });
  },

  async createAcademicSession(data: { name: string; start_date?: string; end_date?: string; status?: string }): Promise<{ session: AcademicSessionItem; message: string }> {
    return safeFetch(`${API_BASE}/school/academic-sessions`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async createTerm(sessionId: string, data: { name: string; start_date?: string; end_date?: string; status?: string }): Promise<{ term: TermItem; message: string }> {
    return safeFetch(`${API_BASE}/school/academic-sessions/${sessionId}/terms`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async getSchoolFees(): Promise<{ fees: FeeItem[]; count: number }> {
    return safeFetch(`${API_BASE}/school/fees`, {
      headers: getAuthHeaders(),
    });
  },

  // --- Step 3: Fee Categories ---
  async getFeeCategories(): Promise<{ categories: FeeCategoryItem[]; count: number }> {
    return safeFetch(`${API_BASE}/school/fee-categories`, {
      headers: getAuthHeaders(),
    });
  },

  async createFeeCategory(data: { name: string; description?: string; status?: string }): Promise<{ category: FeeCategoryItem }> {
    return safeFetch(`${API_BASE}/school/fee-categories`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async updateFeeCategory(id: string, data: { name?: string; description?: string; status?: string }): Promise<{ category: FeeCategoryItem }> {
    return safeFetch(`${API_BASE}/school/fee-categories/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteFeeCategory(id: string): Promise<{ success: boolean; message: string }> {
    return safeFetch(`${API_BASE}/school/fee-categories/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  // --- Step 3: Fee Structures ---
  async getFeeStructures(params?: { class_id?: string; session_id?: string; term_id?: string }): Promise<{ feeStructures: FeeStructureDef[]; count: number }> {
    const query = new URLSearchParams();
    if (params?.class_id) query.set('class_id', params.class_id);
    if (params?.session_id) query.set('session_id', params.session_id);
    if (params?.term_id) query.set('term_id', params.term_id);

    return safeFetch(`${API_BASE}/school/fee-structures?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async createFeeStructure(data: {
    name: string;
    description?: string;
    class_id?: string;
    academic_session_id?: string;
    term_id?: string;
    items: Array<{
      fee_category_id: string;
      amount?: number;
      amount_kobo?: number;
      compulsory?: boolean;
      due_date?: string;
      description?: string;
    }>;
  }): Promise<{ feeStructure: FeeStructureDef }> {
    return safeFetch(`${API_BASE}/school/fee-structures`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteFeeStructure(id: string): Promise<{ success: boolean; message: string }> {
    return safeFetch(`${API_BASE}/school/fee-structures/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  async cloneFeeStructure(
    id: string,
    data?: { name?: string; target_academic_session_id?: string; target_term_id?: string; target_class_id?: string }
  ): Promise<{ success: boolean; feeStructure: FeeStructureDef; message: string }> {
    return safeFetch(`${API_BASE}/school/fee-structures/${id}/clone`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data || {}),
    });
  },

  // --- Step 3: Invoices ---
  async getInvoices(params?: {
    student_id?: string;
    class_id?: string;
    academic_session_id?: string;
    term_id?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ invoices: InvoiceDef[]; total: number; count: number }> {
    const query = new URLSearchParams();
    if (params?.student_id) query.set('student_id', params.student_id);
    if (params?.class_id) query.set('class_id', params.class_id);
    if (params?.academic_session_id) query.set('academic_session_id', params.academic_session_id);
    if (params?.term_id) query.set('term_id', params.term_id);
    if (params?.status) query.set('status', params.status);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));

    return safeFetch(`${API_BASE}/school/invoices?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async getInvoice(id: string): Promise<{ invoice: InvoiceDef }> {
    return safeFetch(`${API_BASE}/school/invoices/${id}`, {
      headers: getAuthHeaders(),
    });
  },

  async createInvoice(data: {
    student_id: string;
    academic_session_id?: string;
    term_id?: string;
    class_id?: string;
    issue_date?: string;
    due_date: string;
    notes?: string;
    items: Array<{
      fee_category_id?: string;
      description: string;
      quantity?: number;
      unit_amount?: number;
      unit_amount_kobo?: number;
    }>;
    discounts?: Array<{
      type: string;
      amount?: number;
      amount_kobo?: number;
      percentage?: number;
      reason: string;
    }>;
  }): Promise<{ invoice: InvoiceDef }> {
    return safeFetch(`${API_BASE}/school/invoices`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async bulkGenerateInvoices(data: {
    fee_structure_id: string;
    class_id: string;
    academic_session_id?: string;
    term_id?: string;
    due_date: string;
    issue_date?: string;
    notes?: string;
  }): Promise<{ count: number; message: string; invoices: any[] }> {
    return safeFetch(`${API_BASE}/school/invoices/generate-bulk`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async cancelInvoice(id: string, reason?: string): Promise<{ success: boolean; message: string }> {
    return safeFetch(`${API_BASE}/school/invoices/${id}/cancel`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason }),
    });
  },

  async applyInvoiceDiscount(
    invoiceId: string,
    data: { type: string; amount?: number; amount_kobo?: number; percentage?: number; reason: string }
  ): Promise<{ success: boolean; invoice: any; discount: any }> {
    return safeFetch(`${API_BASE}/school/invoices/${invoiceId}/discounts`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async recordInvoicePayment(
    invoiceId: string,
    data: { amount?: number; amount_kobo?: number; payment_method: string; payment_date?: string; notes?: string }
  ): Promise<{ success: boolean; invoice: any; payment: any }> {
    return safeFetch(`${API_BASE}/school/invoices/${invoiceId}/payments`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  // --- Step 4: Payments, Receipts, Gateways & Notifications ---
  async getPayments(params?: {
    student_id?: string;
    class_id?: string;
    payment_method?: string;
    status?: string;
    invoice_id?: string;
    start_date?: string;
    end_date?: string;
    min_amount?: number;
    max_amount?: number;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ payments: PaymentItem[]; count: number }> {
    const query = new URLSearchParams();
    if (params?.student_id) query.set('student_id', params.student_id);
    if (params?.class_id) query.set('class_id', params.class_id);
    if (params?.payment_method) query.set('payment_method', params.payment_method);
    if (params?.status) query.set('status', params.status);
    if (params?.invoice_id) query.set('invoice_id', params.invoice_id);
    if (params?.start_date) query.set('start_date', params.start_date);
    if (params?.end_date) query.set('end_date', params.end_date);
    if (params?.min_amount !== undefined) query.set('min_amount', String(params.min_amount));
    if (params?.max_amount !== undefined) query.set('max_amount', String(params.max_amount));
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));

    return safeFetch(`${API_BASE}/school/payments?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async getPaymentDetails(id: string): Promise<{ payment: PaymentItem }> {
    return safeFetch(`${API_BASE}/school/payments/${id}`, {
      headers: getAuthHeaders(),
    });
  },

  async recordPayment(
    invoiceId: string,
    data: {
      amount?: number;
      amount_kobo?: number;
      payment_method: string;
      provider?: string;
      provider_reference?: string;
      payment_date?: string;
      notes?: string;
      is_pending?: boolean;
    }
  ) {
    return safeFetch(`${API_BASE}/school/invoices/${invoiceId}/payments`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async verifyPayment(paymentId: string) {
    return safeFetch(`${API_BASE}/school/payments/${paymentId}/verify`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  },

  async cancelPayment(paymentId: string, reason?: string) {
    return safeFetch(`${API_BASE}/school/payments/${paymentId}/cancel`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason }),
    });
  },

  // Receipts
  async getReceipts(params?: { student_id?: string; search?: string; limit?: number; offset?: number }): Promise<{ receipts: ReceiptItem[]; count: number }> {
    const query = new URLSearchParams();
    if (params?.student_id) query.set('student_id', params.student_id);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));

    return safeFetch(`${API_BASE}/school/receipts?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async getReceiptDetails(id: string): Promise<{ receipt: ReceiptItem }> {
    return safeFetch(`${API_BASE}/school/receipts/${id}`, {
      headers: getAuthHeaders(),
    });
  },

  // Online Payment Gateways
  async getGatewayStatus(): Promise<{ providers: GatewayStatus[] }> {
    return safeFetch(`${API_BASE}/school/gateways/status`, {
      headers: getAuthHeaders(),
    });
  },

  async configureGateways(data: {
    paystack_public_key?: string;
    paystack_secret_key?: string;
    paystack_enabled?: boolean;
    flutterwave_public_key?: string;
    flutterwave_secret_key?: string;
    flutterwave_enabled?: boolean;
  }) {
    return safeFetch(`${API_BASE}/school/gateways/configure`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async testWebhookSimulation(data: {
    provider: string;
    event_type: string;
    reference: string;
    amount_kobo: number;
    invoice_id: string;
  }) {
    return safeFetch(`${API_BASE}/school/gateways/test-webhook`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async initializeOnlineCheckout(
    invoiceId: string,
    data: { provider: string; amount_kobo?: number; email?: string; callback_url?: string }
  ) {
    return safeFetch(`${API_BASE}/school/invoices/${invoiceId}/checkout`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async verifyOnlinePayment(data: { provider: string; reference: string; invoice_id: string; amount_kobo?: number }) {
    return safeFetch(`${API_BASE}/school/payments/verify-online`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  // Notifications
  async getNotifications(): Promise<{ notifications: NotificationItem[]; unreadCount: number }> {
    return safeFetch(`${API_BASE}/school/notifications`, {
      headers: getAuthHeaders(),
    });
  },

  async markNotificationAsRead(id: string) {
    return safeFetch(`${API_BASE}/school/notifications/${id}/read`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    });
  },

  async markAllNotificationsAsRead() {
    return safeFetch(`${API_BASE}/school/notifications/mark-all-read`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  },

  async broadcastNotification(data: {
    type: string;
    title: string;
    message: string;
    data?: any;
  }) {
    return safeFetch(`${API_BASE}/school/notifications/broadcast`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  // Export URLs
  getPaymentsCsvUrl(): string {
    return `${API_BASE}/school/finance/reports/export/payments-csv`;
  },
  getInvoicesCsvUrl(): string {
    return `${API_BASE}/school/finance/reports/export/invoices-csv`;
  },
  getDefaultersCsvUrl(): string {
    return `${API_BASE}/school/finance/reports/export/defaulters-csv`;
  },

  // Detailed Reports
  async getDailyCollectionsReport(days = 14): Promise<{ daily: Array<{ date: string; count: number; total_kobo: number; total_naira: number }> }> {
    return safeFetch(`${API_BASE}/school/finance/reports/daily?days=${days}`, {
      headers: getAuthHeaders(),
    });
  },

  async getMonthlyCollectionsReport(): Promise<{ monthly: Array<{ month: string; count: number; total_kobo: number; total_naira: number }> }> {
    return safeFetch(`${API_BASE}/school/finance/reports/monthly`, {
      headers: getAuthHeaders(),
    });
  },

  async sendDefaulterReminder(studentId: string, channel = 'ALL', customNote?: string) {
    return safeFetch(`${API_BASE}/school/finance/defaulters/send-reminder`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ studentId, channel, customNote }),
    });
  },

  async getDefaultersReport(params?: { class_id?: string; min_balance?: number }): Promise<{
    count: number;
    defaulters: Array<{
      student_id: string;
      admission_number: string;
      student_name: string;
      class_name: string;
      total_billed_naira: number;
      total_paid_naira: number;
      outstanding_balance_naira: number;
      unpaid_invoices_count: number;
    }>;
  }> {
    const query = new URLSearchParams();
    if (params?.class_id) query.set('class_id', params.class_id);
    if (params?.min_balance !== undefined) query.set('min_balance', String(params.min_balance));

    return safeFetch(`${API_BASE}/school/finance/reports/defaulters?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  // --- Step 3: Financial Dashboard & Reports ---
  async getFinancialDashboardStats(): Promise<{ stats: FinancialStatsDef }> {
    return safeFetch(`${API_BASE}/school/finance/dashboard`, {
      headers: getAuthHeaders(),
    });
  },

  async getFinancialReportsSummary(params?: { academic_session_id?: string; term_id?: string }): Promise<{
    classRevenue: Array<{ class_name: string; invoice_count: number; total_billed: number; total_billed_naira: number; total_paid_naira: number; total_balance_naira: number }>;
    categoryRevenue: Array<{ category_name: string; item_count: number; total_billed: number; total_billed_naira: number }>;
    paymentMethods: Array<{ payment_method: string; payment_count: number; total_amount: number; total_amount_naira: number }>;
  }> {
    const query = new URLSearchParams();
    if (params?.academic_session_id) query.set('academic_session_id', params.academic_session_id);
    if (params?.term_id) query.set('term_id', params.term_id);

    return safeFetch(`${API_BASE}/school/finance/reports/summary?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async getStudentFinanceProfile(studentId: string): Promise<StudentFinancialProfile> {
    return safeFetch(`${API_BASE}/school/students/${studentId}/finance`, {
      headers: getAuthHeaders(),
    });
  },

  // Platform Super Admin
  async getAdminStats(): Promise<{ stats: PlatformStats }> {
    return safeFetch(`${API_BASE}/admin/stats`, {
      headers: getAuthHeaders(),
    });
  },

  async getAdminSchools(params?: { search?: string; status?: string; plan_id?: string; state?: string }): Promise<{
    schools: (School & {
      total_students: number;
      total_staff: number;
      total_users: number;
      owner_name: string;
      owner_email: string;
      plan_display_name: string;
      plan_name: string;
      subscription_status: string;
      subscription_end_date: string;
      total_invoiced_naira: number;
      total_collected_naira: number;
      outstanding_naira: number;
    })[];
  }> {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.status) query.set('status', params.status);
    if (params?.plan_id) query.set('plan_id', params.plan_id);
    if (params?.state) query.set('state', params.state);

    return safeFetch(`${API_BASE}/admin/schools?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async createAdminSchool(data: {
    name: string;
    slug?: string;
    type?: string;
    state: string;
    lga: string;
    phone: string;
    email: string;
    address?: string;
    status?: string;
    plan_id?: string;
    owner_name?: string;
    owner_email?: string;
    owner_phone?: string;
    owner_password?: string;
  }) {
    return safeFetch(`${API_BASE}/admin/schools`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async getAdminSchoolDetails(schoolId: string): Promise<{
    school: School & { plan_display_name?: string; plan_name?: string; plan_feature_flags?: string };
    settings: SchoolSettings;
    users: any[];
    usage: {
      students: number;
      staff: number;
      classes: number;
      invoices: number;
      totalInvoicedNaira: number;
      totalCollectedNaira: number;
      outstandingNaira: number;
    };
    subscriptions: SchoolSubscription[];
    recentLogs: AuditLog[];
  }> {
    return safeFetch(`${API_BASE}/admin/schools/${schoolId}`, {
      headers: getAuthHeaders(),
    });
  },

  async updateAdminSchool(schoolId: string, data: Partial<School>) {
    return safeFetch(`${API_BASE}/admin/schools/${schoolId}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteSchool(schoolId: string, confirmationName?: string, mode: 'ARCHIVE' | 'PURGE' = 'PURGE') {
    return safeFetch(`${API_BASE}/admin/schools/${schoolId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      body: JSON.stringify({ confirmationName, mode }),
    });
  },

  async deleteUser(userId: string) {
    return safeFetch(`${API_BASE}/admin/users/${userId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  async updateSchoolStatus(schoolId: string, status: string, reason?: string) {
    return safeFetch(`${API_BASE}/admin/schools/${schoolId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status, reason }),
    });
  },

  async assignSchoolSubscription(
    schoolId: string,
    data: { plan_id: string; duration_months?: number; amount_paid_naira?: number; notes?: string }
  ) {
    return safeFetch(`${API_BASE}/admin/schools/${schoolId}/subscription`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  // Subscription Plans
  async getAdminPlans(): Promise<{ plans: SubscriptionPlan[] }> {
    return safeFetch(`${API_BASE}/admin/plans`, {
      headers: getAuthHeaders(),
    });
  },

  async createAdminPlan(data: Partial<SubscriptionPlan> & { price_naira?: number }) {
    return safeFetch(`${API_BASE}/admin/plans`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async updateAdminPlan(planId: string, data: Partial<SubscriptionPlan> & { price_naira?: number }) {
    return safeFetch(`${API_BASE}/admin/plans/${planId}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  // Subscriptions
  async getAdminSubscriptions(params?: { status?: string; plan_id?: string; expiring_soon?: boolean }): Promise<{
    subscriptions: SchoolSubscription[];
  }> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.plan_id) query.set('plan_id', params.plan_id);
    if (params?.expiring_soon) query.set('expiring_soon', 'true');

    return safeFetch(`${API_BASE}/admin/subscriptions?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  // Revenue
  async getAdminRevenue(): Promise<{
    revenue: {
      platformRevenueKobo: number;
      platformRevenueNaira: number;
      schoolCollectedRevenueKobo: number;
      schoolCollectedRevenueNaira: number;
      successfulCount: number;
      failedCount: number;
      refundedCount: number;
      revenueByPlan: Array<{ plan_id: string; display_name: string; total_kobo: number; total_naira: number; payment_count: number }>;
      transactions: PlatformPayment[];
    };
  }> {
    return safeFetch(`${API_BASE}/admin/revenue`, {
      headers: getAuthHeaders(),
    });
  },

  // Partners & Commissions
  async getAdminPartners(): Promise<{ partners: Partner[] }> {
    return safeFetch(`${API_BASE}/admin/partners`, {
      headers: getAuthHeaders(),
    });
  },

  async createAdminPartner(data: Partial<Partner>) {
    return safeFetch(`${API_BASE}/admin/partners`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async getAdminCommissions(params?: { status?: string; partner_id?: string }): Promise<{ commissions: Commission[] }> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.partner_id) query.set('partner_id', params.partner_id);

    return safeFetch(`${API_BASE}/admin/commissions?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async updateCommissionStatus(commissionId: string, status: string, notes?: string) {
    return safeFetch(`${API_BASE}/admin/commissions/${commissionId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status, notes }),
    });
  },

  // Platform Users & Global Audit Logs
  async getAdminUsers(): Promise<{ users: User[] }> {
    return safeFetch(`${API_BASE}/admin/users`, {
      headers: getAuthHeaders(),
    });
  },

  async getAdminAuditLogs(params?: { action?: string; school_id?: string; limit?: number }): Promise<{ logs: AuditLog[] }> {
    const query = new URLSearchParams();
    if (params?.action) query.set('action', params.action);
    if (params?.school_id) query.set('school_id', params.school_id);
    if (params?.limit) query.set('limit', String(params.limit));

    return safeFetch(`${API_BASE}/admin/audit-logs?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  // Support Impersonation
  async impersonateSchool(schoolId: string, userId?: string, reason?: string): Promise<{
    impersonationToken: string;
    targetUser: { id: string; email: string; full_name: string };
    targetSchool: School;
  }> {
    return safeFetch(`${API_BASE}/admin/impersonate`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ schoolId, userId, reason }),
    });
  },

  async exitImpersonation() {
    return safeFetch(`${API_BASE}/auth/exit-impersonation`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  },

  // Interactive IDOR Attack Simulator (proves tenant isolation)
  async simulateIdor(foreignSchoolId: string) {
    const res = await fetch(`${API_BASE}/test/simulate-idor`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ foreignSchoolId }),
    });
    const json = await res.json();
    return { status: res.status, ok: res.ok, data: json };
  },

  // --- SCHOOL SAAS SUBSCRIPTION & BILLING (Section 6, 7, 8) ---
  async getSchoolSubscription(schoolId?: string): Promise<{
    subscription: SchoolSubscription | null;
    usage: { students: number; staff: number };
    platformSettings: any;
    availablePlans: SubscriptionPlan[];
  }> {
    return safeFetch(`${API_BASE}/school/billing/subscription`, {
      headers: getAuthHeaders(schoolId),
    });
  },

  async getSchoolBillingHistory(schoolId?: string): Promise<{
    payments: PlatformPayment[];
    invoices: PlatformInvoice[];
  }> {
    return safeFetch(`${API_BASE}/school/billing/history`, {
      headers: getAuthHeaders(schoolId),
    });
  },

  async initiateSaaSCheckout(schoolId: string, params: { plan_id?: string; callback_url?: string }): Promise<{
    checkoutUrl?: string;
    providerReference: string;
    internalReference: string;
    finalAmountNaira: number;
    finalAmountKobo: number;
  }> {
    return safeFetch(`${API_BASE}/school/billing/checkout`, {
      method: 'POST',
      headers: getAuthHeaders(schoolId),
      body: JSON.stringify(params),
    });
  },

  async submitSaaSTransferProof(schoolId: string, params: {
    plan_id?: string;
    bank_name?: string;
    transaction_reference: string;
    depositor_name: string;
    amount_naira?: number;
    notes?: string;
    receipt_file?: string;
    receipt_filename?: string;
  }): Promise<{ message: string; internalReference: string; paymentId: string }> {
    return safeFetch(`${API_BASE}/school/billing/bank-transfer/submit`, {
      method: 'POST',
      headers: getAuthHeaders(schoolId),
      body: JSON.stringify(params),
    });
  },

  async getPlatformInvoice(schoolId: string, invoiceId: string): Promise<{
    invoice: PlatformInvoice;
    platformSettings: any;
  }> {
    return safeFetch(`${API_BASE}/school/billing/invoices/${invoiceId}`, {
      headers: getAuthHeaders(schoolId),
    });
  },

  // --- SUPER ADMIN SAAS PRICING & SUBSCRIPTION CONTROLS ---
  async createCustomSchoolSubscription(schoolId: string, data: {
    plan_id: string;
    negotiated_price_naira?: number;
    discount_amount_naira?: number;
    discount_reason?: string;
    final_amount_naira?: number;
    billing_interval?: string;
    duration_months?: number;
    status?: string;
    notes?: string;
  }) {
    return safeFetch(`${API_BASE}/admin/schools/${schoolId}/custom-subscription`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async duplicateAdminPlan(planId: string) {
    return safeFetch(`${API_BASE}/admin/plans/${planId}/duplicate`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  },

  async archiveAdminPlan(planId: string) {
    return safeFetch(`${API_BASE}/admin/plans/${planId}/archive`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  },

  async getAdminDiscounts(): Promise<{ discounts: SubscriptionDiscount[] }> {
    return safeFetch(`${API_BASE}/admin/discounts`, {
      headers: getAuthHeaders(),
    });
  },

  async createAdminDiscount(data: any) {
    return safeFetch(`${API_BASE}/admin/discounts`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteAdminDiscount(id: string) {
    return safeFetch(`${API_BASE}/admin/discounts/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  async getAdminPlatformSettings() {
    return safeFetch(`${API_BASE}/admin/settings`, {
      headers: getAuthHeaders(),
    });
  },

  async updateAdminPlatformSettings(data: any) {
    return safeFetch(`${API_BASE}/admin/settings`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async getAdminPlatformPayments(params?: { status?: string; payment_method?: string; school_id?: string }): Promise<{ payments: PlatformPayment[] }> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.payment_method) query.set('payment_method', params.payment_method);
    if (params?.school_id) query.set('school_id', params.school_id);

    return safeFetch(`${API_BASE}/admin/platform-payments?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async approvePlatformPayment(paymentId: string, notes?: string) {
    return safeFetch(`${API_BASE}/admin/platform-payments/${paymentId}/approve`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ notes }),
    });
  },

  async rejectPlatformPayment(paymentId: string, reason?: string) {
    return safeFetch(`${API_BASE}/admin/platform-payments/${paymentId}/reject`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason }),
    });
  },

  async getAdminPlatformInvoices(params?: { status?: string; school_id?: string }): Promise<{ invoices: PlatformInvoice[] }> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.school_id) query.set('school_id', params.school_id);

    return safeFetch(`${API_BASE}/admin/platform-invoices?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async getPlatformUsageMetrics(): Promise<{ usage: any }> {
    return safeFetch(`${API_BASE}/admin/usage`, {
      headers: getAuthHeaders(),
    });
  },

  // ============================================================================
  // DATA PROTECTION, AUTOMATIC BACKUPS & RECYCLE BIN (Requirements 1-6)
  // ============================================================================
  async getDataProtectionStatus(): Promise<{ success: boolean; stats: any; totalTables: number; totalProtectedRows: number }> {
    return safeFetch(`${API_BASE}/admin/data-protection/status`, {
      headers: getAuthHeaders(),
    });
  },

  async getDataProtectionBackups(): Promise<{ success: boolean; backups: any[] }> {
    return safeFetch(`${API_BASE}/admin/data-protection/backups`, {
      headers: getAuthHeaders(),
    });
  },

  async createDataProtectionBackup(): Promise<{ success: boolean; backup: any; message: string }> {
    return safeFetch(`${API_BASE}/admin/data-protection/backups/create`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  },

  async verifyDataProtectionBackup(id: string): Promise<any> {
    return safeFetch(`${API_BASE}/admin/data-protection/backups/${id}/verify`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  },

  async testRestoreDataProtectionBackup(id: string): Promise<any> {
    return safeFetch(`${API_BASE}/admin/data-protection/backups/${id}/test-restore`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  },

  async restoreDataProtectionBackup(id: string, confirmation: string): Promise<any> {
    return safeFetch(`${API_BASE}/admin/data-protection/backups/${id}/restore`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ confirmation }),
    });
  },

  async getDataProtectionInventory(): Promise<{ success: boolean; inventory: any[] }> {
    return safeFetch(`${API_BASE}/admin/data-protection/inventory`, {
      headers: getAuthHeaders(),
    });
  },

  async getDataProtectionMigrations(): Promise<{ success: boolean; migrations: any[] }> {
    return safeFetch(`${API_BASE}/admin/data-protection/migrations`, {
      headers: getAuthHeaders(),
    });
  },

  // School Tenant Recycle Bin
  async getSchoolRecycleBin(): Promise<{
    success: boolean;
    recycleBin: {
      students: any[];
      staff: any[];
      classes: any[];
      parents: any[];
    };
    counts: {
      students: number;
      staff: number;
      classes: number;
      parents: number;
      total: number;
    };
  }> {
    return safeFetch(`${API_BASE}/school/recycle-bin`, {
      headers: getAuthHeaders(),
    });
  },

  async restoreSchoolRecycleBinRecord(entityType: string, entityId: string): Promise<any> {
    return safeFetch(`${API_BASE}/school/recycle-bin/restore`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ entityType, entityId }),
    });
  },

  async purgeSchoolRecycleBinRecord(entityType: string, entityId: string, confirmation: string): Promise<any> {
    return safeFetch(`${API_BASE}/school/recycle-bin/purge`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ entityType, entityId, confirmation }),
    });
  },

  // Payment Reversals & Refunds (Phase 10)
  async reversePayment(paymentId: string, reason: string, notes?: string): Promise<any> {
    return safeFetch(`${API_BASE}/school/payments/${paymentId}/reverse`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason, notes }),
    });
  },

  async refundPayment(paymentId: string, reason: string, amountKobo?: number, refundMethod?: string): Promise<any> {
    return safeFetch(`${API_BASE}/school/payments/${paymentId}/refund`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason, amount_kobo: amountKobo, refund_method: refundMethod }),
    });
  },

  // Payment Reconciliation Workspace (Phase 6)
  async getPaymentReconciliation(params?: { status?: string; date_from?: string; date_to?: string }): Promise<any> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.date_from) query.set('date_from', params.date_from);
    if (params?.date_to) query.set('date_to', params.date_to);

    return safeFetch(`${API_BASE}/school/finance/reconciliation?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async matchReconciliation(paymentId: string, statementEntryId?: string, status = 'MATCHED', notes?: string): Promise<any> {
    return safeFetch(`${API_BASE}/school/finance/reconciliation/match`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ payment_id: paymentId, statement_entry_id: statementEntryId, status, notes }),
    });
  },

  async importBankStatement(entries: any[]): Promise<any> {
    return safeFetch(`${API_BASE}/school/finance/reconciliation/import-statement`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ entries }),
    });
  },

  // Complete School Data Archive (Phase 9)
  async exportCompleteSchoolArchive(): Promise<any> {
    return safeFetch(`${API_BASE}/school/data-export/archive`, {
      headers: getAuthHeaders(),
    });
  },

  // ============================================================================
  // PERFORMANCE, ATTENDANCE, BEHAVIOUR, REPORT CARDS, ANNOUNCEMENTS & PORTALS
  // ============================================================================

  async switchActiveSchool(schoolId: string): Promise<{
    success: boolean;
    activeSchoolId: string;
    activeRole: UserRole | null;
    activeSchool: School | null;
    activeSettings: SchoolSettings | null;
  }> {
    return safeFetch(`${API_BASE}/auth/switch-school`, {
      method: 'POST',
      headers: getAuthHeaders(schoolId),
      body: JSON.stringify({ school_id: schoolId }),
    });
  },

  async exitActiveSchool(): Promise<{ success: boolean }> {
    return safeFetch(`${API_BASE}/auth/exit-school`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  },

  // Academic & Portal Policy Settings
  async getAcademicSettings(): Promise<{ success: boolean; settings: AcademicSettings }> {
    return safeFetch(`${API_BASE}/school/performance/settings`, {
      headers: getAuthHeaders(),
    });
  },

  async updateAcademicSettings(data: Partial<AcademicSettings>): Promise<{ success: boolean; message: string; settings: AcademicSettings }> {
    return safeFetch(`${API_BASE}/school/performance/settings`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  // Performance Analytics & Overview
  async getPerformanceOverview(params?: {
    academic_session_id?: string;
    term_id?: string;
    class_id?: string;
    subject_id?: string;
    examination_id?: string;
    behaviour_category?: string;
    date_from?: string;
    date_to?: string;
  }): Promise<{ success: boolean } & PerformanceOverviewData> {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) query.set(k, v);
      });
    }
    return safeFetch(`${API_BASE}/school/performance/overview?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  // Subjects
  async getSubjects(): Promise<{ success: boolean; count: number; subjects: SubjectItem[] }> {
    return safeFetch(`${API_BASE}/school/subjects`, {
      headers: getAuthHeaders(),
    });
  },

  async createSubject(data: { name: string; code?: string; department?: string; class_id?: string; status?: string }): Promise<{ success: boolean; subject: SubjectItem }> {
    return safeFetch(`${API_BASE}/school/subjects`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async updateSubject(id: string, data: Partial<SubjectItem>): Promise<{ success: boolean; subject: SubjectItem }> {
    return safeFetch(`${API_BASE}/school/subjects/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteSubject(id: string): Promise<{ success: boolean; message: string }> {
    return safeFetch(`${API_BASE}/school/subjects/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  // Examinations & Workflow
  async getExaminations(params?: {
    academic_session_id?: string;
    term_id?: string;
    class_id?: string;
    status?: string;
  }): Promise<{ success: boolean; count: number; examinations: ExaminationItem[] }> {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) query.set(k, v);
      });
    }
    return safeFetch(`${API_BASE}/school/examinations?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async createExamination(data: {
    title: string;
    exam_type?: string;
    academic_session_id?: string;
    term_id?: string;
    class_id?: string;
    ca_max_score?: number;
    exam_max_score?: number;
  }): Promise<{ success: boolean; examination: ExaminationItem }> {
    return safeFetch(`${API_BASE}/school/examinations`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteExamination(id: string): Promise<{ success: boolean; message: string }> {
    return safeFetch(`${API_BASE}/school/examinations/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  async updateExaminationStatus(examId: string, status: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'PUBLISHED'): Promise<{
    success: boolean;
    message: string;
    examination: ExaminationItem;
  }> {
    return safeFetch(`${API_BASE}/school/examinations/${examId}/status`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status }),
    });
  },

  // Exam Scores & Audited Corrections
  async getExaminationScores(examId: string, params?: { subject_id?: string; class_id?: string }): Promise<{
    success: boolean;
    examination: ExaminationItem;
    roster: Array<{ id: string; admission_number: string; full_name: string; class_id?: string | null; class_name?: string | null }>;
    scores: StudentScoreItem[];
    corrections: ScoreCorrectionLogItem[];
  }> {
    const query = new URLSearchParams();
    if (params?.subject_id) query.set('subject_id', params.subject_id);
    if (params?.class_id) query.set('class_id', params.class_id);
    return safeFetch(`${API_BASE}/school/examinations/${examId}/scores?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async saveExaminationScores(
    examId: string,
    entries: Array<{
      student_id: string;
      subject_id: string;
      ca_score: number | null;
      exam_score: number | null;
      subject_remark?: string | null;
    }>
  ): Promise<{ success: boolean; savedCount: number; scores: StudentScoreItem[] }> {
    return safeFetch(`${API_BASE}/school/examinations/${examId}/scores`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ entries }),
    });
  },

  async correctPublishedScore(
    scoreId: string,
    data: { ca_score?: number | null; exam_score?: number | null; subject_remark?: string; reason: string }
  ): Promise<{ success: boolean; message: string; score: StudentScoreItem; correctionLog: ScoreCorrectionLogItem }> {
    return safeFetch(`${API_BASE}/school/scores/${scoreId}/correct`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async getScoreCorrections(): Promise<{ success: boolean; corrections: ScoreCorrectionLogItem[] }> {
    return safeFetch(`${API_BASE}/school/scores/corrections`, {
      headers: getAuthHeaders(),
    });
  },

  async getStudentPerformance(studentId: string): Promise<{
    success: boolean;
    student: Student;
    scores: StudentScoreItem[];
    attendance: AttendanceRecordItem[];
    behaviour: BehaviourRecordItem[];
    remarks: TeacherRemarkItem[];
    reportCards: ReportCardItem[];
  }> {
    return safeFetch(`${API_BASE}/school/students/${studentId}/performance`, {
      headers: getAuthHeaders(),
    });
  },

  // Digital Report Cards
  async getReportCards(params?: {
    academic_session_id?: string;
    term_id?: string;
    class_id?: string;
    status?: string;
    student_id?: string;
  }): Promise<{ success: boolean; count: number; reportCards: ReportCardItem[] }> {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) query.set(k, v);
      });
    }
    return safeFetch(`${API_BASE}/school/report-cards?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async getReportCardDetail(id: string): Promise<{ success: boolean; reportCard: ReportCardItem }> {
    return safeFetch(`${API_BASE}/school/report-cards/${id}`, {
      headers: getAuthHeaders(),
    });
  },

  async generateReportCards(data: {
    academic_session_id: string;
    term_id: string;
    class_id?: string;
    examination_id?: string;
    student_id?: string;
  }): Promise<{ success: boolean; count: number; reportCards: ReportCardItem[] }> {
    return safeFetch(`${API_BASE}/school/report-cards/generate`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async updateReportCardRemarks(
    id: string,
    data: { teacher_remark?: string; principal_remark?: string; status?: 'DRAFT' | 'REVIEW' | 'APPROVED' }
  ): Promise<{ success: boolean; reportCard: ReportCardItem }> {
    return safeFetch(`${API_BASE}/school/report-cards/${id}/remarks`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async publishReportCard(id: string): Promise<{ success: boolean; message: string; reportCard: ReportCardItem }> {
    return safeFetch(`${API_BASE}/school/report-cards/${id}/publish`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  },

  async publishClassReportCards(data: {
    class_id?: string;
    academic_session_id: string;
    term_id: string;
  }): Promise<{ success: boolean; publishedCount: number }> {
    return safeFetch(`${API_BASE}/school/report-cards/publish-class`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async compileSchoolReportCardPreview(data: {
    student_id: string;
    report_type: 'TERM' | 'SESSION';
    academic_session_id: string;
    term_id?: string;
    examination_id?: string;
  }): Promise<{ success: boolean; source: string; reportCard: ReportCardItem }> {
    return safeFetch(`${API_BASE}/school/report-cards/compile-preview`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  // Full-Session Cumulative Annual Report Cards
  async getSessionReportCards(params?: {
    academic_session_id?: string;
    class_id?: string;
    status?: string;
    student_id?: string;
  }): Promise<{ success: boolean; count: number; sessionReportCards: SessionReportCardItem[] }> {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) query.set(k, v);
      });
    }
    return safeFetch(`${API_BASE}/school/session-report-cards?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async getSessionReportCardDetail(id: string): Promise<{ success: boolean; sessionReportCard: SessionReportCardItem }> {
    return safeFetch(`${API_BASE}/school/session-report-cards/${id}`, {
      headers: getAuthHeaders(),
    });
  },

  async generateSessionReportCards(data: {
    academic_session_id: string;
    class_id?: string;
    student_id?: string;
  }): Promise<{ success: boolean; count: number; sessionReportCards: SessionReportCardItem[] }> {
    return safeFetch(`${API_BASE}/school/session-report-cards/generate`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async updateSessionReportCardRemarks(
    id: string,
    data: {
      teacher_remark?: string;
      principal_remark?: string;
      promotion_status?: string;
      status?: 'DRAFT' | 'REVIEW' | 'APPROVED';
    }
  ): Promise<{ success: boolean; sessionReportCard: SessionReportCardItem }> {
    return safeFetch(`${API_BASE}/school/session-report-cards/${id}/remarks`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async publishSessionReportCard(id: string): Promise<{ success: boolean; message: string; sessionReportCard: SessionReportCardItem }> {
    return safeFetch(`${API_BASE}/school/session-report-cards/${id}/publish`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  },

  async publishClassSessionReportCards(data: {
    class_id?: string;
    academic_session_id: string;
  }): Promise<{ success: boolean; publishedCount: number }> {
    return safeFetch(`${API_BASE}/school/session-report-cards/publish-class`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  // Attendance
  async getAttendance(params?: {
    class_id?: string;
    attendance_date?: string;
    academic_session_id?: string;
    term_id?: string;
    student_id?: string;
  }): Promise<{ success: boolean; count: number; records: AttendanceRecordItem[]; publications: AttendancePublicationItem[] }> {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) query.set(k, v);
      });
    }
    return safeFetch(`${API_BASE}/school/attendance?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async bulkMarkAttendance(data: {
    attendance_date: string;
    class_id?: string;
    academic_session_id?: string;
    term_id?: string;
    is_published?: boolean | number;
    records: Array<{ student_id: string; status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED'; notes?: string }>;
  }): Promise<{ success: boolean; savedCount: number }> {
    return safeFetch(`${API_BASE}/school/attendance/bulk`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async publishAttendance(data: {
    class_id?: string;
    academic_session_id?: string;
    term_id?: string;
    notes?: string;
  }): Promise<{ success: boolean; message: string }> {
    return safeFetch(`${API_BASE}/school/attendance/publish`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  // Behaviour & Teacher Remarks
  async getBehaviourRecords(params?: {
    student_id?: string;
    class_id?: string;
    category?: string;
    severity?: string;
    academic_session_id?: string;
    term_id?: string;
  }): Promise<{ success: boolean; count: number; records: BehaviourRecordItem[] }> {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) query.set(k, v);
      });
    }
    return safeFetch(`${API_BASE}/school/behaviour?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async createBehaviourRecord(data: {
    student_id: string;
    class_id?: string;
    academic_session_id?: string;
    term_id?: string;
    record_date?: string;
    category: string;
    severity?: string;
    title: string;
    description: string;
    action_taken?: string;
    admin_remarks?: string;
    visible_to_parent?: boolean;
    visible_to_student?: boolean;
    visible_to_teacher?: boolean;
  }): Promise<{ success: boolean; record: BehaviourRecordItem }> {
    return safeFetch(`${API_BASE}/school/behaviour`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async updateBehaviourRecord(id: string, data: Omit<Partial<BehaviourRecordItem>, 'visible_to_parent' | 'visible_to_student' | 'visible_to_teacher'> & {
    visible_to_parent?: boolean | number;
    visible_to_student?: boolean | number;
    visible_to_teacher?: boolean | number;
  }): Promise<{ success: boolean; record: BehaviourRecordItem }> {
    return safeFetch(`${API_BASE}/school/behaviour/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteBehaviourRecord(id: string): Promise<{ success: boolean; message: string }> {
    return safeFetch(`${API_BASE}/school/behaviour/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  async getTeacherRemarks(params?: {
    student_id?: string;
    academic_session_id?: string;
    term_id?: string;
    class_id?: string;
  }): Promise<{ success: boolean; remarks: TeacherRemarkItem[] }> {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) query.set(k, v);
      });
    }
    return safeFetch(`${API_BASE}/school/teacher-remarks?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async upsertTeacherRemark(data: {
    student_id: string;
    class_id?: string;
    academic_session_id: string;
    term_id: string;
    remark_text: string;
    staff_name?: string;
    visible_to_parent?: boolean;
    visible_to_student?: boolean;
  }): Promise<{ success: boolean; remark: TeacherRemarkItem }> {
    return safeFetch(`${API_BASE}/school/teacher-remarks`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  // Announcements
  async getAnnouncements(): Promise<{ success: boolean; count: number; announcements: SchoolAnnouncementItem[] }> {
    return safeFetch(`${API_BASE}/school/announcements`, {
      headers: getAuthHeaders(),
    });
  },

  async createAnnouncement(data: {
    title: string;
    content: string;
    audience: string;
    target_class_id?: string | null;
    priority?: string;
    is_published?: boolean;
  }): Promise<{ success: boolean; announcement: SchoolAnnouncementItem }> {
    return safeFetch(`${API_BASE}/school/announcements`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async updateAnnouncement(id: string, data: Omit<Partial<SchoolAnnouncementItem>, 'is_published'> & { is_published?: boolean | number }): Promise<{
    success: boolean;
    announcement: SchoolAnnouncementItem;
  }> {
    return safeFetch(`${API_BASE}/school/announcements/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteAnnouncement(id: string): Promise<{ success: boolean; message: string }> {
    return safeFetch(`${API_BASE}/school/announcements/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  // Admin Portal User Provisioning & Explicit Verification Linkage
  async provisionPortalUser(data: {
    email?: string;
    full_name: string;
    phone?: string;
    password?: string;
    staff_number?: string;
    job_title?: string;
    department?: string;
    role_name: 'SCHOOL_ADMIN' | 'BURSAR' | 'TEACHER' | 'STAFF' | 'PARENT' | 'STUDENT';
    parent_id?: string | null;
    create_parent_profile?: boolean;
    student_ids?: string[];
    student_id?: string | null;
  }): Promise<{ success: boolean; message: string; user: any; issuedStaffNumber?: string | null }> {
    return safeFetch(`${API_BASE}/school/users/provision`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async updateParentChildren(
    parentId: string,
    data: { student_ids: string[]; user_id?: string | null }
  ): Promise<{ success: boolean; message: string; student_ids: string[] }> {
    return safeFetch(`${API_BASE}/school/parents/${parentId}/students`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async provisionStudentAccount(
    studentId: string,
    data: { email?: string; password: string }
  ): Promise<{ success: boolean; message: string; userId: string; studentId: string; loginEmail?: string; admissionNumber?: string | null }> {
    return safeFetch(`${API_BASE}/school/students/${studentId}/provision-account`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async bulkProvisionPortals(data: {
    target: 'STUDENTS' | 'PARENTS' | 'BOTH';
    custom_password?: string;
  }): Promise<{
    success: boolean;
    message: string;
    provisionedCount: number;
    skippedCount: number;
    credentials: BulkProvisionCredential[];
  }> {
    return safeFetch(`${API_BASE}/school/users/bulk-provision-portals`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async revokeSchoolUser(userId: string): Promise<{ success: boolean; message: string }> {
    return safeFetch(`${API_BASE}/school/users/${userId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  async toggleSchoolUserStatus(
    userId: string,
    isActive: boolean
  ): Promise<{ success: boolean; message: string; is_active: number }> {
    return safeFetch(`${API_BASE}/school/users/${userId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ is_active: isActive }),
    });
  },

  // Teacher Read-Only Portal
  async getTeacherDashboard(): Promise<{ success: boolean } & TeacherDashboardData> {
    return safeFetch(`${API_BASE}/portal/teacher/dashboard`, {
      headers: getAuthHeaders(),
    });
  },

  async generateTeacherReportCard(data: {
    student_id: string;
    report_type: 'TERM' | 'SESSION';
    academic_session_id: string;
    term_id?: string;
  }): Promise<{ success: boolean; source: string; reportCard: ReportCardItem }> {
    return safeFetch(`${API_BASE}/portal/teacher/report-cards/generate`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  // Parent & Student Read-Only Portals
  async getParentDashboard(params?: {
    student_id?: string;
    academic_session_id?: string;
    term_id?: string;
  }): Promise<{ success: boolean } & ParentDashboardData> {
    const query = new URLSearchParams();
    if (params?.student_id) query.set('student_id', params.student_id);
    if (params?.academic_session_id) query.set('academic_session_id', params.academic_session_id);
    if (params?.term_id) query.set('term_id', params.term_id);
    return safeFetch(`${API_BASE}/portal/parent/dashboard?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async getParentReportCard(id: string): Promise<{ success: boolean; reportCard: ReportCardItem }> {
    return safeFetch(`${API_BASE}/portal/parent/report-cards/${id}`, {
      headers: getAuthHeaders(),
    });
  },

  async getParentSessionReportCard(id: string): Promise<{ success: boolean; reportCard: SessionReportCardItem }> {
    return safeFetch(`${API_BASE}/portal/parent/session-report-cards/${id}`, {
      headers: getAuthHeaders(),
    });
  },

  async generateParentReportCard(data: {
    student_id: string;
    report_type: 'TERM' | 'SESSION';
    academic_session_id: string;
    term_id?: string;
  }): Promise<{ success: boolean; source: string; reportCard: ReportCardItem }> {
    return safeFetch(`${API_BASE}/portal/parent/report-cards/generate`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async getStudentDashboard(params?: {
    student_id?: string;
    academic_session_id?: string;
    term_id?: string;
  }): Promise<{ success: boolean } & StudentDashboardData> {
    const query = new URLSearchParams();
    if (params?.student_id) query.set('student_id', params.student_id);
    if (params?.academic_session_id) query.set('academic_session_id', params.academic_session_id);
    if (params?.term_id) query.set('term_id', params.term_id);
    return safeFetch(`${API_BASE}/portal/student/dashboard?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
  },

  async getStudentReportCard(id: string): Promise<{ success: boolean; reportCard: ReportCardItem }> {
    return safeFetch(`${API_BASE}/portal/student/report-cards/${id}`, {
      headers: getAuthHeaders(),
    });
  },

  async getStudentSessionReportCard(id: string): Promise<{ success: boolean; reportCard: SessionReportCardItem }> {
    return safeFetch(`${API_BASE}/portal/student/session-report-cards/${id}`, {
      headers: getAuthHeaders(),
    });
  },

  async generateStudentReportCard(data: {
    student_id?: string;
    report_type: 'TERM' | 'SESSION';
    academic_session_id: string;
    term_id?: string;
  }): Promise<{ success: boolean; source: string; reportCard: ReportCardItem }> {
    return safeFetch(`${API_BASE}/portal/student/report-cards/generate`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  // ============================================================================
  // PUBLIC SCHOOL WEBSITE & SUBDOMAIN PORTAL RESOLUTION
  // ============================================================================
  async getPublicPortalContext(hostOverride?: string): Promise<{
    success: boolean;
    matched: boolean;
    slug: string | null;
    school: PublicSchoolSummary | null;
    urls?: SchoolWebsiteUrls;
  }> {
    const query = hostOverride ? `?host=${encodeURIComponent(hostOverride)}` : '';
    return safeFetch(`${API_BASE}/public/portal-context${query}`);
  },

  async getPublicSchoolWebsite(slug: string): Promise<{ success: boolean } & PublicSchoolWebsiteData> {
    return safeFetch(`${API_BASE}/public/schools/${encodeURIComponent(slug)}/website`);
  },

  async submitAdmissionInquiry(
    slug: string,
    data: {
      student_name: string;
      target_class?: string;
      parent_name: string;
      parent_phone: string;
      parent_email?: string;
      message?: string;
    }
  ): Promise<{ success: boolean; inquiry: SchoolAdmissionInquiry; message: string }> {
    return safeFetch(`${API_BASE}/public/schools/${encodeURIComponent(slug)}/inquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  // ============================================================================
  // ADMIN SCHOOL WEBSITE CMS, GALLERY, EVENTS, INQUIRIES & TIMETABLE
  // ============================================================================
  async getSchoolWebsiteAdminProfile(): Promise<{
    success: boolean;
    website: SchoolWebsiteProfile;
    urls: SchoolWebsiteUrls;
  }> {
    return safeFetch(`${API_BASE}/school/website/profile`, {
      headers: getAuthHeaders(),
    });
  },

  async updateSchoolWebsiteAdminProfile(
    data: Partial<SchoolWebsiteProfile> & { portal_subdomain?: string }
  ): Promise<{
    success: boolean;
    website: SchoolWebsiteProfile;
    urls: SchoolWebsiteUrls;
    message: string;
  }> {
    return safeFetch(`${API_BASE}/school/website/profile`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async getWebsitePosts(): Promise<{ success: boolean; posts: SchoolWebsitePost[] }> {
    return safeFetch(`${API_BASE}/school/website/posts`, {
      headers: getAuthHeaders(),
    });
  },

  async createWebsitePost(data: {
    title: string;
    category?: string;
    excerpt?: string;
    content: string;
    cover_image_url?: string | null;
    author_name?: string;
    author_role?: string;
    is_published?: boolean;
    is_featured?: boolean;
  }): Promise<{ success: boolean; post: SchoolWebsitePost; message: string }> {
    return safeFetch(`${API_BASE}/school/website/posts`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async updateWebsitePost(
    id: string,
    data: Partial<SchoolWebsitePost>
  ): Promise<{ success: boolean; post: SchoolWebsitePost; message: string }> {
    return safeFetch(`${API_BASE}/school/website/posts/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteWebsitePost(id: string): Promise<{ success: boolean; message: string }> {
    return safeFetch(`${API_BASE}/school/website/posts/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  async getWebsiteGallery(): Promise<{ success: boolean; gallery: SchoolWebsiteGalleryItem[] }> {
    return safeFetch(`${API_BASE}/school/website/gallery`, {
      headers: getAuthHeaders(),
    });
  },

  async createWebsiteGalleryItem(data: {
    title: string;
    caption?: string;
    album?: string;
    image_url: string;
    is_published?: boolean;
  }): Promise<{ success: boolean; item: SchoolWebsiteGalleryItem; message: string }> {
    return safeFetch(`${API_BASE}/school/website/gallery`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteWebsiteGalleryItem(id: string): Promise<{ success: boolean; message: string }> {
    return safeFetch(`${API_BASE}/school/website/gallery/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  async getWebsiteEvents(): Promise<{ success: boolean; events: SchoolCalendarEvent[] }> {
    return safeFetch(`${API_BASE}/school/website/events`, {
      headers: getAuthHeaders(),
    });
  },

  async createWebsiteEvent(data: {
    title: string;
    event_date: string;
    end_date?: string;
    location?: string;
    description?: string;
    visibility?: 'PUBLIC' | 'STAFF_ONLY';
  }): Promise<{ success: boolean; event: SchoolCalendarEvent; message: string }> {
    return safeFetch(`${API_BASE}/school/website/events`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteWebsiteEvent(id: string): Promise<{ success: boolean; message: string }> {
    return safeFetch(`${API_BASE}/school/website/events/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  async getAdmissionInquiries(): Promise<{ success: boolean; inquiries: SchoolAdmissionInquiry[] }> {
    return safeFetch(`${API_BASE}/school/website/inquiries`, {
      headers: getAuthHeaders(),
    });
  },

  async updateAdmissionInquiryStatus(
    id: string,
    data: { status: 'NEW' | 'CONTACTED' | 'ENROLLED' | 'ARCHIVED'; admin_notes?: string }
  ): Promise<{ success: boolean; inquiry: SchoolAdmissionInquiry }> {
    return safeFetch(`${API_BASE}/school/website/inquiries/${id}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async getAdminTimetable(): Promise<{ success: boolean; slots: TimetableSlotItem[] }> {
    return safeFetch(`${API_BASE}/school/website/timetable`, {
      headers: getAuthHeaders(),
    });
  },

  async createTimetableSlot(data: {
    class_id?: string;
    class_name?: string;
    arm_name?: string;
    day_of_week: string;
    period_label?: string;
    start_time: string;
    end_time: string;
    subject_name: string;
    teacher_name?: string;
    room_label?: string;
  }): Promise<{ success: boolean; slot: TimetableSlotItem; message: string }> {
    return safeFetch(`${API_BASE}/school/website/timetable`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteTimetableSlot(id: string): Promise<{ success: boolean; message: string }> {
    return safeFetch(`${API_BASE}/school/website/timetable/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  // ============================================================================
  // DEDICATED STAFF WORKSPACE (LESSON NOTES, CONFIDENTIAL BRIEFINGS & REQUESTS)
  // ============================================================================
  async generateLessonNoteDraft(data: {
    subject_name: string;
    class_name: string;
    term_name?: string;
    week_number?: number;
    duration_minutes?: number;
    topic: string;
    sub_topic?: string;
  }): Promise<{
    success: boolean;
    draft: Partial<LessonNoteItem>;
    message: string;
  }> {
    return safeFetch(`${API_BASE}/staff-workspace/lesson-notes/generate`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async getLessonNotes(status?: string): Promise<{ success: boolean; lessonNotes: LessonNoteItem[] }> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return safeFetch(`${API_BASE}/staff-workspace/lesson-notes${q}`, {
      headers: getAuthHeaders(),
    });
  },

  async createLessonNote(data: Partial<LessonNoteItem>): Promise<{
    success: boolean;
    lessonNote: LessonNoteItem;
    message: string;
  }> {
    return safeFetch(`${API_BASE}/staff-workspace/lesson-notes`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async updateLessonNote(
    id: string,
    data: Partial<LessonNoteItem>
  ): Promise<{ success: boolean; lessonNote: LessonNoteItem; message: string }> {
    return safeFetch(`${API_BASE}/staff-workspace/lesson-notes/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async reviewLessonNote(
    id: string,
    data: { status: 'APPROVED' | 'REVISION_REQUESTED'; admin_feedback?: string }
  ): Promise<{ success: boolean; lessonNote: LessonNoteItem; message: string }> {
    return safeFetch(`${API_BASE}/staff-workspace/lesson-notes/${id}/review`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteLessonNote(id: string): Promise<{ success: boolean; message: string }> {
    return safeFetch(`${API_BASE}/staff-workspace/lesson-notes/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  async getConfidentialStaffNotices(): Promise<{
    success: boolean;
    notices: ConfidentialNoticeItem[];
  }> {
    return safeFetch(`${API_BASE}/staff-workspace/confidential-notices`, {
      headers: getAuthHeaders(),
    });
  },

  async acknowledgeConfidentialNotice(id: string): Promise<{ success: boolean; message: string }> {
    return safeFetch(`${API_BASE}/staff-workspace/confidential-notices/${id}/acknowledge`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  },

  async getStaffWorkspaceAdmissionsInquiries(): Promise<{
    success: boolean;
    inquiries: SchoolAdmissionInquiry[];
  }> {
    return safeFetch(`${API_BASE}/staff-workspace/admissions-inquiries`, {
      headers: getAuthHeaders(),
    });
  },

  async getStaffWorkspaceTimetable(): Promise<{ success: boolean; slots: TimetableSlotItem[] }> {
    return safeFetch(`${API_BASE}/staff-workspace/timetable`, {
      headers: getAuthHeaders(),
    });
  },

  async getStaffWorkspaceEvents(): Promise<{ success: boolean; events: SchoolCalendarEvent[] }> {
    return safeFetch(`${API_BASE}/staff-workspace/events`, {
      headers: getAuthHeaders(),
    });
  },

  async getStaffRequests(): Promise<{ success: boolean; requests: StaffRequestItem[] }> {
    return safeFetch(`${API_BASE}/staff-workspace/requests`, {
      headers: getAuthHeaders(),
    });
  },

  async createStaffRequest(data: {
    request_type: 'LEAVE' | 'RESOURCES' | 'MAINTENANCE' | 'GENERAL';
    subject: string;
    details: string;
    start_date?: string;
    end_date?: string;
  }): Promise<{ success: boolean; request: StaffRequestItem; message: string }> {
    return safeFetch(`${API_BASE}/staff-workspace/requests`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async reviewStaffRequest(
    id: string,
    data: { status: 'PENDING' | 'APPROVED' | 'DECLINED'; admin_response?: string }
  ): Promise<{ success: boolean; request: StaffRequestItem; message: string }> {
    return safeFetch(`${API_BASE}/staff-workspace/requests/${id}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  // ============================================================================
  // COMPUTER-BASED TESTING (CBT) EXAMINATION ENGINE
  // ============================================================================

  async getCbtExams(params?: { class_id?: string; status?: string; search?: string }): Promise<{
    success: boolean;
    exams: CbtExamItem[];
  }> {
    const query = new URLSearchParams();
    if (params?.class_id) query.set('class_id', params.class_id);
    if (params?.status) query.set('status', params.status);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return safeFetch(`${API_BASE}/cbt/exams${qs}`, {
      headers: getAuthHeaders(),
    });
  },

  async createCbtExam(data: Partial<CbtExamItem>): Promise<{ success: boolean; exam: CbtExamItem }> {
    return safeFetch(`${API_BASE}/cbt/exams`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async updateCbtExam(id: string, data: Partial<CbtExamItem>): Promise<{ success: boolean; exam: CbtExamItem }> {
    return safeFetch(`${API_BASE}/cbt/exams/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteCbtExam(id: string): Promise<{ success: boolean }> {
    return safeFetch(`${API_BASE}/cbt/exams/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  async getCbtQuestions(examId: string): Promise<{
    success: boolean;
    exam: CbtExamItem;
    questions: CbtQuestionItem[];
  }> {
    return safeFetch(`${API_BASE}/cbt/exams/${examId}/questions`, {
      headers: getAuthHeaders(),
    });
  },

  async createCbtQuestion(
    examId: string,
    data: Partial<CbtQuestionItem>
  ): Promise<{ success: boolean; question: CbtQuestionItem; total_marks: number }> {
    return safeFetch(`${API_BASE}/cbt/exams/${examId}/questions`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async bulkImportCbtQuestions(
    examId: string,
    payload: { raw_text?: string; questions?: Partial<CbtQuestionItem>[] }
  ): Promise<{
    success: boolean;
    importedCount: number;
    skippedCount: number;
    errors: string[];
    total_marks: number;
    questions: CbtQuestionItem[];
  }> {
    return safeFetch(`${API_BASE}/cbt/exams/${examId}/questions/bulk`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  async updateCbtQuestion(
    examId: string,
    questionId: string,
    data: Partial<CbtQuestionItem>
  ): Promise<{ success: boolean; question: CbtQuestionItem; total_marks: number }> {
    return safeFetch(`${API_BASE}/cbt/exams/${examId}/questions/${questionId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteCbtQuestion(examId: string, questionId: string): Promise<{ success: boolean; total_marks: number }> {
    return safeFetch(`${API_BASE}/cbt/exams/${examId}/questions/${questionId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  async getCbtExamResults(examId: string): Promise<CbtExamResultsResponse> {
    return safeFetch(`${API_BASE}/cbt/exams/${examId}/results`, {
      headers: getAuthHeaders(),
    });
  },

  async exportCbtExamResultsCsv(examId: string): Promise<Blob> {
    const res = await fetch(`${API_BASE}/cbt/exams/${examId}/results/export`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to export CBT results CSV');
    return res.blob();
  },

  async syncCbtScoresToReportCard(
    examId: string,
    data: { examination_id: string; subject_id?: string; target: 'CA' | 'EXAM' }
  ): Promise<{
    success: boolean;
    syncedCount: number;
    target: string;
    targetMax: number;
    examinationTitle: string;
    message: string;
  }> {
    return safeFetch(`${API_BASE}/cbt/exams/${examId}/sync-scores`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
  },

  async resetCbtAttempt(attemptId: string): Promise<{ success: boolean; message: string }> {
    return safeFetch(`${API_BASE}/cbt/attempts/${attemptId}/reset`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  },

  // Student CBT Exam Hall
  async getStudentCbtExams(): Promise<{
    success: boolean;
    student: { id: string; full_name: string; admission_number?: string; class_id?: string; class_name?: string | null };
    exams: CbtStudentExamItem[];
    history: CbtStudentHistoryItem[];
  }> {
    return safeFetch(`${API_BASE}/cbt/student/exams`, {
      headers: getAuthHeaders(),
    });
  },

  async startStudentCbtExam(examId: string, accessCode?: string): Promise<CbtStartSessionResponse> {
    return safeFetch(`${API_BASE}/cbt/student/exams/${examId}/start`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(accessCode ? { access_code: accessCode } : {}),
    });
  },

  async saveStudentCbtAnswer(
    attemptId: string,
    payload: { question_id?: string; selected?: string; flagged?: boolean; tab_switch_delta?: number }
  ): Promise<{
    success: boolean;
    auto_submitted?: boolean;
    saved_at?: string;
    answered_count?: number;
    tab_switch_count?: number;
    remaining_seconds?: number;
    attempt?: any;
  }> {
    return safeFetch(`${API_BASE}/cbt/student/attempts/${attemptId}/answer`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  async submitStudentCbtAttempt(
    attemptId: string,
    payload?: { answers?: Record<string, CbtAnswerEntry>; auto_submitted?: boolean }
  ): Promise<{
    success: boolean;
    result_withheld: boolean;
    attempt: any;
    review: CbtReviewItem[] | null;
  }> {
    return safeFetch(`${API_BASE}/cbt/student/attempts/${attemptId}/submit`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload || {}),
    });
  },

  async getStudentCbtAttemptReview(attemptId: string): Promise<{
    success: boolean;
    exam: { id: string; title: string; subject_name: string; class_name: string; pass_mark_percent: number };
    attempt: any;
    review: CbtReviewItem[] | null;
  }> {
    return safeFetch(`${API_BASE}/cbt/student/attempts/${attemptId}/review`, {
      headers: getAuthHeaders(),
    });
  },

  // Parent Read-Only CBT Results
  async getParentCbtResults(studentId?: string): Promise<{
    success: boolean;
    results: CbtParentResultItem[];
  }> {
    const qs = studentId ? `?student_id=${encodeURIComponent(studentId)}` : '';
    return safeFetch(`${API_BASE}/cbt/parent/results${qs}`, {
      headers: getAuthHeaders(),
    });
  },
};



