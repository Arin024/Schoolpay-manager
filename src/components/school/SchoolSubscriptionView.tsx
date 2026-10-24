import React, { useEffect, useState } from 'react';
import {
  Shield,
  CreditCard,
  Building2,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  Users,
  Briefcase,
  Layers,
  ArrowRight,
  ExternalLink,
  Download,
  Printer,
  RefreshCw,
  FileText,
  AlertCircle,
  HelpCircle,
  X,
  Send,
  Zap,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import { SchoolSubscription, SubscriptionPlan, PlatformInvoice, PlatformPayment } from '../../types/index.js';
import { SchoolStatusBadge } from '../common/StatusBadge.js';
import { PrintableSaaSInvoiceModal } from './PrintableSaaSInvoiceModal.js';

export const SchoolSubscriptionView: React.FC = () => {
  const { activeSchool, activeSchoolId, activeRole } = useAuth();

  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<SchoolSubscription | null>(null);
  const [usage, setUsage] = useState<{ students: number; staff: number }>({ students: 0, staff: 0 });
  const [platformSettings, setPlatformSettings] = useState<any>(null);
  const [availablePlans, setAvailablePlans] = useState<SubscriptionPlan[]>([]);
  const [invoices, setInvoices] = useState<PlatformInvoice[]>([]);
  const [payments, setPayments] = useState<PlatformPayment[]>([]);

  // Modals & Actions
  const [selectedInvoice, setSelectedInvoice] = useState<PlatformInvoice | null>(null);
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [isBankTransferModalOpen, setIsBankTransferModalOpen] = useState(false);
  const [selectedPlanForUpgrade, setSelectedPlanForUpgrade] = useState<SubscriptionPlan | null>(null);

  // Checkout flow state
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState<{
    checkoutUrl?: string;
    internalReference: string;
    finalAmountNaira: number;
  } | null>(null);

  // Bank transfer form state
  const [bankForm, setBankForm] = useState<{
    bank_name: string;
    depositor_name: string;
    transaction_reference: string;
    amount_naira: string;
    notes: string;
    receipt_file: string | null;
    receipt_filename: string;
  }>({
    bank_name: 'Zenith Bank',
    depositor_name: '',
    transaction_reference: '',
    amount_naira: '',
    notes: '',
    receipt_file: null,
    receipt_filename: '',
  });
  const [bankSubmitLoading, setBankSubmitLoading] = useState(false);
  const [bankSuccessMsg, setBankSuccessMsg] = useState<string | null>(null);
  const [bankErrorMsg, setBankErrorMsg] = useState<string | null>(null);

  const canManageBilling = ['SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR', 'SUPER_ADMIN'].includes(
    activeRole?.role_name || ''
  );

  const loadData = async () => {
    if (!activeSchoolId) return;
    setLoading(true);
    try {
      const [subData, historyData] = await Promise.all([
        api.getSchoolSubscription(activeSchoolId),
        api.getSchoolBillingHistory(activeSchoolId),
      ]);

      setSubscription(subData.subscription);
      setUsage(subData.usage);
      setPlatformSettings(subData.platformSettings);
      setAvailablePlans(subData.availablePlans);
      setInvoices(historyData.invoices);
      setPayments(historyData.payments);
    } catch (err: any) {
      console.error('Failed to load subscription data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeSchoolId]);

  // Initiate Bachs.io Checkout Session
  const handleInitiateCheckout = async (plan: SubscriptionPlan) => {
    if (!activeSchoolId) return;
    setSelectedPlanForUpgrade(plan);
    setCheckoutLoading(true);
    setCheckoutResult(null);
    setIsCheckoutModalOpen(true);

    try {
      const res = await api.initiateSaaSCheckout(activeSchoolId, {
        plan_id: plan.id,
      });
      setCheckoutResult(res);
    } catch (err: any) {
      alert(err.message || 'Failed to initiate Bachs checkout');
      setIsCheckoutModalOpen(false);
    } finally {
      setCheckoutLoading(false);
    }
  };

  // Submit Manual Bank Transfer Proof
  const handleBankTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSchoolId || !selectedPlanForUpgrade) return;

    if (!bankForm.depositor_name) {
      setBankErrorMsg('Please enter the Depositor Name.');
      return;
    }
    if (!bankForm.receipt_file && !bankForm.transaction_reference) {
      setBankErrorMsg('Please upload a transfer receipt (Screenshot/Photo/PDF) or enter a transaction reference.');
      return;
    }

    setBankSubmitLoading(true);
    setBankErrorMsg(null);
    setBankSuccessMsg(null);

    try {
      const res = await api.submitSaaSTransferProof(activeSchoolId, {
        plan_id: selectedPlanForUpgrade.id,
        bank_name: bankForm.bank_name,
        depositor_name: bankForm.depositor_name,
        transaction_reference: bankForm.transaction_reference || `TRF-${Date.now().toString().slice(-6)}`,
        amount_naira: bankForm.amount_naira ? Number(bankForm.amount_naira) : undefined,
        notes: bankForm.notes,
        receipt_file: bankForm.receipt_file || undefined,
        receipt_filename: bankForm.receipt_filename || undefined,
      });

      setBankSuccessMsg(res.message);
      setBankForm({
        bank_name: 'Zenith Bank',
        depositor_name: '',
        transaction_reference: '',
        amount_naira: '',
        notes: '',
        receipt_file: null,
        receipt_filename: '',
      });
      await loadData();
    } catch (err: any) {
      setBankErrorMsg(err.message || 'Failed to submit payment proof');
    } finally {
      setBankSubmitLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-sm">
        <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto mb-3" />
        <p className="text-sm font-semibold text-slate-700">Loading subscription and billing data...</p>
      </div>
    );
  }

  const currentPlan = availablePlans.find((p) => p.id === (subscription?.plan_id || activeSchool?.current_plan_id));
  const studentLimit = currentPlan?.maximum_students || currentPlan?.student_limit || 200;
  const staffLimit = currentPlan?.maximum_staff || currentPlan?.staff_limit || 25;

  const studentPercent = Math.min(100, Math.round((usage.students / studentLimit) * 100));
  const staffPercent = Math.min(100, Math.round((usage.staff / staffLimit) * 100));

  const isGracePeriod = activeSchool?.status === 'GRACE_PERIOD';
  const isTrial = activeSchool?.status === 'TRIAL';
  const isSuspendedOrExpired = ['SUSPENDED', 'EXPIRED', 'CANCELLED'].includes(activeSchool?.status || '');

  return (
    <div className="space-y-8">
      {/* 1. Header & Status Banner */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border-2 border-slate-200 flex items-center justify-center text-emerald-400 font-black text-2xl shadow-inner flex-shrink-0">
              <Shield className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase font-bold tracking-wider text-slate-400">BursarIQ SaaS</span>
                <SchoolStatusBadge status={activeSchool?.status || 'TRIAL'} size="sm" />
              </div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-0.5">
                Subscription &amp; Platform Billing
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Authoritative SaaS plan limits, renewal schedule, and verified transaction receipts.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={loadData}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold transition cursor-pointer"
            >
              <RefreshCw className="w-4 h-4 text-slate-500" />
              <span>Refresh Status</span>
            </button>
          </div>
        </div>

        {/* Warning Alerts for Grace Period or Trial */}
        {isGracePeriod && (
          <div className="mt-6 p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Subscription In Grace Period</p>
              <p className="text-amber-800 mt-0.5">
                Your school subscription has passed its regular expiry date. Please complete payment within the {subscription?.grace_period_days || 7}-day grace window to maintain uninterrupted bursary operations.
              </p>
            </div>
          </div>
        )}

        {isSuspendedOrExpired && (
          <div className="mt-6 p-4 rounded-2xl bg-red-50 border border-red-300 text-red-900 text-xs flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Account Access Restricted ({activeSchool?.status})</p>
              <p className="text-red-800 mt-0.5">
                Normal operations are restricted because your subscription has lapsed. School and student records remain completely safe and intact. Renew below to instantly reactivate full access.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 2. Active Subscription Card & Limits Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Plan Overview Card */}
        <div className="bg-slate-900 text-white rounded-3xl p-6 sm:p-8 flex flex-col justify-between shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <span className="text-[11px] uppercase font-bold tracking-widest text-emerald-400">Current Entitlement</span>
              <span className="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 font-mono font-semibold">
                {currentPlan?.billing_interval || 'ANNUAL'}
              </span>
            </div>

            <h2 className="text-2xl font-black text-white mt-4">
              {currentPlan?.display_name || subscription?.plan_display_name || 'Standard Plan'}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {currentPlan?.description || 'Full-featured school management, online fee collections and receipts.'}
            </p>

            <div className="mt-6 p-4 rounded-2xl bg-slate-800/80 border border-slate-700/80">
              <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Authoritative Charge Price</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-black text-emerald-400">
                  ₦{(subscription?.final_amount_naira || currentPlan?.price_naira || 0).toLocaleString()}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  / {(currentPlan?.billing_interval || 'year').toLowerCase()}
                </span>
              </div>
              {subscription?.negotiated_price_naira !== null && subscription?.negotiated_price_naira !== undefined && (
                <div className="mt-2 pt-2 border-t border-slate-700/60 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Custom Negotiated Rate:</span>
                  <span className="text-emerald-300 font-semibold font-mono">
                    ₦{subscription.negotiated_price_naira.toLocaleString()}
                  </span>
                </div>
              )}
              {subscription && typeof subscription.discount_amount_naira === 'number' && subscription.discount_amount_naira > 0 && (
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Promotional Discount:</span>
                  <span className="text-emerald-300 font-semibold font-mono">
                    -₦{subscription.discount_amount_naira.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-emerald-400" />
              <span>Expires: <strong className="text-white">{subscription?.end_date || activeSchool?.subscription_end_date || 'N/A'}</strong></span>
            </div>
            {subscription?.auto_renew === 1 ? (
              <span className="text-emerald-400 font-semibold">Auto-Renew: ON</span>
            ) : (
              <span className="text-slate-500 font-semibold">Manual Renewal</span>
            )}
          </div>
        </div>

        {/* Real-time Usage Limits */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-sm">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-emerald-600" />
              <span>Tenant Usage &amp; Capacity</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Backend-enforced quotas. Upgrades apply immediately without restart.
            </p>
          </div>

          {/* Student limit progress */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-slate-400" />
                <span>Enrolled Students</span>
              </span>
              <span className="font-mono font-bold text-slate-900">
                {usage.students} / {studentLimit}
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  studentPercent > 90 ? 'bg-amber-500' : 'bg-emerald-600'
                }`}
                style={{ width: `${studentPercent}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-400">
              {studentPercent}% capacity used. Maximum limit strictly enforced.
            </p>
          </div>

          {/* Staff limit progress */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                <Briefcase className="w-4 h-4 text-slate-400" />
                <span>Active Staff &amp; Bursars</span>
              </span>
              <span className="font-mono font-bold text-slate-900">
                {usage.staff} / {staffLimit}
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  staffPercent > 90 ? 'bg-amber-500' : 'bg-emerald-600'
                }`}
                style={{ width: `${staffPercent}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-400">
              {staffPercent}% capacity used.
            </p>
          </div>

          {/* Cloud Storage Limit */}
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
            <span className="text-slate-600 font-semibold">Document &amp; Photo Storage</span>
            <span className="font-mono font-bold text-slate-800">
              {currentPlan?.storage_limit_mb || 1000} MB Allocated
            </span>
          </div>
        </div>

        {/* Enabled Features Checklist */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-4 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-emerald-600" />
              <span>Included SaaS Modules</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Modules activated for this school tier by platform super admin.
            </p>
          </div>

          <div className="space-y-2 text-xs">
            {[
              { label: 'Student Admissions & Bio Data', enabled: true },
              { label: 'Classes, Arms & Promotion Engine', enabled: true },
              { label: 'Tuition Fee Structure & Invoicing', enabled: true },
              { label: 'Online Payment Gateway (Bachs / Paystack)', enabled: true },
              { label: 'Official Receipt Generation & PDF Printing', enabled: true },
              { label: 'Bank Transfer & POS Verification', enabled: true },
              { label: 'Automated SMS / Email Notifications', enabled: true },
              { label: 'Tenant Isolation Guard & Auditing', enabled: true },
            ].map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-slate-700">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span>{f.label}</span>
              </div>
            ))}
          </div>

          <div className="pt-2 text-[11px] text-slate-400">
            Need custom modules or white-labeling? Contact Super Admin.
          </div>
        </div>
      </div>

      {/* 3. Available SaaS Subscription Plans (Dynamic Pricing Engine) */}
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Zap className="w-6 h-6 text-emerald-600" />
            <span>Available Subscription Plans</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Choose a plan tailored to your student body size. Instant online checkout or manual direct bank transfer.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {availablePlans.map((plan) => {
            const isCurrent = (subscription?.plan_id || activeSchool?.current_plan_id) === plan.id;

            return (
              <div
                key={plan.id}
                className={`bg-white rounded-3xl border p-6 flex flex-col justify-between transition-all duration-200 relative ${
                  isCurrent
                    ? 'border-emerald-500 shadow-md ring-2 ring-emerald-500/20'
                    : 'border-slate-200 shadow-sm hover:border-slate-300 hover:shadow'
                }`}
              >
                {isCurrent && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-emerald-600 text-white font-bold text-[10px] uppercase tracking-wider shadow">
                    Active Plan
                  </span>
                )}

                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <h3 className="font-bold text-slate-900 text-base">{plan.display_name}</h3>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">
                      {plan.billing_interval}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 mt-2 min-h-[36px]">{plan.description}</p>

                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-black text-slate-900">
                        ₦{plan.price_naira.toLocaleString()}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        / {plan.billing_interval.toLowerCase()}
                      </span>
                    </div>
                  </div>

                  <div className="mt-5 space-y-2 text-xs text-slate-600">
                    <div className="flex items-center justify-between">
                      <span>Max Students:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {plan.maximum_students || plan.student_limit}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Max Staff:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {plan.maximum_staff || plan.staff_limit}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Admin Users:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {plan.maximum_admin_users || 5}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 space-y-2">
                  <button
                    onClick={() => handleInitiateCheckout(plan)}
                    disabled={!canManageBilling}
                    className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer ${
                      isCurrent
                        ? 'bg-slate-900 text-white hover:bg-slate-800'
                        : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm'
                    } disabled:opacity-50`}
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>{isCurrent ? 'Renew via Bachs.io' : 'Switch & Pay (Bachs)'}</span>
                  </button>

                  <button
                    onClick={() => {
                      setSelectedPlanForUpgrade(plan);
                      setIsBankTransferModalOpen(true);
                    }}
                    disabled={!canManageBilling}
                    className="w-full py-2 px-3 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <Building2 className="w-3.5 h-3.5 text-slate-500" />
                    <span>Direct Bank Transfer</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Billing History & Official SaaS Invoices */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-600" />
              <span>SaaS Billing &amp; Invoice History</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Official commercial invoices and automated platform payment receipts issued to your school.
            </p>
          </div>
        </div>

        {invoices.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 text-slate-500 text-xs">
            No platform subscription invoices issued yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] tracking-wider font-bold">
                <tr>
                  <th className="py-3 px-4">Invoice #</th>
                  <th className="py-3 px-4">Plan</th>
                  <th className="py-3 px-4">Period</th>
                  <th className="py-3 px-4 text-right">Standard</th>
                  <th className="py-3 px-4 text-right">Discount</th>
                  <th className="py-3 px-4 text-right">Final Amount</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-900">{inv.invoice_number}</td>
                    <td className="py-3.5 px-4 font-semibold">{inv.plan_display_name || 'Standard Tier'}</td>
                    <td className="py-3.5 px-4 text-slate-500">{inv.billing_period || inv.issue_date}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-500">
                      ₦{inv.standard_price_naira.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-emerald-600">
                      {inv.discount_naira > 0 ? `-₦${inv.discount_naira.toLocaleString()}` : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                      ₦{inv.final_amount_naira.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        inv.payment_status === 'PAID'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {inv.payment_status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => setSelectedInvoice(inv)}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold transition cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5 text-slate-600" />
                        <span>View / Print</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. Bachs.io Checkout Modal */}
      {isCheckoutModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-200 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-base">Bachs.io Checkout</h3>
              </div>
              <button
                onClick={() => setIsCheckoutModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {checkoutLoading ? (
              <div className="py-12 text-center space-y-3">
                <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
                <p className="text-sm font-semibold text-slate-700">Connecting to Bachs payment gateway...</p>
                <p className="text-xs text-slate-400">Retrieving authoritative server-side charge amount.</p>
              </div>
            ) : checkoutResult ? (
              <div className="space-y-6">
                <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-3">
                  <div className="flex justify-between items-center text-xs text-slate-400">
                    <span>Plan:</span>
                    <span className="text-white font-bold">{selectedPlanForUpgrade?.display_name}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-slate-400">
                    <span>Payment Ref:</span>
                    <span className="text-emerald-400 font-mono font-bold">{checkoutResult.internalReference}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-800 flex justify-between items-baseline">
                    <span className="text-xs font-semibold text-slate-300">Total Charge:</span>
                    <span className="text-2xl font-black text-emerald-400 font-mono">
                      ₦{checkoutResult.finalAmountNaira.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {checkoutResult.checkoutUrl && (
                    <a
                      href={checkoutResult.checkoutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 transition shadow cursor-pointer text-center"
                    >
                      <span>Proceed to Bachs.io Secure Payment</span>
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}

                  <p className="text-center text-xs text-slate-400">
                    Once payment is completed, the webhook automatically verifies and extends your subscription in real time.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* 6. Manual Bank Transfer Modal */}
      {isBankTransferModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-200 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-base">Direct Bank Transfer</h3>
              </div>
              <button
                onClick={() => {
                  setIsBankTransferModalOpen(false);
                  setBankSuccessMsg(null);
                  setBankErrorMsg(null);
                }}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Official BursarIQ SaaS Subscription Payment Accounts */}
            <div className="space-y-3">
              {/* Preferred: Zenith Bank */}
              <div className="p-4 rounded-xl bg-emerald-50 border-2 border-emerald-500 shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-black text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-full bg-emerald-700 text-white text-[10px] font-bold">PREFERRED</span>
                    Zenith Bank (Bank Transfer)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(platformSettings?.platform_account_number || '2208744650');
                      alert('Zenith Bank account number copied: ' + (platformSettings?.platform_account_number || '2208744650'));
                    }}
                    className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-[10px] font-bold transition shadow-xs cursor-pointer"
                  >
                    Copy Account No
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[10px] text-emerald-700 font-semibold block">Bank Name:</span>
                    <span className="font-bold text-emerald-950 text-sm">{platformSettings?.platform_bank_name || 'Zenith Bank'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-emerald-700 font-semibold block">Account Number:</span>
                    <span className="font-mono font-black text-base text-emerald-950 tracking-wider">
                      {platformSettings?.platform_account_number || '2208744650'}
                    </span>
                  </div>
                  <div className="sm:col-span-2 pt-1.5 border-t border-emerald-200">
                    <span className="text-[10px] text-emerald-700 font-semibold block">Beneficiary Account Name:</span>
                    <span className="font-black text-emerald-950">{platformSettings?.platform_account_name || 'Nwajiaku Arinze Christian'}</span>
                  </div>
                </div>
              </div>

              {/* Alternative: OPay */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-300 shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-full bg-slate-700 text-white text-[10px] font-bold">ALTERNATIVE</span>
                    OPay Digital Payment
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(platformSettings?.opay_account_number || '8160754659');
                      alert('OPay account number copied: ' + (platformSettings?.opay_account_number || '8160754659'));
                    }}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-[10px] font-bold transition shadow-xs cursor-pointer"
                  >
                    Copy OPay No
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-600 font-semibold block">Payment Method:</span>
                    <span className="font-bold text-slate-900 text-sm">OPay</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-600 font-semibold block">OPay Account Number:</span>
                    <span className="font-mono font-black text-base text-slate-900 tracking-wider">
                      {platformSettings?.opay_account_number || '8160754659'}
                    </span>
                  </div>
                  <div className="sm:col-span-2 pt-1.5 border-t border-slate-200">
                    <span className="text-[10px] text-slate-600 font-semibold block">OPay Account Name:</span>
                    <span className="font-black text-slate-900">{platformSettings?.opay_account_name || 'Nwajiaku Arinzechukwu Christian'}</span>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 italic">
                * Important: These details are solely for BursarIQ SaaS subscriptions. Student school fees must be paid directly into your school's designated bank accounts.
              </p>
            </div>

            {bankSuccessMsg && (
              <div className="p-4 rounded-xl bg-emerald-100 border border-emerald-300 text-emerald-900 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 flex-shrink-0" />
                <span>{bankSuccessMsg}</span>
              </div>
            )}

            {bankErrorMsg && (
              <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                <span>{bankErrorMsg}</span>
              </div>
            )}

            <form onSubmit={handleBankTransferSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Target Plan</label>
                <input
                  type="text"
                  readOnly
                  value={`${selectedPlanForUpgrade?.display_name || 'Selected Plan'} (₦${(selectedPlanForUpgrade?.price_naira || 0).toLocaleString()})`}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-xs font-semibold cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">Depositor Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Chief O. Adeleke / Saint Joseph Academy"
                  value={bankForm.depositor_name}
                  onChange={(e) => setBankForm({ ...bankForm, depositor_name: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-xs focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1.5 flex items-center justify-between">
                  <span>Upload Payment Receipt (Photo, Screenshot, or PDF) *</span>
                  <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">Instant Super Admin Delivery</span>
                </label>
                
                <div className="relative border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-xl p-4 text-center bg-slate-50 hover:bg-emerald-50/20 transition cursor-pointer">
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 8 * 1024 * 1024) {
                        setBankErrorMsg('File size exceeds 8MB. Please select a smaller photo or PDF receipt.');
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = (uploadEvt) => {
                        const dataUrl = uploadEvt.target?.result as string;
                        setBankForm(prev => ({
                          ...prev,
                          receipt_file: dataUrl,
                          receipt_filename: file.name,
                          transaction_reference: prev.transaction_reference || `REC-${Date.now().toString().slice(-6)}`
                        }));
                      };
                      reader.readAsDataURL(file);
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  
                  {bankForm.receipt_file ? (
                    <div className="flex items-center justify-center gap-2 text-emerald-800 font-bold text-xs py-1">
                      <span className="text-xl">📄</span>
                      <span className="truncate max-w-[220px]">{bankForm.receipt_filename || 'Receipt Attached'}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">Attached ✓</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-1.5 py-1">
                      <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm shadow-xs">
                        📷
                      </div>
                      <p className="text-xs font-bold text-slate-800">
                        Tap here to select Receipt from Gallery or Files
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Accepts Camera Snap, Screenshot, or PDF document
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-2">
                  <input
                    type="text"
                    placeholder="Transaction Reference / Session ID (Optional if receipt is uploaded)"
                    value={bankForm.transaction_reference}
                    onChange={(e) => setBankForm({ ...bankForm, transaction_reference: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-[11px] focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Amount Transferred (₦)</label>
                <input
                  type="number"
                  placeholder={String(selectedPlanForUpgrade?.price_naira || 0)}
                  value={bankForm.amount_naira}
                  onChange={(e) => setBankForm({ ...bankForm, amount_naira: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-900 text-xs font-mono focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Additional Notes</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Paid from GTBank corporate account."
                  value={bankForm.notes}
                  onChange={(e) => setBankForm({ ...bankForm, notes: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-slate-900 text-xs focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={bankSubmitLoading}
                className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
              >
                {bankSubmitLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span>Submit Bank Transfer for Verification</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 7. Printable SaaS Invoice Modal */}
      {selectedInvoice && (
        <PrintableSaaSInvoiceModal
          invoice={selectedInvoice}
          platformSettings={platformSettings}
          onClose={() => setSelectedInvoice(null)}
        />
      )}
    </div>
  );
};
