import { PWAUpdateNotification } from './components/common/PWAUpdateNotification.tsx';
import React, { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { api } from './services/api.js';
import { Header } from './components/common/Header.js';
import { Footer } from './components/common/Footer.js';
import { LoginForm } from './components/auth/LoginForm.js';
import { RegisterForm } from './components/auth/RegisterForm.js';
import { ForgotPasswordModal } from './components/auth/ForgotPasswordModal.js';
import { SecuritySettingsModal } from './components/auth/SecuritySettingsModal.js';
import { SchoolStudentsView } from './components/school/SchoolStudentsView.js';
import { SchoolDashboardOverview } from './components/school/SchoolDashboardOverview.js';
import { SchoolClassesView } from './components/school/SchoolClassesView.js';
import { SchoolParentsView } from './components/school/SchoolParentsView.js';
import { SchoolStaffDirectoryView } from './components/school/SchoolStaffDirectoryView.js';
import { SchoolAcademicSessionsView } from './components/school/SchoolAcademicSessionsView.js';
import { SchoolFinanceView } from './components/school/SchoolFinanceView.js';
import { SchoolProfileView } from './components/school/SchoolProfileView.js';
import { SchoolSettingsView } from './components/school/SchoolSettingsView.js';
import { SchoolUsersView } from './components/school/SchoolUsersView.js';
import { SchoolAuditView } from './components/school/SchoolAuditView.js';
import { SchoolSubscriptionView } from './components/school/SchoolSubscriptionView.js';
import { SchoolRecycleBinView } from './components/school/SchoolRecycleBinView.js';
import { SchoolPerformanceView } from './components/performance/SchoolPerformanceView.js';
import { SchoolAttendanceView } from './components/performance/SchoolAttendanceView.js';
import { SchoolBehaviourView } from './components/performance/SchoolBehaviourView.js';
import { SchoolAnnouncementsView } from './components/performance/SchoolAnnouncementsView.js';
import { ParentPortalView } from './components/portal/ParentPortalView.js';
import { StudentPortalView } from './components/portal/StudentPortalView.js';
import { TeacherPortalView } from './components/portal/TeacherPortalView.js';
import { PublicSchoolWebsite } from './components/school/PublicSchoolWebsite.js';
import { SchoolWebsiteManagerView } from './components/school/SchoolWebsiteManagerView.js';
import { AdminStaffDeskView } from './components/school/AdminStaffDeskView.js';
import { SchoolCBTManagerView } from './components/cbt/SchoolCBTManagerView.js';
import { SuperAdminDashboard } from './components/admin/SuperAdminDashboard.js';
import { OfflineIndicator } from './components/common/OfflineIndicator.js';
import { NotFoundPage } from './components/common/NotFoundPage.js';
import { ThankYouPage } from './components/common/ThankYouPage.js';
import { PrivacyPolicyView } from './components/legal/PrivacyPolicyView.js';
import { TermsAndConditionsView } from './components/legal/TermsAndConditionsView.js';
import { CookieConsentBanner } from './components/common/CookieConsentBanner.js';
import { StickyMobileCTA } from './components/common/StickyMobileCTA.js';
import { updateSeo } from './services/seo.js';
import { analytics } from './services/analytics.js';
import {
  Building2,
  Sliders,
  Users,
  History,
  ShieldAlert,
  ShieldCheck,
  GraduationCap,
  Sparkles,
  LayoutDashboard,
  Calendar,
  Briefcase,
  Layers,
  CreditCard,
  Receipt,
  BarChart3,
  CheckCircle2,
  Mail,
  ArrowRight,
  Phone,
  Zap,
  Lock,
  Trash2,
  CalendarCheck,
  MessageSquare,
  Megaphone,
  Globe,
  BookOpen,
  MonitorCheck,
} from 'lucide-react';
import { SchoolStatusBadge } from './components/common/StatusBadge.js';

type AppView = 'school' | 'superadmin' | 'login' | 'register' | 'thank-you' | 'privacy' | 'terms' | '404';
type SchoolTab =
  | 'overview'
  | 'performance'
  | 'cbt'
  | 'attendance'
  | 'behaviour'
  | 'announcements'
  | 'finance'
  | 'subscription'
  | 'students'
  | 'classes'
  | 'parents'
  | 'staff'
  | 'sessions'
  | 'profile'
  | 'website'
  | 'lesson-notes'
  | 'settings'
  | 'users'
  | 'audit'
  | 'recycle-bin'
  | 'security';

const ADMIN_ROLE_NAMES = new Set(['SCHOOL_OWNER', 'SCHOOL_ADMIN']);
const BURSAR_ALLOWED_TABS: SchoolTab[] = [
  'overview',
  'finance',
  'students',
  'parents',
  'subscription',
  'profile',
];
const ALL_SCHOOL_TABS: SchoolTab[] = [
  'overview',
  'performance',
  'cbt',
  'attendance',
  'behaviour',
  'announcements',
  'website',
  'lesson-notes',
  'finance',
  'subscription',
  'students',
  'classes',
  'parents',
  'staff',
  'sessions',
  'profile',
  'settings',
  'users',
  'audit',
  'recycle-bin',
  'security',
];

function isTabAllowedForRole(tab: SchoolTab, roleName: string | undefined, isSuperAdmin: boolean): boolean {
  if (isSuperAdmin || (roleName && ADMIN_ROLE_NAMES.has(roleName))) {
    return true;
  }
  if (roleName === 'BURSAR') {
    return BURSAR_ALLOWED_TABS.includes(tab);
  }
  return tab === 'overview';
}

function parseSitePathSlugFromLocation(): string | null {
  try {
    const pathMatch = window.location.pathname.match(/^\/(?:site|s|portal)\/([^/?#]+)/i);
    if (pathMatch?.[1]) {
      return decodeURIComponent(pathMatch[1].trim());
    }
    return null;
  } catch {
    return null;
  }
}

function parsePortalSlugFromLocation(): string | null {
  try {
    const rawHash = window.location.hash.replace(/^#\/?/, '');
    if (rawHash.toLowerCase().startsWith('portal/')) {
      const slug = rawHash.slice('portal/'.length).split(/[/?#]/)[0]?.trim();
      if (slug) return decodeURIComponent(slug);
    }
    const sitePath = parseSitePathSlugFromLocation();
    if (sitePath) return sitePath;
    const params = new URLSearchParams(window.location.search);
    const qSlug = params.get('portal') || params.get('school');
    return qSlug ? qSlug.trim() : null;
  } catch {
    return null;
  }
}

const AppContent: React.FC = () => {
  const {
    user,
    isSuperAdmin,
    isLoading,
    activeSchool,
    activeSchoolId,
    activeSettings,
    activeRole,
    impersonatedBy,
    enterSchoolAsSuperAdmin,
    exitSchoolWorkspace,
    logout,
  } = useAuth();
  const [activeView, setActiveView] = useState<AppView>('school');
  const [schoolTab, setSchoolTab] = useState<SchoolTab>('overview');
  const [adminSchoolsList, setAdminSchoolsList] = useState<Array<{ id: string; name: string; state?: string }>>([]);
  const [switchingTargetSchool, setSwitchingTargetSchool] = useState(false);
  const [portalSlug, setPortalSlug] = useState<string | null>(() => parsePortalSlugFromLocation());
  const [previewWebsiteSlug, setPreviewWebsiteSlug] = useState<string | null>(() => parseSitePathSlugFromLocation());
  const [registeredSchoolName, setRegisteredSchoolName] = useState<string | undefined>(undefined);
  const [openEnrollOnStudentTab, setOpenEnrollOnStudentTab] = useState(false);
  const [openImportOnStudentTab, setOpenImportOnStudentTab] = useState(false);
  const [isIdorModalOpen, setIsIdorModalOpen] = useState(false);
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);
  const [recoveryTicketFromUrl, setRecoveryTicketFromUrl] = useState<string>('');

  // Load school selector list for SuperAdmin quick workspace switching
  useEffect(() => {
    if (!isSuperAdmin || !user) {
      setAdminSchoolsList([]);
      return;
    }
    api
      .getAdminSchools()
      .then((res) => {
        if (res?.schools) setAdminSchoolsList(res.schools);
      })
      .catch(() => {
        // non-fatal
      });
  }, [isSuperAdmin, user?.id]);

  // Auto-resolve school portal when visiting a branded school subdomain (e.g. brightstars.bursariq.com.ng)
  useEffect(() => {
    if (user || portalSlug) return;
    api
      .getPublicPortalContext()
      .then((res) => {
        if (res?.matched && res.slug) {
          setPortalSlug(res.slug);
        }
      })
      .catch(() => {
        // non-fatal
      });
  }, [user, portalSlug]);

  // Auto-detect password recovery links from email or admin sharing (?recovery_ticket=... or ?token=...)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlTicket = params.get('recovery_ticket') || params.get('reset_token') || params.get('token');
      if (urlTicket) {
        setRecoveryTicketFromUrl(urlTicket);
        setIsForgotModalOpen(true);
        // Clear sensitive token from address bar for privacy
        window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
      }
    } catch {
      // ignore
    }
  }, []);

  // Helper to dynamically update SEO for any view/tab
  const updatePageSeo = useCallback((view: AppView, tab: SchoolTab, schoolName?: string) => {
    switch (view) {
      case 'login':
        updateSeo({
          title: 'Sign In to Your School Portal | BursarIQ',
          description: 'Sign in to your school portal as Administrator, Bursar, Teacher, Parent, or Student to manage academics, report cards, attendance, and tuition.',
        });
        break;
      case 'register':
        updateSeo({
          title: 'Register Your School – 30-Day Free Trial | BursarIQ',
          description: 'Launch your dedicated Nigerian school platform with role-based portals, termly & annual report cards, attendance, and reconciled bursary.',
        });
        break;
      case 'thank-you':
        updateSeo({
          title: 'Registration Successful – Welcome | BursarIQ',
          description: 'Thank you for registering your school with BursarIQ. Get started in minutes.',
        });
        break;
      case 'privacy':
        updateSeo({
          title: 'Privacy Policy & NDPA Compliance | BursarIQ',
          description: 'Read our zero-trust student privacy and Nigerian Data Protection Act (NDPA 2023) commitments.',
        });
        break;
      case 'terms':
        updateSeo({
          title: 'Terms of Service & Commercial SaaS Agreement | BursarIQ',
          description: 'Commercial multi-tenant SaaS agreement, subscription tiers, and school data protection terms.',
        });
        break;
      case '404':
        updateSeo({
          title: 'Page Not Found (404) | BursarIQ',
          description: 'The requested school resource or section was not found on BursarIQ.',
        });
        break;
      case 'superadmin':
        updateSeo({
          title: 'Platform Super Admin Console | BursarIQ',
          description: 'Commercial multi-tenant administration, school provisioning, and audit governance.',
        });
        break;
      case 'school':
      default: {
        const tabTitles: Record<string, string> = {
          overview: 'Overview Dashboard',
          performance: 'Academic Performance & Report Cards',
          cbt: 'Computer-Based Testing (CBT) Centre',
          attendance: 'Attendance Monitoring',
          behaviour: 'Behaviour & Remarks',
          announcements: 'School Announcements',
          finance: 'Fees & Invoicing',
          subscription: 'SaaS Subscription & Billing',
          students: 'Student Admissions & Directory',
          classes: 'Classes & Arms',
          parents: 'Parent Directory',
          staff: 'Staff Directory',
          sessions: 'Academic Sessions & Terms',
          profile: 'School Profile',
          website: 'School Website, Blog & Gallery',
          'lesson-notes': 'Lesson Notes & Staff Desk',
          settings: 'School Configuration',
          users: 'User Roles & Permissions',
          audit: 'Audit Security Trail',
          'recycle-bin': 'Recycle Bin',
          security: 'Tenant Guard Verification',
        };
        const prefix = tabTitles[tab] || 'School Management';
        const name = schoolName ? ` – ${schoolName}` : '';
        updateSeo({
          title: `${prefix}${name} | BursarIQ`,
          description: `Manage ${prefix.toLowerCase()} with real-time tracking and bank-grade privacy on BursarIQ.`,
        });
        break;
      }
    }
  }, []);

  // History-aware navigation that pushes state so phone Back button returns to previous page without closing app!
  const navigateTo = useCallback(
    (view: AppView, tab?: SchoolTab, replace = false) => {
      const safeView: AppView = view === 'superadmin' && !isSuperAdmin ? (user ? 'school' : 'login') : view;
      const requestedTab = tab || schoolTab;
      const nextTab: SchoolTab = isTabAllowedForRole(requestedTab, activeRole?.role_name, isSuperAdmin)
        ? requestedTab
        : 'overview';
      if (tab && tab !== 'students') {
        setOpenEnrollOnStudentTab(false);
        setOpenImportOnStudentTab(false);
      }
      setActiveView(safeView);
      if (tab || nextTab !== schoolTab) {
        setSchoolTab(nextTab);
      }

      let hash = '';
      if (safeView === 'school') {
        hash = `#${nextTab}`;
      } else if (safeView === 'superadmin') {
        hash = '#superadmin';
      } else {
        hash = `#${safeView}`;
      }

      const stateObj = { view: safeView, schoolTab: nextTab };
      if (replace) {
        window.history.replaceState(stateObj, '', hash);
      } else {
        window.history.pushState(stateObj, '', hash);
      }

      updatePageSeo(safeView, nextTab, activeSchool?.name);
      analytics.trackPageView(safeView, hash);
    },
    [schoolTab, activeSchool, activeRole?.role_name, isSuperAdmin, user, updatePageSeo]
  );

  const handleSuperAdminEnterSchool = useCallback(
    async (schoolId: string, initialTab = 'overview', action?: 'enroll' | 'import') => {
      setSwitchingTargetSchool(true);
      try {
        await enterSchoolAsSuperAdmin(schoolId);
        setOpenEnrollOnStudentTab(action === 'enroll');
        setOpenImportOnStudentTab(action === 'import');
        const nextTab: SchoolTab = ALL_SCHOOL_TABS.includes(initialTab as SchoolTab)
          ? (initialTab as SchoolTab)
          : 'overview';
        navigateTo('school', nextTab);
      } finally {
        setSwitchingTargetSchool(false);
      }
    },
    [enterSchoolAsSuperAdmin, navigateTo]
  );

  const handleExitSuperAdminSchool = useCallback(async () => {
    setOpenEnrollOnStudentTab(false);
    setOpenImportOnStudentTab(false);
    await exitSchoolWorkspace();
    navigateTo('superadmin');
  }, [exitSchoolWorkspace, navigateTo]);

  // Enforce allowed tab whenever user, role, or school switches
  useEffect(() => {
    if (!isTabAllowedForRole(schoolTab, activeRole?.role_name, isSuperAdmin)) {
      setSchoolTab('overview');
    }
  }, [user?.id, activeRole?.role_name, activeSchool?.id, isSuperAdmin, schoolTab]);

  // Handle phone / browser hardware or software BACK button (popstate event)
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      // 1. If any modal was open, close it first
      if (isForgotModalOpen) {
        setIsForgotModalOpen(false);
        return;
      }
      if (isSecurityModalOpen) {
        setIsSecurityModalOpen(false);
        return;
      }
      if (isIdorModalOpen) {
        setIsIdorModalOpen(false);
        return;
      }

      // 1b. Sync public school website preview route on browser Back/Forward
      const sitePathSlug = parseSitePathSlugFromLocation();
      setPreviewWebsiteSlug(sitePathSlug);
      if (sitePathSlug) {
        return;
      }

      // 2. If state exists in history event
      if (event.state && event.state.view) {
        const nextView: AppView =
          event.state.view === 'superadmin' && !isSuperAdmin ? (user ? 'school' : 'login') : event.state.view;
        const candidateTab: SchoolTab = event.state.schoolTab || 'overview';
        const safeTab: SchoolTab = isTabAllowedForRole(candidateTab, activeRole?.role_name, isSuperAdmin)
          ? candidateTab
          : 'overview';
        setActiveView(nextView);
        setSchoolTab(safeTab);
        updatePageSeo(nextView, safeTab, activeSchool?.name);
        return;
      }

      // 3. Fallback: Parse URL hash if state was empty
      const rawHashOriginal = window.location.hash.replace(/^#\/?/, '');
      const rawHash = rawHashOriginal.toLowerCase();
      const hash = rawHash.startsWith('school/') ? rawHash.slice('school/'.length) : rawHash;
      if (!hash || hash === 'login' || hash === 'home') {
        const fallbackView = user ? (isSuperAdmin && !activeSchool ? 'superadmin' : 'school') : 'login';
        setActiveView(fallbackView);
        updatePageSeo(fallbackView, 'overview', activeSchool?.name);
      } else if (hash.startsWith('portal/')) {
        const slug = rawHashOriginal.slice('portal/'.length).split(/[/?#]/)[0]?.trim() || null;
        setPortalSlug(slug);
        const fallbackView = user ? (isSuperAdmin && !activeSchool ? 'superadmin' : 'school') : 'login';
        setActiveView(fallbackView);
        updatePageSeo(fallbackView, 'overview', activeSchool?.name);
      } else if (hash === 'register') {
        setActiveView('register');
        updatePageSeo('register', 'overview');
      } else if (hash === 'thank-you') {
        setActiveView('thank-you');
        updatePageSeo('thank-you', 'overview');
      } else if (hash === 'privacy') {
        setActiveView('privacy');
        updatePageSeo('privacy', 'overview');
      } else if (hash === 'terms') {
        setActiveView('terms');
        updatePageSeo('terms', 'overview');
      } else if (hash === 'superadmin') {
        const nextView: AppView = user ? (isSuperAdmin ? 'superadmin' : 'school') : 'login';
        setActiveView(nextView);
        setSchoolTab('overview');
        updatePageSeo(nextView, 'overview', activeSchool?.name);
      } else if (ALL_SCHOOL_TABS.includes(hash as SchoolTab)) {
        const safeTab: SchoolTab = isTabAllowedForRole(hash as SchoolTab, activeRole?.role_name, isSuperAdmin)
          ? (hash as SchoolTab)
          : 'overview';
        setActiveView(user ? 'school' : 'login');
        setSchoolTab(safeTab);
        updatePageSeo(user ? 'school' : 'login', safeTab, activeSchool?.name);
      } else {
        setActiveView('404');
        updatePageSeo('404', 'overview');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [user, isSuperAdmin, activeSchool, activeRole?.role_name, isForgotModalOpen, isSecurityModalOpen, isIdorModalOpen, updatePageSeo]);

  // Initial load and auth state synchronization
  useEffect(() => {
    const rawHashOriginal = window.location.hash.replace(/^#\/?/, '');
    const rawHash = rawHashOriginal.toLowerCase();
    const hash = rawHash.startsWith('school/') ? rawHash.slice('school/'.length) : rawHash;
    const defaultAuthView: AppView = isSuperAdmin && !activeSchool ? 'superadmin' : 'school';
    let initialView: AppView = user ? defaultAuthView : 'login';
    let initialTab: SchoolTab = 'overview';

    if (hash === 'register') {
      initialView = user ? defaultAuthView : 'register';
    } else if (hash === 'login') {
      initialView = user ? defaultAuthView : 'login';
    } else if (hash.startsWith('portal/')) {
      const parsed = rawHashOriginal.slice('portal/'.length).split(/[/?#]/)[0]?.trim() || null;
      setPortalSlug(parsed);
      initialView = user ? defaultAuthView : 'login';
    } else if (hash === 'thank-you') {
      initialView = 'thank-you';
    } else if (hash === 'privacy') {
      initialView = 'privacy';
    } else if (hash === 'terms') {
      initialView = 'terms';
    } else if (hash === 'superadmin') {
      initialView = user ? (isSuperAdmin ? 'superadmin' : 'school') : 'login';
    } else if (ALL_SCHOOL_TABS.includes(hash as SchoolTab)) {
      initialView = user ? 'school' : 'login';
      initialTab = isTabAllowedForRole(hash as SchoolTab, activeRole?.role_name, isSuperAdmin)
        ? (hash as SchoolTab)
        : 'overview';
    } else if (hash && hash !== '' && hash !== '/') {
      initialView = '404';
    }

    setActiveView(initialView);
    setSchoolTab(initialTab);

    // Preserve /site/<handle> live website preview URL for logged-in staff/admins without overwriting pathname
    if (previewWebsiteSlug || parseSitePathSlugFromLocation()) {
      updatePageSeo(initialView, initialTab, activeSchool?.name);
      analytics.trackPageView(initialView, window.location.pathname);
      return;
    }

    // If user is authenticated and on login/register/portal, blank hash, or a disallowed role hash, sanitize URL to dashboard
    if (
      user &&
      (hash === 'login' ||
        hash === 'register' ||
        hash === '' ||
        hash.startsWith('portal/') ||
        (initialView === 'school' && rawHash !== initialTab) ||
        (initialView !== 'superadmin' && rawHash === 'superadmin'))
    ) {
      const targetHash = initialView === 'superadmin' ? '#superadmin' : `#${initialTab}`;
      window.history.replaceState({ view: initialView, schoolTab: initialTab }, '', targetHash);
    } else {
      // Seed baseline history state so phone back button doesn't close on first press
      const preservedHash =
        window.location.hash ||
        (initialView === 'login' && portalSlug
          ? `#portal/${portalSlug}`
          : initialView === 'school'
            ? `#${initialTab}`
            : `#${initialView}`);
      window.history.replaceState({ view: initialView, schoolTab: initialTab }, '', preservedHash);
    }

    updatePageSeo(initialView, initialTab, activeSchool?.name);
    analytics.trackPageView(initialView, window.location.hash);
  }, [user, isSuperAdmin, activeSchool, activeRole?.role_name, previewWebsiteSlug, updatePageSeo]);

  // Handle successful school registration
  const handleRegistrationSuccess = (schoolData: any) => {
    const schoolName = schoolData?.school?.name || 'Your School';
    setRegisteredSchoolName(schoolName);
    navigateTo('thank-you');
  };

  // Open modals with history guard so pressing phone back button closes the modal
  const handleOpenForgotModal = () => {
    setIsForgotModalOpen(true);
    window.history.pushState({ modal: 'forgot-password' }, '');
  };

  const handleOpenIdorModal = () => {
    setIsIdorModalOpen(true);
    window.history.pushState({ modal: 'idor-test' }, '');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 border border-emerald-400/40 text-white flex items-center justify-center font-black text-2xl shadow-xl shadow-emerald-950/50 animate-pulse">
          ₦
        </div>
        <p className="mt-4 text-xs font-bold text-slate-300 tracking-wider uppercase">
          Initializing BursarIQ...
        </p>
      </div>
    );
  }

  const isSchoolPortalContext = Boolean((!user && portalSlug && activeView !== 'register') || (user && previewWebsiteSlug));

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col selection:bg-emerald-500 selection:text-white overflow-x-hidden">
      {/* Universal Top Header */}
      <Header
        onOpenSecuritySettings={() => setIsSecurityModalOpen(true)}
        activeView={activeView}
        setActiveView={(v) => {
          setPreviewWebsiteSlug(null);
          navigateTo(v as AppView);
        }}
        hideRegisterSchool={isSchoolPortalContext}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 min-w-0">
        {/* VIEW ROUTER */}
        {activeView === 'privacy' ? (
          <PrivacyPolicyView onBack={() => navigateTo(user ? 'school' : 'login')} />
        ) : activeView === 'terms' ? (
          <TermsAndConditionsView onBack={() => navigateTo(user ? 'school' : 'login')} />
        ) : activeView === 'thank-you' ? (
          <ThankYouPage
            schoolName={registeredSchoolName || activeSchool?.name}
            onGoToLogin={() => navigateTo('login')}
            onGoToDashboard={user ? () => navigateTo('school', 'overview') : undefined}
          />
        ) : activeView === '404' ? (
          <NotFoundPage
            onGoHome={() => navigateTo(user ? 'school' : 'login')}
            onGoLogin={() => navigateTo('login')}
          />
        ) : user && previewWebsiteSlug ? (
          <PublicSchoolWebsite
            portalSlug={previewWebsiteSlug}
            isLoggedInPreview={true}
            onReturnToDashboard={() => {
              setPreviewWebsiteSlug(null);
              window.history.replaceState({ view: 'school', schoolTab }, '', `/#${schoolTab}`);
            }}
            onClearPortal={() => {
              setPreviewWebsiteSlug(null);
              window.history.replaceState({ view: 'school', schoolTab }, '', `/#${schoolTab}`);
            }}
            onAuthSuccess={() => setPreviewWebsiteSlug(null)}
            onNavigateRegister={() => setPreviewWebsiteSlug(null)}
            onSelectSchoolPortal={(nextSlug) => {
              setPreviewWebsiteSlug(nextSlug);
              window.history.replaceState({ previewWebsiteSlug: nextSlug }, '', `/site/${nextSlug}`);
            }}
          />
        ) : !user ? (
          portalSlug && activeView !== 'register' ? (
            <PublicSchoolWebsite
              portalSlug={portalSlug}
              onClearPortal={() => {
                setPortalSlug(null);
                window.history.replaceState({ view: 'login' }, '', '/#login');
                navigateTo('login', undefined, true);
              }}
              onAuthSuccess={() => {
                setPreviewWebsiteSlug(null);
                setPortalSlug(null);
                window.history.replaceState({ view: 'school', schoolTab: 'overview' }, '', '/#overview');
                navigateTo('school', 'overview', true);
              }}
              onNavigateRegister={() => navigateTo('register')}
              onSelectSchoolPortal={(nextSlug) => {
                setPortalSlug(nextSlug);
                window.history.replaceState({ view: 'login', portalSlug: nextSlug }, '', `/site/${nextSlug}`);
              }}
              onForgotPassword={handleOpenForgotModal}
            />
          ) : (
          /* Public Unauthenticated State */
          <div className="space-y-10">
            {/* Value Proposition Hero & Above-The-Fold CTAs */}
            <div className="text-center max-w-3xl mx-auto pt-4 pb-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold uppercase tracking-wider mb-4 border border-emerald-200">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Built for Nigerian Schools • Instant School Website &amp; Portal</span>
              </div>
              <h1 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight leading-tight">
                One complete school platform.<br className="hidden sm:inline" />
                <span className="text-emerald-700">Website, academics, staff desk &amp; bursary.</span>
              </h1>
              <p className="mt-3 text-sm sm:text-base text-slate-600 max-w-2xl mx-auto">
                The all-in-one digital operating system for Nigerian schools (bursariq.com.ng). Every school receives a shareable public school website &amp; subdomain with news articles and photo gallery, a private Staff Workspace with Nigerian NERDC lesson notes and confidential circulars, Parent/Student portals, report cards, and reconciled fee billing.
              </p>

              {/* Primary Call-To-Action (Above The Fold) */}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    analytics.trackCtaClick('Hero Register Free', 'hero_above_fold');
                    navigateTo('register');
                  }}
                  className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs sm:text-sm shadow-lg shadow-emerald-950/20 transition cursor-pointer flex items-center gap-2"
                >
                  <span>Register School (30-Day Free Trial)</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              {/* Trust Indicators Above The Fold */}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs font-semibold text-slate-500">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  No Credit Card Required
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Instant 2-Minute Setup
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  100% Private &amp; Secure Records
                </span>
              </div>

              {/* View Switcher: Sign In vs Register School */}
              <div className="mt-6 inline-flex p-1 bg-slate-200/80 rounded-xl shadow-inner border border-slate-300/80">
                <button
                  onClick={() => navigateTo('login')}
                  className={`px-5 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                    activeView !== 'register'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign In to Your School
                </button>
                <button
                  onClick={() => navigateTo('register')}
                  className={`px-5 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                    activeView === 'register'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Register Your School
                </button>
              </div>
            </div>

            {/* Active Form */}
            <div id="auth-form-card" className="pb-8 scroll-mt-24">
              {activeView === 'register' ? (
                <RegisterForm
                  onSwitchToLogin={() => navigateTo('login')}
                  onSuccess={handleRegistrationSuccess}
                />
              ) : (
                <LoginForm
                  onSwitchToRegister={() => navigateTo('register')}
                  onForgotPassword={handleOpenForgotModal}
                  onSuccess={() => navigateTo('school', 'overview')}
                  initialPortalSlug={portalSlug}
                  onPortalSlugChange={(slug) => {
                    setPortalSlug(slug);
                    if (!user) {
                      window.history.replaceState({ view: 'login', portalSlug: slug }, '', slug ? `#portal/${slug}` : '#login');
                    }
                  }}
                />
              )}
            </div>

            {/* Comprehensive Public Landing Page Information */}
            <div className="pt-6 pb-12 border-t border-slate-200/80 space-y-12">
              {/* Pillar 1: Who it is designed for & Core Mission */}
              <div className="text-center max-w-3xl mx-auto space-y-2">
                <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                  Everything Your School Needs Across Every Stakeholder
                </h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Designed for Nigerian Nursery &amp; Primary Schools, Secondary Colleges, and K-12 Academies. Replace disconnected spreadsheets, paper result sheets, and payment mix-ups with dedicated portals where Administrators manage official school records, Teachers track classes and report cards, Parents monitor children&apos;s results and fees, and Students view published grades safely.
                </p>
              </div>

              {/* Pillar 2: Feature Matrix Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                    <Users className="w-5 h-5 text-emerald-700" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-base">Role-Separated School Portals</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Every school gets a branded portal link for Proprietors, Admins, Bursars, Teachers, Parents, and Students. Students sign in with their Admission Number and Parents with their Phone Number—never sharing admin logins.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-800 flex items-center justify-center font-bold">
                    <BarChart3 className="w-5 h-5 text-blue-700" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-base">End-of-Term &amp; Full-Session Report Cards</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Record CA and Examination scores across First, Second, and Third Terms, publish approved grades without draft leakage, and generate printable End-of-Term and Cumulative Annual Report Cards with promotion standing.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-800 flex items-center justify-center font-bold">
                    <GraduationCap className="w-5 h-5 text-purple-700" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-base">Nigerian Admissions &amp; Class Directory</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Automatically generate school-coded Nigerian admission numbers on enrollment, manage classes, arms, subjects, staff assignments, parent links, and bulk CSV imports—or request hands-free assisted onboarding.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
                    <CalendarCheck className="w-5 h-5 text-amber-700" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-base">Attendance, Behaviour &amp; Notices</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Maintain daily class attendance registers, record student conduct commendations and discipline remarks, and broadcast targeted school announcements straight to staff, parents, and learners.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-teal-100 text-teal-800 flex items-center justify-center font-bold">
                    <Receipt className="w-5 h-5 text-teal-700" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-base">Smart Bursary &amp; Document Verification</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Manage tuition and levy invoices, flexible partial payments, online parent checkout, and debtor summaries while issuing tamper-proof receipts and report cards verifiable publicly by code.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-800 flex items-center justify-center font-bold">
                    <ShieldCheck className="w-5 h-5 text-rose-700" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-base">Strict Tenant Isolation &amp; Permanent Records</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Every school&apos;s student, academic, and financial ledger is isolated and preserved with role-based permissions, cryptographic audit logging, and soft-delete recovery protection against accidental data loss.
                  </p>
                </div>
              </div>

              {/* Pillar 3: How a School Gets Started (3 Simple Steps) */}
              <div className="bg-slate-900 text-white rounded-3xl p-8 sm:p-10 space-y-8">
                <div className="text-center max-w-2xl mx-auto">
                  <h3 className="text-xl sm:text-2xl font-black tracking-tight">How Your School Gets Started</h3>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1">Launch your school&apos;s complete digital academic and bursary portal in minutes.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="p-5 rounded-2xl bg-slate-800/80 border border-slate-700 space-y-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500 text-slate-950 font-black text-sm flex items-center justify-center">1</div>
                    <h4 className="font-bold text-white text-sm">Register Your School Portal</h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Create your private school workspace and shareable portal link with your institution profile, state, and proprietor account on a 30-day free trial.
                    </p>
                  </div>

                  <div className="p-5 rounded-2xl bg-slate-800/80 border border-slate-700 space-y-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500 text-slate-950 font-black text-sm flex items-center justify-center">2</div>
                    <h4 className="font-bold text-white text-sm">Set Up Classes, Staff &amp; Students</h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Configure Nigerian terms and sessions, add subjects and form teachers, link parents, and auto-generate student admission numbers individually or via CSV import.
                    </p>
                  </div>

                  <div className="p-5 rounded-2xl bg-slate-800/80 border border-slate-700 space-y-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500 text-slate-950 font-black text-sm flex items-center justify-center">3</div>
                    <h4 className="font-bold text-white text-sm">Publish Results, Attendance &amp; Fees</h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Publish End-of-Term and Full-Session report cards, record attendance, issue invoices and verified receipts, and let parents and students activate their own portals.
                    </p>
                  </div>
                </div>

                <div className="text-center pt-2">
                  <button
                    onClick={() => {
                      navigateTo('register');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs sm:text-sm shadow-lg transition cursor-pointer"
                  >
                    <span>Register Your School Now</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Pillar 4: Platform Contact & Inquiries */}
              <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">Need Assistance or Have Questions?</h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Our platform support team is available to assist school owners and bursars with setup and onboarding.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-700">
                  <a
                    href="mailto:support@bursariq.com.ng"
                    className="flex items-center gap-1.5 hover:text-emerald-700 transition"
                  >
                    <Mail className="w-4 h-4 text-emerald-600" />
                    <span>support@bursariq.com.ng</span>
                  </a>
                  <a
                    href="tel:08160754659"
                    className="flex items-center gap-1.5 hover:text-emerald-700 transition"
                  >
                    <Phone className="w-4 h-4 text-emerald-600" />
                    <span>08160754659</span>
                  </a>
                  <a
                    href="https://wa.me/2348160754659"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition"
                  >
                    <span className="font-bold">WhatsApp: 08160754659</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
          )
        ) : isSuperAdmin && (activeView === 'superadmin' || !activeSchool) ? (
          /* Super Admin Platform View */
          <SuperAdminDashboard onEnterSchool={handleSuperAdminEnterSchool} />
        ) : (
          /* Dedicated School Environment */
          <div className="space-y-6">
            {/* Platform SuperAdmin Assisted School Workspace Bar */}
            {isSuperAdmin && activeSchool && !impersonatedBy && (
              <div className="bg-slate-900 text-white rounded-2xl border border-slate-800 px-5 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-emerald-400">
                    Platform SuperAdmin · Assisted School Data Entry Mode
                  </p>
                  <p className="text-xs text-slate-300">
                    Entering and managing records for <strong className="text-white">{activeSchool.name}</strong> without affecting other tenants.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {adminSchoolsList.length > 0 && (
                    <select
                      aria-label="Switch target school workspace"
                      disabled={switchingTargetSchool}
                      value={activeSchoolId || activeSchool.id}
                      onChange={(e) => {
                        if (e.target.value && e.target.value !== activeSchool.id) {
                          handleSuperAdminEnterSchool(e.target.value, schoolTab);
                        }
                      }}
                      className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white cursor-pointer max-w-[240px] truncate"
                    >
                      {adminSchoolsList.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}{s.state ? ` (${s.state})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() => navigateTo('school', 'students')}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold rounded-xl cursor-pointer whitespace-nowrap"
                  >
                    Students
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateTo('school', 'performance')}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold rounded-xl cursor-pointer whitespace-nowrap"
                  >
                    Exams &amp; Report Cards
                  </button>
                  <button
                    type="button"
                    onClick={handleExitSuperAdminSchool}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap"
                  >
                    Return to Platform Console
                  </button>
                </div>
              </div>
            )}

            {/* School Hero Greeting Banner */}
            {activeSchool && (
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 relative overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border-2 border-slate-200 flex items-center justify-center text-white shadow-inner flex-shrink-0">
                      <span className="text-2xl font-black text-emerald-400">
                        {activeSchool.name.charAt(0)}
                      </span>
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs uppercase font-bold tracking-wider text-slate-400">Welcome to</span>
                        <SchoolStatusBadge status={activeSchool.status} size="sm" />
                      </div>
                      <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                        {activeSchool.name}
                      </h1>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {activeSchool.lga}, {activeSchool.state} • {activeSchool.type}
                        {activeSettings && (
                          <span className="ml-2 pl-2 border-l border-slate-200 font-semibold text-emerald-700">
                            Session {activeSettings.current_academic_session} ({activeSettings.current_term})
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200 self-start sm:self-auto">
                    <span className="text-slate-600 font-semibold">Private Tenant Environment</span>
                  </div>
                </div>
              </div>
            )}

            {/* Dedicated Role-Scoped Portals (Parent, Student, Staff/Teacher, Bursar, School Admin, Fail-Closed Fallback) */}
            {activeRole?.role_name === 'PARENT' ? (
              <ParentPortalView />
            ) : activeRole?.role_name === 'STUDENT' ? (
              <StudentPortalView />
            ) : activeRole?.role_name === 'TEACHER' || activeRole?.role_name === 'STAFF' ? (
              <TeacherPortalView />
            ) : activeRole?.role_name === 'BURSAR' ? (
              /* Dedicated Bursar Financial Workspace */
              <>
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-2 flex flex-wrap gap-1">
                  <button
                    onClick={() => navigateTo('school', 'overview')}
                    className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                      schoolTab === 'overview'
                        ? 'bg-slate-900 text-white shadow'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <LayoutDashboard className="w-4 h-4 text-emerald-400" />
                    <span>Overview</span>
                  </button>

                  <button
                    onClick={() => navigateTo('school', 'finance')}
                    className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                      schoolTab === 'finance'
                        ? 'bg-slate-900 text-white shadow'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <CreditCard className="w-4 h-4 text-emerald-400" />
                    <span>Fees &amp; Billing</span>
                  </button>

                  <button
                    onClick={() => navigateTo('school', 'students')}
                    className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                      schoolTab === 'students'
                        ? 'bg-slate-900 text-white shadow'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <GraduationCap className="w-4 h-4 text-emerald-400" />
                    <span>Students</span>
                  </button>

                  <button
                    onClick={() => navigateTo('school', 'parents')}
                    className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                      schoolTab === 'parents'
                        ? 'bg-slate-900 text-white shadow'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Users className="w-4 h-4 text-emerald-400" />
                    <span>Parents</span>
                  </button>

                  <button
                    onClick={() => navigateTo('school', 'subscription')}
                    className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                      schoolTab === 'subscription'
                        ? 'bg-slate-900 text-white shadow'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>SaaS Subscription</span>
                  </button>

                  <button
                    onClick={() => navigateTo('school', 'profile')}
                    className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                      schoolTab === 'profile'
                        ? 'bg-slate-900 text-white shadow'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    <span>Profile</span>
                  </button>
                </div>

                {schoolTab === 'finance' ? (
                  <SchoolFinanceView />
                ) : schoolTab === 'students' ? (
                  <SchoolStudentsView readOnly />
                ) : schoolTab === 'parents' ? (
                  <SchoolParentsView readOnly />
                ) : schoolTab === 'subscription' ? (
                  <SchoolSubscriptionView />
                ) : schoolTab === 'profile' ? (
                  <SchoolProfileView />
                ) : (
                  <SchoolDashboardOverview
                    readOnly
                    onNavigateTab={(tab) => navigateTo('school', tab)}
                    onOpenEnrollModal={() => {}}
                    onOpenImportModal={() => {}}
                  />
                )}
              </>
            ) : isSuperAdmin || activeRole?.role_name === 'SCHOOL_OWNER' || activeRole?.role_name === 'SCHOOL_ADMIN' ? (
            <>
            {/* School Secondary Navigation Tabs (Authorized School Owner / School Admin / Super Admin Only) */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-2 flex flex-wrap gap-1">
              <button
                onClick={() => navigateTo('school', 'overview')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'overview'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <LayoutDashboard className="w-4 h-4 text-emerald-400" />
                <span>Overview</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'performance')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'performance'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <BarChart3 className="w-4 h-4 text-emerald-400" />
                <span>Performance &amp; Reports</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'attendance')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'attendance'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <CalendarCheck className="w-4 h-4 text-emerald-400" />
                <span>Attendance</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'behaviour')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'behaviour'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                <span>Behaviour &amp; Remarks</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'announcements')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'announcements'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Megaphone className="w-4 h-4 text-emerald-400" />
                <span>Announcements</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'cbt')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'cbt'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <MonitorCheck className="w-4 h-4 text-emerald-400" />
                <span>CBT Exams</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'finance')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'finance'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <CreditCard className="w-4 h-4 text-emerald-400" />
                <span>Fees &amp; Billing</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'subscription')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'subscription'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>SaaS Subscription</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'students')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'students'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <GraduationCap className="w-4 h-4 text-emerald-400" />
                <span>Students</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'classes')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'classes'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Building2 className="w-4 h-4 text-emerald-400" />
                <span>Classes &amp; Arms</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'parents')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'parents'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Users className="w-4 h-4 text-emerald-400" />
                <span>Parents</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'staff')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'staff'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Briefcase className="w-4 h-4 text-emerald-400" />
                <span>Staff Directory</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'sessions')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'sessions'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Calendar className="w-4 h-4 text-emerald-400" />
                <span>Sessions &amp; Terms</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'website')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'website'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Globe className="w-4 h-4 text-emerald-400" />
                <span>Website &amp; Gallery</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'lesson-notes')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'lesson-notes'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <BookOpen className="w-4 h-4 text-emerald-400" />
                <span>Lesson Notes &amp; Staff Desk</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'profile')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'profile'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span>Profile</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'settings')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'settings'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Sliders className="w-4 h-4 text-emerald-400" />
                <span>Settings</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'users')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'users'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Users className="w-4 h-4 text-emerald-400" />
                <span>Roles</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'audit')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'audit'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <History className="w-4 h-4 text-emerald-400" />
                <span>Audit</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'recycle-bin')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'recycle-bin'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Trash2 className="w-4 h-4 text-emerald-400" />
                <span>Recycle Bin</span>
              </button>

              <button
                onClick={() => navigateTo('school', 'security')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition ml-auto cursor-pointer whitespace-nowrap shrink-0 ${
                  schoolTab === 'security'
                    ? 'bg-emerald-700 text-white shadow'
                    : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                }`}
              >
                <ShieldAlert className="w-4 h-4" />
                <span>Verify Tenant Guard</span>
              </button>
            </div>

            {/* School Content Tab Panels */}
            {schoolTab === 'overview' && (
              <SchoolDashboardOverview
                onNavigateTab={(tab) => navigateTo('school', tab)}
                onOpenEnrollModal={() => {
                  setOpenEnrollOnStudentTab(true);
                  navigateTo('school', 'students');
                }}
                onOpenImportModal={() => {
                  setOpenImportOnStudentTab(true);
                  navigateTo('school', 'students');
                }}
                onPreviewLiveWebsite={(slug) => {
                  setPreviewWebsiteSlug(slug);
                  window.history.pushState({ previewWebsiteSlug: slug }, '', `/site/${slug}`);
                }}
              />
            )}
            {schoolTab === 'performance' && <SchoolPerformanceView />}
            {schoolTab === 'cbt' && <SchoolCBTManagerView isAdminOverride={true} />}
            {schoolTab === 'attendance' && <SchoolAttendanceView />}
            {schoolTab === 'behaviour' && <SchoolBehaviourView />}
            {schoolTab === 'announcements' && <SchoolAnnouncementsView />}
            {schoolTab === 'finance' && <SchoolFinanceView />}
            {schoolTab === 'subscription' && <SchoolSubscriptionView />}
            {schoolTab === 'students' && (
              <SchoolStudentsView
                key={`students-${activeSchool?.id || 'none'}-${openEnrollOnStudentTab ? 'enroll' : openImportOnStudentTab ? 'import' : 'list'}`}
                initialOpenEnroll={openEnrollOnStudentTab}
                initialOpenImport={openImportOnStudentTab}
              />
            )}
            {schoolTab === 'classes' && <SchoolClassesView />}
            {schoolTab === 'parents' && <SchoolParentsView />}
            {schoolTab === 'staff' && <SchoolStaffDirectoryView />}
            {schoolTab === 'sessions' && <SchoolAcademicSessionsView />}
            {schoolTab === 'website' && (
              <SchoolWebsiteManagerView
                onPreviewLiveWebsite={(slug) => {
                  setPreviewWebsiteSlug(slug);
                  window.history.pushState({ previewWebsiteSlug: slug }, '', `/site/${slug}`);
                }}
              />
            )}
            {schoolTab === 'lesson-notes' && <AdminStaffDeskView />}
            {schoolTab === 'profile' && <SchoolProfileView />}
            {schoolTab === 'settings' && <SchoolSettingsView />}
            {schoolTab === 'users' && <SchoolUsersView />}
            {schoolTab === 'audit' && <SchoolAuditView />}
            {schoolTab === 'recycle-bin' && <SchoolRecycleBinView />}
            {schoolTab === 'security' && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                      <span>School Data Privacy &amp; Vault Protection</span>
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Your school records (<strong className="text-slate-800">{activeSchool?.name}</strong>) are securely partitioned in a private vault with 256-bit encryption.
                    </p>
                  </div>
                  <button
                    onClick={handleOpenIdorModal}
                    className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition cursor-pointer flex items-center gap-2 shadow-xs shrink-0 self-start sm:self-auto"
                  >
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Run Security Audit Test</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <p className="font-bold text-slate-900 mb-1">1. Private School Vault</p>
                    <p className="text-slate-600 leading-relaxed">
                      Every student roster, fee invoice, and payment receipt is strictly locked to your institution. No other school or outside entity can ever access your data.
                    </p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <p className="font-bold text-slate-900 mb-1">2. Anti-Tamper Protection</p>
                    <p className="text-slate-600 leading-relaxed">
                      All account actions, role permissions, and financial modifications are cryptographically signed and logged with real-time fraud defense.
                    </p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <p className="font-bold text-slate-900 mb-1">3. Guaranteed Data Preservation</p>
                    <p className="text-slate-600 leading-relaxed">
                      Your historical records, student fee ledgers, and academic session histories are continuously backed up and can never be lost or accidentally deleted.
                    </p>
                  </div>
                </div>
              </div>
            )}
            </>
            ) : (
              /* Fail-Closed Fallback for Unrecognized / Unassigned Roles */
              <div className="bg-white rounded-2xl border border-rose-200 p-10 text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
                  <Lock className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-900">Role Not Assigned — Access Restricted</h2>
                  <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
                    Your account does not currently hold an authorized portal role for this institution. Please contact your School Administrator to assign your role before signing in again.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Global Modals */}

      <ForgotPasswordModal
        isOpen={isForgotModalOpen}
        initialTicket={recoveryTicketFromUrl}
        onClose={() => {
          setIsForgotModalOpen(false);
          setRecoveryTicketFromUrl('');
        }}
      />

      <SecuritySettingsModal
        isOpen={isSecurityModalOpen}
        onClose={() => setIsSecurityModalOpen(false)}
      />

      {/* Sticky Mobile CTA for quick access on phone screens */}
      {!user && !portalSlug && (
        <StickyMobileCTA
          onRegister={() => {
            navigateTo('register');
            setTimeout(() => {
              const el = document.getElementById('auth-form-card');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 60);
          }}
          onLogin={() => {
            navigateTo('login');
            setTimeout(() => {
              const el = document.getElementById('auth-form-card');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 60);
          }}
          activeView={activeView}
        />
      )}

      {/* Cookie Consent Banner (NDPA Compliant) */}
      <CookieConsentBanner onOpenPrivacyPolicy={() => navigateTo('privacy')} />

      {/* Reusable Elegant Footer with Branding & Legal Links */}
      <Footer
        onNavigateView={(view) => navigateTo(view as AppView)}
        hideRegisterSchool={isSchoolPortalContext}
      />

      {/* PWA Offline Indicator */}
      <OfflineIndicator />
      <PWAUpdateNotification />
</div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
