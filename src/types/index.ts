/// <reference types="vite-plugin-pwa/client" />
export type SchoolStatus = 'TRIAL' | 'ACTIVE' | 'GRACE_PERIOD' | 'SUSPENDED' | 'EXPIRED' | 'CANCELLED';

export type SchoolType =
  | 'Nursery & Primary'
  | 'Secondary'
  | 'Comprehensive / K-12'
  | 'Vocational / Technical'
  | 'International';

export type RoleName =
  | 'SUPER_ADMIN'
  | 'SCHOOL_OWNER'
  | 'SCHOOL_ADMIN'
  | 'BURSAR'
  | 'TEACHER'
  | 'STAFF'
  | 'PARENT'
  | 'STUDENT'
  | 'PARTNER';

export interface User {
  id: string;
  email: string;
  full_name: string;
  phone?: string | null;
  is_platform_admin: number;
}

export interface School {
  id: string;
  name: string;
  slug: string;
  type: SchoolType;
  status: SchoolStatus;
  address?: string;
  state: string;
  lga: string;
  phone: string;
  email: string;
  website?: string | null;
  logo_url?: string | null;
  current_plan_id?: string | null;
  subscription_end_date?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SchoolSettings {
  id: string;
  school_id: string;
  currency: string;
  currency_symbol: string;
  current_academic_session: string;
  current_term: string;
  payment_notification_email?: string | null;
  payment_notification_sms: number;
  portal_subdomain?: string | null;
  allow_partial_payments: number;
}

export interface UserRole {
  id: string;
  user_id: string;
  school_id: string | null;
  role_id: string;
  role_name: RoleName;
  role_display_name: string;
  role_scope: 'PLATFORM' | 'SCHOOL';
  is_primary: number;
  school_name?: string | null;
  school_status?: SchoolStatus | null;
  school_slug?: string | null;
}

export type StudentStatus = 'ACTIVE' | 'INACTIVE' | 'GRADUATED' | 'TRANSFERRED' | 'WITHDRAWN' | 'SUSPENDED';
export type StaffEmploymentStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'LEFT';
export type SessionStatus = 'UPCOMING' | 'ACTIVE' | 'COMPLETED';

export interface Student {
  id: string;
  school_id: string;
  admission_number: string;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  full_name: string;
  gender?: string | null;
  date_of_birth?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  state?: string | null;
  nationality?: string | null;
  admission_date?: string | null;
  student_status: StudentStatus;
  status?: string; // fallback alias
  class_id?: string | null;
  class_arm_id?: string | null;
  class_name?: string | null;
  class_arm_name?: string | null;
  academic_session_id?: string | null;
  academic_session_name?: string | null;
  profile_photo_url?: string | null;
  emergency_contact?: string | null;
  medical_notes?: string | null;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  guardian_email?: string | null;
  created_at: string;
  updated_at?: string;
  user_id?: string | null;
  parents?: ParentWithRelationship[];
}

export interface ParentWithRelationship {
  id: string;
  parent_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  email?: string | null;
  occupation?: string | null;
  address?: string | null;
  relationship_type: string;
  is_primary_contact: number;
}

export interface ParentItem {
  id: string;
  school_id: string;
  user_id?: string | null;
  portal_user_email?: string | null;
  portal_user_name?: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  occupation?: string | null;
  relationship: string;
  emergency_contact?: string | null;
  created_at: string;
  updated_at?: string;
  children?: {
    student_id: string;
    admission_number: string;
    full_name: string;
    class_name?: string | null;
    relationship_type: string;
    is_primary_contact: number;
  }[];
}

export interface ClassArmItem {
  id: string;
  school_id: string;
  class_id: string;
  name: string;
  capacity: number;
  class_teacher_id?: string | null;
  class_teacher_name?: string | null;
  total_students?: number;
  created_at: string;
  updated_at?: string;
}

export interface ClassItem {
  id: string;
  school_id: string;
  name: string;
  description?: string | null;
  level: string;
  academic_session_id?: string | null;
  academic_session_name?: string | null;
  total_students?: number;
  arms?: ClassArmItem[];
  created_at: string;
  updated_at?: string;
}

export interface StaffItem {
  id: string;
  school_id: string;
  user_id?: string | null;
  staff_number: string;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  gender?: string | null;
  address?: string | null;
  job_title: string;
  department?: string | null;
  employment_status: StaffEmploymentStatus;
  date_joined?: string | null;
  profile_photo_url?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface TermItem {
  id: string;
  school_id: string;
  academic_session_id: string;
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  status: SessionStatus;
  created_at: string;
  updated_at?: string;
}

export interface AcademicSessionItem {
  id: string;
  school_id: string;
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  status: SessionStatus;
  terms?: TermItem[];
  created_at: string;
  updated_at?: string;
}

export interface SchoolDashboardStats {
  totalStudents: number;
  activeStudents: number;
  totalClasses: number;
  totalStaff: number;
  totalParents: number;
  currentAcademicSession: string;
  currentTerm: string;
  recentStudents: Student[];
}

export interface FeeItem {
  id: string;
  school_id: string;
  name: string;
  amount: number;
  session: string;
  term: string;
  description?: string | null;
  created_at: string;
}

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';
export type PaymentMethod = 'BANK_TRANSFER' | 'POS' | 'CASH' | 'ONLINE' | 'CHEQUE';
export type DiscountType = 'FIXED' | 'PERCENTAGE' | 'SCHOLARSHIP' | 'WAIVER';

export interface FeeCategoryItem {
  id: string;
  school_id: string;
  name: string;
  description?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: string;
  updated_at?: string;
}

export interface FeeStructureItemDef {
  id: string;
  school_id: string;
  fee_structure_id: string;
  fee_category_id: string;
  category_name?: string;
  amount: number; // in kobo
  amount_naira?: number;
  compulsory: boolean | number;
  due_date?: string | null;
  description?: string | null;
  created_at?: string;
}

export interface FeeStructureDef {
  id: string;
  school_id: string;
  class_id?: string | null;
  class_name?: string | null;
  academic_session_id?: string | null;
  session_name?: string | null;
  term_id?: string | null;
  term_name?: string | null;
  name: string;
  description?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  total_amount?: number;
  total_naira?: number;
  items?: FeeStructureItemDef[];
  created_at: string;
  updated_at?: string;
}

export interface InvoiceLineItem {
  id: string;
  school_id: string;
  invoice_id: string;
  fee_category_id?: string | null;
  category_name?: string;
  description: string;
  quantity: number;
  unit_amount: number; // in kobo
  unit_amount_naira?: number;
  total_amount: number; // in kobo
  total_amount_naira?: number;
  created_at?: string;
}

export interface InvoiceDiscountItem {
  id: string;
  school_id: string;
  invoice_id: string;
  type: DiscountType;
  amount: number; // in kobo
  amount_naira?: number;
  percentage?: number | null;
  reason: string;
  authorized_by?: string | null;
  authorizer_name?: string | null;
  created_at?: string;
}

export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'REFUNDED';

export interface PaymentItem {
  id: string;
  school_id: string;
  invoice_id: string;
  invoice_number?: string;
  invoice_total?: number;
  invoice_total_naira?: number;
  invoice_balance?: number;
  invoice_balance_naira?: number;
  student_id: string;
  student_name?: string;
  admission_number?: string;
  class_name?: string;
  class_display_name?: string;
  payment_reference: string;
  internal_reference?: string;
  provider_reference?: string;
  provider?: string;
  amount: number; // in kobo
  amount_naira?: number;
  currency?: string;
  payment_method: PaymentMethod;
  status: PaymentStatus;
  payment_date: string;
  paid_at?: string;
  verified_at?: string | null;
  verified_by?: string | null;
  verifier_name?: string | null;
  notes?: string | null;
  received_by?: string | null;
  receiver_name?: string | null;
  receipt_id?: string | null;
  receipt_number?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ReceiptItem {
  id: string;
  school_id: string;
  receipt_number: string;
  payment_id: string;
  invoice_id: string;
  student_id: string;
  amount: number; // in kobo
  amount_naira: number;
  previous_balance: number; // in kobo
  previous_balance_naira: number;
  current_balance: number; // in kobo
  current_balance_naira: number;
  issue_date: string;
  issued_by?: string | null;
  issuer_name?: string | null;
  issuer_email?: string | null;
  notes?: string | null;
  created_at: string;
  payment_reference?: string;
  internal_reference?: string;
  payment_method?: PaymentMethod;
  provider?: string;
  payment_status?: PaymentStatus;
  paid_at?: string;
  invoice_number?: string;
  invoice_issue_date?: string;
  invoice_total?: number;
  invoice_total_naira?: number;
  student_name?: string;
  first_name?: string;
  last_name?: string;
  admission_number?: string;
  class_name?: string;
  class_arm_name?: string;
  class_display_name?: string;
  school_name?: string;
  school_slug?: string;
  school_type?: string;
  school_address?: string;
  school_state?: string;
  school_lga?: string;
  school_phone?: string;
  school_email?: string;
  school_website?: string | null;
  school_logo_url?: string | null;
}

export interface NotificationItem {
  id: string;
  school_id: string;
  user_id?: string | null;
  type:
    | 'INVOICE_CREATED'
    | 'PAYMENT_RECEIVED'
    | 'PAYMENT_FAILED'
    | 'PAYMENT_VERIFIED'
    | 'INVOICE_OVERDUE'
    | 'RECEIPT_AVAILABLE'
    | 'ANNOUNCEMENT'
    | 'SYSTEM';
  title: string;
  message: string;
  data?: any;
  read_at?: string | null;
  created_at: string;
}

export interface GatewayStatus {
  name: 'MANUAL' | 'PAYSTACK' | 'FLUTTERWAVE' | 'MONIEPOINT' | 'TEST_SANDBOX';
  displayName: string;
  isConfigured: boolean;
}

export interface InvoiceDef {
  id: string;
  school_id: string;
  student_id: string;
  student_name?: string;
  first_name?: string;
  last_name?: string;
  admission_number?: string;
  class_name?: string;
  invoice_number: string;
  academic_session_id?: string | null;
  session_name?: string | null;
  term_id?: string | null;
  term_name?: string | null;
  class_id?: string | null;
  issue_date: string;
  due_date: string;
  subtotal: number; // in kobo
  subtotal_naira?: number;
  discount: number; // in kobo
  discount_naira?: number;
  total: number; // in kobo
  total_naira?: number;
  amount_paid: number; // in kobo
  amount_paid_naira?: number;
  balance: number; // in kobo
  balance_naira?: number;
  status: InvoiceStatus;
  notes?: string | null;
  items?: InvoiceLineItem[];
  discounts?: InvoiceDiscountItem[];
  payments?: PaymentItem[];
  school_name?: string;
  school_address?: string;
  school_phone?: string;
  school_email?: string;
  school_website?: string;
  school_logo_url?: string;
  created_at: string;
  updated_at?: string;
}

export interface FinancialStatsDef {
  totalInvoicedKobo: number;
  totalInvoicedNaira: number;
  totalCollectedKobo: number;
  totalCollectedNaira: number;
  outstandingKobo: number;
  outstandingNaira: number;
  overdueKobo: number;
  overdueNaira: number;
  paidCount: number;
  partiallyPaidCount: number;
  unpaidCount: number;
  overdueCount: number;
  totalInvoices: number;
  collectionRate: number;
  recentInvoices: InvoiceDef[];
  recentPayments: PaymentItem[];
}

export interface StudentFinancialProfile {
  student: {
    id: string;
    fullName: string;
    admissionNumber: string;
    className: string;
  };
  summary: {
    totalBilledKobo: number;
    totalBilledNaira: number;
    totalDiscountKobo: number;
    totalDiscountNaira: number;
    totalPaidKobo: number;
    totalPaidNaira: number;
    outstandingBalanceKobo: number;
    outstandingBalanceNaira: number;
    invoiceCount: number;
  };
  invoices: InvoiceDef[];
  payments: PaymentItem[];
}

export interface PlatformStats {
  totalSchools: number;
  activeSchools: number;
  trialSchools: number;
  graceSchools?: number;
  suspendedSchools: number;
  expiredSchools?: number;
  cancelledSchools?: number;
  totalStudents: number;
  totalUsers: number;
  totalStaff?: number;
  totalClasses?: number;
  totalInvoices?: number;
  totalPayments?: number;
  platformRevenueKobo?: number;
  platformRevenueNaira?: number;
  schoolCollectedRevenueKobo?: number;
  schoolCollectedRevenueNaira?: number;
  activeSubscriptions?: number;
  expiringSubscriptions?: number;
  totalPartners?: number;
  totalCommissionsKobo?: number;
  totalCommissionsNaira?: number;
  recentActivity?: AuditLog[];
}

export type BillingInterval = 'ONE_TIME' | 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL' | 'CUSTOM' | 'TERM' | 'LIFETIME';

export type SubscriptionLifecycleStatus =
  | 'TRIAL'
  | 'ACTIVE'
  | 'GRACE_PERIOD'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface SubscriptionPlan {
  id: string;
  name: string;
  display_name: string;
  description?: string | null;
  price: number; // in kobo (minor unit)
  price_naira: number;
  currency: string;
  billing_interval: BillingInterval;
  billing_interval_count: number;
  trial_days: number;
  maximum_students: number;
  maximum_staff: number;
  maximum_admin_users: number;
  student_limit: number;
  staff_limit: number;
  storage_limit_mb: number;
  feature_limits?: Record<string, number>;
  feature_flags: Record<string, boolean>;
  active: number;
  subscriber_count?: number;
  created_at: string;
  updated_at?: string;
}

export interface SubscriptionDiscount {
  id: string;
  code?: string | null;
  name: string;
  discount_type: 'PERCENTAGE' | 'FIXED';
  discount_value: number; // percentage (e.g. 20) or fixed kobo
  discount_value_naira?: number;
  school_id?: string | null;
  plan_id?: string | null;
  active: number;
  expires_at?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface SchoolSubscription {
  id: string;
  school_id: string;
  school_name?: string;
  school_slug?: string;
  plan_id: string;
  plan_name?: string;
  plan_display_name?: string;
  billing_interval?: string;
  status: SubscriptionLifecycleStatus;
  start_date: string;
  end_date: string;
  expiry_date?: string;
  renewal_date?: string;
  trial_end_date?: string | null;
  auto_renew: number;
  provider: string;
  provider_reference?: string | null;
  standard_plan_price: number; // kobo
  standard_plan_price_naira?: number;
  negotiated_price?: number | null; // kobo
  negotiated_price_naira?: number | null;
  discount_amount: number; // kobo
  discount_amount_naira?: number;
  discount_reason?: string | null;
  final_amount: number; // authoritative amount in kobo
  final_amount_naira: number;
  currency: string;
  amount_paid: number; // kobo
  amount_paid_naira?: number;
  grace_period_days?: number;
  notes?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface PlatformInvoice {
  id: string;
  invoice_number: string;
  school_id: string;
  school_name?: string;
  school_address?: string | null;
  school_email?: string | null;
  school_phone?: string | null;
  subscription_id: string;
  plan_id: string;
  plan_display_name?: string;
  billing_period?: string;
  standard_price: number; // kobo
  standard_price_naira: number;
  discount: number; // kobo
  discount_naira: number;
  negotiated_price?: number | null; // kobo
  negotiated_price_naira?: number | null;
  final_amount: number; // kobo
  final_amount_naira: number;
  currency: string;
  payment_status: 'PAID' | 'PENDING' | 'OVERDUE' | 'CANCELLED';
  issue_date: string;
  due_date: string;
  paid_at?: string | null;
  payment_method?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface PlatformPayment {
  id: string;
  school_id: string;
  school_name?: string;
  subscription_id?: string | null;
  plan_id?: string | null;
  plan_display_name?: string;
  invoice_id?: string | null;
  amount: number; // kobo
  amount_naira: number;
  currency: string;
  payment_method: string;
  provider: string;
  provider_transaction_id?: string | null;
  provider_reference?: string | null;
  internal_reference: string;
  status: 'SUCCESS' | 'PENDING' | 'FAILED' | 'REFUNDED';
  paid_at: string;
  metadata?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface Partner {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  partner_type: 'BANK' | 'REFERRAL' | 'INTEGRATION' | 'RESELLER';
  commission_rate: number; // percentage, e.g. 15.0
  referral_code?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  notes?: string | null;
  commission_count?: number;
  paid_commissions_kobo?: number;
  paid_commissions_naira?: number;
  pending_commissions_kobo?: number;
  pending_commissions_naira?: number;
  created_at: string;
}

export interface Commission {
  id: string;
  partner_id: string;
  partner_name?: string;
  partner_company?: string;
  school_id?: string | null;
  school_name?: string;
  platform_payment_id?: string | null;
  amount: number; // kobo
  amount_naira: number;
  rate_percent: number;
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'CANCELLED';
  notes?: string | null;
  paid_at?: string | null;
  created_at: string;
}

export interface AuditLog {
  id: number;
  actor_id?: string | null;
  actor_email?: string | null;
  school_id?: string | null;
  school_name?: string | null;
  action: string;
  entity: string;
  entity_id?: string | null;
  ip_address?: string | null;
  metadata?: string | null;
  created_at: string;
}

// ============================================================================
// SCHOOL PERFORMANCE, ATTENDANCE, BEHAVIOUR, REPORT CARDS & PORTALS
// ============================================================================

export type ExamWorkflowStatus = 'DRAFT' | 'REVIEW' | 'APPROVED' | 'PUBLISHED';
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
export type BehaviourCategory = 'POSITIVE' | 'COMMENDATION' | 'DISCIPLINE' | 'INCIDENT' | 'OBSERVATION';
export type BehaviourSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type AnnouncementAudience = 'ALL' | 'PARENTS' | 'STUDENTS' | 'TEACHERS' | 'CLASS' | 'STAFF_ONLY';
export type AnnouncementPriority = 'NORMAL' | 'IMPORTANT' | 'URGENT';

export interface GradingScaleBand {
  grade: string;
  min: number;
  max: number;
  remark: string;
}

export interface AcademicSettings {
  school_id: string;
  ca_max_score: number;
  exam_max_score: number;
  grading_scale: GradingScaleBand[];
  missing_score_policy: 'EXCLUDE' | 'ZERO';
  show_class_position: boolean;
  students_can_view_fees: boolean;
  teachers_can_view_fees: boolean;
  require_review_before_approve: boolean;
  component_structure?: Array<{ key: string; label: string; max: number }> | null;
}

export interface SubjectItem {
  id: string;
  school_id: string;
  name: string;
  code: string;
  department?: string | null;
  class_id?: string | null;
  class_name?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  created_at?: string;
}

export interface ExaminationItem {
  id: string;
  school_id: string;
  academic_session_id?: string | null;
  session_name?: string | null;
  term_id?: string | null;
  term_name?: string | null;
  class_id?: string | null;
  class_name?: string | null;
  title: string;
  exam_type: string;
  ca_max_score: number;
  exam_max_score: number;
  total_max_score: number;
  status: ExamWorkflowStatus;
  scores_count?: number;
  published_at?: string | null;
  created_at?: string;
}

export interface StudentScoreItem {
  id: string;
  school_id: string;
  examination_id: string;
  student_id: string;
  student_name?: string;
  admission_number?: string;
  class_id?: string | null;
  subject_id: string;
  subject_name?: string;
  subject_code?: string;
  academic_session_id?: string | null;
  session_name?: string | null;
  term_id?: string | null;
  term_name?: string | null;
  exam_title?: string;
  exam_type?: string;
  ca_max_score?: number;
  exam_max_score?: number;
  total_max_score?: number;
  ca_score: number | null;
  exam_score: number | null;
  total_score: number | null;
  grade?: string | null;
  grade_remark?: string | null;
  subject_remark?: string | null;
  status: ExamWorkflowStatus;
  updated_at?: string;
}

export interface ScoreCorrectionLogItem {
  id: string;
  score_id: string;
  examination_id: string;
  exam_title?: string;
  student_id: string;
  student_name?: string;
  admission_number?: string;
  subject_id: string;
  subject_name?: string;
  previous_ca_score: number | null;
  new_ca_score: number | null;
  previous_exam_score: number | null;
  new_exam_score: number | null;
  previous_total: number | null;
  new_total: number | null;
  previous_grade?: string | null;
  new_grade?: string | null;
  reason: string;
  corrected_by: string;
  corrected_by_email?: string | null;
  created_at: string;
}

export interface ReportCardBreakdown {
  report_type?: 'TERM' | 'SESSION';
  reportCardId: string;
  verificationCode: string;
  isLiveGenerated?: boolean;
  school?: Partial<School>;
  student?: Partial<Student>;
  sessionName: string;
  termName: string;
  showClassPosition: boolean;
  total_score: number;
  average_score: number;
  subjects_count: number;
  terms_count?: number;
  class_position: number | null;
  class_size: number | null;
  promotion_status?: string | null;
  passMark?: number;
  gradingScale?: GradingScaleBand[];
  overall_grade?: { grade: string; remark: string };
  terms?: Array<{ id: string; name: string }>;
  term_averages?: Array<{
    term_id: string;
    term_name: string;
    subjects_count: number;
    total_score: number;
    average_score: number;
    grade: string;
  }>;
  subjects: Array<{
    subject_id: string;
    subject_name: string;
    subject_code?: string;
    ca_score?: number | null;
    exam_score?: number | null;
    ca_max_score?: number;
    exam_max_score?: number;
    total_score: number | null;
    cumulative_total?: number;
    cumulative_average?: number;
    terms_taken?: number;
    term_scores?: Array<{
      term_id: string;
      term_name: string;
      ca_score: number | null;
      exam_score: number | null;
      total_score: number | null;
      percentage: number | null;
      grade: string | null;
    }>;
    grade?: string | null;
    grade_remark?: string | null;
    subject_remark?: string | null;
  }>;
  attendance_summary?: {
    totalDays: number;
    present: number;
    absent: number;
    late: number;
    excused: number;
    attendanceRatePct: number;
  };
  behaviour_summary?: {
    totalRecords: number;
    positiveCount: number;
    disciplineCount: number;
    highlights?: Array<{ category: string; severity: string; title: string; record_date: string }>;
  };
  teacher_remark?: string;
  teacher_remark_author?: string;
  principal_remark?: string;
  published_at?: string;
}

export interface ReportCardItem {
  id: string;
  report_type?: 'TERM' | 'SESSION';
  school_id: string;
  student_id: string;
  student_name?: string;
  admission_number?: string;
  class_id?: string | null;
  class_name?: string | null;
  academic_session_id: string;
  session_name?: string;
  term_id?: string;
  term_name?: string;
  examination_id?: string | null;
  status: ExamWorkflowStatus;
  total_score: number;
  average_score: number;
  subjects_count: number;
  terms_count?: number;
  class_position: number | null;
  class_size: number | null;
  promotion_status?: string | null;
  term_averages?: ReportCardBreakdown['term_averages'];
  teacher_remark?: string | null;
  principal_remark?: string | null;
  verification_code?: string | null;
  published_at?: string | null;
  overall_grade?: { grade: string; remark: string };
  breakdown?: ReportCardBreakdown | null;
}

export type SessionReportCardItem = ReportCardItem;

export interface AttendanceRecordItem {
  id: string;
  school_id: string;
  student_id: string;
  student_name?: string;
  admission_number?: string;
  class_id?: string | null;
  class_name?: string | null;
  academic_session_id?: string | null;
  session_name?: string | null;
  term_id?: string | null;
  term_name?: string | null;
  attendance_date: string;
  status: AttendanceStatus;
  notes?: string | null;
  is_published: number;
}

export interface AttendancePublicationItem {
  id: string;
  class_id?: string | null;
  class_name?: string | null;
  academic_session_id?: string | null;
  session_name?: string | null;
  term_id?: string | null;
  term_name?: string | null;
  status: string;
  published_at?: string | null;
  notes?: string | null;
}

export interface BehaviourRecordItem {
  id: string;
  school_id: string;
  student_id: string;
  student_name?: string;
  admission_number?: string;
  class_id?: string | null;
  class_name?: string | null;
  academic_session_id?: string | null;
  session_name?: string | null;
  term_id?: string | null;
  term_name?: string | null;
  record_date: string;
  category: BehaviourCategory;
  severity: BehaviourSeverity;
  title: string;
  description: string;
  action_taken?: string | null;
  admin_remarks?: string | null;
  visible_to_parent: number;
  visible_to_student: number;
  visible_to_teacher: number;
}

export interface TeacherRemarkItem {
  id: string;
  school_id: string;
  student_id: string;
  student_name?: string;
  admission_number?: string;
  class_id?: string | null;
  class_name?: string | null;
  academic_session_id: string;
  session_name?: string;
  term_id: string;
  term_name?: string;
  remark_text: string;
  staff_name?: string | null;
  visible_to_parent: number;
  visible_to_student: number;
  updated_at?: string;
}

export interface SchoolAnnouncementItem {
  id: string;
  school_id: string;
  title: string;
  content: string;
  audience: AnnouncementAudience;
  target_class_id?: string | null;
  target_class_name?: string | null;
  priority: AnnouncementPriority;
  is_confidential?: number;
  is_published: number;
  published_at?: string | null;
  created_by_name?: string | null;
  created_at?: string;
}

export interface PerformanceOverviewData {
  summary: {
    studentsAssessed: number;
    scoredEntriesCount: number;
    overallAveragePct: number;
    passRatePct: number;
    publishedExamsCount: number;
    draftExamsCount: number;
    reportCardsPublished: number;
    reportCardsTotal: number;
    attendanceRecordsCount: number;
    attendanceRatePct: number;
    positiveBehaviourCount: number;
    disciplineBehaviourCount: number;
  };
  classRankings: Array<{
    classId: string;
    className: string;
    studentsCount: number;
    entriesCount: number;
    averagePct: number;
    passRatePct: number;
  }>;
  subjectTrends: Array<{
    subjectId: string;
    subjectName: string;
    entriesCount: number;
    averagePct: number;
    minPct: number;
    maxPct: number;
    passRatePct: number;
  }>;
  termTrend: Array<{
    key: string;
    label: string;
    entriesCount: number;
    averagePct: number;
    passRatePct: number;
  }>;
  gradeDistribution: Array<{ grade: string; count: number }>;
  topStudents: Array<{
    studentId: string;
    studentName: string;
    admissionNumber: string;
    className: string;
    averagePct: number;
    attendancePct: number | null;
    count: number;
  }>;
  atRiskStudents: Array<{
    studentId: string;
    studentName: string;
    admissionNumber: string;
    className: string;
    averagePct: number;
    attendancePct: number | null;
    count: number;
  }>;
}

export interface PortalChildSummary {
  id: string;
  admission_number: string;
  full_name: string;
  first_name: string;
  last_name: string;
  gender?: string | null;
  class_id?: string | null;
  class_name?: string | null;
  class_arm_name?: string | null;
  student_status?: string;
  relationship_type?: string;
  is_primary_contact?: number;
}

export interface ParentDashboardData {
  school: School | null;
  settings: AcademicSettings;
  schools: Array<{
    school_id: string;
    school_name: string;
    school_status: string;
    role_name: string;
    role_display_name: string;
  }>;
  parentProfile?: {
    id: string;
    first_name: string;
    last_name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    occupation?: string | null;
    relationship?: string | null;
  } | null;
  sessions?: AcademicSessionItem[];
  children: PortalChildSummary[];
  selectedChild: PortalChildSummary | null;
  results: StudentScoreItem[];
  termTrend: Array<{ key: string; label: string; averagePct: number; subjectsCount: number }>;
  reportCards: ReportCardItem[];
  sessionReportCards?: SessionReportCardItem[];
  attendance: {
    summary: {
      totalDays: number;
      present: number;
      absent: number;
      late: number;
      excused: number;
      attendanceRatePct: number;
    };
    records: AttendanceRecordItem[];
  };
  behaviour: BehaviourRecordItem[];
  teacherRemarks: TeacherRemarkItem[];
  feeSummary: {
    totalBilledKobo: number;
    totalPaidKobo: number;
    outstandingKobo: number;
    totalBilledNaira: number;
    totalPaidNaira: number;
    outstandingNaira: number;
    invoicesCount: number;
    unpaidInvoicesCount: number;
  } | null;
  invoices: InvoiceDef[];
  payments: PaymentItem[];
  receipts: ReceiptItem[];
  gateways: GatewayStatus[];
  announcements: SchoolAnnouncementItem[];
  timetable?: TimetableSlotItem[];
  events?: SchoolCalendarEvent[];
  notifications: NotificationItem[];
}

export interface StudentDashboardData {
  school: School | null;
  settings: AcademicSettings;
  sessions?: AcademicSessionItem[];
  student: Student | null;
  results: StudentScoreItem[];
  termTrend: Array<{ key: string; label: string; averagePct: number; subjectsCount: number }>;
  reportCards: ReportCardItem[];
  sessionReportCards?: SessionReportCardItem[];
  attendance: {
    summary: {
      totalDays: number;
      present: number;
      absent: number;
      late: number;
      excused: number;
      attendanceRatePct: number;
    };
    records: AttendanceRecordItem[];
  };
  behaviour: BehaviourRecordItem[];
  teacherRemarks: TeacherRemarkItem[];
  feesVisible: boolean;
  feeSummary: ParentDashboardData['feeSummary'];
  invoices: InvoiceDef[];
  payments: PaymentItem[];
  receipts: ReceiptItem[];
  announcements: SchoolAnnouncementItem[];
  timetable?: TimetableSlotItem[];
  events?: SchoolCalendarEvent[];
  notifications: NotificationItem[];
}

export interface TeacherDashboardData {
  school: School | null;
  settings: AcademicSettings;
  schools: Array<{
    school_id: string;
    school_name: string;
    school_status: string;
    role_name: string;
    role_display_name: string;
  }>;
  sessions?: AcademicSessionItem[];
  teacherProfile: {
    user: User | null;
    staff: StaffItem | null;
  };
  assignedClasses: Array<{
    id: string;
    arm_id?: string;
    class_id: string;
    class_name: string;
    level: string;
    class_level?: string;
    arm_name: string;
    capacity: number;
    total_students: number;
    students_count?: number;
  }>;
  hasAssignedClasses: boolean;
  allClasses: Array<{
    id: string;
    name: string;
    level: string;
    total_students: number;
  }>;
  subjects: SubjectItem[];
  students: Student[];
  announcements: SchoolAnnouncementItem[];
  recentAdmissionsInquiries?: SchoolAdmissionInquiry[];
  notifications: NotificationItem[];
  stats: {
    studentsCount?: number;
    classesCount?: number;
    subjectsCount?: number;
    announcementsCount?: number;
    assignedClassesCount?: number;
    authorizedStudentsCount?: number;
    publishedExamsCount: number;
    reportCardsPublishedCount?: number;
    attendanceLogsCount?: number;
    lessonNotesCount?: number;
    confidentialNoticesCount?: number;
    newInquiriesCount?: number;
    unreadNotificationsCount?: number;
    teachersCanViewFees?: boolean;
  };
}

export interface PublicSchoolSummary {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  state: string;
  lga: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logo_url?: string | null;
  portal_subdomain?: string | null;
}

export interface PublicDocumentVerificationResult {
  valid: boolean;
  document_type: 'RECEIPT' | 'REPORT_CARD';
  school: {
    id: string;
    name: string;
    slug: string;
    state: string;
    lga: string;
  };
  details: Record<string, any>;
}

export interface BulkProvisionCredential {
  role: 'STUDENT' | 'PARENT';
  name: string;
  loginIdentifier: string;
  aliasIdentifier: string | null;
  temporaryPassword: string;
}

export type WebsiteThemeAccent = 'emerald' | 'navy' | 'indigo' | 'burgundy' | 'teal';

export interface SchoolWebsiteProfile {
  id: string;
  school_id: string;
  tagline?: string | null;
  hero_title?: string | null;
  hero_subtitle?: string | null;
  hero_image_url?: string | null;
  theme_accent: WebsiteThemeAccent;
  about_title?: string | null;
  about_body?: string | null;
  vision?: string | null;
  mission?: string | null;
  core_values?: string | null;
  principal_name?: string | null;
  principal_title?: string | null;
  principal_message?: string | null;
  principal_photo_url?: string | null;
  admissions_open: number;
  admissions_summary?: string | null;
  established_year?: string | null;
  facilities_text?: string | null;
  social_whatsapp?: string | null;
  social_facebook?: string | null;
  social_instagram?: string | null;
  is_published: number;
  updated_at?: string;
}

export interface SchoolWebsiteUrls {
  portal_subdomain: string;
  subdomainUrl: string;
  portalHashUrl: string;
  sitePathUrl: string;
}

export interface SchoolWebsitePost {
  id: string;
  school_id: string;
  title: string;
  slug: string;
  category: string;
  excerpt?: string | null;
  content: string;
  cover_image_url?: string | null;
  author_name?: string | null;
  author_role?: string | null;
  is_published: number;
  is_featured: number;
  published_at?: string | null;
  created_at?: string;
}

export interface SchoolWebsiteGalleryItem {
  id: string;
  school_id: string;
  title: string;
  caption?: string | null;
  album: string;
  image_url: string;
  is_published: number;
  display_order: number;
  created_at?: string;
}

export interface SchoolCalendarEvent {
  id: string;
  school_id?: string;
  title: string;
  event_date: string;
  end_date?: string | null;
  location?: string | null;
  description?: string | null;
  visibility: 'PUBLIC' | 'STAFF_ONLY';
  created_at?: string;
}

export interface SchoolAdmissionInquiry {
  id: string;
  school_id: string;
  student_name: string;
  target_class?: string | null;
  parent_name: string;
  parent_phone: string;
  parent_email?: string | null;
  message?: string | null;
  status: 'NEW' | 'CONTACTED' | 'ENROLLED' | 'ARCHIVED';
  admin_notes?: string | null;
  created_at?: string;
}

export interface PublicSchoolWebsiteData {
  school: PublicSchoolSummary;
  settings: {
    portal_subdomain: string;
    current_academic_session: string;
    current_term: string;
  };
  urls: SchoolWebsiteUrls;
  website: SchoolWebsiteProfile;
  posts: SchoolWebsitePost[];
  gallery: SchoolWebsiteGalleryItem[];
  events: SchoolCalendarEvent[];
  classes: Array<{ id: string; name: string; level?: string | null }>;
  cbtSummary?: {
    activeExamsCount: number;
    exams: Array<{
      id: string;
      title: string;
      subject_name: string;
      class_name: string;
      exam_mode: string;
      duration_minutes: number;
      starts_at?: string | null;
      ends_at?: string | null;
      total_questions: number;
    }>;
  };
  stats: {
    studentsCount: number;
    classesCount: number;
    staffCount: number;
  };
}

export type LessonNoteStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REVISION_REQUESTED';

export interface LessonNoteItem {
  id: string;
  school_id: string;
  teacher_user_id?: string | null;
  teacher_name?: string | null;
  subject_id?: string | null;
  subject_name: string;
  class_id?: string | null;
  class_name: string;
  academic_session_id?: string | null;
  term_name?: string | null;
  week_number: number;
  duration_minutes: number;
  topic: string;
  sub_topic?: string | null;
  behavioural_objectives?: string | null;
  previous_knowledge?: string | null;
  instructional_materials?: string | null;
  introduction_step?: string | null;
  presentation_steps?: string | null;
  evaluation_questions?: string | null;
  assignment_text?: string | null;
  teacher_notes?: string | null;
  status: LessonNoteStatus;
  admin_feedback?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TimetableSlotItem {
  id: string;
  school_id: string;
  class_id?: string | null;
  class_name: string;
  arm_name?: string | null;
  day_of_week: string;
  period_label?: string | null;
  start_time: string;
  end_time: string;
  subject_name: string;
  teacher_user_id?: string | null;
  teacher_name?: string | null;
  room_label?: string | null;
}

export interface StaffRequestItem {
  id: string;
  school_id: string;
  user_id: string;
  staff_name: string;
  request_type: 'LEAVE' | 'RESOURCES' | 'MAINTENANCE' | 'GENERAL';
  subject: string;
  details: string;
  start_date?: string | null;
  end_date?: string | null;
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
  admin_response?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at?: string;
}

export interface ConfidentialNoticeItem extends SchoolAnnouncementItem {
  my_read_at?: string | null;
  acknowledged_count?: number;
  is_acknowledged?: boolean;
  is_staff_confidential?: boolean;
}

// ============================================================================
// COMPUTER-BASED TESTING (CBT) EXAMINATION ENGINE
// ============================================================================

export type CbtExamStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED';
export type CbtExamMode = 'CA_TEST' | 'TERM_EXAM' | 'MOCK' | 'PRACTICE' | 'ENTRANCE';
export type CbtQuestionType = 'MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER';

export interface CbtExamItem {
  id: string;
  school_id: string;
  title: string;
  description?: string | null;
  instructions?: string | null;
  class_id?: string | null;
  class_name?: string | null;
  class_arm_id?: string | null;
  class_arm_name?: string | null;
  subject_id?: string | null;
  subject_name: string;
  academic_session_id?: string | null;
  term_id?: string | null;
  linked_examination_id?: string | null;
  sync_score_target: 'NONE' | 'CA' | 'EXAM';
  exam_mode: CbtExamMode;
  duration_minutes: number;
  total_marks: number;
  pass_mark_percent: number;
  max_attempts: number;
  shuffle_questions: number;
  shuffle_options: number;
  show_result_immediately: number;
  show_correct_answers: number;
  access_code?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  status: CbtExamStatus;
  created_by?: string | null;
  created_by_name?: string | null;
  question_count?: number;
  attempts_count?: number;
  completed_count?: number;
  avg_percentage?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface CbtQuestionItem {
  id: string;
  school_id?: string;
  cbt_exam_id: string;
  question_order: number;
  question_type: CbtQuestionType;
  question_text: string;
  question_image_url?: string | null;
  option_a?: string | null;
  option_b?: string | null;
  option_c?: string | null;
  option_d?: string | null;
  option_e?: string | null;
  correct_answer?: string;
  explanation?: string | null;
  marks: number;
}

export interface CbtAnswerEntry {
  selected?: string;
  flagged?: boolean;
  updated_at?: string;
}

export interface CbtStudentExamItem {
  id: string;
  title: string;
  description?: string | null;
  instructions?: string | null;
  subject_name: string;
  class_id?: string | null;
  class_name: string;
  exam_mode: CbtExamMode;
  duration_minutes: number;
  total_marks: number;
  pass_mark_percent: number;
  question_count: number;
  max_attempts: number;
  attempts_used: number;
  requires_access_code: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  show_result_immediately: boolean;
  show_correct_answers: boolean;
  not_yet_open: boolean;
  window_closed: boolean;
  can_start: boolean;
  active_attempt_id?: string | null;
  latest_submitted_attempt?: {
    id: string;
    status: string;
    submitted_at?: string | null;
    score_obtained: number | null;
    max_score: number | null;
    percentage: number | null;
    grade: string | null;
    passed: boolean | null;
  } | null;
}

export interface CbtStudentHistoryItem {
  id: string;
  cbt_exam_id: string;
  exam_title: string;
  subject_name: string;
  status: string;
  submitted_at?: string | null;
  time_spent_seconds: number;
  total_questions: number;
  answered_count: number;
  score_obtained: number | null;
  max_score: number | null;
  percentage: number | null;
  grade: string | null;
  passed: boolean | null;
  can_review: boolean;
  result_withheld: boolean;
}

export interface CbtStartSessionResponse {
  success: boolean;
  resumed?: boolean;
  auto_submitted?: boolean;
  message?: string;
  server_now?: string;
  remaining_seconds?: number;
  exam?: {
    id: string;
    title: string;
    subject_name: string;
    class_name: string;
    instructions?: string | null;
    duration_minutes: number;
    total_marks: number;
    show_result_immediately: boolean;
    show_correct_answers: boolean;
  };
  attempt?: {
    id: string;
    status: string;
    started_at?: string;
    expires_at?: string;
    tab_switch_count?: number;
    answers?: Record<string, CbtAnswerEntry>;
    score_obtained?: number | null;
    max_score?: number | null;
    percentage?: number | null;
    grade?: string | null;
  };
  questions?: CbtQuestionItem[];
}

export interface CbtReviewItem {
  question_id: string;
  question_order: number;
  question_type: CbtQuestionType;
  question_text: string;
  question_image_url?: string | null;
  option_a?: string | null;
  option_b?: string | null;
  option_c?: string | null;
  option_d?: string | null;
  option_e?: string | null;
  selected_answer: string | null;
  correct_answer: string;
  explanation?: string | null;
  marks: number;
  earned_marks: number;
  is_correct: boolean;
  flagged: boolean;
}

export interface CbtExamResultsResponse {
  success: boolean;
  exam: CbtExamItem;
  summary: {
    total_attempts: number;
    completed_count: number;
    in_progress_count: number;
    passed_count: number;
    pass_rate_percent: number;
    average_percentage: number;
    highest_percentage: number;
    lowest_percentage: number;
  };
  attempts: Array<{
    id: string;
    student_id: string;
    student_name: string;
    admission_number?: string | null;
    class_name?: string | null;
    attempt_number: number;
    status: string;
    started_at?: string | null;
    submitted_at?: string | null;
    time_spent_seconds: number;
    total_questions: number;
    answered_count: number;
    correct_count: number;
    wrong_count: number;
    score_obtained: number;
    max_score: number;
    percentage: number;
    grade?: string | null;
    passed: boolean;
    tab_switch_count: number;
    synced_to_report_card: boolean;
    synced_at?: string | null;
  }>;
  questionAnalytics: Array<{
    question_id: string;
    question_number: number;
    question_text: string;
    question_type: string;
    correct_answer: string;
    marks: number;
    answered_count: number;
    correct_count: number;
    accuracy_percent: number;
  }>;
}

export interface CbtParentResultItem {
  id: string;
  cbt_exam_id: string;
  student_id: string;
  student_name: string;
  admission_number?: string | null;
  class_name?: string | null;
  exam_title: string;
  subject_name: string;
  exam_mode: string;
  status: string;
  submitted_at?: string | null;
  time_spent_seconds: number;
  total_questions: number;
  correct_count: number;
  score_obtained: number;
  max_score: number;
  percentage: number;
  grade?: string | null;
  passed: boolean;
  can_review: boolean;
}


