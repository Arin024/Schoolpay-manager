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
} from '../types/index.js';

const API_BASE = '/api/v1';

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
    this.name = 'ApiError';
  }
}

export async function safeFetch<T = any>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers || {});
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  const mergedOptions: RequestInit = {
    ...options,
    headers,
  };

  let res: Response;
  try {
    res = await fetch(url, mergedOptions);
  } catch (err: any) {
    throw new ApiError(
      0,
      'Unable to connect to the server. Please check your internet connection and try again.',
      { originalError: err?.message }
    );
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
    // Non-JSON response (e.g. HTML from 502/503 Cloud Run gateway, cold start, or SPA fallback)
    const text = await res.text().catch(() => '');
    if (res.status === 502 || res.status === 503) {
      throw new ApiError(
        res.status,
        'Server is temporarily warming up or restarting. Please try again in a few moments.',
        { raw: text }
      );
    }
    if (res.status === 404) {
      throw new ApiError(
        res.status,
        'The requested API endpoint was not found on this server.',
        { raw: text }
      );
    }
    if (!res.ok) {
      throw new ApiError(
        res.status,
        `Server responded with HTTP ${res.status}. Please try again shortly.`,
        { raw: text }
      );
    }
    throw new ApiError(
      res.status,
      'Received an unexpected response from the server. Please reload and try again.',
      { raw: text }
    );
  }

  if (!res.ok) {
    const errorMsg = data?.message || data?.error || `Request failed with status ${res.status}`;
    throw new ApiError(res.status, errorMsg, data);
  }

  return data as T;
}

function getAuthHeaders(schoolId?: string | null): Record<string, string> {
  const token = localStorage.getItem('bursariq_session_token') || localStorage.getItem('schoolpay_session_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const effectiveSchoolId = schoolId || localStorage.getItem('bursariq_active_school') || localStorage.getItem('schoolpay_active_school');
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

  async login(credentials: { email: string; password: string; schoolId?: string }) {
    return safeFetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
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

  async createStudent(data: Partial<Student>): Promise<{ student: Student; message: string }> {
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

  async importStudents(students: any[]): Promise<{ importedCount: number; failedCount: number; errors: any[]; message: string }> {
    return safeFetch(`${API_BASE}/school/students/import`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ students }),
    });
  },

  async exportStudentsCsv(): Promise<Blob> {
    const res = await fetch(`${API_BASE}/school/students/export`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new ApiError(res.status, 'Failed to export students CSV');
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

  async createClass(data: { name: string; level: string; description?: string; academic_session_id?: string }): Promise<{ class: ClassItem; message: string }> {
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

  async createClassArm(classId: string, data: { name: string; capacity?: number; class_teacher_id?: string }): Promise<{ arm: ClassArmItem; message: string }> {
    return safeFetch(`${API_BASE}/school/classes/${classId}/arms`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
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

  async deleteSchool(schoolId: string, confirmationName?: string) {
    return safeFetch(`${API_BASE}/admin/schools/${schoolId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      body: JSON.stringify({ confirmationName }),
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
};
