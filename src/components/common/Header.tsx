import React from 'react';
import { Building2, Shield, LogOut, ChevronDown, UserCheck, ShieldAlert, Sparkles } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { SchoolStatusBadge, RoleBadge } from './StatusBadge.js';
import { PWAInstallButton } from './PWAInstallButton.js';

interface HeaderProps {
  onOpenIdorTest: () => void;
  onOpenResetPassword?: () => void;
  activeView: string;
  setActiveView: (view: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenIdorTest,
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
    switchSchool,
    logout,
  } = useAuth();

  return (
    <header className="sticky top-0 z-40 bg-slate-900 border-b border-slate-800 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Platform Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-950/40 border border-emerald-400/30">
              <span className="font-extrabold text-white text-lg tracking-tight">₦</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base sm:text-lg tracking-tight text-white">
                  School Pay Manager
                </span>
                <span className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded">
                  STEP 1 FOUNDATION
                </span>
              </div>
              <p className="hidden md:block text-[11px] text-slate-400">
                Simple school payments. Smarter school management.
              </p>
            </div>
          </div>

          {/* Right Navigation Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* PWA Install Button */}
            <PWAInstallButton />

            {user ? (
              <>
                {/* IDOR Isolation Verification Button */}
                <button
                  onClick={onOpenIdorTest}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition"
                  title="Verify Tenant Isolation & IDOR Defense"
                >
                  <ShieldAlert className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Verify Tenant Guard</span>
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
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveView('login')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeView === 'login'
                      ? 'bg-slate-800 text-white border border-slate-700'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Sign In
                </button>
                <button
                  onClick={() => setActiveView('register')}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition"
                >
                  Register School
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
