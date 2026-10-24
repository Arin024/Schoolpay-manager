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
  email: string;
  phone: string;
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


