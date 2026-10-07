import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { Header } from './components/common/Header.js';
import { Footer } from './components/common/Footer.js';
import { LoginForm } from './components/auth/LoginForm.js';
import { RegisterForm } from './components/auth/RegisterForm.js';
import { ForgotPasswordModal } from './components/auth/ForgotPasswordModal.js';
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
import { SuperAdminDashboard } from './components/admin/SuperAdminDashboard.js';
import { IdorVerificationModal } from './components/security/IdorVerificationModal.js';
import { OfflineIndicator } from './components/common/OfflineIndicator.js';
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
} from 'lucide-react';
import { SchoolStatusBadge } from './components/common/StatusBadge.js';

const AppContent: React.FC = () => {
  const { user, isSuperAdmin, isLoading, activeSchool, activeSettings } = useAuth();
  const [activeView, setActiveView] = useState<'school' | 'superadmin' | 'login' | 'register'>('school');
  const [schoolTab, setSchoolTab] = useState<
    'overview' | 'finance' | 'students' | 'classes' | 'parents' | 'staff' | 'sessions' | 'profile' | 'settings' | 'users' | 'audit' | 'security'
  >('overview');
  const [openEnrollOnStudentTab, setOpenEnrollOnStudentTab] = useState(false);
  const [openImportOnStudentTab, setOpenImportOnStudentTab] = useState(false);
  const [isIdorModalOpen, setIsIdorModalOpen] = useState(false);
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 border border-emerald-400/40 text-white flex items-center justify-center font-black text-2xl shadow-xl shadow-emerald-950/50 animate-pulse">
          ₦
        </div>
        <p className="mt-4 text-xs font-bold text-slate-300 tracking-wider uppercase">
          Initializing School Pay Manager...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Universal Top Header */}
      <Header
        onOpenIdorTest={() => setIsIdorModalOpen(true)}
        activeView={activeView}
        setActiveView={(v) => setActiveView(v as any)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!user ? (
          /* Public Unauthenticated State */
          <div className="space-y-10">
            {/* Value Proposition Hero */}
            <div className="text-center max-w-3xl mx-auto pt-4 pb-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold uppercase tracking-wider mb-4 border border-emerald-200">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>True Multi-Tenant SaaS • Dedicated School Privacy</span>
              </div>
              <h1 className="text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight leading-tight">
                Simple school payments.<br className="hidden sm:inline" />
                <span className="text-emerald-700">Smarter school management.</span>
              </h1>
              <p className="mt-3 text-sm sm:text-base text-slate-600 max-w-2xl mx-auto">
                Purpose-built commercial SaaS engineered for school proprietors, principals, bursars, and accountants across Nigeria with strict, zero-trust tenant isolation.
              </p>

              {/* View Switcher: Sign In vs Register School */}
              <div className="mt-6 inline-flex p-1 bg-slate-200/80 rounded-xl shadow-inner border border-slate-300/80">
                <button
                  onClick={() => setActiveView('login')}
                  className={`px-6 py-2 rounded-lg text-xs font-bold transition ${
                    activeView !== 'register'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign In
                </button>
                <button
                  onClick={() => setActiveView('register')}
                  className={`px-6 py-2 rounded-lg text-xs font-bold transition ${
                    activeView === 'register'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Register School
                </button>
              </div>
            </div>

            {/* Active Form */}
            <div className="pb-12">
              {activeView === 'register' ? (
                <RegisterForm onSwitchToLogin={() => setActiveView('login')} />
              ) : (
                <LoginForm
                  onSwitchToRegister={() => setActiveView('register')}
                  onForgotPassword={() => setIsForgotModalOpen(true)}
                />
              )}
            </div>
          </div>
        ) : isSuperAdmin && activeView === 'superadmin' ? (
          /* Super Admin Platform View (Platform level only) */
          <SuperAdminDashboard />
        ) : (
          /* Dedicated School Environment (Point 9 & 16: feels like each school's private platform) */
          <div className="space-y-6">
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
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-slate-600 font-semibold">Private Tenant Environment</span>
                  </div>
                </div>
              </div>
            )}

            {/* School Secondary Navigation Tabs */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-2 flex flex-wrap gap-1">
              <button
                onClick={() => setSchoolTab('overview')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  schoolTab === 'overview'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <LayoutDashboard className="w-4 h-4 text-emerald-400" />
                <span>Overview</span>
              </button>

              <button
                onClick={() => setSchoolTab('finance')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  schoolTab === 'finance'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <CreditCard className="w-4 h-4 text-emerald-400" />
                <span>Fees &amp; Billing</span>
              </button>

              <button
                onClick={() => setSchoolTab('students')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  schoolTab === 'students'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <GraduationCap className="w-4 h-4 text-emerald-400" />
                <span>Students</span>
              </button>

              <button
                onClick={() => setSchoolTab('classes')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  schoolTab === 'classes'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Building2 className="w-4 h-4 text-emerald-400" />
                <span>Classes &amp; Arms</span>
              </button>

              <button
                onClick={() => setSchoolTab('parents')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  schoolTab === 'parents'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Users className="w-4 h-4 text-emerald-400" />
                <span>Parents</span>
              </button>

              <button
                onClick={() => setSchoolTab('staff')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  schoolTab === 'staff'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Briefcase className="w-4 h-4 text-emerald-400" />
                <span>Staff Directory</span>
              </button>

              <button
                onClick={() => setSchoolTab('sessions')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  schoolTab === 'sessions'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Calendar className="w-4 h-4 text-emerald-400" />
                <span>Sessions &amp; Terms</span>
              </button>

              <button
                onClick={() => setSchoolTab('profile')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  schoolTab === 'profile'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span>Profile</span>
              </button>

              <button
                onClick={() => setSchoolTab('settings')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  schoolTab === 'settings'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Sliders className="w-4 h-4 text-emerald-400" />
                <span>Settings</span>
              </button>

              <button
                onClick={() => setSchoolTab('users')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  schoolTab === 'users'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Users className="w-4 h-4 text-emerald-400" />
                <span>Roles</span>
              </button>

              <button
                onClick={() => setSchoolTab('audit')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  schoolTab === 'audit'
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <History className="w-4 h-4 text-emerald-400" />
                <span>Audit</span>
              </button>

              <button
                onClick={() => setSchoolTab('security')}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition ml-auto cursor-pointer ${
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
                onNavigateTab={(tab) => setSchoolTab(tab)}
                onOpenEnrollModal={() => {
                  setOpenEnrollOnStudentTab(true);
                  setSchoolTab('students');
                }}
                onOpenImportModal={() => {
                  setOpenImportOnStudentTab(true);
                  setSchoolTab('students');
                }}
              />
            )}
            {schoolTab === 'finance' && <SchoolFinanceView />}
            {schoolTab === 'students' && (
              <SchoolStudentsView
                initialOpenEnroll={openEnrollOnStudentTab}
                initialOpenImport={openImportOnStudentTab}
              />
            )}
            {schoolTab === 'classes' && <SchoolClassesView />}
            {schoolTab === 'parents' && <SchoolParentsView />}
            {schoolTab === 'staff' && <SchoolStaffDirectoryView />}
            {schoolTab === 'sessions' && <SchoolAcademicSessionsView />}
            {schoolTab === 'profile' && <SchoolProfileView />}
            {schoolTab === 'settings' && <SchoolSettingsView />}
            {schoolTab === 'users' && <SchoolUsersView />}
            {schoolTab === 'audit' && <SchoolAuditView />}
            {schoolTab === 'security' && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-emerald-600" />
                      <span>Tenant Isolation &amp; IDOR Security Verification</span>
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Verify that your school tenant (<strong className="text-slate-800">{activeSchool?.name}</strong>) is cryptographically isolated from other schools.
                    </p>
                  </div>
                  <button
                    onClick={() => setIsIdorModalOpen(true)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition"
                  >
                    Open Live IDOR Simulator
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <p className="font-bold text-slate-900 mb-1">1. Server-Side Enforcement</p>
                    <p className="text-slate-600">
                      Authorization checks run exclusively on the server in <code>requireTenant</code> middleware. The frontend merely displays authorized data.
                    </p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <p className="font-bold text-slate-900 mb-1">2. IDOR Attack Prevention</p>
                    <p className="text-slate-600">
                      Tampering with <code>x-school-id</code> or URL parameters generates an immediate HTTP 403 Forbidden and alerts the platform audit log.
                    </p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <p className="font-bold text-slate-900 mb-1">3. Non-Destructive Suspension</p>
                    <p className="text-slate-600">
                      If school status is suspended or expired, mutations are paused, but records are never deleted from the database.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Global Modals */}
      <IdorVerificationModal
        isOpen={isIdorModalOpen}
        onClose={() => setIsIdorModalOpen(false)}
      />

      <ForgotPasswordModal
        isOpen={isForgotModalOpen}
        onClose={() => setIsForgotModalOpen(false)}
      />

      {/* Reusable Elegant Footer with Branding Links */}
      <Footer />

      {/* PWA Offline Indicator */}
      <OfflineIndicator />
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
