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

function getAuthHeaders(schoolId?: string | null): Record<string, string> {
  const token = localStorage.getItem('schoolpay_session_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (schoolId) {
    headers['X-School-Id'] = schoolId;
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
    const res = await fetch(`${API_BASE}/auth/register-school`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Registration failed', json);
    return json;
  },

  async login(credentials: { email: string; password: string; schoolId?: string }) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Login failed', json);
    return json;
  },

  async logout() {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
    } catch (e) {
      // ignore network errors on logout
    }
    localStorage.removeItem('schoolpay_session_token');
    localStorage.removeItem('schoolpay_active_school');
  },

  async getMe() {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Session expired', json);
    return json;
  },

  async requestPasswordReset(email: string) {
    const res = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Reset request failed', json);
    return json;
  },

  async completePasswordReset(token: string, newPassword: string) {
    const res = await fetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword }),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Reset completion failed', json);
    return json;
  },

  // Tenant School Management
  async getSchoolProfile(schoolId: string): Promise<{ school: School; settings: SchoolSettings }> {
    const res = await fetch(`${API_BASE}/school/profile`, {
      headers: getAuthHeaders(schoolId),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch school profile', json);
    return json;
  },

  async updateSchoolProfile(schoolId: string, data: Partial<School>): Promise<{ school: School; message: string }> {
    const res = await fetch(`${API_BASE}/school/profile`, {
      method: 'PUT',
      headers: getAuthHeaders(schoolId),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to update school profile', json);
    return json;
  },

  async getSchoolSettings(schoolId: string): Promise<{ settings: SchoolSettings }> {
    const res = await fetch(`${API_BASE}/school/settings`, {
      headers: getAuthHeaders(schoolId),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch settings', json);
    return json;
  },

  async updateSchoolSettings(schoolId: string, data: Partial<SchoolSettings>): Promise<{ settings: SchoolSettings; message: string }> {
    const res = await fetch(`${API_BASE}/school/settings`, {
      method: 'PUT',
      headers: getAuthHeaders(schoolId),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to update settings', json);
    return json;
  },

  async getSchoolUsers(schoolId: string): Promise<{ users: any[] }> {
    const res = await fetch(`${API_BASE}/school/users`, {
      headers: getAuthHeaders(schoolId),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch school users', json);
    return json;
  },

  async getSchoolAuditLogs(schoolId: string): Promise<{ logs: AuditLog[] }> {
    const res = await fetch(`${API_BASE}/school/audit-logs`, {
      headers: getAuthHeaders(schoolId),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch audit logs', json);
    return json;
  },

  // School Management & Operational Stats (Step 2)
  async getSchoolStats(): Promise<{ stats: SchoolDashboardStats }> {
    const res = await fetch(`${API_BASE}/school/stats`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch school statistics', json);
    return json;
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
    const res = await fetch(`${API_BASE}/school/students?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch students', json);
    return json;
  },

  async getSchoolStudentById(studentId: string): Promise<{ student: Student }> {
    const res = await fetch(`${API_BASE}/school/students/${studentId}`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch student record', json);
    return json;
  },

  async createStudent(data: Partial<Student>): Promise<{ student: Student; message: string }> {
    const res = await fetch(`${API_BASE}/school/students`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to enroll student', json);
    return json;
  },

  async updateStudent(studentId: string, data: Partial<Student>): Promise<{ student: Student; message: string }> {
    const res = await fetch(`${API_BASE}/school/students/${studentId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to update student', json);
    return json;
  },

  async deleteStudent(studentId: string): Promise<{ message: string }> {
    const res = await fetch(`${API_BASE}/school/students/${studentId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to delete student', json);
    return json;
  },

  async importStudents(students: any[]): Promise<{ importedCount: number; failedCount: number; errors: any[]; message: string }> {
    const res = await fetch(`${API_BASE}/school/students/import`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ students }),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to import students', json);
    return json;
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
    const res = await fetch(`${API_BASE}/school/parents`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch parents', json);
    return json;
  },

  async createParent(data: Partial<ParentItem> & { student_ids?: string[] }): Promise<{ parent: ParentItem; message: string }> {
    const res = await fetch(`${API_BASE}/school/parents`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to create parent record', json);
    return json;
  },

  async updateParent(parentId: string, data: Partial<ParentItem>): Promise<{ parent: ParentItem; message: string }> {
    const res = await fetch(`${API_BASE}/school/parents/${parentId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to update parent', json);
    return json;
  },

  async deleteParent(parentId: string): Promise<{ message: string }> {
    const res = await fetch(`${API_BASE}/school/parents/${parentId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to delete parent', json);
    return json;
  },

  // Classes & Arms API
  async getSchoolClasses(): Promise<{ classes: ClassItem[]; count: number }> {
    const res = await fetch(`${API_BASE}/school/classes`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch classes', json);
    return json;
  },

  async createClass(data: { name: string; level: string; description?: string; academic_session_id?: string }): Promise<{ class: ClassItem; message: string }> {
    const res = await fetch(`${API_BASE}/school/classes`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to create class', json);
    return json;
  },

  async deleteClass(classId: string): Promise<{ message: string }> {
    const res = await fetch(`${API_BASE}/school/classes/${classId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to delete class', json);
    return json;
  },

  async createClassArm(classId: string, data: { name: string; capacity?: number; class_teacher_id?: string }): Promise<{ arm: ClassArmItem; message: string }> {
    const res = await fetch(`${API_BASE}/school/classes/${classId}/arms`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to create class arm', json);
    return json;
  },

  // Staff API
  async getSchoolStaff(): Promise<{ staff: StaffItem[]; count: number }> {
    const res = await fetch(`${API_BASE}/school/staff`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch staff directory', json);
    return json;
  },

  async createStaff(data: Partial<StaffItem>): Promise<{ staff: StaffItem; message: string }> {
    const res = await fetch(`${API_BASE}/school/staff`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to add staff member', json);
    return json;
  },

  async updateStaff(staffId: string, data: Partial<StaffItem>): Promise<{ staff: StaffItem; message: string }> {
    const res = await fetch(`${API_BASE}/school/staff/${staffId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to update staff member', json);
    return json;
  },

  async deleteStaff(staffId: string): Promise<{ message: string }> {
    const res = await fetch(`${API_BASE}/school/staff/${staffId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to delete staff member', json);
    return json;
  },

  // Academic Sessions & Terms API
  async getSchoolAcademicSessions(): Promise<{ sessions: AcademicSessionItem[] }> {
    const res = await fetch(`${API_BASE}/school/academic-sessions`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch academic sessions', json);
    return json;
  },

  async createAcademicSession(data: { name: string; start_date?: string; end_date?: string; status?: string }): Promise<{ session: AcademicSessionItem; message: string }> {
    const res = await fetch(`${API_BASE}/school/academic-sessions`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to create academic session', json);
    return json;
  },

  async createTerm(sessionId: string, data: { name: string; start_date?: string; end_date?: string; status?: string }): Promise<{ term: TermItem; message: string }> {
    const res = await fetch(`${API_BASE}/school/academic-sessions/${sessionId}/terms`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to create term', json);
    return json;
  },

  async getSchoolFees(): Promise<{ fees: FeeItem[]; count: number }> {
    const res = await fetch(`${API_BASE}/school/fees`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch fee structures', json);
    return json;
  },

  // --- Step 3: Fee Categories ---
  async getFeeCategories(): Promise<{ categories: FeeCategoryItem[]; count: number }> {
    const res = await fetch(`${API_BASE}/school/fee-categories`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch fee categories', json);
    return json;
  },

  async createFeeCategory(data: { name: string; description?: string; status?: string }): Promise<{ category: FeeCategoryItem }> {
    const res = await fetch(`${API_BASE}/school/fee-categories`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to create fee category', json);
    return json;
  },

  async updateFeeCategory(id: string, data: { name?: string; description?: string; status?: string }): Promise<{ category: FeeCategoryItem }> {
    const res = await fetch(`${API_BASE}/school/fee-categories/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to update fee category', json);
    return json;
  },

  async deleteFeeCategory(id: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/school/fee-categories/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to delete fee category', json);
    return json;
  },

  // --- Step 3: Fee Structures ---
  async getFeeStructures(params?: { class_id?: string; session_id?: string; term_id?: string }): Promise<{ feeStructures: FeeStructureDef[]; count: number }> {
    const query = new URLSearchParams();
    if (params?.class_id) query.set('class_id', params.class_id);
    if (params?.session_id) query.set('session_id', params.session_id);
    if (params?.term_id) query.set('term_id', params.term_id);

    const res = await fetch(`${API_BASE}/school/fee-structures?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch fee structures', json);
    return json;
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
    const res = await fetch(`${API_BASE}/school/fee-structures`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to create fee structure', json);
    return json;
  },

  async deleteFeeStructure(id: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/school/fee-structures/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to delete fee structure', json);
    return json;
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

    const res = await fetch(`${API_BASE}/school/invoices?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch invoices', json);
    return json;
  },

  async getInvoice(id: string): Promise<{ invoice: InvoiceDef }> {
    const res = await fetch(`${API_BASE}/school/invoices/${id}`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch invoice details', json);
    return json;
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
    const res = await fetch(`${API_BASE}/school/invoices`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to create invoice', json);
    return json;
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
    const res = await fetch(`${API_BASE}/school/invoices/generate-bulk`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to generate bulk invoices', json);
    return json;
  },

  async cancelInvoice(id: string, reason?: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/school/invoices/${id}/cancel`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason }),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to cancel invoice', json);
    return json;
  },

  async applyInvoiceDiscount(
    invoiceId: string,
    data: { type: string; amount?: number; amount_kobo?: number; percentage?: number; reason: string }
  ): Promise<{ success: boolean; invoice: any; discount: any }> {
    const res = await fetch(`${API_BASE}/school/invoices/${invoiceId}/discounts`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to apply discount', json);
    return json;
  },

  async recordInvoicePayment(
    invoiceId: string,
    data: { amount?: number; amount_kobo?: number; payment_method: string; payment_date?: string; notes?: string }
  ): Promise<{ success: boolean; invoice: any; payment: any }> {
    const res = await fetch(`${API_BASE}/school/invoices/${invoiceId}/payments`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to record payment', json);
    return json;
  },

  // --- Step 3: Payments & Receipts ---
  async getPayments(params?: { student_id?: string; payment_method?: string; start_date?: string; end_date?: string }): Promise<{ payments: PaymentItem[]; count: number }> {
    const query = new URLSearchParams();
    if (params?.student_id) query.set('student_id', params.student_id);
    if (params?.payment_method) query.set('payment_method', params.payment_method);
    if (params?.start_date) query.set('start_date', params.start_date);
    if (params?.end_date) query.set('end_date', params.end_date);

    const res = await fetch(`${API_BASE}/school/payments?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch payments', json);
    return json;
  },

  // --- Step 3: Financial Dashboard & Reports ---
  async getFinancialDashboardStats(): Promise<{ stats: FinancialStatsDef }> {
    const res = await fetch(`${API_BASE}/school/finance/dashboard`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch financial dashboard stats', json);
    return json;
  },

  async getFinancialReportsSummary(params?: { academic_session_id?: string; term_id?: string }): Promise<{
    classRevenue: Array<{ class_name: string; invoice_count: number; total_billed: number; total_billed_naira: number; total_paid_naira: number; total_balance_naira: number }>;
    categoryRevenue: Array<{ category_name: string; item_count: number; total_billed: number; total_billed_naira: number }>;
    paymentMethods: Array<{ payment_method: string; payment_count: number; total_amount: number; total_amount_naira: number }>;
  }> {
    const query = new URLSearchParams();
    if (params?.academic_session_id) query.set('academic_session_id', params.academic_session_id);
    if (params?.term_id) query.set('term_id', params.term_id);

    const res = await fetch(`${API_BASE}/school/finance/reports/summary?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch financial summary reports', json);
    return json;
  },

  async getStudentFinanceProfile(studentId: string): Promise<StudentFinancialProfile> {
    const res = await fetch(`${API_BASE}/school/students/${studentId}/finance`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch student finance profile', json);
    return json;
  },

  // Platform Super Admin
  async getAdminStats(): Promise<{ stats: PlatformStats }> {
    const res = await fetch(`${API_BASE}/admin/stats`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch platform metrics', json);
    return json;
  },

  async getAdminSchools(): Promise<{ schools: (School & { total_users: number; owner_name: string; owner_email: string })[] }> {
    const res = await fetch(`${API_BASE}/admin/schools`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch platform schools', json);
    return json;
  },

  async getAdminSchoolDetails(schoolId: string): Promise<{ school: School; settings: SchoolSettings; users: any[]; recentLogs: AuditLog[] }> {
    const res = await fetch(`${API_BASE}/admin/schools/${schoolId}`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch school details', json);
    return json;
  },

  async updateSchoolStatus(schoolId: string, status: string, reason?: string) {
    const res = await fetch(`${API_BASE}/admin/schools/${schoolId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status, reason }),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to update school status', json);
    return json;
  },

  async getAdminAuditLogs(): Promise<{ logs: AuditLog[] }> {
    const res = await fetch(`${API_BASE}/admin/audit-logs`, {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new ApiError(res.status, json.message || 'Failed to fetch platform audit logs', json);
    return json;
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
};
