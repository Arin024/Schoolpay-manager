import React, { useEffect, useState } from 'react';
import {
  CreditCard,
  Plus,
  Search,
  Printer,
  FileText,
  DollarSign,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  Layers,
  Calendar,
  Building2,
  Download,
  Percent,
  X,
  Filter,
  Users,
  ChevronRight,
  ShieldCheck,
  Tag,
  Receipt,
  FileSpreadsheet,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import {
  InvoiceDef,
  PaymentItem,
  FeeCategoryItem,
  FeeStructureDef,
  FinancialStatsDef,
  ClassItem,
  AcademicSessionItem,
  TermItem,
  Student,
} from '../../types/index.js';
import { PrintableInvoiceModal } from './PrintableInvoiceModal.js';

export const SchoolFinanceView: React.FC = () => {
  const { activeSchool: currentSchool, user } = useAuth();
  const [activeTab, setActiveTab] = useState<
    'overview' | 'invoices' | 'payments' | 'structures' | 'categories' | 'reports'
  >('overview');

  // Core Data
  const [stats, setStats] = useState<FinancialStatsDef | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDef[]>([]);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [categories, setCategories] = useState<FeeCategoryItem[]>([]);
  const [structures, setStructures] = useState<FeeStructureDef[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [sessions, setSessions] = useState<AcademicSessionItem[]>([]);

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');

  // Loading & Error States
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDef | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // Payment Modal
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<InvoiceDef | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'BANK_TRANSFER' | 'POS' | 'CASH' | 'ONLINE' | 'CHEQUE'>('BANK_TRANSFER');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payNotes, setPayNotes] = useState('');

  // Discount / Scholarship Modal
  const [isDiscountModalOpen, setIsDiscountModalOpen] = useState(false);
  const [discountInvoice, setDiscountInvoice] = useState<InvoiceDef | null>(null);
  const [discountType, setDiscountType] = useState<'FIXED' | 'PERCENTAGE' | 'SCHOLARSHIP' | 'WAIVER'>('SCHOLARSHIP');
  const [discountVal, setDiscountVal] = useState('');
  const [discountReason, setDiscountReason] = useState('');

  // Create Invoice Modal
  const [isCreateInvoiceModalOpen, setIsCreateInvoiceModalOpen] = useState(false);
  const [newInvStudentId, setNewInvStudentId] = useState('');
  const [newInvDueDate, setNewInvDueDate] = useState('');
  const [newInvNotes, setNewInvNotes] = useState('');
  const [newInvItems, setNewInvItems] = useState<Array<{ categoryId: string; desc: string; qty: number; unit: string }>>([
    { categoryId: '', desc: 'Tuition Fee', qty: 1, unit: '120000' },
  ]);

  // Bulk Generate Modal
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkFsId, setBulkFsId] = useState('');
  const [bulkClassId, setBulkClassId] = useState('');
  const [bulkDueDate, setBulkDueDate] = useState('');

  // Create Fee Structure Modal
  const [isStructureModalOpen, setIsStructureModalOpen] = useState(false);
  const [fsName, setFsName] = useState('');
  const [fsDesc, setFsDesc] = useState('');
  const [fsClassId, setFsClassId] = useState('');
  const [fsItems, setFsItems] = useState<Array<{ categoryId: string; amount: string; compulsory: boolean; desc: string }>>([
    { categoryId: '', amount: '100000', compulsory: true, desc: 'Core Tuition' },
  ]);

  // Create Fee Category Modal
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');

  // Reports Summary
  const [reportData, setReportData] = useState<{
    classRevenue: any[];
    categoryRevenue: any[];
    paymentMethods: any[];
  } | null>(null);

  const fetchFinanceData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [statsRes, invRes, payRes, catRes, fsRes, classRes, stuRes, sesRes] = await Promise.all([
        api.getFinancialDashboardStats().catch(() => ({ stats: null })),
        api.getInvoices({ limit: 100 }).catch(() => ({ invoices: [], total: 0 })),
        api.getPayments({}).catch(() => ({ payments: [] })),
        api.getFeeCategories().catch(() => ({ categories: [] })),
        api.getFeeStructures().catch(() => ({ feeStructures: [] })),
        api.getSchoolClasses().catch(() => ({ classes: [] })),
        api.getSchoolStudents({ limit: 100 }).catch(() => ({ students: [] })),
        api.getSchoolAcademicSessions().catch(() => ({ sessions: [] })),
      ]);

      if (statsRes.stats) setStats(statsRes.stats);
      setInvoices(invRes.invoices || []);
      setPayments(payRes.payments || []);
      setCategories(catRes.categories || []);
      setStructures(fsRes.feeStructures || []);
      setClasses(classRes.classes || []);
      setStudents(stuRes.students || []);
      setSessions(sesRes.sessions || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load financial records.');
    } finally {
      setLoading(false);
    }
  };

  const fetchReports = async () => {
    try {
      const repRes = await api.getFinancialReportsSummary();
      setReportData(repRes);
    } catch (err: any) {
      console.error('Failed to load reports:', err);
    }
  };

  useEffect(() => {
    fetchFinanceData();
  }, [currentSchool?.id]);

  useEffect(() => {
    if (activeTab === 'reports') {
      fetchReports();
    }
  }, [activeTab]);

  // Handle Recording Payment
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentInvoice) return;
    try {
      setActionLoading(true);
      setError(null);
      const res = await api.recordInvoicePayment(paymentInvoice.id, {
        amount: parseFloat(payAmount),
        payment_method: payMethod,
        payment_date: payDate,
        notes: payNotes,
      });
      setSuccessMsg(`Payment of ₦${parseFloat(payAmount).toLocaleString()} recorded successfully for ${paymentInvoice.invoice_number}`);
      setIsPaymentModalOpen(false);
      setPayAmount('');
      setPayNotes('');
      fetchFinanceData();
    } catch (err: any) {
      setError(err.message || 'Payment recording failed.');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Applying Discount
  const handleApplyDiscount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!discountInvoice) return;
    try {
      setActionLoading(true);
      setError(null);
      await api.applyInvoiceDiscount(discountInvoice.id, {
        type: discountType,
        amount: discountType !== 'PERCENTAGE' ? parseFloat(discountVal) : undefined,
        percentage: discountType === 'PERCENTAGE' ? parseFloat(discountVal) : undefined,
        reason: discountReason,
      });
      setSuccessMsg(`Discount applied successfully to ${discountInvoice.invoice_number}`);
      setIsDiscountModalOpen(false);
      setDiscountVal('');
      setDiscountReason('');
      fetchFinanceData();
    } catch (err: any) {
      setError(err.message || 'Failed to apply discount.');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Creating Invoice
  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setActionLoading(true);
      setError(null);
      await api.createInvoice({
        student_id: newInvStudentId,
        due_date: newInvDueDate,
        notes: newInvNotes,
        items: newInvItems.map((it) => ({
          fee_category_id: it.categoryId || undefined,
          description: it.desc,
          quantity: it.qty,
          unit_amount: parseFloat(it.unit) || 0,
        })),
      });
      setSuccessMsg('Invoice generated successfully.');
      setIsCreateInvoiceModalOpen(false);
      setNewInvStudentId('');
      setNewInvDueDate('');
      setNewInvNotes('');
      fetchFinanceData();
    } catch (err: any) {
      setError(err.message || 'Failed to create invoice.');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Bulk Generate
  const handleBulkGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setActionLoading(true);
      setError(null);
      const res = await api.bulkGenerateInvoices({
        fee_structure_id: bulkFsId,
        class_id: bulkClassId,
        due_date: bulkDueDate,
      });
      setSuccessMsg(`Batch generation complete: ${res.count} invoices created.`);
      setIsBulkModalOpen(false);
      setBulkDueDate('');
      fetchFinanceData();
    } catch (err: any) {
      setError(err.message || 'Bulk invoice generation failed.');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Create Fee Structure
  const handleCreateStructure = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setActionLoading(true);
      setError(null);
      await api.createFeeStructure({
        name: fsName,
        description: fsDesc,
        class_id: fsClassId || undefined,
        items: fsItems.map((it) => ({
          fee_category_id: it.categoryId,
          amount: parseFloat(it.amount) || 0,
          compulsory: it.compulsory,
          description: it.desc,
        })),
      });
      setSuccessMsg('Fee structure template created successfully.');
      setIsStructureModalOpen(false);
      setFsName('');
      setFsDesc('');
      fetchFinanceData();
    } catch (err: any) {
      setError(err.message || 'Failed to create fee structure.');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Create Category
  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setActionLoading(true);
      setError(null);
      await api.createFeeCategory({
        name: newCatName,
        description: newCatDesc,
      });
      setSuccessMsg('Fee category created.');
      setIsCategoryModalOpen(false);
      setNewCatName('');
      setNewCatDesc('');
      fetchFinanceData();
    } catch (err: any) {
      setError(err.message || 'Failed to create fee category.');
    } finally {
      setActionLoading(false);
    }
  };

  // View & Print invoice
  const handleViewInvoice = async (inv: InvoiceDef) => {
    try {
      const full = await api.getInvoice(inv.id);
      setSelectedInvoice(full.invoice);
      setIsPrintModalOpen(true);
    } catch (err) {
      setSelectedInvoice(inv);
      setIsPrintModalOpen(true);
    }
  };

  // Filtered invoices
  const filteredInvoices = invoices.filter((inv) => {
    if (statusFilter && inv.status !== statusFilter) return false;
    if (classFilter && inv.class_id !== classFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchInv = inv.invoice_number.toLowerCase().includes(q);
      const matchName = (inv.student_name || '').toLowerCase().includes(q);
      const matchAdm = (inv.admission_number || '').toLowerCase().includes(q);
      if (!matchInv && !matchName && !matchAdm) return false;
    }
    return true;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PAID':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
            <CheckCircle2 className="w-3 h-3" /> Paid
          </span>
        );
      case 'PARTIALLY_PAID':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
            <Clock className="w-3 h-3" /> Partial
          </span>
        );
      case 'OVERDUE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800">
            <AlertCircle className="w-3 h-3" /> Overdue
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-200 text-slate-700">
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
            Issued
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between text-rose-800 text-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-emerald-800 text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Header & Tenant Identifier */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-blue-600 uppercase">
            <CreditCard className="w-4 h-4" /> Fees & Financial Management (Step 3)
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight mt-1">
            {currentSchool?.name} Bursary & Billing
          </h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Deterministic zero-float integer calculations &bull; Multi-tenant isolated ledger &bull; Automated reconciliation
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsCreateInvoiceModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Issue Invoice
          </button>
          <button
            onClick={() => setIsBulkModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
          >
            <Layers className="w-4 h-4" /> Bulk Class Invoices
          </button>
          <a
            href="/api/v1/school/finance/reports/export-csv?type=invoices"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> CSV Export
          </a>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex flex-wrap gap-1 bg-slate-100/80 p-1.5 rounded-2xl border border-slate-200">
        {[
          { id: 'overview', label: 'Financial Overview', icon: TrendingUp },
          { id: 'invoices', label: 'Student Invoices', icon: FileText, count: invoices.length },
          { id: 'payments', label: 'Payments & Receipts', icon: Receipt, count: payments.length },
          { id: 'structures', label: 'Fee Structures', icon: Layers, count: structures.length },
          { id: 'categories', label: 'Fee Categories', icon: Tag, count: categories.length },
          { id: 'reports', label: 'Financial Reports', icon: FileSpreadsheet },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                isActive
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    isActive ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* =========================================================================
          TAB 1: OVERVIEW DASHBOARD
      ========================================================================== */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Key Metric KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden">
              <div className="text-slate-500 text-xs font-bold uppercase tracking-wider">Total Invoiced</div>
              <div className="text-2xl font-black text-slate-900 mt-1 font-mono">
                ₦{(stats?.totalInvoicedNaira || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                <span>{stats?.totalInvoices || 0} bills issued</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden">
              <div className="text-emerald-700 text-xs font-bold uppercase tracking-wider">Total Collected</div>
              <div className="text-2xl font-black text-emerald-700 mt-1 font-mono">
                ₦{(stats?.totalCollectedNaira || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[11px] text-emerald-600 mt-1 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> {stats?.collectionRate || 0}% collection rate
              </div>
            </div>

            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden">
              <div className="text-amber-700 text-xs font-bold uppercase tracking-wider">Outstanding Fees</div>
              <div className="text-2xl font-black text-amber-700 mt-1 font-mono">
                ₦{(stats?.outstandingNaira || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[11px] text-amber-600 mt-1">
                {stats?.partiallyPaidCount || 0} partial &bull; {stats?.unpaidCount || 0} unpaid
              </div>
            </div>

            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden">
              <div className="text-rose-700 text-xs font-bold uppercase tracking-wider">Overdue Fees</div>
              <div className="text-2xl font-black text-rose-700 mt-1 font-mono">
                ₦{(stats?.overdueNaira || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[11px] text-rose-600 mt-1 flex items-center gap-1 font-semibold">
                <AlertCircle className="w-3.5 h-3.5" /> {stats?.overdueCount || 0} overdue invoices
              </div>
            </div>
          </div>

          {/* Collection Progress & Breakdown Bar */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-slate-800 uppercase tracking-wider">Collection Progress</span>
              <span className="font-bold text-blue-700">{stats?.collectionRate || 0}% Collected</span>
            </div>
            <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden flex">
              <div
                style={{ width: `${Math.min(100, stats?.collectionRate || 0)}%` }}
                className="bg-emerald-600 h-full transition-all duration-500"
              />
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-slate-600 pt-1">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
                <span>Fully Paid: {stats?.paidCount || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span>Partially Paid: {stats?.partiallyPaidCount || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <span>Unpaid / Issued: {stats?.unpaidCount || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                <span>Overdue: {stats?.overdueCount || 0}</span>
              </div>
            </div>
          </div>

          {/* Dual Columns: Recent Invoices & Recent Payments */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Invoices */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600" /> Recent Invoices
                </div>
                <button
                  onClick={() => setActiveTab('invoices')}
                  className="text-xs text-blue-600 font-bold hover:underline flex items-center gap-1"
                >
                  View All <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="divide-y divide-slate-100 flex-1">
                {stats?.recentInvoices && stats.recentInvoices.length > 0 ? (
                  stats.recentInvoices.map((inv) => (
                    <div
                      key={inv.id}
                      onClick={() => handleViewInvoice(inv)}
                      className="p-4 hover:bg-slate-50 transition-colors flex items-center justify-between cursor-pointer"
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold text-slate-900 text-xs">{inv.student_name}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {inv.invoice_number} &bull; {inv.admission_number}
                        </div>
                      </div>
                      <div className="text-right space-y-1">
                        <div className="font-mono font-bold text-xs text-slate-900">
                          ₦{(inv.total / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </div>
                        <div>{getStatusBadge(inv.status)}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-slate-400 text-xs">No recent invoices recorded.</div>
                )}
              </div>
            </div>

            {/* Recent Payments */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-emerald-600" /> Recent Payments
                </div>
                <button
                  onClick={() => setActiveTab('payments')}
                  className="text-xs text-blue-600 font-bold hover:underline flex items-center gap-1"
                >
                  View All <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="divide-y divide-slate-100 flex-1">
                {stats?.recentPayments && stats.recentPayments.length > 0 ? (
                  stats.recentPayments.map((p) => (
                    <div key={p.id} className="p-4 flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="font-bold text-slate-900 text-xs">{p.student_name}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {p.payment_reference} &bull; {p.payment_method}
                        </div>
                      </div>
                      <div className="text-right space-y-0.5">
                        <div className="font-mono font-bold text-xs text-emerald-700">
                          +₦{(p.amount / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </div>
                        <div className="text-[10px] text-slate-400">{p.payment_date}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-slate-400 text-xs">No payments recorded yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 2: INVOICES MANAGEMENT
      ========================================================================== */}
      {activeTab === 'invoices' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search invoice #, student or admission..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-hidden"
              >
                <option value="">All Statuses</option>
                <option value="ISSUED">Issued (Unpaid)</option>
                <option value="PARTIALLY_PAID">Partially Paid</option>
                <option value="PAID">Paid</option>
                <option value="OVERDUE">Overdue</option>
                <option value="CANCELLED">Cancelled</option>
              </select>

              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-hidden"
              >
                <option value="">All Classes</option>
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                  </option>
                ))}
              </select>

              <button
                onClick={() => setIsCreateInvoiceModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> New Invoice
              </button>
            </div>
          </div>

          {/* Invoices Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <th className="py-3 px-4">Invoice #</th>
                    <th className="py-3 px-4">Student</th>
                    <th className="py-3 px-4">Class</th>
                    <th className="py-3 px-4">Due Date</th>
                    <th className="py-3 px-4 text-right">Total (NGN)</th>
                    <th className="py-3 px-4 text-right">Paid (NGN)</th>
                    <th className="py-3 px-4 text-right">Balance (NGN)</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredInvoices.length > 0 ? (
                    filteredInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-blue-700">{inv.invoice_number}</td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">{inv.student_name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{inv.admission_number}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-700">{inv.class_name || 'N/A'}</td>
                        <td className="py-3 px-4 text-slate-600">{inv.due_date}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                          ₦{(inv.total / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-700">
                          ₦{(inv.amount_paid / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-rose-700">
                          ₦{(inv.balance / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-center">{getStatusBadge(inv.status)}</td>
                        <td className="py-3 px-4 text-right space-x-1">
                          <button
                            onClick={() => handleViewInvoice(inv)}
                            title="View & Print Official Invoice"
                            className="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg cursor-pointer"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>

                          {inv.status !== 'PAID' && inv.status !== 'CANCELLED' && (
                            <>
                              <button
                                onClick={() => {
                                  setPaymentInvoice(inv);
                                  setPayAmount((inv.balance / 100).toString());
                                  setIsPaymentModalOpen(true);
                                }}
                                title="Record Payment"
                                className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg cursor-pointer"
                              >
                                <DollarSign className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setDiscountInvoice(inv);
                                  setIsDiscountModalOpen(true);
                                }}
                                title="Apply Scholarship / Discount"
                                className="p-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg cursor-pointer"
                              >
                                <Percent className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400 italic">
                        No student invoices found matching filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 3: PAYMENTS & RECEIPTS
      ========================================================================== */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Official Payment Ledger</h3>
              <p className="text-xs text-slate-500">Immutable audit log of all validated fee receipts</p>
            </div>
            <a
              href="/api/v1/school/finance/reports/export-csv?type=payments"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Export Receipts CSV
            </a>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <th className="py-3 px-4">Receipt Ref</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Student</th>
                    <th className="py-3 px-4">Invoice #</th>
                    <th className="py-3 px-4">Payment Method</th>
                    <th className="py-3 px-4 text-right">Amount (NGN)</th>
                    <th className="py-3 px-4">Receiver</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {payments.length > 0 ? (
                    payments.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-slate-900">{p.payment_reference}</td>
                        <td className="py-3 px-4 text-slate-600">{p.payment_date}</td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">{p.student_name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{p.admission_number}</div>
                        </td>
                        <td className="py-3 px-4 font-mono text-blue-700">{p.invoice_number}</td>
                        <td className="py-3 px-4">
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                            {p.payment_method}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700">
                          ₦{(p.amount / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-slate-500">{p.receiver_name || 'Bursary Admin'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400 italic">
                        No payments recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 4: FEE STRUCTURES
      ========================================================================== */}
      {activeTab === 'structures' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Class Fee Structures</h3>
              <p className="text-xs text-slate-500">Termly packages and itemized fee schedules</p>
            </div>
            <button
              onClick={() => setIsStructureModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> New Fee Structure
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {structures.map((fs) => (
              <div key={fs.id} className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                      {fs.class_name || 'All Classes'}
                    </span>
                    <span className="text-xs font-bold text-emerald-700 font-mono">
                      ₦{((fs.total_amount || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <h4 className="font-bold text-slate-900 text-sm mt-3">{fs.name}</h4>
                  {fs.description && <p className="text-xs text-slate-500 mt-1">{fs.description}</p>}

                  {/* Line Items List */}
                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Item Breakdown</div>
                    {fs.items && fs.items.length > 0 ? (
                      fs.items.map((it) => (
                        <div key={it.id} className="flex justify-between items-center text-xs">
                          <span className="text-slate-700 truncate max-w-[65%]">
                            {it.category_name || it.description}
                            {it.compulsory ? (
                              <span className="text-[10px] text-slate-400 ml-1">(Req)</span>
                            ) : (
                              <span className="text-[10px] text-amber-600 ml-1">(Opt)</span>
                            )}
                          </span>
                          <span className="font-mono text-slate-900 font-semibold">
                            ₦{(it.amount / 100).toLocaleString()}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-400 italic">No line items.</div>
                    )}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
                  <button
                    onClick={() => {
                      setBulkFsId(fs.id);
                      setBulkClassId(fs.class_id || '');
                      setIsBulkModalOpen(true);
                    }}
                    className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
                  >
                    <Layers className="w-3.5 h-3.5" /> Issue to Class
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm(`Delete fee structure "${fs.name}"?`)) {
                        await api.deleteFeeStructure(fs.id);
                        fetchFinanceData();
                      }
                    }}
                    className="text-xs text-rose-500 hover:text-rose-700 cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 5: FEE CATEGORIES
      ========================================================================== */}
      {activeTab === 'categories' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Fee Categories</h3>
              <p className="text-xs text-slate-500">Standardized school fee classification codes</p>
            </div>
            <button
              onClick={() => setIsCategoryModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add Category
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.map((cat) => (
              <div key={cat.id} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex items-start justify-between">
                <div className="space-y-1">
                  <div className="font-bold text-slate-900 text-sm">{cat.name}</div>
                  <p className="text-xs text-slate-500 leading-relaxed">{cat.description || 'No description'}</p>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    cat.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {cat.status}
                  </span>
                </div>
                <button
                  onClick={async () => {
                    if (confirm(`Remove fee category "${cat.name}"?`)) {
                      await api.deleteFeeCategory(cat.id);
                      fetchFinanceData();
                    }
                  }}
                  className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 6: FINANCIAL REPORTS
      ========================================================================== */}
      {activeTab === 'reports' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-900 text-base mb-1">Class Revenue & Fee Realization</h3>
            <p className="text-xs text-slate-500 mb-4">Breakdown of billings, collections and outstanding balances per class</p>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <th className="py-3 px-4">Class</th>
                    <th className="py-3 px-4 text-center">Invoices</th>
                    <th className="py-3 px-4 text-right">Total Billed (NGN)</th>
                    <th className="py-3 px-4 text-right">Total Paid (NGN)</th>
                    <th className="py-3 px-4 text-right">Outstanding (NGN)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {reportData?.classRevenue && reportData.classRevenue.length > 0 ? (
                    reportData.classRevenue.map((c, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-bold text-slate-900">{c.class_name}</td>
                        <td className="py-3 px-4 text-center">{c.invoice_count}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                          ₦{c.total_billed_naira.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-700">
                          ₦{c.total_paid_naira.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-rose-700">
                          ₦{c.total_balance_naira.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400 italic">
                        No class revenue records available.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Category Revenue Breakdown */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
              <h4 className="font-bold text-slate-900 text-sm">Revenue By Fee Category</h4>
              <div className="space-y-2 text-xs">
                {reportData?.categoryRevenue?.map((cat, idx) => (
                  <div key={idx} className="flex justify-between items-center p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="font-medium text-slate-800">{cat.category_name}</span>
                    <span className="font-mono font-bold text-slate-900">
                      ₦{cat.total_billed_naira.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Payment Method Distribution */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
              <h4 className="font-bold text-slate-900 text-sm">Payment Method Volumes</h4>
              <div className="space-y-2 text-xs">
                {reportData?.paymentMethods?.map((pm, idx) => (
                  <div key={idx} className="flex justify-between items-center p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="font-medium text-slate-800">{pm.payment_method}</span>
                    <span className="font-mono font-bold text-emerald-700">
                      ₦{pm.total_amount_naira.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 1: RECORD PAYMENT
      ========================================================================== */}
      {isPaymentModalOpen && paymentInvoice && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Receipt className="w-5 h-5 text-emerald-600" /> Record Fee Payment
              </h3>
              <button onClick={() => setIsPaymentModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
              <div>Invoice: <span className="font-mono font-bold text-blue-700">{paymentInvoice.invoice_number}</span></div>
              <div>Student: <span className="font-bold text-slate-800">{paymentInvoice.student_name}</span></div>
              <div>
                Outstanding Balance:{' '}
                <span className="font-mono font-black text-rose-700">
                  ₦{(paymentInvoice.balance / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <form onSubmit={handleRecordPayment} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Amount to Pay (₦ Naira) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  max={paymentInvoice.balance / 100}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Payment Method *</label>
                <select
                  value={payMethod}
                  onChange={(e: any) => setPayMethod(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-hidden"
                >
                  <option value="BANK_TRANSFER">Bank Transfer (Direct / Wire)</option>
                  <option value="POS">Point of Sale (POS Terminal Card)</option>
                  <option value="CASH">Cash Deposit at Bursary</option>
                  <option value="ONLINE">Online Portal / Gateway</option>
                  <option value="CHEQUE">Bank Draft / Cheque</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Transaction Date *</label>
                <input
                  type="date"
                  required
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Payment Notes / Bank Reference</label>
                <input
                  type="text"
                  placeholder="e.g. GTBank Transfer Ref: 98124912"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? 'Recording...' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 2: APPLY DISCOUNT / SCHOLARSHIP
      ========================================================================== */}
      {isDiscountModalOpen && discountInvoice && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Percent className="w-5 h-5 text-amber-600" /> Apply Scholarship or Fee Waiver
              </h3>
              <button onClick={() => setIsDiscountModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
              <div>Invoice: <span className="font-mono font-bold">{discountInvoice.invoice_number}</span></div>
              <div>Subtotal: <span className="font-mono font-bold">₦{(discountInvoice.subtotal / 100).toLocaleString()}</span></div>
              <div>Current Discount: <span className="font-mono text-emerald-700">₦{(discountInvoice.discount / 100).toLocaleString()}</span></div>
            </div>

            <form onSubmit={handleApplyDiscount} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Adjustment Type *</label>
                <select
                  value={discountType}
                  onChange={(e: any) => setDiscountType(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                >
                  <option value="SCHOLARSHIP">Merit / Need Scholarship</option>
                  <option value="FIXED">Fixed Amount Discount (₦)</option>
                  <option value="PERCENTAGE">Percentage Waiver (%)</option>
                  <option value="WAIVER">Staff Child / Sibling Fee Waiver</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {discountType === 'PERCENTAGE' ? 'Discount Percentage (%) *' : 'Discount Amount (₦ Naira) *'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={discountVal}
                  onChange={(e) => setDiscountVal(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Reason / Justification for Audit *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Academic Excellence Award - Top in Class"
                  value={discountReason}
                  onChange={(e) => setDiscountReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsDiscountModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl"
                >
                  {actionLoading ? 'Applying...' : 'Apply Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 3: CREATE SINGLE INVOICE
      ========================================================================== */}
      {isCreateInvoiceModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" /> Issue Student Invoice
              </h3>
              <button onClick={() => setIsCreateInvoiceModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateInvoice} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Select Student *</label>
                <select
                  required
                  value={newInvStudentId}
                  onChange={(e) => setNewInvStudentId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                >
                  <option value="">-- Choose Student --</option>
                  {students.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.full_name} ({st.admission_number}) - {st.class_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Due Date *</label>
                <input
                  type="date"
                  required
                  value={newInvDueDate}
                  onChange={(e) => setNewInvDueDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              {/* Line Items */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="font-bold text-slate-700">Fee Line Items</label>
                  <button
                    type="button"
                    onClick={() =>
                      setNewInvItems([
                        ...newInvItems,
                        { categoryId: '', desc: 'Sundry Fee', qty: 1, unit: '15000' },
                      ])
                    }
                    className="text-xs text-blue-600 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Item
                  </button>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto p-1">
                  {newInvItems.map((it, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <select
                        value={it.categoryId}
                        onChange={(e) => {
                          const updated = [...newInvItems];
                          updated[idx].categoryId = e.target.value;
                          setNewInvItems(updated);
                        }}
                        className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-xl w-36"
                      >
                        <option value="">Category</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        placeholder="Description"
                        value={it.desc}
                        onChange={(e) => {
                          const updated = [...newInvItems];
                          updated[idx].desc = e.target.value;
                          setNewInvItems(updated);
                        }}
                        className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-xl flex-1"
                      />
                      <input
                        type="number"
                        placeholder="₦ Amount"
                        value={it.unit}
                        onChange={(e) => {
                          const updated = [...newInvItems];
                          updated[idx].unit = e.target.value;
                          setNewInvItems(updated);
                        }}
                        className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-xl w-28 font-mono text-right font-bold"
                      />
                      {newInvItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setNewInvItems(newInvItems.filter((_, i) => i !== idx));
                          }}
                          className="text-slate-400 hover:text-rose-600 p-1"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Invoice Notes / Description</label>
                <input
                  type="text"
                  placeholder="e.g. Termly standard bill"
                  value={newInvNotes}
                  onChange={(e) => setNewInvNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateInvoiceModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl"
                >
                  {actionLoading ? 'Issuing...' : 'Generate Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 4: BULK GENERATE INVOICES
      ========================================================================== */}
      {isBulkModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Layers className="w-5 h-5 text-blue-600" /> Batch Generate Class Invoices
              </h3>
              <button onClick={() => setIsBulkModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleBulkGenerate} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Target Class *</label>
                <select
                  required
                  value={bulkClassId}
                  onChange={(e) => setBulkClassId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                >
                  <option value="">-- Choose Class --</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name} ({cls.level})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Fee Structure Template *</label>
                <select
                  required
                  value={bulkFsId}
                  onChange={(e) => setBulkFsId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                >
                  <option value="">-- Choose Fee Structure --</option>
                  {structures.map((fs) => (
                    <option key={fs.id} value={fs.id}>
                      {fs.name} (₦{((fs.total_amount || 0) / 100).toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Due Date *</label>
                <input
                  type="date"
                  required
                  value={bulkDueDate}
                  onChange={(e) => setBulkDueDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsBulkModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl"
                >
                  {actionLoading ? 'Generating...' : 'Issue to All Students'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 5: CREATE FEE STRUCTURE
      ========================================================================== */}
      {isStructureModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Layers className="w-5 h-5 text-blue-600" /> New Fee Structure Template
              </h3>
              <button onClick={() => setIsStructureModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateStructure} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Structure Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SSS 2 Term 1 2024/2025 Standard Fees"
                  value={fsName}
                  onChange={(e) => setFsName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Target Class</label>
                <select
                  value={fsClassId}
                  onChange={(e) => setFsClassId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                >
                  <option value="">Applicable to All Classes</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Items Breakdown */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="font-bold text-slate-700">Structure Items</label>
                  <button
                    type="button"
                    onClick={() =>
                      setFsItems([
                        ...fsItems,
                        { categoryId: '', amount: '20000', compulsory: true, desc: 'Sundry item' },
                      ])
                    }
                    className="text-xs text-blue-600 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Line
                  </button>
                </div>

                <div className="space-y-2 max-h-40 overflow-y-auto p-1">
                  {fsItems.map((it, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <select
                        required
                        value={it.categoryId}
                        onChange={(e) => {
                          const updated = [...fsItems];
                          updated[idx].categoryId = e.target.value;
                          setFsItems(updated);
                        }}
                        className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-xl w-36"
                      >
                        <option value="">Category *</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        placeholder="₦ Amount"
                        value={it.amount}
                        onChange={(e) => {
                          const updated = [...fsItems];
                          updated[idx].amount = e.target.value;
                          setFsItems(updated);
                        }}
                        className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-xl w-28 font-mono text-right font-bold"
                      />
                      <label className="flex items-center gap-1 text-[11px] text-slate-600">
                        <input
                          type="checkbox"
                          checked={it.compulsory}
                          onChange={(e) => {
                            const updated = [...fsItems];
                            updated[idx].compulsory = e.target.checked;
                            setFsItems(updated);
                          }}
                        />
                        Req
                      </label>
                      {fsItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setFsItems(fsItems.filter((_, i) => i !== idx))}
                          className="text-slate-400 hover:text-rose-600 p-1"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsStructureModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl"
                >
                  {actionLoading ? 'Saving...' : 'Save Structure'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 6: CREATE FEE CATEGORY
      ========================================================================== */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Tag className="w-5 h-5 text-blue-600" /> New Fee Category
              </h3>
              <button onClick={() => setIsCategoryModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCategory} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Category Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Robotics & AI Lab"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Description</label>
                <input
                  type="text"
                  placeholder="e.g. Specialized lab fee"
                  value={newCatDesc}
                  onChange={(e) => setNewCatDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCategoryModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl"
                >
                  {actionLoading ? 'Creating...' : 'Create Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          PRINTABLE INVOICE MODAL
      ========================================================================== */}
      <PrintableInvoiceModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        invoice={selectedInvoice}
        currentSchool={currentSchool}
      />
    </div>
  );
};
