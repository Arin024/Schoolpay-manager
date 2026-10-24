import React, { useState, useEffect } from 'react';
import {
  X,
  KeyRound,
  Mail,
  Phone,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Lock,
  Eye,
  EyeOff,
  Search,
  UserCheck,
  Sparkles,
  LifeBuoy,
} from 'lucide-react';
import { api } from '../../services/api.js';

interface ForgotPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialIdentifier?: string;
  initialTicket?: string;
}

type RecoveryStep =
  | 'identify'
  | 'reclaim_account'
  | 'lookup_identifier'
  | 'choose_method'
  | 'security_questions'
  | 'backup_code'
  | 'email_link'
  | 'manual_token'
  | 'new_password'
  | 'success';

export const ForgotPasswordModal: React.FC<ForgotPasswordModalProps> = ({
  isOpen,
  onClose,
  initialIdentifier = '',
  initialTicket = '',
}) => {
  const [step, setStep] = useState<RecoveryStep>('identify');
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [maskedIdentifier, setMaskedIdentifier] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [availableMethods, setAvailableMethods] = useState<{
    emailLink: boolean;
    securityQuestions: boolean;
    backupCodes: boolean;
    adminAssisted: boolean;
  }>({
    emailLink: true,
    securityQuestions: false,
    backupCodes: false,
    adminAssisted: true,
  });
  const [questions, setQuestions] = useState<[string, string] | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  // Security questions answers
  const [answer1, setAnswer1] = useState('');
  const [answer2, setAnswer2] = useState('');

  // Backup code
  const [backupCode, setBackupCode] = useState('');

  // Manual / verified ticket
  const [recoveryTicket, setRecoveryTicket] = useState(initialTicket);

  // Reclaim missing / wiped account states
  const [reclaimData, setReclaimData] = useState({
    schoolName: '',
    email: '',
    phone: '',
    ownerName: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [reclaimLoading, setReclaimLoading] = useState(false);
  const [reclaimError, setReclaimError] = useState('');
  const [reclaimSuccess, setReclaimSuccess] = useState('');

  // New password state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Lookup state
  const [lookupPhone, setLookupPhone] = useState('');
  const [lookupFullName, setLookupFullName] = useState('');
  const [lookupSchoolName, setLookupSchoolName] = useState('');
  const [lookupResult, setLookupResult] = useState<{ email?: string; phone?: string } | null>(null);

  // Status & feedback
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (initialTicket) {
        setRecoveryTicket(initialTicket);
        setStep('new_password');
        setMessage('Recovery verification ticket recognized. Please enter and confirm your new secure password below.');
      } else if (initialIdentifier) {
        setIdentifier(initialIdentifier);
      }
    }
  }, [isOpen, initialTicket, initialIdentifier]);

  if (!isOpen) return null;

  const resetAll = () => {
    setStep('identify');
    setIdentifier('');
    setMaskedIdentifier('');
    setMaskedPhone('');
    setChallengeId('');
    setQuestions(null);
    setAnswer1('');
    setAnswer2('');
    setBackupCode('');
    setRecoveryTicket('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    setMessage(null);
    setLookupResult(null);
  };

  const handleClose = () => {
    resetAll();
    onClose();
  };

  // Step 1: Identify Account
  const handleIdentify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return;

    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const res = await api.identifyRecoveryAccount(identifier.trim());
      setChallengeId(res.challengeId);
      setMaskedIdentifier(res.maskedIdentifier || identifier.trim());
      setMaskedPhone(res.maskedPhone || '');
      setAvailableMethods(res.methods || { emailLink: true, securityQuestions: false, backupCodes: false, adminAssisted: true });
      setIsPlatformAdmin(Boolean(res.isPlatformAdmin));

      if (res.questions && res.questions.length === 2) {
        setQuestions(res.questions);
      } else {
        setQuestions(null);
      }

      setStep('choose_method');
    } catch (err: any) {
      setError(err?.message || 'Failed to identify account. Please verify your details.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Identifier Lookup (Forgot Email/Phone)
  const handleLookupIdentifier = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const res = await api.lookupForgottenIdentifier({
        phone: lookupPhone.trim() || undefined,
        fullName: lookupFullName.trim() || undefined,
        schoolName: lookupSchoolName.trim() || undefined,
      });

      if (res.found) {
        setLookupResult({ email: res.maskedEmail, phone: res.maskedPhone });
        setMessage(`Matched account found: ${res.maskedEmail}. You can now proceed to recover it.`);
      } else {
        setError('No account matched the provided details. Please check with your school administrator.');
      }
    } catch (err: any) {
      setError(err?.message || 'Lookup failed.');
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Security Questions Verification
  const handleVerifyQuestions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answer1.trim() || !answer2.trim()) {
      setError('Please provide answers for both security questions.');
      return;
    }

    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const res = await api.verifySecurityQuestions(challengeId, answer1.trim(), answer2.trim());
      setRecoveryTicket(res.recoveryTicket);
      setMessage('Identity verified successfully! You may now set your new password.');
      setStep('new_password');
    } catch (err: any) {
      setError(err?.message || 'Security answers do not match our records.');
    } finally {
      setLoading(false);
    }
  };

  // Step 4: Backup Code Verification
  const handleVerifyBackupCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backupCode.trim()) return;

    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const res = await api.verifyBackupRecoveryCode(challengeId, backupCode.trim());
      setRecoveryTicket(res.recoveryTicket);
      setMessage('Backup code verified! You may now set your new password.');
      setStep('new_password');
    } catch (err: any) {
      setError(err?.message || 'Invalid or already used backup code.');
    } finally {
      setLoading(false);
    }
  };

  // Step 5: Email Link / Instant Verification Request
  const handleRequestEmailLink = async () => {
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const res = await api.requestVerifiedRecoveryLink(challengeId);
      setRecoveryTicket(res.recoveryTicket);
      setMessage(res.message);
      // Seamless progression: In development/demo, user can immediately proceed without copy-pasting!
      setStep('email_link');
    } catch (err: any) {
      setError(err?.message || 'Failed to dispatch recovery request.');
    } finally {
      setLoading(false);
    }
  };

  // Step 6: Complete Password Reset
  const handleCompleteReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPassword || newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match. Please ensure both fields are identical.');
      return;
    }

    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const res = await api.completeAccountRecovery({
        recoveryTicket: recoveryTicket.trim(),
        newPassword,
        confirmPassword,
      });

      setMessage(res.message);
      setStep('success');
    } catch (err: any) {
      setError(err?.message || 'Failed to reset password. The recovery session may have expired.');
    } finally {
      setLoading(false);
    }
  };

  // Password strength checker helper
  const getPasswordStrength = (pwd: string) => {
    if (!pwd) return { score: 0, label: 'None', color: 'bg-slate-200' };
    let score = 0;
    if (pwd.length >= 8) score += 1;
    if (pwd.length >= 12) score += 1;
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score += 1;
    if (/[0-9]/.test(pwd)) score += 1;
    if (/[^A-Za-z0-9]/.test(pwd)) score += 1;

    if (score <= 2) return { score: 1, label: 'Weak', color: 'bg-red-500' };
    if (score <= 3) return { score: 2, label: 'Fair', color: 'bg-amber-500' };
    if (score <= 4) return { score: 3, label: 'Good', color: 'bg-blue-500' };
    return { score: 4, label: 'Strong', color: 'bg-emerald-500' };
  };

  const strength = getPasswordStrength(newPassword);

  const handleReclaimAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setReclaimError('');
    if (!reclaimData.email.trim() || !reclaimData.email.includes('@')) {
      setReclaimError('Please enter a valid official email address.');
      return;
    }
    if (reclaimData.newPassword.length < 8) {
      setReclaimError('Password must be at least 8 characters long.');
      return;
    }
    if (reclaimData.newPassword !== reclaimData.confirmPassword) {
      setReclaimError('Passwords do not match.');
      return;
    }

    setReclaimLoading(true);
    try {
      const res = await fetch('/api/v1/recovery/claim-wiped-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolName: reclaimData.schoolName.trim(),
          email: reclaimData.email.trim(),
          phone: reclaimData.phone.trim(),
          ownerName: reclaimData.ownerName.trim(),
          newPassword: reclaimData.newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to reclaim account');
      }
      setReclaimSuccess(data.message || 'Account successfully reclaimed! You can now log in.');
      if (data.token) {
        localStorage.setItem('auth_token', data.token);
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (err: any) {
      setReclaimError(err.message || 'An error occurred during account recovery.');
    } finally {
      setReclaimLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 px-5 sm:px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-tight text-white">
                Account Recovery &amp; Security
              </h3>
              <p className="text-[11px] text-slate-400">
                {step === 'identify' && 'Identify your account to begin safe recovery'}
                {step === 'lookup_identifier' && 'Recover forgotten email or phone'}
                {step === 'choose_method' && 'Choose your preferred verification method'}
                {step === 'security_questions' && 'Verify your identity via security questions'}
                {step === 'backup_code' && 'Verify with emergency single-use backup code'}
                {step === 'email_link' && 'Verified email recovery link'}
                {step === 'manual_token' && 'Enter your verified recovery ticket'}
                {step === 'new_password' && 'Create your new secure password'}
                {step === 'success' && 'Password updated successfully'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            aria-label="Close recovery modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 max-h-[80vh] overflow-y-auto">
          {/* Error Banner */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl flex items-start gap-2 shadow-xs animate-in fade-in">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600" />
              <div className="flex-1 font-medium leading-relaxed">{error}</div>
            </div>
          )}

          {/* Success / Info Message */}
          {message && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-start gap-2 shadow-xs animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-600" />
              <div className="flex-1 font-medium leading-relaxed">{message}</div>
            </div>
          )}

          {/* STEP 1: IDENTIFY ACCOUNT */}
          {step === 'identify' && (
            <form onSubmit={handleIdentify} className="space-y-4">
              <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-600 space-y-1">
                <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Zero-Friction, Multi-Factor Account Recovery</span>
                </p>
                <p className="text-slate-500">
                  Enter your registered official email address or phone number. We will look up your account and present the recovery methods configured for your profile.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Registered Official Email Address or Phone Number
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="e.g. proprietor@lagospremier.edu.ng or 08031234567"
                    required
                    autoFocus
                    className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-slate-900 transition"
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep('lookup_identifier');
                  }}
                  className="text-xs text-emerald-700 hover:text-emerald-800 font-semibold flex items-center gap-1 hover:underline"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>Forgot your email or phone?</span>
                </button>

                <button
                  type="submit"
                  disabled={loading || !identifier.trim()}
                  className="w-full sm:w-auto px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-950/20 flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  {loading ? (
                    <span>Verifying...</span>
                  ) : (
                    <>
                      <span>Find Account &amp; Continue</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>

              {/* Dev / Test Quick Fill Options */}
              <div className="pt-4 border-t border-slate-200/80">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Quick-Fill Test Accounts:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setIdentifier('proprietor@lagospremier.edu.ng')}
                    className="p-2 text-left rounded-lg border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/70 text-slate-800 transition"
                  >
                    <p className="font-bold text-emerald-800">School Proprietor (School A)</p>
                    <p className="text-[10px] text-slate-500 font-mono">proprietor@lagospremier.edu.ng</p>
                    <p className="text-[10px] text-emerald-700 mt-0.5">Has Security Questions + Backup Code</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIdentifier('SchoolPay28@gmail.com')}
                    className="p-2 text-left rounded-lg border border-purple-200 bg-purple-50/70 hover:bg-purple-100/70 text-slate-800 transition"
                  >
                    <p className="font-bold text-purple-800">Platform Super Admin</p>
                    <p className="text-[10px] text-slate-500 font-mono">SchoolPay28@gmail.com</p>
                    <p className="text-[10px] text-purple-700 mt-0.5">Requires Verified Email Channel</p>
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* STEP 1B: LOOKUP IDENTIFIER (FORGOT EMAIL/PHONE) */}
          {step === 'reclaim_account' && (
          <form onSubmit={handleReclaimAccount} className="space-y-4">
            <div className="bg-emerald-50 dark:bg-emerald-950/40 p-3 rounded-xl border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200">
              <p className="font-bold flex items-center gap-1.5 mb-1">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                Disaster Recovery & Account Re-Claim
              </p>
              <p className="text-[11px] leading-relaxed">
                If your account was impacted during a server reset or cannot be found, enter your school and proprietor details below. Our PostgreSQL recovery engine will immediately verify or restore your tenant and let you set a new secure password.
              </p>
            </div>

            {reclaimError && (
              <div className="bg-red-50 dark:bg-red-950/50 p-3 rounded-xl border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{reclaimError}</span>
              </div>
            )}

            {reclaimSuccess && (
              <div className="bg-emerald-50 dark:bg-emerald-950/50 p-3 rounded-xl border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{reclaimSuccess}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Official School Name
              </label>
              <input
                type="text"
                required
                value={reclaimData.schoolName}
                onChange={(e) => setReclaimData({ ...reclaimData, schoolName: e.target.value })}
                placeholder="e.g. Winner International School"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Registered Email Address
                </label>
                <input
                  type="email"
                  required
                  value={reclaimData.email}
                  onChange={(e) => setReclaimData({ ...reclaimData, email: e.target.value })}
                  placeholder="proprietor@school.edu.ng"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Proprietor Phone Number
                </label>
                <input
                  type="tel"
                  value={reclaimData.phone}
                  onChange={(e) => setReclaimData({ ...reclaimData, phone: e.target.value })}
                  placeholder="080XXXXXXXX"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Proprietor Full Name (Optional)
              </label>
              <input
                type="text"
                value={reclaimData.ownerName}
                onChange={(e) => setReclaimData({ ...reclaimData, ownerName: e.target.value })}
                placeholder="e.g. Chief Dr. Adeleke"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Set New Password
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={reclaimData.newPassword}
                  onChange={(e) => setReclaimData({ ...reclaimData, newPassword: e.target.value })}
                  placeholder="Min 8 characters"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={reclaimData.confirmPassword}
                  onChange={(e) => setReclaimData({ ...reclaimData, confirmPassword: e.target.value })}
                  placeholder="Repeat new password"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={reclaimLoading}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md transition disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
            >
              {reclaimLoading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Verifying & Restoring Account...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Reclaim & Restore Account</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setStep('identify')}
              className="w-full text-center text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              ← Back to standard login recovery
            </button>
          </form>
        )}

        {step === 'lookup_identifier' && (
            <form onSubmit={handleLookupIdentifier} className="space-y-4">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900">
                <p className="font-semibold flex items-center gap-1.5 mb-1">
                  <HelpCircle className="w-4 h-4 text-blue-600" />
                  <span>Account Identifier Assistance</span>
                </p>
                <p className="text-blue-800">
                  If you forgot which email was registered, provide your registered phone number, or your Full Name and School Name to locate your masked account.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Option A: Search by Registered Phone Number
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={lookupPhone}
                    onChange={(e) => setLookupPhone(e.target.value)}
                    placeholder="e.g. 08031234567 or +234..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                </div>
              </div>

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-slate-200"></div>
                <span className="flex-shrink mx-3 text-slate-400 text-[10px] uppercase font-bold">OR</span>
                <div className="flex-grow border-t border-slate-200"></div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Option B: Full Name &amp; School Name
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={lookupFullName}
                    onChange={(e) => setLookupFullName(e.target.value)}
                    placeholder="Your Full Name"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                  <input
                    type="text"
                    value={lookupSchoolName}
                    onChange={(e) => setLookupSchoolName(e.target.value)}
                    placeholder="Your School Name"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {lookupResult && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs space-y-2">
                  <p className="font-bold text-emerald-900">Found Matched Account:</p>
                  <p className="text-slate-700 font-mono text-sm bg-white p-2 rounded-lg border border-emerald-100">
                    {lookupResult.email}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (lookupResult.email) {
                        setIdentifier(lookupResult.email);
                        setStep('identify');
                      }
                    }}
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition"
                  >
                    Proceed to Recover this Account &rarr;
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep('identify')}
                  className="text-xs text-slate-600 hover:text-slate-900"
                >
                  &larr; Back to email input
                </button>
                <button
                  type="submit"
                  disabled={loading || (!lookupPhone.trim() && (!lookupFullName.trim() || !lookupSchoolName.trim()))}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
                >
                  {loading ? 'Searching...' : 'Locate Account'}
                </button>
              </div>
            </form>
          )}

          {/* STEP 2: CHOOSE RECOVERY METHOD */}
          {step === 'choose_method' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-slate-50 border border-slate-200/90 rounded-xl flex items-center justify-between gap-3 text-xs">
                <div>
                  <p className="text-[11px] text-slate-500">Identified Account:</p>
                  <p className="font-mono font-bold text-slate-900 text-sm">{maskedIdentifier}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setStep('identify')}
                  className="text-emerald-700 hover:underline text-xs font-semibold"
                >
                  Change
                </button>
              </div>

              {isPlatformAdmin && (
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-900 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 text-purple-600 flex-shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    <strong>Privileged Super Admin Account:</strong> In accordance with strict security standards, platform-level accounts require direct verified email authorization or primary console verification.
                  </p>
                </div>
              )}

              <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Select Recovery Method:
              </p>

              <div className="space-y-2.5">
                {/* Method 1: Verified Email Recovery Link */}
                <button
                  type="button"
                  onClick={handleRequestEmailLink}
                  disabled={loading}
                  className="w-full p-3.5 text-left rounded-xl border border-slate-200 hover:border-emerald-500 bg-white hover:bg-emerald-50/40 transition flex items-center justify-between gap-3 group shadow-xs cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center group-hover:scale-105 transition flex-shrink-0">
                      <Mail className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-bold text-xs text-slate-900 group-hover:text-emerald-800">
                        Verified Email Recovery Link
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Instant dispatch to your verified official inbox ({maskedIdentifier})
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600" />
                </button>

                {/* Method 2: Security Questions (if enabled and not Super Admin) */}
                {availableMethods.securityQuestions ? (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setStep('security_questions');
                    }}
                    className="w-full p-3.5 text-left rounded-xl border border-slate-200 hover:border-emerald-500 bg-white hover:bg-emerald-50/40 transition flex items-center justify-between gap-3 group shadow-xs cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-teal-100 text-teal-800 flex items-center justify-center group-hover:scale-105 transition flex-shrink-0">
                        <HelpCircle className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-bold text-xs text-slate-900 group-hover:text-teal-800">
                          Answer Security Questions
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Verify identity by answering your 2 pre-configured personal security questions
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-teal-600" />
                  </button>
                ) : !isPlatformAdmin && (
                  <div className="p-2.5 rounded-xl border border-dashed border-slate-200 bg-slate-50 text-[11px] text-slate-400 flex items-center gap-2">
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>Security questions not configured yet for this account</span>
                  </div>
                )}

                {/* Method 3: Emergency Backup Recovery Code */}
                {availableMethods.backupCodes ? (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setStep('backup_code');
                    }}
                    className="w-full p-3.5 text-left rounded-xl border border-slate-200 hover:border-emerald-500 bg-white hover:bg-emerald-50/40 transition flex items-center justify-between gap-3 group shadow-xs cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center group-hover:scale-105 transition flex-shrink-0">
                        <Lock className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-bold text-xs text-slate-900 group-hover:text-amber-800">
                          Single-Use Emergency Backup Code
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Use one of your 8 generated backup recovery codes (BK-XXXX-XXXX)
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-amber-600" />
                  </button>
                ) : null}

                {/* Method 4: Administrator-Assisted Recovery */}
                {availableMethods.adminAssisted && (
                  <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-600 space-y-1">
                    <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <LifeBuoy className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Lost Access to Email and Phone?</span>
                    </p>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Your School Proprietor or School Administrator can generate an authorized 1-hour recovery ticket from the Staff Management dashboard without ever seeing your password.
                    </p>
                    <button
                      type="button"
                      onClick={() => setStep('manual_token')}
                      className="text-[11px] font-bold text-emerald-700 hover:underline pt-1 inline-block"
                    >
                      Already have an Admin-Assisted Ticket or Link? Enter it here &rarr;
                    </button>
                  </div>
                )}
              </div>

              <div className="pt-2 flex justify-start">
                <button
                  type="button"
                  onClick={() => setStep('identify')}
                  className="text-xs text-slate-500 hover:text-slate-800"
                >
                  &larr; Back to account identification
                </button>
              </div>
            </div>
          )}

          {/* STEP 3A: SECURITY QUESTIONS VERIFICATION */}
          {step === 'security_questions' && questions && (
            <form onSubmit={handleVerifyQuestions} className="space-y-4">
              <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl text-xs text-teal-900">
                <p className="font-bold flex items-center gap-1.5 mb-0.5">
                  <HelpCircle className="w-4 h-4 text-teal-700" />
                  <span>Answer Your 2 Security Questions</span>
                </p>
                <p className="text-teal-800 text-[11px]">
                  Answers are securely verified with one-way password hashing and are case-insensitive. Max 3 attempts before temporary lockout.
                </p>
              </div>

              <div className="space-y-3">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <label className="block text-xs font-bold text-slate-800 mb-1.5">
                    1. {questions[0]}
                  </label>
                  <input
                    type="text"
                    value={answer1}
                    onChange={(e) => setAnswer1(e.target.value)}
                    placeholder="Enter answer (e.g. lagos primary school)"
                    required
                    autoFocus
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:border-teal-500 focus:ring-1 focus:ring-teal-500 text-slate-900"
                  />
                </div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <label className="block text-xs font-bold text-slate-800 mb-1.5">
                    2. {questions[1]}
                  </label>
                  <input
                    type="text"
                    value={answer2}
                    onChange={(e) => setAnswer2(e.target.value)}
                    placeholder="Enter answer (e.g. ikeja)"
                    required
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:border-teal-500 focus:ring-1 focus:ring-teal-500 text-slate-900"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep('choose_method')}
                  className="text-xs text-slate-600 hover:text-slate-900"
                >
                  &larr; Choose different method
                </button>

                <button
                  type="submit"
                  disabled={loading || !answer1.trim() || !answer2.trim()}
                  className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md transition"
                >
                  {loading ? 'Verifying Answers...' : 'Verify Answers & Set Password'}
                </button>
              </div>
            </form>
          )}

          {/* STEP 3B: BACKUP CODE VERIFICATION */}
          {step === 'backup_code' && (
            <form onSubmit={handleVerifyBackupCode} className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                <p className="font-bold flex items-center gap-1.5 mb-0.5">
                  <Lock className="w-4 h-4 text-amber-700" />
                  <span>Enter Emergency Backup Code</span>
                </p>
                <p className="text-amber-800 text-[11px]">
                  Enter one of your 8 single-use emergency recovery codes. Each code can only be used once and is invalidated immediately.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Single-Use Recovery Code (e.g. BK-2026-BURS)
                </label>
                <input
                  type="text"
                  value={backupCode}
                  onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                  placeholder="BK-XXXX-XXXX"
                  required
                  autoFocus
                  className="w-full px-3 py-2.5 text-sm font-mono tracking-wider border border-slate-300 rounded-xl focus:border-amber-500 focus:ring-1 focus:ring-amber-500 text-slate-900"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep('choose_method')}
                  className="text-xs text-slate-600 hover:text-slate-900"
                >
                  &larr; Choose different method
                </button>

                <button
                  type="submit"
                  disabled={loading || !backupCode.trim()}
                  className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md transition"
                >
                  {loading ? 'Verifying...' : 'Verify Backup Code'}
                </button>
              </div>
            </form>
          )}

          {/* STEP 3C: EMAIL LINK DISPATCHED / INSTANT 1-CLICK PROGRESSION */}
          {step === 'email_link' && (
            <div className="space-y-4 text-center py-2">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-sm">
                <Mail className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm">
                  Verified Recovery Link Generated!
                </h4>
                <p className="text-xs text-slate-600 mt-1 max-w-sm mx-auto">
                  A cryptographic time-limited recovery ticket has been authorized for <strong>{maskedIdentifier}</strong>.
                </p>
              </div>

              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 text-left space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                  <span>Instant Verification Ready</span>
                </p>
                <p className="text-[11px] text-slate-600">
                  In this live development environment, your session has been verified immediately. Tap below to create your new secure password without copying any tokens!
                </p>
              </div>

              <button
                type="button"
                onClick={() => setStep('new_password')}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-2"
              >
                <span>Proceed to Set New Password</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* STEP 3D: MANUAL TICKET / ADMIN ASSISTED ENTRY */}
          {step === 'manual_token' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (recoveryTicket.trim()) {
                  setStep('new_password');
                }
              }}
              className="space-y-4"
            >
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
                <p className="font-semibold text-slate-800 mb-1">Enter Admin-Assisted or Recovery Ticket</p>
                <p className="text-[11px] text-slate-500">
                  If your school administrator provided you with a temporary recovery ticket (e.g. adm_... or rst_...), paste it below.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Recovery Ticket / Token
                </label>
                <input
                  type="text"
                  value={recoveryTicket}
                  onChange={(e) => setRecoveryTicket(e.target.value)}
                  placeholder="Paste ticket (e.g. adm_... or rst_...)"
                  required
                  autoFocus
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-slate-900"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep('choose_method')}
                  className="text-xs text-slate-600 hover:text-slate-900"
                >
                  &larr; Back
                </button>
                <button
                  type="submit"
                  disabled={!recoveryTicket.trim()}
                  className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                >
                  Continue &rarr;
                </button>
              </div>
            </form>
          )}

          {/* STEP 4: NEW SECURE PASSWORD INPUT */}
          {step === 'new_password' && (
            <form onSubmit={handleCompleteReset} className="space-y-4">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                <p>
                  Identity verified. Enter and confirm your new permanent account password below.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    New Secure Password
                  </label>
                  <span className="text-[11px] font-medium text-slate-500">Min 8 characters</span>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    required
                    autoFocus
                    className="w-full pl-3 pr-10 py-2.5 text-sm border border-slate-300 rounded-xl focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Password Strength Indicator */}
                {newPassword && (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">Strength:</span>
                      <span className="font-bold text-slate-700">{strength.label}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${strength.color} transition-all duration-300`}
                        style={{ width: `${(strength.score / 4) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Confirm New Password
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  required
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-slate-900"
                />
                {confirmPassword && confirmPassword !== newPassword && (
                  <p className="text-[11px] text-red-600 mt-1 font-medium">Passwords do not match</p>
                )}
                {confirmPassword && confirmPassword === newPassword && (
                  <p className="text-[11px] text-emerald-600 mt-1 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Passwords match perfectly
                  </p>
                )}
              </div>

              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep('choose_method')}
                  className="text-xs text-slate-500 hover:text-slate-800"
                >
                  &larr; Back
                </button>

                <button
                  type="submit"
                  disabled={loading || !newPassword || newPassword.length < 8 || newPassword !== confirmPassword}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md transition cursor-pointer"
                >
                  {loading ? 'Updating Password...' : 'Save New Password'}
                </button>
              </div>
            </form>
          )}

          {/* STEP 5: SUCCESS STATE */}
          {step === 'success' && (
            <div className="py-4 text-center space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-md shadow-emerald-950/10 animate-bounce">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h4 className="font-extrabold text-slate-900 text-base">
                  Password Reset Successfully!
                </h4>
                <p className="text-xs text-slate-600 mt-1 max-w-sm mx-auto leading-relaxed">
                  Your account has been secured with your new password. All prior sessions on other devices have been safely invalidated.
                </p>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 max-w-sm mx-auto">
                <p className="font-semibold text-slate-700">Next Steps:</p>
                <p className="text-[11px] mt-0.5">
                  Sign in with your email and new password to resume managing your school bursary.
                </p>
              </div>

              <button
                type="button"
                onClick={handleClose}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer"
              >
                Return to Sign In &rarr;
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
