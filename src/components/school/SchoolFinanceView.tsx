import { exportTableToPdf } from "../../utils/pdfExport.ts";
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
  MessageSquare,
  Send,
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
  Globe,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  Zap,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api, safeFetch } from '../../services/api.js';
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
  ReceiptItem,
  GatewayStatus,
} from '../../types/index.js';
import { PrintableInvoiceModal } from './PrintableInvoiceModal.js';
import { PrintableReceiptModal } from './PrintableReceiptModal.js';

export const SchoolFinanceView: React.FC = () => {
  const { activeSchool: currentSchool, user } = useAuth();
  const [activeTab, setActiveTab] = useState<
    'overview' | 'invoices' | 'payments' | 'gateways' | 'reports' | 'structures' | 'categories'
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

  // Gateways & Webhooks Data
  const [gateways, setGateways] = useState<GatewayStatus[]>([]);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [webhookSimulating, setWebhookSimulating] = useState(false);
  const [webhookResult, setWebhookResult] = useState<any>(null);

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');

  // Payment Tab Filter States
  const [paySearchQuery, setPaySearchQuery] = useState('');
  const [payStatusFilter, setPayStatusFilter] = useState('');
  const [payMethodFilter, setPayMethodFilter] = useState('');

  // Loading & Error States
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDef | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  const handleExportInvoicesPdf = () => {
    exportTableToPdf({
      title: "Official Invoices & Billing Statement",
      subtitle: "Comprehensive Student Billing Register",
      school: {
        name: currentSchool?.name || "School Portal",
        slug: currentSchool?.slug,
        email: currentSchool?.email,
        phone: currentSchool?.phone,
        address: currentSchool?.address,
        state: currentSchool?.state,
      },
      columns: [
        { header: "Invoice #", key: "invoice_number" },
        { header: "Student", key: "student_name" },
        { header: "Class", key: "class_name" },
        { header: "Total (₦)", key: "total", align: "right", format: (val) => Number(val || 0).toLocaleString() },
        { header: "Paid (₦)", key: "amount_paid", align: "right", format: (val) => Number(val || 0).toLocaleString() },
        { header: "Balance (₦)", key: "balance", align: "right", format: (val) => Number(val || 0).toLocaleString() },
        { header: "Status", key: "status", align: "center" },
      ],
      data: filteredInvoices.map((inv) => ({
        invoice_number: inv.invoice_number,
        student_name: inv.student_name || (inv as any).student_admission_number || (inv as any).admission_number || "-",
        class_name: inv.class_name || "-",
        total: (inv.total || 0) / 100,
        amount_paid: (inv.amount_paid || 0) / 100,
        balance: (inv.balance || 0) / 100,
        status: inv.status,
      })),
      summaryItems: [
        { label: "Total Invoiced", value: "₦" + ((filteredInvoices.reduce((acc, i) => acc + (i.total || 0), 0)) / 100).toLocaleString() },
        { label: "Total Paid", value: "₦" + ((filteredInvoices.reduce((acc, i) => acc + (i.amount_paid || 0), 0)) / 100).toLocaleString() },
        { label: "Outstanding Balance", value: "₦" + ((filteredInvoices.reduce((acc, i) => acc + (i.balance || 0), 0)) / 100).toLocaleString() },
      ],
    });
  };


  // Official Receipt Modal
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptItem | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);

  // Payment Modal
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<InvoiceDef | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'BANK_TRANSFER' | 'POS' | 'CASH' | 'ONLINE' | 'CHEQUE'>('BANK_TRANSFER');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payNotes, setPayNotes] = useState('');
  const [isPendingPayment, setIsPendingPayment] = useState(false);

  // Online Checkout Simulator Modal
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [checkoutInvoice, setCheckoutInvoice] = useState<InvoiceDef | null>(null);
  const [checkoutProvider, setCheckoutProvider] = useState<'TEST_SANDBOX' | 'PAYSTACK' | 'FLUTTERWAVE'>('TEST_SANDBOX');
  const [checkoutAmount, setCheckoutAmount] = useState('');
  const [checkoutEmail, setCheckoutEmail] = useState('');
  const [checkoutSimulating, setCheckoutSimulating] = useState(false);

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

  // Reports
  const [reportSubTab, setReportSubTab] = useState<'summary' | 'daily' | 'monthly' | 'defaulters'>('summary');
  const [reminderModalDefaulter, setReminderModalDefaulter] = useState<any | null>(null);
  const [reminderCustomNote, setReminderCustomNote] = useState('');
  const [reminderSending, setReminderSending] = useState(false);
  const [reminderResult, setReminderResult] = useState<any | null>(null);
  const [reportData, setReportData] = useState<{
    classRevenue: any[];
    categoryRevenue: any[];
    paymentMethods: any[];
  } | null>(null);
  const [dailyReports, setDailyReports] = useState<any[]>([]);
  const [monthlyReports, setMonthlyReports] = useState<any[]>([]);
  const [defaulters, setDefaulters] = useState<any[]>([]);

  const fetchFinanceData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [statsRes, invRes, payRes, catRes, fsRes, classRes, stuRes, sesRes, gwRes] = await Promise.all([
        api.getFinancialDashboardStats().catch(() => ({ stats: null })),
        api.getInvoices({ limit: 100 }).catch(() => ({ invoices: [], total: 0 })),
        api.getPayments({ limit: 100 }).catch(() => ({ payments: [] })),
        api.getFeeCategories().catch(() => ({ categories: [] })),
        api.getFeeStructures().catch(() => ({ feeStructures: [] })),
        api.getSchoolClasses().catch(() => ({ classes: [] })),
        api.getSchoolStudents({ limit: 100 }).catch(() => ({ students: [] })),
        api.getSchoolAcademicSessions().catch(() => ({ sessions: [] })),
        api.getGatewayStatus().catch(() => ({ providers: [] })),
      ]);

      if (statsRes.stats) setStats(statsRes.stats);
      setInvoices(invRes.invoices || []);
      setPayments(payRes.payments || []);
      setCategories(catRes.categories || []);
      setStructures(fsRes.feeStructures || []);
      setClasses(classRes.classes || []);
      setStudents(stuRes.students || []);
      setSessions(sesRes.sessions || []);
      setGateways(gwRes.providers || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load financial records.');
    } finally {
      setLoading(false);
    }
  };

  const fetchReports = async () => {
    try {
      const [repRes, dailyRes, monthlyRes, defRes] = await Promise.all([
        api.getFinancialReportsSummary().catch(() => null),
        api.getDailyCollectionsReport(14).catch(() => ({ daily: [] })),
        api.getMonthlyCollectionsReport().catch(() => ({ monthly: [] })),
        api.getDefaultersReport().catch(() => ({ defaulters: [] })),
      ]);
      if (repRes) setReportData(repRes);
      setDailyReports(dailyRes.daily || []);
      setMonthlyReports(monthlyRes.monthly || []);
      setDefaulters(defRes.defaulters || []);
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

  // Open Official Receipt
  const handleOpenReceipt = async (p: PaymentItem) => {
    try {
      setActionLoading(true);
      if (p.receipt_id) {
        const res = await api.getReceiptDetails(p.receipt_id);
        setSelectedReceipt(res.receipt);
        setIsReceiptModalOpen(true);
        return;
      }

      // Try finding by payment reference
      const res = await api.getReceipts({ search: p.payment_reference });
      if (res.receipts && res.receipts.length > 0) {
        setSelectedReceipt(res.receipts[0]);
        setIsReceiptModalOpen(true);
        return;
      }

      // Construct fallback receipt from payment record
      setSelectedReceipt({
        id: p.id,
        school_id: p.school_id,
        receipt_number: p.receipt_number || p.payment_reference,
        payment_id: p.id,
        invoice_id: p.invoice_id,
        student_id: p.student_id,
        amount: p.amount,
        amount_naira: p.amount_naira || p.amount / 100,
        previous_balance: (p.invoice_balance || 0) + p.amount,
        previous_balance_naira: ((p.invoice_balance || 0) + p.amount) / 100,
        current_balance: p.invoice_balance || 0,
        current_balance_naira: (p.invoice_balance || 0) / 100,
        issue_date: p.payment_date,
        issued_by: p.received_by,
        issuer_name: p.receiver_name || 'Bursary Officer',
        notes: p.notes,
        created_at: p.created_at || new Date().toISOString(),
        payment_reference: p.payment_reference,
        internal_reference: p.internal_reference,
        payment_method: p.payment_method,
        payment_status: p.status,
        invoice_number: p.invoice_number,
        student_name: p.student_name,
        admission_number: p.admission_number,
        class_name: p.class_name,
        class_display_name: p.class_display_name,
        school_name: currentSchool?.name,
        school_slug: currentSchool?.slug,
        school_type: currentSchool?.type,
        school_address: currentSchool?.address,
        school_state: currentSchool?.state,
        school_lga: currentSchool?.lga,
        school_phone: currentSchool?.phone,
        school_email: currentSchool?.email,
        school_website: currentSchool?.website,
        school_logo_url: currentSchool?.logo_url,
      });
      setIsReceiptModalOpen(true);
    } catch (err: any) {
      setError('Could not open receipt: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Verify Pending Payment
  const handleVerifyPayment = async (paymentId: string) => {
    if (!confirm('Authenticate and confirm this payment? Outstanding invoice balance will be updated and official receipt issued.')) return;
    try {
      setActionLoading(true);
      setError(null);
      const res = await api.verifyPayment(paymentId);
      setSuccessMsg('Payment successfully verified and official receipt issued.');
      fetchFinanceData();
      if (res.payment?.receipt?.receiptId) {
        const rRes = await api.getReceiptDetails(res.payment.receipt.receiptId);
        setSelectedReceipt(rRes.receipt);
        setIsReceiptModalOpen(true);
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed.');
    } finally {
      setActionLoading(false);
    }
  };

  // Cancel Payment
  const handleCancelPayment = async (paymentId: string) => {
    const reason = prompt('Please enter cancellation reason for audit log:');
    if (reason === null) return;
    try {
      setActionLoading(true);
      setError(null);
      await api.cancelPayment(paymentId, reason || 'Bursar cancellation');
      setSuccessMsg('Payment status updated to CANCELLED.');
      fetchFinanceData();
    } catch (err: any) {
      setError(err.message || 'Cancellation failed.');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Recording Payment
  const handleSendReminder = async (studentId: string, customNote?: string) => {
    setReminderSending(true);
    setReminderResult(null);
    try {
      const res = await api.sendDefaulterReminder(studentId, 'ALL', customNote);
      setReminderResult(res);
    } catch (err: any) {
      alert(err?.message || 'Failed to dispatch reminder');
    } finally {
      setReminderSending(false);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentInvoice) return;
    try {
      setActionLoading(true);
      setError(null);
      const res = await api.recordPayment(paymentInvoice.id, {
        amount: parseFloat(payAmount),
        payment_method: payMethod,
        payment_date: payDate,
        notes: payNotes,
        is_pending: isPendingPayment,
      });

      if (isPendingPayment) {
        setSuccessMsg(`Payment of ₦${parseFloat(payAmount).toLocaleString()} logged as PENDING verification.`);
      } else {
        setSuccessMsg(`Payment of ₦${parseFloat(payAmount).toLocaleString()} confirmed. Official Receipt generated.`);
        if (res.payment?.receipt?.receiptId) {
          const rRes = await api.getReceiptDetails(res.payment.receipt.receiptId);
          setSelectedReceipt(rRes.receipt);
          setIsReceiptModalOpen(true);
        }
      }

      setIsPaymentModalOpen(false);
      setPayAmount('');
      setPayNotes('');
      setIsPendingPayment(false);
      fetchFinanceData();
    } catch (err: any) {
      setError(err.message || 'Payment recording failed.');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Online Checkout Simulation
  const handleSimulateOnlineCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutInvoice) return;
    try {
      setCheckoutSimulating(true);
      setError(null);
      const amtKobo = Math.round(parseFloat(checkoutAmount) * 100);

      const initRes = await api.initializeOnlineCheckout(checkoutInvoice.id, {
        provider: checkoutProvider,
        amount_kobo: amtKobo,
        email: checkoutEmail || user?.email || 'guardian@student.sch.ng',
      });

      const verifyRes = await api.verifyOnlinePayment({
        provider: checkoutProvider,
        reference: initRes.providerReference,
        invoice_id: checkoutInvoice.id,
        amount_kobo: amtKobo,
      });

      setSuccessMsg(`Payment confirmed via ${checkoutProvider}! Official Receipt issued.`);
      setIsCheckoutModalOpen(false);
      fetchFinanceData();

      if (verifyRes.payment?.receipt?.receiptId) {
        const rRes = await api.getReceiptDetails(verifyRes.payment.receipt.receiptId);
        setSelectedReceipt(rRes.receipt);
        setIsReceiptModalOpen(true);
      }
    } catch (err: any) {
      setError(err.message || 'Online payment simulation failed.');
    } finally {
      setCheckoutSimulating(false);
    }
  };

  // Handle Simulate Webhook
  const handleSimulateWebhook = async (providerName: string) => {
    try {
      setWebhookSimulating(true);
      setError(null);
      const targetInvoice = invoices.find((inv) => inv.balance > 0) || invoices[0];
      if (!targetInvoice) {
        setError('No active invoices available for webhook testing.');
        return;
      }

      const testAmountKobo = Math.min(targetInvoice.balance, 1000000); // ₦10,000 or balance
      const testRef = `wh_demo_${Date.now()}`;

      const json = await safeFetch(`/api/v1/webhooks/payments/${providerName.toLowerCase()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-signature': 'sandbox-test-sig',
        },
        body: JSON.stringify({
          event: 'charge.success',
          reference: testRef,
          provider_reference: testRef,
          amount_kobo: testAmountKobo,
          currency: 'NGN',
          school_id: currentSchool?.id,
          invoice_id: targetInvoice.id,
          student_id: targetInvoice.student_id,
          internal_reference: `PAY-WH-${Date.now().toString().slice(-4)}`,
        }),
      });

      setWebhookResult(json);
      setSuccessMsg(`Webhook received and verified idempotently! Receipt #${json.receiptNumber} generated.`);
      fetchFinanceData();
    } catch (err: any) {
      setError(`Webhook network error: ${err.message}`);
    } finally {
      setWebhookSimulating(false);
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
          <button
            onClick={handleExportInvoicesPdf}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            title="Export Invoices to PDF"
          >
            <Printer className="w-3.5 h-3.5 text-emerald-700" /> Export PDF
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
          { id: 'gateways', label: 'Online Gateways & Webhooks', icon: Globe },
          { id: 'reports', label: 'Financial Reports', icon: FileSpreadsheet },
          { id: 'structures', label: 'Fee Structures', icon: Layers, count: structures.length },
          { id: 'categories', label: 'Fee Categories', icon: Tag, count: categories.length },
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

                          {inv.amount_paid > 0 && (
                            <button
                              onClick={async () => {
                                try {
                                  const res = await api.getReceipts({ search: inv.invoice_number });
                                  if (res.receipts && res.receipts.length > 0) {
                                    setSelectedReceipt(res.receipts[0]);
                                    setIsReceiptModalOpen(true);
                                  } else {
                                    const payRes = await api.getPayments({ invoice_id: inv.id });
                                    if (payRes.payments && payRes.payments.length > 0) {
                                      handleOpenReceipt(payRes.payments[0]);
                                    }
                                  }
                                } catch {
                                  setError('Could not find receipt for this invoice.');
                                }
                              }}
                              title="View Payment Receipt Voucher"
                              className="p-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg cursor-pointer"
                            >
                              <Receipt className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {inv.status !== 'PAID' && inv.status !== 'CANCELLED' && (
                            <>
                              <button
                                onClick={() => {
                                  setPaymentInvoice(inv);
                                  setPayAmount((inv.balance / 100).toString());
                                  setIsPaymentModalOpen(true);
                                }}
                                title="Record Manual Payment"
                                className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg cursor-pointer"
                              >
                                <DollarSign className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setCheckoutInvoice(inv);
                                  setCheckoutAmount((inv.balance / 100).toString());
                                  setIsCheckoutModalOpen(true);
                                }}
                                title="Online Checkout Simulator (Paystack / Flutterwave / Sandbox)"
                                className="p-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg cursor-pointer"
                              >
                                <Zap className="w-3.5 h-3.5" />
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
          TAB 3: PAYMENTS, RECEIPTS & VERIFICATION
      ========================================================================== */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Receipt className="w-4 h-4 text-emerald-600" /> Payment Reconciliation & Receipt Ledger
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Multi-channel payments &bull; Bursary verification &bull; Official numbered receipt vouchers
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => {
                  const unpaidInv = invoices.find((i) => i.balance > 0) || invoices[0];
                  if (unpaidInv) {
                    setCheckoutInvoice(unpaidInv);
                    setCheckoutAmount((unpaidInv.balance / 100).toString());
                    setIsCheckoutModalOpen(true);
                  } else {
                    setError('No invoice available for checkout simulation.');
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs"
              >
                <Zap className="w-3.5 h-3.5" /> Online Checkout Simulator
              </button>
              <a
                href="/api/v1/school/finance/reports/export-csv?type=payments"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Export Payments CSV
              </a>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search reference, student, admission number..."
                value={paySearchQuery}
                onChange={(e) => setPaySearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={payStatusFilter}
                onChange={(e) => setPayStatusFilter(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-hidden"
              >
                <option value="">All Statuses</option>
                <option value="SUCCESS">Verified (SUCCESS)</option>
                <option value="PENDING">Pending (PENDING)</option>
                <option value="CANCELLED">Cancelled (CANCELLED)</option>
              </select>

              <select
                value={payMethodFilter}
                onChange={(e) => setPayMethodFilter(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-hidden"
              >
                <option value="">All Payment Methods</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="POS">POS Terminal</option>
                <option value="CASH">Cash Deposit</option>
                <option value="ONLINE">Online Portal</option>
                <option value="CHEQUE">Bank Cheque</option>
              </select>

              {(paySearchQuery || payStatusFilter || payMethodFilter) && (
                <button
                  onClick={() => {
                    setPaySearchQuery('');
                    setPayStatusFilter('');
                    setPayMethodFilter('');
                  }}
                  className="px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-xl font-bold transition-colors cursor-pointer"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>

          {/* Payments Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <th className="py-3 px-4">Receipt & Ref</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Student & Class</th>
                    <th className="py-3 px-4">Invoice #</th>
                    <th className="py-3 px-4">Method & Channel</th>
                    <th className="py-3 px-4 text-right">Amount (NGN)</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {(() => {
                    const filtered = payments.filter((p) => {
                      if (payStatusFilter && p.status !== payStatusFilter) return false;
                      if (payMethodFilter && p.payment_method !== payMethodFilter) return false;
                      if (paySearchQuery) {
                        const q = paySearchQuery.toLowerCase();
                        const matchRef = p.payment_reference?.toLowerCase().includes(q) || p.internal_reference?.toLowerCase().includes(q);
                        const matchStudent = p.student_name?.toLowerCase().includes(q) || p.admission_number?.toLowerCase().includes(q);
                        const matchReceipt = p.receipt_number?.toLowerCase().includes(q);
                        if (!matchRef && !matchStudent && !matchReceipt) return false;
                      }
                      return true;
                    });

                    if (filtered.length === 0) {
                      return (
                        <tr>
                          <td colSpan={8} className="py-10 text-center text-slate-400 italic">
                            No payment records matched your search filters.
                          </td>
                        </tr>
                      );
                    }

                    return filtered.map((p) => {
                      const isPending = p.status === 'PENDING';
                      const isSuccess = p.status === 'SUCCESS';
                      const isCancelled = p.status === 'CANCELLED';

                      return (
                        <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3 px-4">
                            <div className="font-mono font-bold text-slate-900">
                              {p.receipt_number || p.payment_reference}
                            </div>
                            {p.internal_reference && p.internal_reference !== p.payment_reference && (
                              <div className="text-[10px] text-slate-400 font-mono">
                                Ref: {p.internal_reference}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-600 whitespace-nowrap">{p.payment_date}</td>
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900">{p.student_name || 'N/A'}</div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {p.admission_number} &bull; {p.class_display_name || p.class_name || 'Class'}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono text-blue-700">{p.invoice_number}</td>
                          <td className="py-3 px-4">
                            <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700 uppercase">
                              {p.payment_method?.replace('_', ' ')}
                            </span>
                            {p.provider && p.provider !== 'MANUAL' && (
                              <span className="ml-1 text-[9px] font-mono text-purple-600 bg-purple-50 px-1 py-0.2 rounded border border-purple-200">
                                {p.provider}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700">
                            ₦{(p.amount / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-4">
                            {isSuccess && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Confirmed
                              </span>
                            )}
                            {isPending && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 animate-pulse">
                                <Clock className="w-3 h-3 text-amber-600" /> Pending Auth
                              </span>
                            )}
                            {isCancelled && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                                <X className="w-3 h-3 text-rose-600" /> Cancelled
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="inline-flex items-center gap-1">
                              {isSuccess && (
                                <button
                                  onClick={() => handleOpenReceipt(p)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg text-[11px] font-bold transition-colors cursor-pointer border border-emerald-200"
                                  title="Print official receipt voucher"
                                >
                                  <Printer className="w-3 h-3 text-emerald-600" /> Receipt
                                </button>
                              )}
                              {isPending && (
                                <>
                                  <button
                                    onClick={() => handleVerifyPayment(p.id)}
                                    disabled={actionLoading}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
                                    title="Verify & Confirm Bank Transfer"
                                  >
                                    <Check className="w-3 h-3" /> Verify
                                  </button>
                                  <button
                                    onClick={() => handleCancelPayment(p.id)}
                                    disabled={actionLoading}
                                    className="p-1 hover:bg-rose-50 text-rose-600 rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
                                    title="Reject Payment"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                              {isCancelled && (
                                <span className="text-[10px] text-slate-400 italic">Voided</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 4: ONLINE PAYMENT GATEWAYS & WEBHOOKS
      ========================================================================== */}
      {activeTab === 'gateways' && (
        <div className="space-y-6">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Globe className="w-4 h-4 text-purple-600" /> Payment Gateway Service & Webhook Architecture
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Provider-agnostic payment architecture &bull; Paystack &bull; Flutterwave &bull; Idempotent Webhook Processing
              </p>
            </div>
            <button
              onClick={fetchFinanceData}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" /> Refresh Status
            </button>
          </div>

          {/* Gateway Provider Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Paystack Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-sm text-slate-900">Paystack</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    Active Sandbox
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Debit Cards (Mastercard, Visa, Verve), USSD (*737#), Direct Bank Account Transfer, Apple Pay.
                </p>
                <div className="mt-3 pt-3 border-t border-slate-100 text-[11px] space-y-1">
                  <div className="flex justify-between text-slate-600">
                    <span>Currency:</span>
                    <span className="font-mono font-bold text-slate-900">NGN (Kobo)</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Signature Verification:</span>
                    <span className="font-mono text-emerald-700">HMAC-SHA512</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleSimulateWebhook('PAYSTACK')}
                disabled={webhookSimulating}
                className="mt-4 w-full py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer text-center"
              >
                Test Paystack Webhook
              </button>
            </div>

            {/* Flutterwave Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-sm text-slate-900">Flutterwave</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    Active Sandbox
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  International Cards, Mobile Money, Bank Account Transfers, Barter, QR Payments.
                </p>
                <div className="mt-3 pt-3 border-t border-slate-100 text-[11px] space-y-1">
                  <div className="flex justify-between text-slate-600">
                    <span>Currency:</span>
                    <span className="font-mono font-bold text-slate-900">NGN</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Signature Verification:</span>
                    <span className="font-mono text-emerald-700">Secret Hash</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleSimulateWebhook('FLUTTERWAVE')}
                disabled={webhookSimulating}
                className="mt-4 w-full py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer text-center"
              >
                Test Flutterwave Webhook
              </button>
            </div>

            {/* Instant Sandbox Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-sm text-slate-900">Instant Sandbox</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                    Zero Setup
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Automated testing engine for immediate card payments, balance reconciliation, and receipt issuing.
                </p>
                <div className="mt-3 pt-3 border-t border-slate-100 text-[11px] space-y-1">
                  <div className="flex justify-between text-slate-600">
                    <span>Mode:</span>
                    <span className="font-bold text-blue-700">Demo & Audit</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Idempotency:</span>
                    <span className="font-mono text-emerald-700">Enforced</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  const unpaidInv = invoices.find((i) => i.balance > 0) || invoices[0];
                  if (unpaidInv) {
                    setCheckoutInvoice(unpaidInv);
                    setCheckoutAmount((unpaidInv.balance / 100).toString());
                    setIsCheckoutModalOpen(true);
                  }
                }}
                className="mt-4 w-full py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer text-center"
              >
                Simulate Checkout Flow
              </button>
            </div>

            {/* Manual Bursary Gateway */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-sm text-slate-900">Manual Bursary</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-800">
                    Desk Entry
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Physical cash collection, bank teller submissions, POS slip reconciliation with 2-step verification.
                </p>
                <div className="mt-3 pt-3 border-t border-slate-100 text-[11px] space-y-1">
                  <div className="flex justify-between text-slate-600">
                    <span>Authorization:</span>
                    <span className="font-bold text-slate-800">Bursar Role</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Audit Trail:</span>
                    <span className="font-mono text-emerald-700">Immutable</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  const unpaidInv = invoices.find((i) => i.balance > 0) || invoices[0];
                  if (unpaidInv) {
                    setPaymentInvoice(unpaidInv);
                    setPayAmount((unpaidInv.balance / 100).toString());
                    setIsPaymentModalOpen(true);
                  }
                }}
                className="mt-4 w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer text-center"
              >
                Record Manual Entry
              </button>
            </div>
          </div>

          {/* Webhook Architecture & Integration Hub */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" /> Secure Webhook Integration Endpoints
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Point external payment gateways to these endpoints. All webhook events are logged, validated, and processed with strict idempotency.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <span className="text-xs font-bold text-slate-700 block">Paystack Webhook URL:</span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`${window.location.origin}/api/v1/webhooks/payments/paystack`}
                    className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/api/v1/webhooks/payments/paystack`);
                      setWebhookCopied(true);
                      setTimeout(() => setWebhookCopied(false), 2000);
                    }}
                    className="p-2 bg-slate-200 hover:bg-slate-300 rounded-xl text-slate-700 cursor-pointer"
                    title="Copy URL"
                  >
                    {webhookCopied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <span className="text-xs font-bold text-slate-700 block">Flutterwave Webhook URL:</span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`${window.location.origin}/api/v1/webhooks/payments/flutterwave`}
                    className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/api/v1/webhooks/payments/flutterwave`);
                      setWebhookCopied(true);
                      setTimeout(() => setWebhookCopied(false), 2000);
                    }}
                    className="p-2 bg-slate-200 hover:bg-slate-300 rounded-xl text-slate-700 cursor-pointer"
                    title="Copy URL"
                  >
                    {webhookCopied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Webhook Execution Result Console */}
            {webhookResult && (
              <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between text-emerald-400 font-bold">
                  <span>✓ Webhook Processed Successfully</span>
                  <span className="text-slate-400 text-[11px]">{new Date().toLocaleTimeString()}</span>
                </div>
                <div className="text-slate-300">
                  Receipt Number: <span className="font-bold text-white">{webhookResult.receiptNumber}</span>
                </div>
                <div className="text-slate-400 text-[11px]">
                  Payment ID: {webhookResult.paymentId} &bull; Idempotency check verified &bull; Ledger updated
                </div>
              </div>
            )}
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
          {/* Sub-tab navigation for reports */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setReportSubTab('summary')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  reportSubTab === 'summary' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Summary Realization
              </button>
              <button
                onClick={() => setReportSubTab('daily')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  reportSubTab === 'daily' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Daily Collections
              </button>
              <button
                onClick={() => setReportSubTab('monthly')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  reportSubTab === 'monthly' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Monthly Revenue
              </button>
              <button
                onClick={() => setReportSubTab('defaulters')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  reportSubTab === 'defaulters' ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Outstanding Defaulters ({defaulters.length})
              </button>
            </div>

            <div className="flex items-center gap-2">
              <a
                href={`/api/v1/school/finance/reports/export-csv?type=${reportSubTab === 'defaulters' ? 'invoices&status=OVERDUE' : 'payments'}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Export {reportSubTab.toUpperCase()} CSV
              </a>
            </div>
          </div>

          {/* SubTab 1: Summary Realization */}
          {reportSubTab === 'summary' && (
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

          {/* SubTab 2: Daily Collections Report */}
          {reportSubTab === 'daily' && (
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
              <div>
                <h4 className="font-bold text-slate-900 text-sm">Daily Collection Log (Last 14 Days)</h4>
                <p className="text-xs text-slate-500">Day-by-day cash flow audit for verified payments</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4 text-center">Transactions</th>
                      <th className="py-3 px-4 text-right">Total Amount (NGN)</th>
                      <th className="py-3 px-4 text-right">Avg. Receipt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {dailyReports.length > 0 ? (
                      dailyReports.map((d, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-bold text-slate-900">{d.date}</td>
                          <td className="py-3 px-4 text-center">
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 font-bold">
                              {d.count}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700">
                            ₦{d.total_naira.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-slate-600">
                            ₦{d.count > 0 ? (d.total_naira / d.count).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0.00'}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-400 italic">
                          No daily transactions recorded in this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SubTab 3: Monthly Collections */}
          {reportSubTab === 'monthly' && (
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
              <div>
                <h4 className="font-bold text-slate-900 text-sm">Monthly Revenue Trend</h4>
                <p className="text-xs text-slate-500">Aggregate fee realization by calendar month</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                      <th className="py-3 px-4">Month</th>
                      <th className="py-3 px-4 text-center">Transactions</th>
                      <th className="py-3 px-4 text-right">Revenue (NGN)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {monthlyReports.length > 0 ? (
                      monthlyReports.map((m, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-bold text-slate-900 font-mono">{m.month}</td>
                          <td className="py-3 px-4 text-center">{m.count}</td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700">
                            ₦{m.total_naira.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="py-8 text-center text-slate-400 italic">
                          No monthly records found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SubTab 4: Defaulters / Outstanding Balances */}
          {reportSubTab === 'defaulters' && (
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600" /> Outstanding Fee Defaulters
                  </h4>
                  <p className="text-xs text-slate-500">Students with uncollected invoice balances</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                      <th className="py-3 px-4">Student Name</th>
                      <th className="py-3 px-4">Admission #</th>
                      <th className="py-3 px-4">Class</th>
                      <th className="py-3 px-4 text-right">Total Billed</th>
                      <th className="py-3 px-4 text-right">Paid</th>
                      <th className="py-3 px-4 text-right text-rose-700">Outstanding Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {defaulters.length > 0 ? (
                      defaulters.map((d, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-bold text-slate-900">{d.student_name}</td>
                          <td className="py-3 px-4 font-mono text-slate-600">{d.admission_number}</td>
                          <td className="py-3 px-4">{d.class_name || 'N/A'}</td>
                          <td className="py-3 px-4 text-right font-mono">
                            ₦{d.total_billed_naira.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-emerald-700">
                            ₦{d.total_paid_naira.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-rose-700">
                            ₦{d.outstanding_balance_naira.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setReminderModalDefaulter(d);
                                  setReminderResult(null);
                                  setReminderCustomNote('');
                                }}
                                className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-xs cursor-pointer"
                                title="Send WhatsApp & SMS Fee Notice"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                                <span>Send Notice</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-emerald-600 font-bold italic">
                          🎉 All student fees are currently settled in full!
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          MODAL: SEND PARENT FEE REMINDER NOTICE (WHATSAPP & SMS)
      ========================================================================== */}
      {reminderModalDefaulter && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-emerald-600" />
                <span>Dispatch Outstanding Fee Notice</span>
              </h3>
              <button
                onClick={() => setReminderModalDefaulter(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-full cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Student:</span>
                <span className="font-bold text-slate-900">{reminderModalDefaulter.student_name} ({reminderModalDefaulter.admission_number})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Class:</span>
                <span className="font-semibold text-slate-800">{reminderModalDefaulter.class_name || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Parent / Guardian:</span>
                <span className="font-bold text-slate-900">{reminderModalDefaulter.parent_name || 'Parent'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Registered Phone:</span>
                <span className="font-mono text-emerald-700 font-bold">{reminderModalDefaulter.parent_phone || 'None on file'}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 mt-1.5">
                <span className="text-rose-700 font-bold">Outstanding Balance:</span>
                <span className="font-mono font-bold text-rose-700 text-sm">
                  ₦{reminderModalDefaulter.outstanding_balance_naira.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {reminderResult ? (
              <div className="space-y-4">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 space-y-2">
                  <p className="font-bold flex items-center gap-1.5 text-emerald-700">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Notice Dispatched to Audit &amp; Logs!
                  </p>
                  <p className="text-[11px] text-slate-700 font-mono bg-white p-2.5 rounded-xl border border-emerald-100">
                    "{reminderResult.messageText}"
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <a
                    href={reminderResult.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs shadow-md transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span>Open 1-Click WhatsApp Chat</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(reminderResult.messageText);
                      alert('Reminder text copied to clipboard!');
                    }}
                    className="py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition cursor-pointer"
                  >
                    Copy Text
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendReminder(reminderModalDefaulter.student_id, reminderCustomNote);
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Custom Note or Grace Period (Optional)
                  </label>
                  <input
                    type="text"
                    value={reminderCustomNote}
                    onChange={(e) => setReminderCustomNote(e.target.value)}
                    placeholder="e.g. Please clear balance on or before Friday to receive report card."
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setReminderModalDefaulter(null)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={reminderSending}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-md transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{reminderSending ? 'Generating Notice...' : 'Generate & Dispatch Notice'}</span>
                  </button>
                </div>
              </form>
            )}
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

              {/* Pending Verification Option */}
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-1">
                <label className="flex items-center gap-2 cursor-pointer font-bold text-amber-900 text-xs">
                  <input
                    type="checkbox"
                    checked={isPendingPayment}
                    onChange={(e) => setIsPendingPayment(e.target.checked)}
                    className="w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500"
                  />
                  <span>Log as Pending Verification (Awaiting Bank Reconciliation)</span>
                </label>
                <p className="text-[11px] text-amber-700 pl-6">
                  Check if guardian submitted teller slip and bursar needs to verify bank statement before issuing official receipt.
                </p>
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
                  {actionLoading ? 'Recording...' : isPendingPayment ? 'Submit for Verification' : 'Confirm Payment & Issue Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: ONLINE CHECKOUT SIMULATOR
      ========================================================================== */}
      {isCheckoutModalOpen && checkoutInvoice && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Zap className="w-5 h-5 text-purple-600" /> Online Payment Simulator
              </h3>
              <button onClick={() => setIsCheckoutModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 bg-purple-50 rounded-xl text-xs space-y-1 text-purple-950 border border-purple-100">
              <div>Invoice: <span className="font-mono font-bold">{checkoutInvoice.invoice_number}</span></div>
              <div>Student: <span className="font-bold">{checkoutInvoice.student_name}</span></div>
              <div>Balance: <span className="font-mono font-black text-purple-700">₦{(checkoutInvoice.balance / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
            </div>

            <form onSubmit={handleSimulateOnlineCheckout} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Gateway Provider *</label>
                <select
                  value={checkoutProvider}
                  onChange={(e: any) => setCheckoutProvider(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 focus:outline-hidden"
                >
                  <option value="TEST_SANDBOX">Instant Sandbox Simulator (Zero Setup)</option>
                  <option value="PAYSTACK">Paystack Gateway Checkout</option>
                  <option value="FLUTTERWAVE">Flutterwave Gateway Checkout</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Payment Amount (₦) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  max={checkoutInvoice.balance / 100}
                  value={checkoutAmount}
                  onChange={(e) => setCheckoutAmount(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Payer Email</label>
                <input
                  type="email"
                  placeholder="parent@student.sch.ng"
                  value={checkoutEmail}
                  onChange={(e) => setCheckoutEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                />
              </div>

              <div className="p-3 bg-slate-50 rounded-xl text-[11px] text-slate-500 space-y-1 border border-slate-200">
                <div className="font-bold text-slate-700 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Deterministic Verification
                </div>
                <p>
                  Backend verifies reference, minor units (kobo), currency (NGN) and generates official receipt voucher.
                </p>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCheckoutModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={checkoutSimulating}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  {checkoutSimulating ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Verifying...
                    </>
                  ) : (
                    'Confirm Online Checkout'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Official Printable Receipt Modal */}
      <PrintableReceiptModal
        receipt={selectedReceipt}
        isOpen={isReceiptModalOpen}
        onClose={() => setIsReceiptModalOpen(false)}
      />

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
