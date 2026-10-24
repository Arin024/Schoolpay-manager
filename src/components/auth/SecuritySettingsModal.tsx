import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  KeyRound,
  HelpCircle,
  Lock,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  Phone,
  Mail,
  RefreshCw,
} from 'lucide-react';
import { api } from '../../services/api.js';

interface SecuritySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_SECURITY_QUESTIONS = [
  'What primary school did you attend?',
  'In what city or town were you born?',
  'What is your mother’s maiden name?',
  'What was the name of your first teacher or school principal?',
  'What is your favourite Nigerian dish or delicacy?',
  'What was your childhood nickname?',
  'What was the name of your first pet or childhood friend?',
];

export const SecuritySettingsModal: React.FC<SecuritySettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'questions' | 'backup_codes'>('questions');
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Security Questions Form
  const [currentPassword, setCurrentPassword] = useState('');
  const [question1, setQuestion1] = useState(PRESET_SECURITY_QUESTIONS[0]);
  const [answer1, setAnswer1] = useState('');
  const [question2, setQuestion2] = useState(PRESET_SECURITY_QUESTIONS[1]);
  const [answer2, setAnswer2] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryPhone, setRecoveryPhone] = useState('');

  // Backup codes
  const [generatedCodes, setGeneratedCodes] = useState<string[] | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [codePassword, setCodePassword] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadStatus();
    }
  }, [isOpen]);

  const loadStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getSecurityStatus();
      setStatus(res);
      if (res.question1) setQuestion1(res.question1);
      if (res.question2) setQuestion2(res.question2);
    } catch (err: any) {
      setError(err?.message || 'Failed to load security status');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const handleSaveQuestions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      setError('Current password is required to update security settings.');
      return;
    }
    if (!answer1.trim() || !answer2.trim()) {
      setError('Please provide answers for both security questions.');
      return;
    }
    if (question1 === question2) {
      setError('Please select two different security questions.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      const res = await api.configureSecurityQuestions({
        currentPassword,
        question1,
        answer1,
        question2,
        answer2,
        recoveryEmail: recoveryEmail.trim() || undefined,
        recoveryPhone: recoveryPhone.trim() || undefined,
      });

      setSuccess(res.message);
      setCurrentPassword('');
      setAnswer1('');
      setAnswer2('');
      await loadStatus();
    } catch (err: any) {
      setError(err?.message || 'Failed to update security questions.');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateBackupCodes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codePassword) {
      setError('Current password is required to generate new emergency backup codes.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      const res = await api.generateBackupCodes(codePassword);
      setGeneratedCodes(res.codes);
      setSuccess(res.message);
      setCodePassword('');
      await loadStatus();
    } catch (err: any) {
      setError(err?.message || 'Failed to generate backup recovery codes.');
    } finally {
      setLoading(false);
    }
  };

  const copyCodesToClipboard = () => {
    if (!generatedCodes) return;
    const text = `BursarIQ Emergency Backup Recovery Codes:\n\n${generatedCodes.join('\n')}\n\nKeep these codes in a secure, confidential offline location. Each code can be used once.`;
    navigator.clipboard.writeText(text);
    setCopiedCodes(true);
    setTimeout(() => setCopiedCodes(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden my-auto animate-in fade-in duration-200">
        {/* Header */}
        <div className="bg-slate-900 px-5 sm:px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-tight text-white">
                Account Security &amp; Recovery Settings
              </h3>
              <p className="text-[11px] text-slate-400">
                Configure self-service recovery methods &amp; backup codes
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-5 pt-3 gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab('questions');
              setError(null);
              setSuccess(null);
            }}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'questions'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Security Questions</span>
            {status?.hasSecurityQuestions && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 ml-1"></span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('backup_codes');
              setError(null);
              setSuccess(null);
            }}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'backup_codes'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Emergency Backup Codes</span>
            {status?.backupCodesRemaining > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 text-[10px]">
                {status.backupCodesRemaining}
              </span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 max-h-[75vh] overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-600" />
              <span>{success}</span>
            </div>
          )}

          {/* TAB 1: SECURITY QUESTIONS */}
          {activeTab === 'questions' && (
            <form onSubmit={handleSaveQuestions} className="space-y-4">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
                <p className="font-semibold text-slate-800 mb-1">How Security Questions Protect You</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  In case you lose access to your official email, you can recover your account immediately by answering these two questions. Answers are securely hashed and never readable by anyone.
                </p>
              </div>

              {/* Question 1 */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Security Question 1
                </label>
                <select
                  value={question1}
                  onChange={(e) => setQuestion1(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-slate-900"
                >
                  {PRESET_SECURITY_QUESTIONS.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={answer1}
                  onChange={(e) => setAnswer1(e.target.value)}
                  placeholder="Enter confidential answer to Question 1"
                  required
                  className="w-full mt-2 px-3 py-2 text-xs border border-slate-300 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-slate-900"
                />
              </div>

              {/* Question 2 */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Security Question 2
                </label>
                <select
                  value={question2}
                  onChange={(e) => setQuestion2(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-slate-900"
                >
                  {PRESET_SECURITY_QUESTIONS.map((q) => (
                    <option key={q} value={q} disabled={q === question1}>
                      {q}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={answer2}
                  onChange={(e) => setAnswer2(e.target.value)}
                  placeholder="Enter confidential answer to Question 2"
                  required
                  className="w-full mt-2 px-3 py-2 text-xs border border-slate-300 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-slate-900"
                />
              </div>

              {/* Optional Backup Contacts */}
              <div className="pt-2 border-t border-slate-200">
                <p className="text-xs font-semibold text-slate-700 mb-2">
                  Optional Secondary Recovery Contacts
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Secondary Backup Email</label>
                    <input
                      type="email"
                      value={recoveryEmail}
                      onChange={(e) => setRecoveryEmail(e.target.value)}
                      placeholder="backup@gmail.com"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Secondary Backup Phone</label>
                    <input
                      type="tel"
                      value={recoveryPhone}
                      onChange={(e) => setRecoveryPhone(e.target.value)}
                      placeholder="0803..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Authorization Password */}
              <div className="pt-2 border-t border-slate-200">
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Authorize with Current Password
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password to save changes"
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-slate-900"
                />
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md transition"
                >
                  {loading ? 'Saving Security Questions...' : 'Save Security Questions'}
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: EMERGENCY BACKUP CODES */}
          {activeTab === 'backup_codes' && (
            <div className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-amber-700" />
                  <span>Single-Use Emergency Recovery Codes</span>
                </p>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  Backup codes allow you to regain access to BursarIQ if you lose your phone, email access, or forgot your password. Each code can only be used once.
                </p>
              </div>

              {/* Newly generated codes view */}
              {generatedCodes ? (
                <div className="space-y-3 p-4 bg-slate-900 text-white rounded-xl shadow-inner">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                      Your 8 Single-Use Recovery Codes:
                    </p>
                    <button
                      type="button"
                      onClick={copyCodesToClipboard}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-semibold flex items-center gap-1 text-slate-200 border border-slate-700 transition"
                    >
                      {copiedCodes ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedCodes ? 'Copied!' : 'Copy All'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 font-mono text-xs text-slate-200 py-2">
                    {generatedCodes.map((c, i) => (
                      <div key={c} className="p-2 bg-slate-800/80 rounded border border-slate-700">
                        <span className="text-slate-500 mr-2">{i + 1}.</span>
                        <span className="font-bold text-emerald-300">{c}</span>
                      </div>
                    ))}
                  </div>

                  <p className="text-[11px] text-amber-300/90 leading-relaxed">
                    ⚠️ <strong>Store these codes in a safe offline location right now.</strong> They will not be displayed in plain text again.
                  </p>
                </div>
              ) : (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Active Unused Backup Codes:</span>
                    <span className="font-bold text-slate-900 bg-white px-2.5 py-0.5 rounded border border-slate-200">
                      {status?.backupCodesRemaining || 0} remaining
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Generating a new set of 8 codes will automatically invalidate any previous unused codes.
                  </p>
                </div>
              )}

              {/* Generate new set form */}
              <form onSubmit={handleGenerateBackupCodes} className="space-y-3 pt-2 border-t border-slate-200">
                <label className="block text-xs font-bold text-slate-800">
                  Authorize Code Generation with Current Password
                </label>
                <input
                  type="password"
                  value={codePassword}
                  onChange={(e) => setCodePassword(e.target.value)}
                  placeholder="Enter your current password"
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-slate-900"
                />

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    <span>Generate 8 New Backup Codes</span>
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
