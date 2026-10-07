import React, { useState } from 'react';
import { Lock, Mail, Eye, EyeOff, ShieldCheck, ArrowRight, AlertCircle, ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { PORTFOLIO_URL } from '../../constants/index.js';

interface LoginFormProps {
  onSwitchToRegister: () => void;
  onForgotPassword: () => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({
  onSwitchToRegister,
  onForgotPassword,
}) => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Hidden testing switcher for developer verification only
  const [showDevPanel, setShowDevPanel] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login({ email: email.trim(), password });
    } catch (err: any) {
      setError(err?.message || 'Invalid email address or password.');
    } finally {
      setLoading(false);
    }
  };

  const fillDevAccount = (devEmail: string, devPass: string) => {
    setEmail(devEmail);
    setPassword(devPass);
    setError(null);
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        {/* Brand Banner */}
        <div className="bg-slate-900 px-6 py-8 text-white text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 border border-emerald-400/40 text-white mx-auto flex items-center justify-center mb-3 shadow-lg shadow-emerald-950/40">
            <span className="font-extrabold text-2xl tracking-tight">₦</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">School Pay Manager</h2>
          <p className="text-xs text-slate-400 mt-1">
            Simple school payments. Smarter school management.
          </p>
        </div>

        {/* Clean Production Login Form */}
        <div className="p-6 sm:p-8">
          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Official Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. bursar@yourschool.edu.ng"
                  required
                  autoComplete="email"
                  className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl transition"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Password
                </label>
                <button
                  type="button"
                  onClick={onForgotPassword}
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-semibold"
                >
                  Forgot Password?
                </button>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  autoComplete="current-password"
                  className="w-full pl-10 pr-10 py-2.5 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm shadow-md hover:shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-70 cursor-pointer"
            >
              {loading ? (
                <span>Signing in...</span>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-200 text-center">
            <p className="text-xs text-slate-600">
              Need to register a new school?{' '}
              <button
                type="button"
                onClick={onSwitchToRegister}
                className="font-bold text-emerald-600 hover:text-emerald-700"
              >
                Register Your School
              </button>
            </p>
          </div>
        </div>

        {/* Security Indicator Footer */}
        <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex items-center justify-center gap-2 text-[11px] text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>True Multi-Tenant Architecture • End-to-End Encryption</span>
        </div>
      </div>

      {/* Development Testing Sandbox (Strictly isolated and collapsed by default) */}
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-100/60 overflow-hidden text-xs">
        <button
          type="button"
          onClick={() => setShowDevPanel(!showDevPanel)}
          className="w-full px-4 py-2 flex items-center justify-between text-slate-500 hover:text-slate-700 transition"
        >
          <span className="flex items-center gap-1.5 font-medium text-[11px]">
            <Terminal className="w-3.5 h-3.5 text-slate-400" />
            Developer Testing Mode (Local Verification Only)
          </span>
          {showDevPanel ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showDevPanel && (
          <div className="p-3 bg-white border-t border-slate-200 space-y-2">
            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
              1-Click Test Credentials:
            </p>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => fillDevAccount('proprietor@lagospremier.edu.ng', 'OwnerLagos@2025!')}
                className="p-2 text-left rounded border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300"
              >
                <strong className="block text-slate-800">School A Proprietor</strong>
                <span className="text-[10px] text-slate-500 truncate block">proprietor@lagospremier...</span>
              </button>
              <button
                type="button"
                onClick={() => fillDevAccount('proprietor@abujahorizon.sch.ng', 'OwnerAbuja@2025!')}
                className="p-2 text-left rounded border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300"
              >
                <strong className="block text-slate-800">School B Proprietor</strong>
                <span className="text-[10px] text-slate-500 truncate block">proprietor@abujahorizon...</span>
              </button>
              <button
                type="button"
                onClick={() => fillDevAccount('bursar@lagospremier.edu.ng', 'BursarLagos@2025!')}
                className="p-2 text-left rounded border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300"
              >
                <strong className="block text-slate-800">School A Bursar</strong>
                <span className="text-[10px] text-slate-500 truncate block">bursar@lagospremier...</span>
              </button>
              <button
                type="button"
                onClick={() => fillDevAccount('superadmin@schoolpay.ng', 'SuperAdmin@2025!')}
                className="p-2 text-left rounded border border-purple-200 bg-purple-50 hover:bg-purple-100"
              >
                <strong className="block text-purple-900">Platform Super Admin</strong>
                <span className="text-[10px] text-purple-600 truncate block">superadmin@schoolpay.ng</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
