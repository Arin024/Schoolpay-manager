import React from 'react';
import { Building2, Shield, LogOut, ChevronDown, UserCheck, ShieldAlert, Sparkles, KeyRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { SchoolStatusBadge, RoleBadge } from './StatusBadge.js';
import { PWAInstallButton } from './PWAInstallButton.js';
import { NotificationBell } from './NotificationBell.js';

interface HeaderProps {
  onOpenResetPassword?: () => void;
  onOpenSecuritySettings?: () => void;
  activeView: string;
  setActiveView: (view: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenResetPassword,
  onOpenSecuritySettings,
  activeView,
  setActiveView,
}) => {
  const {
    user,
    roles,
    activeRole,
    activeSchool,
    activeSchoolId,
    isSuperAdmin,
    impersonatedBy,
    stopImpersonation,
    switchSchool,
    logout,
  } = useAuth();

  return (
    <>
      {/* Super Admin Support Impersonation Alert Banner */}
      {impersonatedBy && (
        <div className="bg-amber-500 text-slate-950 px-4 py-2 text-xs font-bold flex flex-wrap items-center justify-between gap-2 shadow-inner border-b border-amber-600">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 bg-slate-950 text-amber-400 rounded text-[10px] uppercase font-mono tracking-wider">
              SUPPORT IMPERSONATION ACTIVE
            </span>
            <span>
              You are currently viewing <strong>{activeSchool?.name || activeSchoolId}</strong> as a delegated support session. All platform write actions are strictly audit-logged.
            </span>
          </div>
          <button
            onClick={stopImpersonation}
            className="px-3 py-1 bg-slate-950 hover:bg-slate-900 text-white rounded text-xs font-bold transition flex items-center gap-1 shadow-sm"
          >
            <span>Exit Impersonation Session</span>
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <header className="sticky top-0 z-40 bg-slate-900 border-b border-slate-800 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Platform Title */}
          <button
            type="button"
            onClick={() => setActiveView(user ? (isSuperAdmin && !activeSchool ? 'superadmin' : 'school') : 'login')}
            className="flex items-center gap-3 text-left cursor-pointer group focus:outline-hidden"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-950/40 border border-emerald-400/30 group-hover:scale-105 transition">
              <span className="font-extrabold text-white text-lg tracking-tight">₦</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base sm:text-lg tracking-tight text-white group-hover:text-emerald-300 transition">
                  Bursar<span className="text-emerald-400">IQ</span>
                </span>
                <span className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded">
                  BURSARY SAAS
                </span>
              </div>
              <p className="hidden md:block text-[11px] text-slate-400">
                Simple school payments. Smarter bursary management.
              </p>
            </div>
          </button>

          {/* Right Navigation Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* PWA Install Button */}
            <PWAInstallButton />

            {user ? (
              <>


                {/* Account Security & Recovery Settings */}
                <button
                  onClick={onOpenSecuritySettings}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 hover:text-white transition"
                  title="Account Security & Recovery Questions"
                >
                  <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden md:inline">Security</span>
                </button>

                {/* If Super Admin, show platform switch button */}
                {isSuperAdmin && (
                  <button
                    onClick={() => setActiveView(activeView === 'superadmin' ? 'school' : 'superadmin')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                      activeView === 'superadmin'
                        ? 'bg-purple-600 text-white border-purple-500 shadow-sm'
                        : 'bg-purple-950/50 hover:bg-purple-900/60 text-purple-300 border-purple-800'
                    }`}
                  >
                    <Shield className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Platform Super Admin</span>
                  </button>
                )}

                {/* In-App Notification Bell */}
                <NotificationBell />

                {/* Current User Info */}
                <div className="hidden lg:flex items-center gap-2 pl-2 border-l border-slate-800">
                  <div className="text-right">
                    <p className="text-xs font-medium text-slate-200 leading-tight">
                      {user.full_name}
                    </p>
                    <div className="mt-0.5">
                      <RoleBadge role={activeRole?.role_name || (isSuperAdmin ? 'SUPER_ADMIN' : 'STAFF')} />
                    </div>
                  </div>
                </div>

                {/* Logout Button */}
                <button
                  onClick={logout}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent hover:border-slate-700 transition"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setActiveView('register');
                    setTimeout(() => {
                      const el = document.getElementById('auth-form-card');
                      if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }, 60);
                  }}
                  className="px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition cursor-pointer flex items-center gap-1.5 shrink-0"
                >
                  <span>Register Your School</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
    </>
  );
};
