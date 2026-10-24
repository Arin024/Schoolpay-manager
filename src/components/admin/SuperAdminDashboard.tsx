import React, { useEffect, useState } from 'react';
import {
  Shield,
  Building2,
  Search,
  Filter,
  Eye,
  CheckCircle2,
  AlertTriangle,
  History,
  RefreshCw,
  X,
  CreditCard,
  Layers,
  DollarSign,
  Users,
  UserCheck,
  Plus,
  ArrowUpRight,
  TrendingUp,
  Percent,
  Settings,
  ShieldAlert,
  Sliders,
  ExternalLink,
  ChevronRight,
  Check,
  Calendar,
  Lock,
  Activity,
  Server,
  Database,
  HardDrive,
  Trash2,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import {
  School,
  SchoolStatus,
  AuditLog,
  PlatformStats,
  SubscriptionPlan,
  SchoolSubscription,
  PlatformPayment,
  Partner,
  Commission,
  User,
} from '../../types/index.js';
import { SchoolStatusBadge } from '../common/StatusBadge.js';
import { SCHOOL_STATUSES, NIGERIAN_STATES, SCHOOL_TYPES } from '../../constants/index.js';
import {
  CreateSchoolModal,
  AssignSubscriptionModal,
} from './AdminModals.js';
import { DataProtectionView } from './DataProtectionView.js';

export const SuperAdminDashboard: React.FC = () => {
  const { startImpersonation } = useAuth();

  // Navigation
  type AdminNavTab =
    | 'dashboard'
    | 'schools'
    | 'subscriptions'
    | 'plans'
    | 'revenue'
    | 'partners'
    | 'commissions'
    | 'platform_users'
    | 'audit_logs'
    | 'usage'
    | 'data_protection'
    | 'settings';

  const [activeNav, setActiveNav] = useState<AdminNavTab>('dashboard');

  // Core Data States
  const [platformStats, setPlatformStats] = useState<PlatformStats | null>(null);
  const [usageMetrics, setUsageMetrics] = useState<any | null>(null);
  const [schools, setSchools] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<SchoolSubscription[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [revenueData, setRevenueData] = useState<any | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [platformUsers, setPlatformUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Loading & Filter States
  const [loading, setLoading] = useState(true);
  const [schoolSearch, setSchoolSearch] = useState('');
  const [schoolStatusFilter, setSchoolStatusFilter] = useState('ALL');
  const [schoolPlanFilter, setSchoolPlanFilter] = useState('ALL');
  const [schoolStateFilter, setSchoolStateFilter] = useState('ALL');

  // Selected School Detail Drawer
  const [selectedSchool, setSelectedSchool] = useState<any | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [schoolDetails, setSchoolDetails] = useState<any | null>(null);

  // Modals
  const [isCreateSchoolOpen, setIsCreateSchoolOpen] = useState(false);
  const [statusModalSchool, setStatusModalSchool] = useState<any | null>(null);
  const [deleteModalSchool, setDeleteModalSchool] = useState<any | null>(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [newStatus, setNewStatus] = useState<SchoolStatus>('ACTIVE');
  const [statusReason, setStatusReason] = useState('');
  const [statusSubmitting, setStatusSubmitting] = useState(false);

  const [assignSubModalSchool, setAssignSubModalSchool] = useState<any | null>(null);

  // Plan Edit / Create Modal
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [planForm, setPlanForm] = useState({
    name: '',
    display_name: '',
    description: '',
    price_naira: 0,
    billing_interval: 'TERM',
    student_limit: 250,
    staff_limit: 30,
    storage_limit_mb: 1000,
    active: 1,
    feature_flags: {
      student_management: true,
      financial_management: true,
      online_payments: true,
      reports: true,
      parent_portal: true,
      notifications: true,
      exports: true,
      advanced_analytics: false,
      api_access: false,
      custom_branding: false,
    },
  });

  // Partner Modal
  const [partnerModalOpen, setPartnerModalOpen] = useState(false);
  const [partnerForm, setPartnerForm] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    partner_type: 'REFERRAL' as 'REFERRAL' | 'BANK' | 'INTEGRATION' | 'RESELLER',
    commission_rate: 10.0,
    referral_code: '',
    notes: '',
  });

  // Impersonation state
  const [impersonatingSchoolId, setImpersonatingSchoolId] = useState<string | null>(null);

  // Advanced SaaS Controls state
  const [pendingPayments, setPendingPayments] = useState<any[]>([]);
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [platformSettings, setPlatformSettings] = useState<any>(null);
  const [customSubModalOpen, setCustomSubModalOpen] = useState(false);
  const [customSubForm, setCustomSubForm] = useState({
    school_id: '',
    plan_id: 'plan_standard',
    negotiated_price_naira: '',
    discount_amount_naira: '',
    discount_reason: '',
    final_amount_naira: '',
    billing_interval: 'ANNUAL',
    duration_months: 12,
    status: 'ACTIVE',
    notes: '',
  });

  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [discountForm, setDiscountForm] = useState({
    code: '',
    name: '',
    discount_type: 'PERCENTAGE' as 'PERCENTAGE' | 'FIXED',
    discount_value: 15,
    school_id: '',
    plan_id: '',
    expires_at: '',
    notes: '',
  });

  // Load telemetry
  const loadData = async () => {
    setLoading(true);
    try {
      const [
        statsRes,
        schoolsRes,
        subsRes,
        plansRes,
        revRes,
        partnersRes,
        commRes,
        usersRes,
        logsRes,
        pendingPayRes,
        settingsRes,
        discountsRes,
        usageRes,
      ] = await Promise.all([
        api.getAdminStats().catch(() => ({ stats: null })),
        api.getAdminSchools().catch(() => ({ schools: [] })),
        api.getAdminSubscriptions().catch(() => ({ subscriptions: [] })),
        api.getAdminPlans().catch(() => ({ plans: [] })),
        api.getAdminRevenue().catch(() => ({ revenue: null })),
        api.getAdminPartners().catch(() => ({ partners: [] })),
        api.getAdminCommissions().catch(() => ({ commissions: [] })),
        api.getAdminUsers().catch(() => ({ users: [] })),
        api.getAdminAuditLogs().catch(() => ({ logs: [] })),
        api.getAdminPlatformPayments({ status: 'PENDING' }).catch(() => ({ payments: [] })),
        api.getAdminPlatformSettings().catch(() => ({ settings: null })),
        api.getAdminDiscounts().catch(() => ({ discounts: [] })),
        api.getPlatformUsageMetrics().catch(() => ({ usage: null })),
      ]);

      if (statsRes?.stats) setPlatformStats(statsRes.stats);
      if (usageRes?.usage) setUsageMetrics(usageRes.usage);
      if (schoolsRes?.schools) setSchools(schoolsRes.schools);
      if (subsRes?.subscriptions) setSubscriptions(subsRes.subscriptions);
      if (plansRes?.plans) setPlans(plansRes.plans);
      if (revRes?.revenue) setRevenueData(revRes.revenue);
      if (partnersRes?.partners) setPartners(partnersRes.partners);
      if (commRes?.commissions) setCommissions(commRes.commissions);
      if (usersRes?.users) setPlatformUsers(usersRes.users);
      if (logsRes?.logs) setAuditLogs(logsRes.logs);
      if (pendingPayRes?.payments) setPendingPayments(pendingPayRes.payments);
      if (settingsRes?.settings) setPlatformSettings(settingsRes.settings);
      if (discountsRes?.discounts) setDiscounts(discountsRes.discounts);
    } catch (err) {
      console.error('Failed to load Super Admin dashboard telemetry:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // School Details View
  const viewDetails = async (school: any) => {
    setSelectedSchool(school);
    setDetailsLoading(true);
    try {
      const res = await api.getAdminSchoolDetails(school.id);
      setSchoolDetails(res);
    } catch (err) {
      console.error('Failed to load school details:', err);
    } finally {
      setDetailsLoading(false);
    }
  };

  // Status Change Handler
  const handleDeleteSchoolSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteModalSchool) return;
    if (deleteConfirmationText.trim().toLowerCase() !== deleteModalSchool.name.trim().toLowerCase()) {
      setDeleteError(`Please type the exact school name "${deleteModalSchool.name}" to confirm deletion.`);
      return;
    }

    setDeleteSubmitting(true);
    setDeleteError('');
    try {
      await api.deleteSchool(deleteModalSchool.id, deleteConfirmationText.trim());
      setDeleteModalSchool(null);
      setDeleteConfirmationText('');
      await loadData();
      if (selectedSchool && selectedSchool.id === deleteModalSchool.id) {
        setSelectedSchool(null);
      }
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete school account');
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const handleUpdateStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModalSchool) return;

    setStatusSubmitting(true);
    try {
      await api.updateSchoolStatus(statusModalSchool.id, newStatus, statusReason);
      setStatusModalSchool(null);
      setStatusReason('');
      await loadData();
      if (selectedSchool && selectedSchool.id === statusModalSchool.id) {
        viewDetails(statusModalSchool);
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to update status');
    } finally {
      setStatusSubmitting(false);
    }
  };

  // Support Impersonation Handler
  const handleImpersonate = async (schoolId: string, schoolName: string) => {
    const confirmed = window.confirm(
      `INITIATE SUPPORT IMPERSONATION SESSION\n\nYou are about to enter a delegated, short-lived session for "${schoolName}".\n\n• An explicit PLATFORM AUDIT LOG event will be recorded.\n• You will see an amber Impersonation Banner at all times.\n• You can exit back to Super Admin at any time.\n\nProceed?`
    );
    if (!confirmed) return;

    setImpersonatingSchoolId(schoolId);
    try {
      const res = await api.impersonateSchool(schoolId, undefined, 'Super Admin support investigation');
      if (res && res.impersonationToken) {
        await startImpersonation(res.impersonationToken, schoolId);
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to initiate support impersonation');
    } finally {
      setImpersonatingSchoolId(null);
    }
  };

  // Plan creation / editing handler
  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingPlan) {
        await api.updateAdminPlan(editingPlan.id, {
          display_name: planForm.display_name,
          description: planForm.description,
          price_naira: Number(planForm.price_naira),
          student_limit: Number(planForm.student_limit),
          staff_limit: Number(planForm.staff_limit),
          storage_limit_mb: Number(planForm.storage_limit_mb),
          feature_flags: planForm.feature_flags,
          active: planForm.active,
        });
      } else {
        await api.createAdminPlan({
          name: planForm.name,
          display_name: planForm.display_name,
          description: planForm.description,
          price_naira: Number(planForm.price_naira),
          billing_interval: planForm.billing_interval as any,
          student_limit: Number(planForm.student_limit),
          staff_limit: Number(planForm.staff_limit),
          storage_limit_mb: Number(planForm.storage_limit_mb),
          feature_flags: planForm.feature_flags,
        });
      }
      setPlanModalOpen(false);
      setEditingPlan(null);
      await loadData();
    } catch (err: any) {
      alert(err?.message || 'Failed to save plan');
    }
  };

  // Partner creation handler
  const handleSavePartner = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createAdminPartner(partnerForm);
      setPartnerModalOpen(false);
      setPartnerForm({
        name: '',
        email: '',
        phone: '',
        company: '',
        partner_type: 'REFERRAL',
        commission_rate: 10.0,
        referral_code: '',
        notes: '',
      });
      await loadData();
    } catch (err: any) {
      alert(err?.message || 'Failed to create partner');
    }
  };

  // Commission status update handler
  const handleUpdateCommissionStatus = async (commId: string, status: string) => {
    try {
      await api.updateCommissionStatus(commId, status);
      await loadData();
    } catch (err: any) {
      alert(err?.message || 'Failed to update commission');
    }
  };

  // Filtered Schools calculation
  const filteredSchools = schools.filter((s) => {
    const term = schoolSearch.toLowerCase().trim();
    const matchesSearch =
      !term ||
      s.name.toLowerCase().includes(term) ||
      s.email.toLowerCase().includes(term) ||
      s.phone.toLowerCase().includes(term) ||
      s.slug.toLowerCase().includes(term) ||
      s.id.toLowerCase().includes(term);

    const matchesStatus = schoolStatusFilter === 'ALL' || s.status === schoolStatusFilter;
    const matchesPlan = schoolPlanFilter === 'ALL' || s.current_plan_id === schoolPlanFilter;
    const matchesState = schoolStateFilter === 'ALL' || s.state === schoolStateFilter;

    return matchesSearch && matchesStatus && matchesPlan && matchesState;
  });

  return (
    <div className="space-y-6">
      {/* ==================================================================== */}
      {/* TOP PLATFORM GOVERNANCE BANNER                                        */}
      {/* ==================================================================== */}
      <div className="bg-gradient-to-r from-purple-950 via-slate-900 to-indigo-950 rounded-2xl p-6 sm:p-8 text-white border border-purple-800/40 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-400/30 text-xs font-bold uppercase tracking-wider">
              <Shield className="w-3.5 h-3.5 text-purple-300" />
              <span>Platform Super Admin Control Center</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              SaaS Ecosystem Governance
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl">
              Strict multi-tenant boundary. Global telemetry, SaaS subscription pricing, school lifecycle enforcement, and financial oversight.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              onClick={() => setIsCreateSchoolOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md transition"
            >
              <Plus className="w-4 h-4" />
              <span>Provision School</span>
            </button>
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-2 px-3.5 py-2 bg-purple-900/60 hover:bg-purple-800/80 border border-purple-700/60 rounded-xl text-xs font-semibold text-purple-200 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh Telemetry</span>
            </button>
          </div>
        </div>

        {/* Global Quick Telemetry Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 sm:gap-3 mt-6 pt-6 border-t border-purple-900/40 relative z-10">
          <div className="bg-slate-900/80 p-2.5 rounded-xl border border-purple-900/40">
            <p className="text-[10px] text-slate-400 font-semibold uppercase">Total Schools</p>
            <p className="text-lg font-black text-white mt-0.5">{platformStats?.totalSchools ?? schools.length}</p>
          </div>
          <div className="bg-slate-900/80 p-2.5 rounded-xl border border-purple-900/40">
            <p className="text-[10px] text-slate-400 font-semibold uppercase">Active Tenants</p>
            <p className="text-lg font-black text-emerald-400 mt-0.5">{platformStats?.activeSchools ?? 0}</p>
          </div>
          <div className="bg-slate-900/80 p-2.5 rounded-xl border border-purple-900/40">
            <p className="text-[10px] text-slate-400 font-semibold uppercase">Trial Status</p>
            <p className="text-lg font-black text-blue-400 mt-0.5">{platformStats?.trialSchools ?? 0}</p>
          </div>
          <div className="bg-slate-900/80 p-2.5 rounded-xl border border-purple-900/40">
            <p className="text-[10px] text-slate-400 font-semibold uppercase">Suspended</p>
            <p className="text-lg font-black text-rose-400 mt-0.5">{platformStats?.suspendedSchools ?? 0}</p>
          </div>
          <div className="bg-slate-900/80 p-2.5 rounded-xl border border-purple-900/40">
            <p className="text-[10px] text-slate-400 font-semibold uppercase">Total Learners</p>
            <p className="text-lg font-black text-teal-300 mt-0.5">{platformStats?.totalStudents ?? 0}</p>
          </div>
          <div className="bg-slate-900/80 p-2.5 rounded-xl border border-purple-900/40">
            <p className="text-[10px] text-slate-400 font-semibold uppercase">Active Subs</p>
            <p className="text-lg font-black text-purple-300 mt-0.5">{platformStats?.activeSubscriptions ?? 0}</p>
          </div>
          <div className="bg-slate-900/80 p-2.5 rounded-xl border border-purple-900/40">
            <p className="text-[10px] text-slate-400 font-semibold uppercase">SaaS Revenue</p>
            <p className="text-lg font-black text-amber-300 mt-0.5">₦{(platformStats?.platformRevenueNaira ?? 0).toLocaleString()}</p>
          </div>
          <div className="bg-slate-900/80 p-2.5 rounded-xl border border-purple-900/40">
            <p className="text-[10px] text-slate-400 font-semibold uppercase">Partners</p>
            <p className="text-lg font-black text-indigo-300 mt-0.5">{platformStats?.totalPartners ?? partners.length}</p>
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* SUPER ADMIN DEDICATED NAVIGATION BAR (Section 12 requirement)        */}
      {/* ==================================================================== */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-1.5 flex flex-wrap items-center gap-1">
        {[
          { id: 'dashboard', label: 'Dashboard', icon: Shield },
          { id: 'schools', label: `Schools (${schools.length})`, icon: Building2 },
          { id: 'subscriptions', label: `Subscriptions (${subscriptions.length})`, icon: CreditCard },
          { id: 'plans', label: `Plans (${plans.length})`, icon: Layers },
          { id: 'revenue', label: 'Revenue', icon: DollarSign },
          { id: 'partners', label: `Partners (${partners.length})`, icon: Users },
          { id: 'commissions', label: `Commissions (${commissions.length})`, icon: Percent },
          { id: 'platform_users', label: `Platform Users (${platformUsers.length})`, icon: UserCheck },
          { id: 'audit_logs', label: `Audit Logs (${auditLogs.length})`, icon: History },
          { id: 'usage', label: 'Platform Usage & Capacity', icon: Activity },
          { id: 'data_protection', label: 'Data Protection & Backups', icon: Database },
          { id: 'settings', label: 'Settings', icon: Settings },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeNav === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveNav(tab.id as AdminNavTab)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                isActive
                  ? 'bg-purple-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-purple-50 hover:text-purple-900'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-purple-300' : 'text-slate-400'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ==================================================================== */}
      {/* 1. DASHBOARD OVERVIEW TAB                                            */}
      {/* ==================================================================== */}
      {activeNav === 'dashboard' && (
        <div className="space-y-6">
          {/* Revenue Isolation Distinction Banner (Section 7 requirement) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gradient-to-br from-purple-900 to-indigo-950 text-white p-5 rounded-2xl border border-purple-800/60 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-300">
                  Platform SaaS Subscription Revenue
                </span>
                <span className="px-2 py-0.5 bg-purple-500/20 text-purple-200 border border-purple-400/30 rounded text-[10px] font-bold">
                  PLATFORM EARNINGS
                </span>
              </div>
              <p className="text-3xl font-black mt-2 text-white">
                ₦{(platformStats?.platformRevenueNaira ?? 0).toLocaleString()}
              </p>
              <p className="text-xs text-purple-200 mt-1">
                Fees paid BY schools TO BursarIQ for platform access &amp; plans.
              </p>
            </div>

            <div className="bg-gradient-to-br from-emerald-900 to-slate-900 text-white p-5 rounded-2xl border border-emerald-800/60 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                  Total School-Collected Money
                </span>
                <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 rounded text-[10px] font-bold">
                  TENANT BURSARY
                </span>
              </div>
              <p className="text-3xl font-black mt-2 text-white">
                ₦{(platformStats?.schoolCollectedRevenueNaira ?? 0).toLocaleString()}
              </p>
              <p className="text-xs text-emerald-200 mt-1">
                School fees collected BY individual schools FROM parents (completely segregated).
              </p>
            </div>
          </div>

          {/* School Status Breakdown Grid (Section 1 & 3 requirements) */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Building2 className="w-4 h-4 text-purple-600" />
              <span>School Institutional Network Breakdown</span>
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <p className="text-[10px] font-bold text-emerald-800 uppercase">ACTIVE</p>
                <p className="text-xl font-black text-emerald-950 mt-1">{platformStats?.activeSchools ?? 0}</p>
                <p className="text-[10px] text-emerald-700 mt-0.5">Full write access</p>
              </div>
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                <p className="text-[10px] font-bold text-blue-800 uppercase">TRIAL</p>
                <p className="text-xl font-black text-blue-950 mt-1">{platformStats?.trialSchools ?? 0}</p>
                <p className="text-[10px] text-blue-700 mt-0.5">Evaluation window</p>
              </div>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-[10px] font-bold text-amber-800 uppercase">GRACE PERIOD</p>
                <p className="text-xl font-black text-amber-950 mt-1">{platformStats?.graceSchools ?? 0}</p>
                <p className="text-[10px] text-amber-700 mt-0.5">Renewal pending</p>
              </div>
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl">
                <p className="text-[10px] font-bold text-rose-800 uppercase">SUSPENDED</p>
                <p className="text-xl font-black text-rose-950 mt-1">{platformStats?.suspendedSchools ?? 0}</p>
                <p className="text-[10px] text-rose-700 mt-0.5">Data locked, preserved</p>
              </div>
              <div className="p-3 bg-slate-100 border border-slate-300 rounded-xl">
                <p className="text-[10px] font-bold text-slate-700 uppercase">EXPIRED</p>
                <p className="text-xl font-black text-slate-900 mt-1">{platformStats?.expiredSchools ?? 0}</p>
                <p className="text-[10px] text-slate-600 mt-0.5">Read-only history</p>
              </div>
              <div className="p-3 bg-slate-100 border border-slate-300 rounded-xl">
                <p className="text-[10px] font-bold text-slate-700 uppercase">CANCELLED</p>
                <p className="text-xl font-black text-slate-900 mt-1">{platformStats?.cancelledSchools ?? 0}</p>
                <p className="text-[10px] text-slate-600 mt-0.5">Archived safely</p>
              </div>
            </div>
          </div>

          {/* Recent Platform Activity Audit Log (Section 1 & 9 requirements) */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <History className="w-4 h-4 text-purple-600" />
                <span>Recent Platform Ecosystem Activity</span>
              </h3>
              <button
                onClick={() => setActiveNav('audit_logs')}
                className="text-xs font-bold text-purple-600 hover:text-purple-700 flex items-center gap-1"
              >
                <span>View All Logs</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px] bg-slate-50/60">
                    <th className="py-2.5 px-3">Event Action</th>
                    <th className="py-2.5 px-3">School Tenant</th>
                    <th className="py-2.5 px-3">Actor Email</th>
                    <th className="py-2.5 px-3">IP Address</th>
                    <th className="py-2.5 px-3">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {(platformStats?.recentActivity || auditLogs.slice(0, 8)).map((log: any) => {
                    const isViolation = log.action === 'IDOR_SECURITY_VIOLATION' || log.action === 'UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT';
                    return (
                      <tr key={log.id} className={isViolation ? 'bg-red-50/60' : 'hover:bg-slate-50/50'}>
                        <td className="py-2 px-3 font-sans">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                              isViolation
                                ? 'bg-red-600 text-white animate-pulse'
                                : 'bg-slate-100 text-slate-800'
                            }`}
                          >
                            {log.action}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-700 font-sans">
                          {log.school_name || log.school_id || <span className="text-slate-400 italic">Platform Level</span>}
                        </td>
                        <td className="py-2 px-3 text-slate-600 font-sans">{log.actor_email || 'System'}</td>
                        <td className="py-2 px-3 text-slate-400">{log.ip_address || '—'}</td>
                        <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 2. SCHOOLS DIRECTORY & SEARCH TAB                                    */}
      {/* ==================================================================== */}
      {activeNav === 'schools' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
            <div>
              <h3 className="text-base font-bold text-slate-900">Registered Schools</h3>
              <p className="text-xs text-slate-500">Search and govern isolated school partitions across Nigeria.</p>
            </div>
            <button
              onClick={() => setIsCreateSchoolOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition shadow-sm self-start sm:self-auto"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Register New School</span>
            </button>
          </div>

          {/* Search by name, email, phone, identifier, status, plan, state (Section 2 requirement) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={schoolSearch}
                onChange={(e) => setSchoolSearch(e.target.value)}
                placeholder="Search name, email, phone, ID..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:border-purple-500"
              />
            </div>

            <div>
              <select
                value={schoolStatusFilter}
                onChange={(e) => setSchoolStatusFilter(e.target.value)}
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2"
              >
                <option value="ALL">All Lifecycle Statuses</option>
                {SCHOOL_STATUSES.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={schoolPlanFilter}
                onChange={(e) => setSchoolPlanFilter(e.target.value)}
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2"
              >
                <option value="ALL">All SaaS Plans</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name}</option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={schoolStateFilter}
                onChange={(e) => setSchoolStateFilter(e.target.value)}
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2"
              >
                <option value="ALL">All Nigerian States</option>
                {NIGERIAN_STATES.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Schools Table */}
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-400">Loading school tenants...</div>
          ) : filteredSchools.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">No schools matching search filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px] bg-slate-50/60">
                    <th className="py-3 px-4">School Tenant</th>
                    <th className="py-3 px-4">Location</th>
                    <th className="py-3 px-4">SaaS Plan</th>
                    <th className="py-3 px-4">Lifecycle Status</th>
                    <th className="py-3 px-4">Learners / Staff</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSchools.map((s, idx) => (
                    <tr key={`${s.id}-${idx}`} className="hover:bg-slate-50/50 transition">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-900 text-emerald-400 font-bold flex items-center justify-center text-xs flex-shrink-0">
                            {s.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">{s.name}</p>
                            <p className="text-[11px] text-slate-400 font-mono">
                              ID: {s.id} • {s.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        <p className="font-medium text-slate-800">{s.state}</p>
                        <p className="text-[11px] text-slate-400">{s.lga}</p>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded font-semibold text-[10px]">
                          {s.plan_display_name || s.current_plan_id}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <SchoolStatusBadge status={s.status} />
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">
                        <span>{s.total_students ?? 0} students</span> • <span>{s.total_staff ?? 0} staff</span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => viewDetails(s)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-semibold text-[11px] transition flex items-center gap-1"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Details</span>
                          </button>
                          <button
                            onClick={() => setAssignSubModalSchool(s)}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-md font-semibold text-[11px] transition flex items-center gap-1"
                          >
                            <CreditCard className="w-3 h-3" />
                            <span>Plan</span>
                          </button>
                          <button
                            onClick={() => {
                              setStatusModalSchool(s);
                              setNewStatus(s.status);
                            }}
                            className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-md font-semibold text-[11px] transition"
                          >
                            Status
                          </button>
                          <button
                            onClick={() => {
                              setDeleteModalSchool(s);
                              setDeleteConfirmationText('');
                              setDeleteError('');
                            }}
                            className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-md font-semibold text-[11px] transition flex items-center gap-1"
                            title="Permanently delete school and all data"
                          >
                            <Trash2 className="w-3 h-3 text-red-600" />
                            <span>Delete</span>
                          </button>
                          <button
                            onClick={() => handleImpersonate(s.id, s.name)}
                            disabled={impersonatingSchoolId === s.id}
                            className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-md text-[11px] transition flex items-center gap-1 shadow-xs"
                            title="Audited delegated support session"
                          >
                            <UserCheck className="w-3 h-3" />
                            <span>{impersonatingSchoolId === s.id ? 'Loading...' : 'Impersonate'}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* 3. SUBSCRIPTIONS MANAGEMENT TAB                                      */}
      {/* ==================================================================== */}
      {activeNav === 'subscriptions' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h3 className="font-bold text-slate-900 text-base">Platform Subscription Registry</h3>
              <p className="text-xs text-slate-500">Lifecycle records of all schools on BursarIQ.</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px] bg-slate-50/60">
                  <th className="py-2.5 px-3">School Tenant</th>
                  <th className="py-2.5 px-3">Plan</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Billing Period</th>
                  <th className="py-2.5 px-3">Amount Paid</th>
                  <th className="py-2.5 px-3">Payment Provider</th>
                  <th className="py-2.5 px-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {subscriptions.map((sub: any) => (
                  <tr key={sub.id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-3">
                      <p className="font-bold text-slate-900">{sub.school_name || sub.school_id}</p>
                      <p className="text-[10px] text-slate-400 font-mono">ID: {sub.id}</p>
                    </td>
                    <td className="py-3 px-3">
                      <span className="font-semibold text-slate-800">{sub.plan_display_name || sub.plan_id}</span>
                    </td>
                    <td className="py-3 px-3">
                      <SchoolStatusBadge status={sub.status} size="sm" />
                    </td>
                    <td className="py-3 px-3 text-slate-600 text-[11px]">
                      {sub.start_date} to {sub.end_date}
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-slate-900">
                      ₦{(sub.amount_paid_naira ?? sub.amount_paid / 100).toLocaleString()}
                    </td>
                    <td className="py-3 px-3 text-slate-600">{sub.provider}</td>
                    <td className="py-3 px-3">
                      <button
                        onClick={() => {
                          const schoolMatch = schools.find((s) => s.id === sub.school_id);
                          if (schoolMatch) setAssignSubModalSchool(schoolMatch);
                        }}
                        className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded text-[11px] font-semibold"
                      >
                        Renew / Change
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 4. SUBSCRIPTION PLANS TAB (Configurable Plans & Feature Flags)       */}
      {/* ==================================================================== */}
      {activeNav === 'plans' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">Configurable Subscription Plans</h3>
              <p className="text-xs text-slate-500">
                Plans control pricing intervals and modular feature flags enforced server-side.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setCustomSubForm({
                    school_id: schools[0]?.id || '',
                    plan_id: plans[0]?.id || 'plan_standard',
                    negotiated_price_naira: '',
                    discount_amount_naira: '',
                    discount_reason: '',
                    final_amount_naira: '',
                    billing_interval: 'ANNUAL',
                    duration_months: 12,
                    status: 'ACTIVE',
                    notes: '',
                  });
                  setCustomSubModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
              >
                <DollarSign className="w-3.5 h-3.5" />
                <span>Custom School Pricing</span>
              </button>
              <button
                onClick={() => {
                  setEditingPlan(null);
                  setPlanForm({
                    name: '',
                    display_name: '',
                    description: '',
                    price_naira: 35000,
                    billing_interval: 'TERM',
                    student_limit: 300,
                    staff_limit: 40,
                    storage_limit_mb: 2000,
                    active: 1,
                    feature_flags: {
                      student_management: true,
                      financial_management: true,
                      online_payments: true,
                      reports: true,
                      parent_portal: true,
                      notifications: true,
                      exports: true,
                      advanced_analytics: true,
                      api_access: false,
                      custom_branding: false,
                    },
                  });
                  setPlanModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Custom Plan</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {plans.map((p) => {
              const flags = typeof p.feature_flags === 'string' ? JSON.parse(p.feature_flags) : p.feature_flags || {};
              return (
                <div
                  key={p.id}
                  className={`bg-white rounded-2xl border p-5 shadow-sm space-y-4 flex flex-col justify-between ${
                    p.active ? 'border-purple-200' : 'border-slate-200 opacity-60'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-purple-100 text-purple-800">
                        {p.billing_interval}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {p.subscriber_count ?? 0} schools
                      </span>
                    </div>

                    <h4 className="text-lg font-black text-slate-900">{p.display_name}</h4>
                    <p className="text-xs text-slate-500 line-clamp-2">{p.description || 'Full platform capabilities'}</p>

                    <div className="pt-2">
                      <span className="text-2xl font-black text-purple-900">
                        ₦{(p.price_naira ?? p.price / 100).toLocaleString()}
                      </span>
                      <span className="text-xs text-slate-400"> / {p.billing_interval.toLowerCase()}</span>
                    </div>

                    <div className="pt-3 border-t border-slate-100 space-y-1 text-[11px] text-slate-600">
                      <p>• Up to <strong>{p.student_limit}</strong> Students</p>
                      <p>• Up to <strong>{p.staff_limit}</strong> Staff Members</p>
                      <p>• <strong>{p.storage_limit_mb}MB</strong> Document Storage</p>
                    </div>

                    {/* Feature flags pills */}
                    <div className="pt-3 border-t border-slate-100 space-y-1">
                      <p className="text-[10px] uppercase font-bold text-slate-400">Enforced Feature Flags</p>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(flags).map(([key, enabled]) => (
                          <span
                            key={key}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                              enabled ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-400'
                            }`}
                          >
                            {key.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-slate-100">
                    <button
                      onClick={() => {
                        setEditingPlan(p);
                        setPlanForm({
                          name: p.name,
                          display_name: p.display_name,
                          description: p.description || '',
                          price_naira: p.price_naira ?? p.price / 100,
                          billing_interval: p.billing_interval,
                          student_limit: p.student_limit,
                          staff_limit: p.staff_limit,
                          storage_limit_mb: p.storage_limit_mb,
                          active: p.active,
                          feature_flags: flags,
                        });
                        setPlanModalOpen(true);
                      }}
                      className="w-full py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-800 rounded-lg text-xs font-bold transition text-center cursor-pointer"
                    >
                      Edit Plan &amp; Limits
                    </button>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={async () => {
                          if (confirm(`Duplicate plan "${p.display_name}"?`)) {
                            await api.duplicateAdminPlan(p.id);
                            await loadData();
                          }
                        }}
                        className="py-1 px-2 text-[10px] font-bold text-slate-700 hover:text-purple-700 bg-slate-100 hover:bg-purple-50 rounded-lg transition text-center cursor-pointer"
                      >
                        Duplicate
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm(`Archive / Deactivate plan "${p.display_name}"?`)) {
                            await api.archiveAdminPlan(p.id);
                            await loadData();
                          }
                        }}
                        className="py-1 px-2 text-[10px] font-bold text-rose-700 hover:bg-rose-100 bg-rose-50 rounded-lg transition text-center cursor-pointer"
                      >
                        {p.active ? 'Archive' : 'Archived'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 5. PLATFORM REVENUE TAB                                              */}
      {/* ==================================================================== */}
      {activeNav === 'revenue' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Total Platform SaaS Revenue</span>
              <p className="text-2xl font-black text-purple-900 mt-1">
                ₦{(revenueData?.platformRevenueNaira ?? 0).toLocaleString()}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">Direct subscription billing</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Successful Payments</span>
              <p className="text-2xl font-black text-emerald-600 mt-1">{revenueData?.successfulCount ?? 0}</p>
              <p className="text-[11px] text-emerald-700 mt-1">Settled transactions</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Failed Payments</span>
              <p className="text-2xl font-black text-rose-600 mt-1">{revenueData?.failedCount ?? 0}</p>
              <p className="text-[11px] text-rose-700 mt-1">Declined or abandoned</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Refunds Processed</span>
              <p className="text-2xl font-black text-amber-600 mt-1">{revenueData?.refundedCount ?? 0}</p>
              <p className="text-[11px] text-amber-700 mt-1">Reversals &amp; chargebacks</p>
            </div>
          </div>

          {/* Pending Manual Bank Transfer Verifications (Section 7 requirement) */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                  <span>Offline Bank Transfers Awaiting Review ({pendingPayments.length})</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Direct bank deposits and corporate transfers submitted by schools for SaaS activation.
                </p>
              </div>
            </div>

            {pendingPayments.length === 0 ? (
              <p className="text-xs text-slate-400 py-3 italic">No pending manual bank transfers awaiting review.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px] bg-amber-50/50">
                      <th className="py-2.5 px-3">Reference</th>
                      <th className="py-2.5 px-3">School Tenant</th>
                      <th className="py-2.5 px-3">Target Plan</th>
                      <th className="py-2.5 px-3">Amount</th>
                      <th className="py-2.5 px-3">Depositor / Proof</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-[11px]">
                    {pendingPayments.map((p: any) => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-mono font-bold text-purple-900">{p.internal_reference}</td>
                        <td className="py-2.5 px-3 font-bold text-slate-900">{p.school_name}</td>
                        <td className="py-2.5 px-3">{p.plan_display_name || p.plan_id}</td>
                        <td className="py-2.5 px-3 font-bold font-mono text-emerald-700">₦{(p.amount_naira || p.amount / 100).toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-slate-600 max-w-xs">
                          <p className="font-medium text-slate-800">{p.notes || 'Direct bank deposit'}</p>
                          {(() => {
                            let meta: any = null;
                            try {
                              meta = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata;
                            } catch (e) {}
                            if (meta?.receipt_file) {
                              return (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const win = window.open();
                                    if (win) {
                                      win.document.write(`<iframe src="${meta.receipt_file}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
                                    }
                                  }}
                                  className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold hover:bg-emerald-200 cursor-pointer"
                                >
                                  📎 View Uploaded Receipt ({meta.receipt_filename || 'Document'})
                                </button>
                              );
                            }
                            return null;
                          })()}
                        </td>
                        <td className="py-2.5 px-3 text-right space-x-1.5">
                          <button
                            onClick={async () => {
                              if (confirm(`Approve payment of ₦${(p.amount_naira || p.amount / 100).toLocaleString()} for ${p.school_name}? This will instantly ACTIVATE their subscription.`)) {
                                await api.approvePlatformPayment(p.id, 'Verified by Super Admin');
                                await loadData();
                              }
                            }}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs shadow-xs cursor-pointer"
                          >
                            Approve
                          </button>
                          <button
                            onClick={async () => {
                              const reason = prompt('Enter rejection reason:');
                              if (reason) {
                                await api.rejectPlatformPayment(p.id, reason);
                                await loadData();
                              }
                            }}
                            className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-lg text-xs cursor-pointer"
                          >
                            Reject
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Revenue by Plan */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-900 text-sm">Platform SaaS Revenue by Subscription Plan</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {(revenueData?.revenueByPlan || []).map((rp: any) => (
                <div key={rp.plan_id} className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <p className="font-bold text-slate-800 text-xs">{rp.display_name}</p>
                  <p className="text-xl font-black text-purple-900 mt-1">
                    ₦{(rp.total_naira ?? rp.total_kobo / 100).toLocaleString()}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{rp.payment_count} transactions</p>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Platform Transactions Table */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-900 text-sm">Recent Platform Subscription Billing Events</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px] bg-slate-50/60">
                    <th className="py-2.5 px-3">Reference</th>
                    <th className="py-2.5 px-3">School Tenant</th>
                    <th className="py-2.5 px-3">Plan</th>
                    <th className="py-2.5 px-3">Amount</th>
                    <th className="py-2.5 px-3">Method</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {(revenueData?.transactions || []).map((t: any) => (
                    <tr key={t.id} className="hover:bg-slate-50/50">
                      <td className="py-2.5 px-3 font-bold text-purple-900">{t.internal_reference}</td>
                      <td className="py-2.5 px-3 font-sans text-slate-900">{t.school_name}</td>
                      <td className="py-2.5 px-3 font-sans">{t.plan_display_name || t.plan_id}</td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">
                        ₦{(t.amount_naira ?? t.amount / 100).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">{t.payment_method}</td>
                      <td className="py-2.5 px-3 font-sans">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          {t.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">{new Date(t.paid_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 6. PARTNERS TAB                                                      */}
      {/* ==================================================================== */}
      {activeNav === 'partners' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h3 className="font-bold text-slate-900 text-base">Commercial Partners &amp; Resellers</h3>
              <p className="text-xs text-slate-500">Bank alliances, referral partners, and system integrators.</p>
            </div>
            <button
              onClick={() => setPartnerModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Partner</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px] bg-slate-50/60">
                  <th className="py-2.5 px-3">Partner Name</th>
                  <th className="py-2.5 px-3">Contact Email</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Referral Code</th>
                  <th className="py-2.5 px-3">Commission Rate</th>
                  <th className="py-2.5 px-3">Commissions Paid</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {partners.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-3">
                      <p className="font-bold text-slate-900">{p.name}</p>
                      <p className="text-[11px] text-slate-400">{p.company || 'Individual'}</p>
                    </td>
                    <td className="py-3 px-3 text-slate-600">{p.email}</td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 bg-slate-100 rounded text-[10px] font-semibold text-slate-700">
                        {p.partner_type}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-purple-900">{p.referral_code}</td>
                    <td className="py-3 px-3 font-semibold text-slate-900">{p.commission_rate}%</td>
                    <td className="py-3 px-3 font-mono font-bold text-emerald-700">
                      ₦{(p.paid_commissions_naira ?? 0).toLocaleString()}
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 7. COMMISSIONS TAB                                                   */}
      {/* ==================================================================== */}
      {activeNav === 'commissions' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h3 className="font-bold text-slate-900 text-base">Partner Revenue Share Commissions</h3>
              <p className="text-xs text-slate-500">Track and approve referral commission payouts.</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px] bg-slate-50/60">
                  <th className="py-2.5 px-3">Partner</th>
                  <th className="py-2.5 px-3">Referred School</th>
                  <th className="py-2.5 px-3">Amount</th>
                  <th className="py-2.5 px-3">Commission Rate</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {commissions.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-3 font-bold text-slate-900">{c.partner_name}</td>
                    <td className="py-3 px-3 text-slate-700">{c.school_name || 'Platform referral'}</td>
                    <td className="py-3 px-3 font-mono font-bold text-purple-900">
                      ₦{(c.amount_naira ?? c.amount / 100).toLocaleString()}
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-700">{c.rate_percent}%</td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          c.status === 'PAID'
                            ? 'bg-emerald-100 text-emerald-800'
                            : c.status === 'APPROVED'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      {c.status === 'PENDING' && (
                        <button
                          onClick={() => handleUpdateCommissionStatus(c.id, 'APPROVED')}
                          className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[11px] font-semibold mr-1"
                        >
                          Approve
                        </button>
                      )}
                      {c.status === 'APPROVED' && (
                        <button
                          onClick={() => handleUpdateCommissionStatus(c.id, 'PAID')}
                          className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded text-[11px] font-semibold"
                        >
                          Mark Paid
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 8. PLATFORM USERS TAB                                                */}
      {/* ==================================================================== */}
      {activeNav === 'platform_users' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h3 className="font-bold text-slate-900 text-base">Global Platform Users &amp; Administrators</h3>
              <p className="text-xs text-slate-500">All registered users across school tenants and platform admins.</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px] bg-slate-50/60">
                  <th className="py-2.5 px-3">User</th>
                  <th className="py-2.5 px-3">Email Address</th>
                  <th className="py-2.5 px-3">Platform Privilege</th>
                  <th className="py-2.5 px-3">Account Status</th>
                  <th className="py-2.5 px-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {platformUsers.map((u: any) => (
                  <tr key={u.id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-3">
                      <p className="font-bold text-slate-900">{u.full_name}</p>
                      <p className="text-[10px] text-slate-400 font-mono">ID: {u.id}</p>
                    </td>
                    <td className="py-3 px-3 text-slate-600">{u.email}</td>
                    <td className="py-3 px-3">
                      {u.is_platform_admin === 1 ? (
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-800 border border-purple-200 rounded text-[10px] font-bold">
                          SUPER_ADMIN
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-semibold">
                          TENANT_USER
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-bold">
                        ACTIVE
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-400">{new Date(u.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 9. PLATFORM AUDIT LOGS TAB                                           */}
      {/* ==================================================================== */}
      {activeNav === 'audit_logs' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h3 className="font-bold text-slate-900 text-base">Platform Ecosystem Audit Log Stream</h3>
              <p className="text-xs text-slate-500">
                Tamper-evident log of all school creations, suspensions, logins, plan modifications, and blocked IDOR attempts.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px] bg-slate-50/60">
                  <th className="py-2.5 px-3">Action</th>
                  <th className="py-2.5 px-3">School Tenant</th>
                  <th className="py-2.5 px-3">Actor Email</th>
                  <th className="py-2.5 px-3">Metadata</th>
                  <th className="py-2.5 px-3">IP Address</th>
                  <th className="py-2.5 px-3">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                {auditLogs.map((log) => {
                  const isViolation = log.action === 'IDOR_SECURITY_VIOLATION' || log.action === 'UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT';
                  return (
                    <tr key={log.id} className={isViolation ? 'bg-red-50/60' : 'hover:bg-slate-50/50'}>
                      <td className="py-2.5 px-3 font-sans">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            isViolation
                              ? 'bg-red-600 text-white animate-pulse'
                              : 'bg-slate-100 text-slate-800'
                          }`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-sans text-slate-800">
                        {log.school_name || log.school_id || <span className="text-slate-400 italic">Platform Level</span>}
                      </td>
                      <td className="py-2.5 px-3 font-sans text-slate-600">{log.actor_email || 'System'}</td>
                      <td className="py-2.5 px-3 text-slate-500 max-w-xs truncate">{log.metadata || '—'}</td>
                      <td className="py-2.5 px-3 text-slate-400">{log.ip_address || '—'}</td>
                      <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* DATA PROTECTION & AUTOMATIC BACKUPS TAB                              */}
      {/* ==================================================================== */}
      {activeNav === 'data_protection' && <DataProtectionView />}

      {/* ==================================================================== */}
      {/* 10. SETTINGS TAB                                                     */}
      {/* ==================================================================== */}
      {activeNav === 'settings' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
          <div>
            <h3 className="font-bold text-slate-900 text-base">Super Admin Platform Security &amp; Settings</h3>
            <p className="text-xs text-slate-500">Server-side session policies, password protections, and governance controls.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-purple-50 rounded-xl border border-purple-200 space-y-2">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-purple-700" />
                <h4 className="font-bold text-purple-950 text-xs">Server-Side PBKDF2 Password Hashing</h4>
              </div>
              <p className="text-[11px] text-purple-900">
                100,000 iterations PBKDF2 with SHA-512 and individual cryptographic salts per user. Plaintext passwords are never stored.
              </p>
            </div>

            <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 space-y-2">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-emerald-700" />
                <h4 className="font-bold text-emerald-950 text-xs">Strict Zero-Trust Tenant Isolation</h4>
              </div>
              <p className="text-[11px] text-emerald-900">
                All school data queries enforce SQL WHERE school_id = ? verified from server session. Cross-tenant queries are blocked immediately with critical audit alerts.
              </p>
            </div>

            <div className="p-4 bg-blue-50 rounded-xl border border-blue-200 space-y-2">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-blue-700" />
                <h4 className="font-bold text-blue-950 text-xs">Audited Support Impersonation</h4>
              </div>
              <p className="text-[11px] text-blue-900">
                Short-lived 2-hour delegated sessions with visible banner and zero elevation to Super Admin from school sessions.
              </p>
            </div>

            <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 space-y-2">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-amber-700" />
                <h4 className="font-bold text-amber-950 text-xs">Tenant Data Retention Guarantee</h4>
              </div>
              <p className="text-[11px] text-amber-900">
                Setting a school status to SUSPENDED, EXPIRED, or CANCELLED locks write operations while permanently preserving all financial, student, and academic history.
              </p>
            </div>
          </div>

          {/* Platform Financial & Grace Period Settings (Section 7, 9) */}
          <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h4 className="font-bold text-slate-900 text-sm">Platform Financial &amp; Grace Period Parameters</h4>
                <p className="text-xs text-slate-500">Configurable grace periods, trial duration, and official settlement bank account details.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Default Grace Period (Days)</label>
                <input
                  type="number"
                  value={platformSettings?.default_grace_period_days ?? 7}
                  onChange={(e) => setPlatformSettings({ ...platformSettings, default_grace_period_days: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono bg-white"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Default Free Trial (Days)</label>
                <input
                  type="number"
                  value={platformSettings?.default_trial_days ?? 30}
                  onChange={(e) => setPlatformSettings({ ...platformSettings, default_trial_days: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono bg-white"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Platform Settlement Bank</label>
                <input
                  type="text"
                  value={platformSettings?.platform_bank_name ?? 'Zenith Bank Plc'}
                  onChange={(e) => setPlatformSettings({ ...platformSettings, platform_bank_name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Platform Account Number</label>
                <input
                  type="text"
                  value={platformSettings?.platform_account_number ?? '1012345678'}
                  onChange={(e) => setPlatformSettings({ ...platformSettings, platform_account_number: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono bg-white font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Beneficiary Account Name</label>
                <input
                  type="text"
                  value={platformSettings?.platform_account_name ?? 'BursarIQ Global Ltd'}
                  onChange={(e) => setPlatformSettings({ ...platformSettings, platform_account_name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Official Support &amp; Billing Email</label>
                <input
                  type="email"
                  value={platformSettings?.platform_contact_email ?? 'support@bursariq.com.ng'}
                  onChange={(e) => setPlatformSettings({ ...platformSettings, platform_contact_email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Support Phone / WhatsApp</label>
                <input
                  type="text"
                  value={platformSettings?.platform_contact_phone ?? '08160754659'}
                  onChange={(e) => setPlatformSettings({ ...platformSettings, platform_contact_phone: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={async () => {
                  await api.updateAdminPlatformSettings(platformSettings);
                  alert('Platform settings saved successfully.');
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs shadow-sm cursor-pointer"
              >
                Save Platform Parameters
              </button>
            </div>
          </div>

          {/* Subscription Discounts & Promotional Pricing (Section 4) */}
          <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h4 className="font-bold text-slate-900 text-sm">Subscription Discounts &amp; Promotional Codes</h4>
                <p className="text-xs text-slate-500">Configure promotional or negotiated discounts for target schools.</p>
              </div>
              <button
                onClick={() => setDiscountModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold transition shadow-sm cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Promo Discount</span>
              </button>
            </div>

            {discounts.length === 0 ? (
              <p className="text-xs text-slate-400 py-2 italic">No promotional discounts active.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs bg-white rounded-xl border border-slate-200">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px] bg-slate-50">
                      <th className="py-2.5 px-3">Code</th>
                      <th className="py-2.5 px-3">Name</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Value</th>
                      <th className="py-2.5 px-3">Scope</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-[11px]">
                    {discounts.map((d: any) => (
                      <tr key={d.id}>
                        <td className="py-2.5 px-3 font-mono font-bold text-purple-900">{d.code}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{d.name}</td>
                        <td className="py-2.5 px-3">{d.discount_type}</td>
                        <td className="py-2.5 px-3 font-bold font-mono text-emerald-700">{d.discount_value_display}</td>
                        <td className="py-2.5 px-3 text-slate-500">{d.school_name || 'All Schools'}</td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={async () => {
                              if (confirm(`Delete discount "${d.code}"?`)) {
                                await api.deleteAdminDiscount(d.id);
                                await loadData();
                              }
                            }}
                            className="px-2 py-0.5 text-rose-600 hover:bg-rose-50 rounded text-xs font-bold cursor-pointer"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* PLATFORM USAGE & CAPACITY TAB (Section 14 requirement)               */}
      {/* ==================================================================== */}
      {activeNav === 'usage' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-900 flex items-center justify-center font-bold">
                  <Activity className="w-4 h-4 text-purple-900" />
                </div>
                <h3 className="text-base font-black text-slate-900">Platform Usage &amp; Capacity Monitoring</h3>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Real-time storage utilization, database capacity, integration health, and edge infrastructure thresholds.
              </p>
            </div>
            <button
              onClick={loadData}
              className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer self-start sm:self-auto"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Metrics</span>
            </button>
          </div>

          {/* Infrastructure Capacity Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Database Storage */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Database Storage</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  (usageMetrics?.database?.usagePercent ?? 0) > 80 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {usageMetrics?.database?.status || 'HEALTHY'}
                </span>
              </div>
              <div>
                <p className="text-2xl font-black text-slate-900">
                  {usageMetrics?.database?.fileSizeFormatted || '0.00 MB'}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Limit: {usageMetrics?.database?.freeTierLimitFormatted || '5.00 GB'} (Cloudflare D1 Free Tier)
                </p>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-purple-600 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(1, Math.min(100, (usageMetrics?.database?.usagePercent ?? 0)))}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-400">
                Warning threshold: 80% ({(usageMetrics?.database?.usagePercent ?? 0)}% used)
              </p>
            </div>

            {/* Total School Tenants */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Tenants</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                  {usageMetrics?.entities?.activeSchools || 0} Live
                </span>
              </div>
              <div>
                <p className="text-2xl font-black text-slate-900">
                  {usageMetrics?.entities?.totalSchools || 0}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Total registered schools across Nigeria
                </p>
              </div>
              <p className="text-[11px] text-slate-600">
                <span className="font-bold text-slate-900">{usageMetrics?.entities?.trialSchools || 0}</span> on trial • <span className="font-bold text-slate-900">{usageMetrics?.entities?.suspendedSchools || 0}</span> suspended
              </p>
            </div>

            {/* Total Students Managed */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Students</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">
                  Demographics
                </span>
              </div>
              <div>
                <p className="text-2xl font-black text-slate-900">
                  {(usageMetrics?.entities?.totalStudents || 0).toLocaleString()}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Across all registered school tenants
                </p>
              </div>
              <p className="text-[11px] text-slate-600">
                <span className="font-bold text-slate-900">{(usageMetrics?.entities?.totalUsers || 0).toLocaleString()}</span> total portal user accounts
              </p>
            </div>

            {/* Webhook & Integration Health */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Webhook Reliability</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  (usageMetrics?.webhooks?.failedEvents || 0) === 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                }`}>
                  {usageMetrics?.webhooks?.healthRatePercent ?? 100}% Success
                </span>
              </div>
              <div>
                <p className="text-2xl font-black text-slate-900">
                  {usageMetrics?.webhooks?.totalEvents || 0} Events
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Processed: {usageMetrics?.webhooks?.successfulEvents || 0} • Failed: {usageMetrics?.webhooks?.failedEvents || 0}
                </p>
              </div>
              <p className="text-[11px] text-slate-600">
                Security defense: <span className="font-bold text-emerald-700">{usageMetrics?.security?.totalViolations || 0}</span> IDOR attempts blocked
              </p>
            </div>
          </div>

          {/* Cloudflare Edge & Infrastructure Configuration Status */}
          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-3">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-slate-700" />
              <h4 className="font-bold text-slate-900 text-sm">Edge Infrastructure &amp; Cloudflare D1 Analytics</h4>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {usageMetrics?.database?.cloudflareD1?.setupNotice}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div className="bg-white p-3 rounded-xl border border-slate-200 text-xs">
                <span className="text-slate-400 block font-semibold text-[10px] uppercase">Engine Architecture</span>
                <span className="font-bold text-slate-800">{usageMetrics?.database?.engine}</span>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-200 text-xs">
                <span className="text-slate-400 block font-semibold text-[10px] uppercase">Edge Database UUID</span>
                <span className="font-mono text-slate-800 text-[11px] truncate block">
                  {usageMetrics?.database?.cloudflareD1?.databaseId || 'Local WAL SQLite Mode'}
                </span>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-200 text-xs">
                <span className="text-slate-400 block font-semibold text-[10px] uppercase">Free-Tier Storage Allocation</span>
                <span className="font-bold text-slate-800">5.00 GB max storage</span>
              </div>
            </div>
          </div>

          {/* Tenant Usage Breakdown Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="font-bold text-slate-900 text-sm">Tenant Capacity &amp; Resource Consumption by School</h4>
                <p className="text-xs text-slate-500">Breakdown of student counts, active users, invoice records, and financial volume per school tenant.</p>
              </div>
              <span className="text-xs font-bold text-purple-900 bg-purple-50 px-3 py-1 rounded-full self-start sm:self-auto">
                {usageMetrics?.schoolsBreakdown?.length || schools.length} Schools Tracked
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200 text-[10px]">
                  <tr>
                    <th className="py-3 px-4">School Name</th>
                    <th className="py-3 px-4">State</th>
                    <th className="py-3 px-4">SaaS Plan</th>
                    <th className="py-3 px-4 text-center">Enrolled Students</th>
                    <th className="py-3 px-4 text-center">Users</th>
                    <th className="py-3 px-4 text-center">Invoices</th>
                    <th className="py-3 px-4 text-right">Fee Collections</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {usageMetrics?.schoolsBreakdown && usageMetrics.schoolsBreakdown.length > 0 ? (
                    usageMetrics.schoolsBreakdown.map((s: any, idx: number) => (
                      <tr key={`${s.id}-${idx}`} className="hover:bg-slate-50 transition">
                        <td className="py-3 px-4">
                          <span className="font-bold text-slate-900 block">{s.name}</span>
                          <span className="text-[10px] text-slate-400 font-mono">{s.slug}</span>
                        </td>
                        <td className="py-3 px-4 text-slate-600">{s.state || 'N/A'}</td>
                        <td className="py-3 px-4">
                          <span className="font-semibold text-purple-900 bg-purple-50 px-2 py-0.5 rounded text-[11px]">
                            {s.plan_name || 'Standard'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-bold text-slate-900">
                          {s.student_count ?? 0}
                        </td>
                        <td className="py-3 px-4 text-center text-slate-600">
                          {s.user_count ?? 0}
                        </td>
                        <td className="py-3 px-4 text-center text-slate-600">
                          {s.invoice_count ?? 0}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-emerald-700">
                          ₦{(s.total_collected_naira ?? 0).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <SchoolStatusBadge status={s.status} />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400">
                        No school tenant usage records available.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Infrastructure Limits & Scaling Considerations */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-3">
            <h4 className="font-bold text-slate-900 text-sm">Infrastructure Limits &amp; Upgrade Path</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-600">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="font-bold text-slate-900 block">Cloudflare D1 Capacity</span>
                <p>Free Tier includes 5 GB storage with 5,000,000 read queries and 100,000 write queries per day. Sub-millisecond response across 300+ edge locations.</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="font-bold text-slate-900 block">Growth &amp; Concurrency</span>
                <p>The tenant isolation architecture enforces zero-trust with indexed <code>school_id</code> queries. Supports up to thousands of active schools without database contention.</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="font-bold text-slate-900 block">Threshold Warning &amp; Upgrades</span>
                <p>When storage exceeds the 80% threshold (4 GB), administrators can seamlessly upgrade to Cloudflare Workers Paid ($5/month) for unbounded storage expansion.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* SCHOOL DETAILS DRAWER / MODAL                                        */}
      {/* ==================================================================== */}
      {selectedSchool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
              <div>
                <h3 className="font-bold text-base text-white">{selectedSchool.name}</h3>
                <p className="text-xs text-slate-400 font-mono">Tenant ID: {selectedSchool.id} • Slug: {selectedSchool.slug}</p>
              </div>
              <button
                onClick={() => setSelectedSchool(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 text-xs flex-1">
              {detailsLoading ? (
                <div className="py-12 text-center text-slate-400">Loading school metadata &amp; usage statistics...</div>
              ) : schoolDetails ? (
                <>
                  {/* Status & Plan Bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <div>
                      <span className="text-slate-400 block font-semibold uppercase text-[10px]">Lifecycle Status</span>
                      <div className="mt-1">
                        <SchoolStatusBadge status={schoolDetails.school.status} />
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-semibold uppercase text-[10px]">SaaS Plan</span>
                      <p className="font-bold text-purple-900 mt-1">{schoolDetails.school.plan_display_name || 'Standard'}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-semibold uppercase text-[10px]">Location</span>
                      <p className="font-medium text-slate-800 mt-1">{schoolDetails.school.lga}, {schoolDetails.school.state}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-semibold uppercase text-[10px]">Contact</span>
                      <p className="font-medium text-slate-800 mt-1">{schoolDetails.school.phone}</p>
                      <p className="text-slate-500 truncate">{schoolDetails.school.email}</p>
                    </div>
                  </div>

                  {/* Usage Metrics */}
                  <div className="space-y-2">
                    <h4 className="font-bold text-slate-900 text-sm">Tenant Resource Usage &amp; Bursary Collection</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3 bg-purple-50 rounded-xl border border-purple-200">
                        <span className="text-[10px] text-purple-700 font-bold uppercase">Enrolled Students</span>
                        <p className="text-xl font-black text-purple-950 mt-0.5">{schoolDetails.usage?.students ?? 0}</p>
                      </div>
                      <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-200">
                        <span className="text-[10px] text-indigo-700 font-bold uppercase">Staff Members</span>
                        <p className="text-xl font-black text-indigo-950 mt-0.5">{schoolDetails.usage?.staff ?? 0}</p>
                      </div>
                      <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                        <span className="text-[10px] text-emerald-700 font-bold uppercase">School Fees Collected</span>
                        <p className="text-lg font-black text-emerald-950 mt-0.5">
                          ₦{(schoolDetails.usage?.totalCollectedNaira ?? 0).toLocaleString()}
                        </p>
                      </div>
                      <div className="p-3 bg-rose-50 rounded-xl border border-rose-200">
                        <span className="text-[10px] text-rose-700 font-bold uppercase">Outstanding Fees</span>
                        <p className="text-lg font-black text-rose-950 mt-0.5">
                          ₦{(schoolDetails.usage?.outstandingNaira ?? 0).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Registered Users */}
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm mb-2">Registered School Users ({schoolDetails.users.length})</h4>
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                      {schoolDetails.users.map((u: any) => (
                        <div key={u.id} className="p-3 bg-white flex items-center justify-between">
                          <div>
                            <p className="font-bold text-slate-800">{u.full_name}</p>
                            <p className="text-[11px] text-slate-500">{u.email}</p>
                          </div>
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-semibold rounded text-[10px]">
                            {u.role_display_name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Subscription History */}
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm mb-2">Subscription History ({schoolDetails.subscriptions?.length ?? 0})</h4>
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden text-[11px]">
                      {(schoolDetails.subscriptions || []).map((sub: any) => (
                        <div key={sub.id} className="p-3 bg-white flex items-center justify-between">
                          <div>
                            <span className="font-bold text-slate-900">{sub.plan_display_name || sub.plan_id}</span>
                            <span className="text-slate-500 ml-2">({sub.start_date} to {sub.end_date})</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold font-mono text-purple-900">
                              ₦{((sub.amount_paid || 0) / 100).toLocaleString()}
                            </span>
                            <SchoolStatusBadge status={sub.status} size="sm" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recent School Audit Trail */}
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm mb-2">Recent School Audit Events</h4>
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden text-[11px] font-mono">
                      {(schoolDetails.recentLogs || []).map((l: any) => (
                        <div key={l.id} className="p-2.5 bg-white flex items-center justify-between">
                          <div>
                            <span className="font-bold text-slate-900">{l.action}</span>
                            <span className="text-slate-500 ml-2 font-sans">by {l.actor_email}</span>
                          </div>
                          <span className="text-slate-400">{new Date(l.created_at).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex items-center justify-between">
              <button
                onClick={() => {
                  setSelectedSchool(null);
                  handleImpersonate(selectedSchool.id, selectedSchool.name);
                }}
                className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Support Impersonation</span>
              </button>

              <button
                onClick={() => setSelectedSchool(null)}
                className="px-4 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* PERMANENTLY DELETE SCHOOL MODAL */}
      {deleteModalSchool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-red-200 overflow-hidden">
            <div className="bg-red-900 px-6 py-4 flex items-center justify-between text-white">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-red-800 flex items-center justify-center text-red-300">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">Permanent School Account Deletion</h3>
                  <p className="text-[11px] text-red-300">Super Admin Irreversible Purge</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteModalSchool(null)}
                className="p-1 hover:bg-red-800 rounded-md text-red-200 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleDeleteSchoolSubmit} className="p-6 space-y-4">
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-900 text-xs">
                <p className="font-bold flex items-center gap-1.5 mb-1 text-red-700">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  Warning: This action CANNOT be undone!
                </p>
                <p className="text-[11px] leading-relaxed text-red-800">
                  You are about to permanently delete <strong>{deleteModalSchool.name}</strong> from both Neon PostgreSQL and all local caches. This will immediately purge:
                </p>
                <ul className="list-disc list-inside mt-1.5 space-y-0.5 text-[11px] text-red-700 font-medium">
                  <li>All student, staff, and parent records</li>
                  <li>All fee structures, invoices, and payment receipts</li>
                  <li>All proprietor, bursar, and school user login credentials</li>
                  <li>Active subscriptions and custom settings</li>
                </ul>
              </div>

              {deleteError && (
                <div className="p-3 bg-red-100 border border-red-300 rounded-lg text-red-800 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{deleteError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  To confirm deletion, please type the school name:
                </label>
                <div className="p-2 bg-slate-100 rounded-md text-xs font-mono font-bold text-slate-800 mb-2 select-all">
                  {deleteModalSchool.name}
                </div>
                <input
                  type="text"
                  required
                  value={deleteConfirmationText}
                  onChange={(e) => setDeleteConfirmationText(e.target.value)}
                  placeholder="Type exact school name here"
                  className="w-full px-3 py-2 text-xs border border-red-300 focus:border-red-500 rounded-lg focus:ring-1 focus:ring-red-500 outline-hidden font-medium"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setDeleteModalSchool(null)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deleteSubmitting}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs shadow-md transition disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{deleteSubmitting ? 'Purging School...' : 'Permanently Delete School'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CHANGE STATUS MODAL                                                  */}
      {/* ==================================================================== */}
      {statusModalSchool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white">
              <div>
                <h3 className="font-bold text-sm text-white">Update School Account Lifecycle Status</h3>
                <p className="text-[11px] text-slate-400">{statusModalSchool.name}</p>
              </div>
              <button
                onClick={() => setStatusModalSchool(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateStatus} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Select New Status</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as SchoolStatus)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold"
                >
                  {SCHOOL_STATUSES.map((st) => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Administrative Note / Reason</label>
                <textarea
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  placeholder="e.g. Termly subscription renewal, or temporary freeze"
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-[11px] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Tenant Data Guarantee:</strong> Setting status to SUSPENDED, EXPIRED, or CANCELLED temporarily locks write operations for school users, but <strong>NEVER deletes</strong> any school data.
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStatusModalSchool(null)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={statusSubmitting}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg shadow disabled:opacity-50"
                >
                  {statusSubmitting ? 'Updating...' : 'Confirm Status Change'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* CREATE SCHOOL MODAL                                                  */}
      {/* ==================================================================== */}
      <CreateSchoolModal
        isOpen={isCreateSchoolOpen}
        onClose={() => setIsCreateSchoolOpen(false)}
        plans={plans}
        onSubmit={async (data) => {
          await api.createAdminSchool(data);
          await loadData();
        }}
      />

      {/* ==================================================================== */}
      {/* ASSIGN / RENEW SUBSCRIPTION MODAL                                    */}
      {/* ==================================================================== */}
      <AssignSubscriptionModal
        school={assignSubModalSchool}
        plans={plans}
        isOpen={Boolean(assignSubModalSchool)}
        onClose={() => setAssignSubModalSchool(null)}
        onSubmit={async (schoolId, data) => {
          await api.assignSchoolSubscription(schoolId, data);
          await loadData();
        }}
      />

      {/* ==================================================================== */}
      {/* CREATE / EDIT SUBSCRIPTION PLAN MODAL                                */}
      {/* ==================================================================== */}
      {planModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white">
              <div>
                <h3 className="font-bold text-sm text-white">
                  {editingPlan ? `Edit Plan: ${editingPlan.display_name}` : 'Create Subscription Plan'}
                </h3>
                <p className="text-[11px] text-slate-400">Configure quotas &amp; modular feature restrictions</p>
              </div>
              <button
                onClick={() => setPlanModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePlan} className="p-6 overflow-y-auto space-y-4 text-xs flex-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Code / Name *</label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editingPlan)}
                    value={planForm.name}
                    onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                    placeholder="ENTERPRISE_PLUS"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg uppercase"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Display Title *</label>
                  <input
                    type="text"
                    required
                    value={planForm.display_name}
                    onChange={(e) => setPlanForm({ ...planForm, display_name: e.target.value })}
                    placeholder="Enterprise Plus Tier"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Description</label>
                <input
                  type="text"
                  value={planForm.description}
                  onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                  placeholder="Targeted at multi-branch institutions"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Price (₦ Naira) *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={planForm.price_naira}
                    onChange={(e) => setPlanForm({ ...planForm, price_naira: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Billing Interval</label>
                  <select
                    value={planForm.billing_interval}
                    onChange={(e) => setPlanForm({ ...planForm, billing_interval: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="ONE_TIME">One-Time / Perpetual</option>
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly (Every 3 Months)</option>
                    <option value="SEMI_ANNUAL">Semi-Annual (Every 6 Months)</option>
                    <option value="ANNUAL">Annual (Every 12 Months)</option>
                    <option value="TERM">Termly (Every 4 Months)</option>
                    <option value="CUSTOM">Custom Interval</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Student Quota</label>
                  <input
                    type="number"
                    value={planForm.student_limit}
                    onChange={(e) => setPlanForm({ ...planForm, student_limit: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Staff Quota</label>
                  <input
                    type="number"
                    value={planForm.staff_limit}
                    onChange={(e) => setPlanForm({ ...planForm, staff_limit: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Storage (MB)</label>
                  <input
                    type="number"
                    value={planForm.storage_limit_mb}
                    onChange={(e) => setPlanForm({ ...planForm, storage_limit_mb: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {/* Modular Feature Flags Checkboxes (Section 5 requirement) */}
              <div className="space-y-2 pt-2 border-t border-slate-200">
                <label className="block font-bold text-slate-900 uppercase text-[11px]">
                  Feature Flags (Server-Enforced Access)
                </label>
                <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  {Object.keys(planForm.feature_flags).map((flagKey) => {
                    const isChecked = (planForm.feature_flags as any)[flagKey];
                    return (
                      <label key={flagKey} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) =>
                            setPlanForm({
                              ...planForm,
                              feature_flags: {
                                ...planForm.feature_flags,
                                [flagKey]: e.target.checked,
                              },
                            })
                          }
                          className="rounded text-purple-600 focus:ring-purple-500"
                        />
                        <span className="capitalize">{flagKey.replace(/_/g, ' ')}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setPlanModalOpen(false)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg shadow"
                >
                  Save Subscription Plan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* CREATE PARTNER MODAL                                                 */}
      {/* ==================================================================== */}
      {partnerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white">
              <h3 className="font-bold text-sm text-white">Add Commercial Partner</h3>
              <button
                onClick={() => setPartnerModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePartner} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Partner / Firm Name *</label>
                <input
                  type="text"
                  required
                  value={partnerForm.name}
                  onChange={(e) => setPartnerForm({ ...partnerForm, name: e.target.value })}
                  placeholder="Zenith Education Solutions"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Email *</label>
                  <input
                    type="email"
                    required
                    value={partnerForm.email}
                    onChange={(e) => setPartnerForm({ ...partnerForm, email: e.target.value })}
                    placeholder="partner@zenith.com"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={partnerForm.phone}
                    onChange={(e) => setPartnerForm({ ...partnerForm, phone: e.target.value })}
                    placeholder="+234 803 000 0000"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Partner Type</label>
                  <select
                    value={partnerForm.partner_type}
                    onChange={(e) => setPartnerForm({ ...partnerForm, partner_type: e.target.value as any })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="REFERRAL">Referral Agent</option>
                    <option value="BANK">Commercial Bank</option>
                    <option value="INTEGRATION">System Integrator</option>
                    <option value="RESELLER">Regional Reseller</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Commission Rate (%)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={partnerForm.commission_rate}
                    onChange={(e) => setPartnerForm({ ...partnerForm, commission_rate: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Referral Code (Optional)</label>
                <input
                  type="text"
                  value={partnerForm.referral_code}
                  onChange={(e) => setPartnerForm({ ...partnerForm, referral_code: e.target.value })}
                  placeholder="ZENITH-LAGOS"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono uppercase"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPartnerModalOpen(false)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg shadow"
                >
                  Add Partner
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ==================================================================== */}
      {/* 11. CUSTOM SCHOOL PRICING MODAL (Section 2 & 3)                      */}
      {/* ==================================================================== */}
      {customSubModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-base">Custom School Pricing &amp; Plan Override</h3>
              </div>
              <button onClick={() => setCustomSubModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Set negotiated pricing for a specific school without modifying the global standard plans. The backend stores this agreed price authoritatively.
            </p>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const res = await api.createCustomSchoolSubscription(customSubForm.school_id, {
                    plan_id: customSubForm.plan_id,
                    negotiated_price_naira: customSubForm.negotiated_price_naira ? Number(customSubForm.negotiated_price_naira) : undefined,
                    discount_amount_naira: customSubForm.discount_amount_naira ? Number(customSubForm.discount_amount_naira) : 0,
                    discount_reason: customSubForm.discount_reason,
                    final_amount_naira: customSubForm.final_amount_naira ? Number(customSubForm.final_amount_naira) : undefined,
                    billing_interval: customSubForm.billing_interval,
                    duration_months: Number(customSubForm.duration_months),
                    status: customSubForm.status,
                    notes: customSubForm.notes,
                  });
                  alert(res.message);
                  setCustomSubModalOpen(false);
                  await loadData();
                } catch (err: any) {
                  alert(err.message || 'Failed to assign custom subscription');
                }
              }}
              className="space-y-3 text-xs"
            >
              <div>
                <label className="block font-bold text-slate-700 mb-1">Target School *</label>
                <select
                  required
                  value={customSubForm.school_id}
                  onChange={(e) => setCustomSubForm({ ...customSubForm, school_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  {schools.map((s, idx) => (
                    <option key={`${s.id}-${idx}`} value={s.id}>
                      {s.name} ({s.slug})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Target Plan *</label>
                  <select
                    value={customSubForm.plan_id}
                    onChange={(e) => setCustomSubForm({ ...customSubForm, plan_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name} (Std: ₦{(p.price_naira || p.price / 100).toLocaleString()})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Billing Interval</label>
                  <select
                    value={customSubForm.billing_interval}
                    onChange={(e) => setCustomSubForm({ ...customSubForm, billing_interval: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="ANNUAL">Annual (1 Year)</option>
                    <option value="SEMI_ANNUAL">Semi-Annual (6 Months)</option>
                    <option value="QUARTERLY">Quarterly (3 Months)</option>
                    <option value="MONTHLY">Monthly (1 Month)</option>
                    <option value="TERM">Termly (4 Months)</option>
                    <option value="CUSTOM">Custom Interval</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Negotiated Price (₦ Naira)</label>
                  <input
                    type="number"
                    placeholder="e.g. 135000"
                    value={customSubForm.negotiated_price_naira}
                    onChange={(e) => setCustomSubForm({ ...customSubForm, negotiated_price_naira: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Discount Amount (₦ Naira)</label>
                  <input
                    type="number"
                    placeholder="e.g. 15000"
                    value={customSubForm.discount_amount_naira}
                    onChange={(e) => setCustomSubForm({ ...customSubForm, discount_amount_naira: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Final Authoritative Charge (₦)</label>
                  <input
                    type="number"
                    placeholder="Leave blank to auto-calculate"
                    value={customSubForm.final_amount_naira}
                    onChange={(e) => setCustomSubForm({ ...customSubForm, final_amount_naira: e.target.value })}
                    className="w-full px-3 py-2 border border-emerald-300 rounded-lg font-mono font-bold text-emerald-800"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Duration (Months)</label>
                  <input
                    type="number"
                    value={customSubForm.duration_months}
                    onChange={(e) => setCustomSubForm({ ...customSubForm, duration_months: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Discount / Negotiation Reason</label>
                <input
                  type="text"
                  placeholder="e.g. Multi-campus discount agreed by management"
                  value={customSubForm.discount_reason}
                  onChange={(e) => setCustomSubForm({ ...customSubForm, discount_reason: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setCustomSubModalOpen(false)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white font-bold rounded-lg shadow"
                >
                  Activate Custom Subscription
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 12. CREATE PROMO DISCOUNT MODAL (Section 4)                          */}
      {/* ==================================================================== */}
      {discountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="font-bold text-slate-900 text-base">Create Subscription Discount</h3>
              <button onClick={() => setDiscountModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api.createAdminDiscount({
                    code: discountForm.code,
                    name: discountForm.name,
                    discount_type: discountForm.discount_type,
                    discount_value: Number(discountForm.discount_value),
                    school_id: discountForm.school_id || undefined,
                    plan_id: discountForm.plan_id || undefined,
                    expires_at: discountForm.expires_at || undefined,
                    notes: discountForm.notes || undefined,
                  });
                  alert('Discount created successfully.');
                  setDiscountModalOpen(false);
                  await loadData();
                } catch (err: any) {
                  alert(err.message || 'Failed to create discount');
                }
              }}
              className="space-y-3 text-xs"
            >
              <div>
                <label className="block font-bold text-slate-700 mb-1">Discount Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Early Adopter 20%"
                  value={discountForm.name}
                  onChange={(e) => setDiscountForm({ ...discountForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Promo Code</label>
                  <input
                    type="text"
                    placeholder="e.g. WELCOME20"
                    value={discountForm.code}
                    onChange={(e) => setDiscountForm({ ...discountForm, code: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono uppercase font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Type</label>
                  <select
                    value={discountForm.discount_type}
                    onChange={(e) => setDiscountForm({ ...discountForm, discount_type: e.target.value as any })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="PERCENTAGE">Percentage (%)</option>
                    <option value="FIXED">Fixed Amount (₦ Naira)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Discount Value ({discountForm.discount_type === 'PERCENTAGE' ? '%' : '₦ Naira'}) *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  value={discountForm.discount_value}
                  onChange={(e) => setDiscountForm({ ...discountForm, discount_value: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Attach to Specific School (Optional)</label>
                <select
                  value={discountForm.school_id}
                  onChange={(e) => setDiscountForm({ ...discountForm, school_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  <option value="">Global (All Schools)</option>
                  {schools.map((s, idx) => (
                    <option key={`${s.id}-${idx}`} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setDiscountModalOpen(false)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg shadow"
                >
                  Create Discount
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
