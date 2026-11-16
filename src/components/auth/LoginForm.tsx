import React, { useEffect, useState } from 'react';
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  ShieldCheck,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Building2,
  GraduationCap,
  Users,
  Search,
  FileCheck2,
  UserCheck,
  Phone,
  MapPin,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import { PublicDocumentVerificationResult, PublicSchoolSummary } from '../../types/index.js';

type PortalMainTab = 'signin' | 'activate' | 'verify';
type SignInRoleMode = 'staff' | 'parent' | 'student';
type ActivateRoleMode = 'STUDENT' | 'PARENT';

interface LoginFormProps {
  onSwitchToRegister: () => void;
  onForgotPassword: () => void;
  onSuccess?: () => void;
  initialPortalSlug?: string | null;
  onPortalSlugChange?: (slug: string | null) => void;
}

function formatNairaFromKobo(kobo: number): string {
  const naira = Number(kobo || 0) / 100;
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
  }).format(naira);
}

export const LoginForm: React.FC<LoginFormProps> = ({
  onSwitchToRegister,
  onForgotPassword,
  onSuccess,
  initialPortalSlug = null,
  onPortalSlugChange,
}) => {
  const { login, admissionLogin, completeSessionAuth } = useAuth();

  // Top-level portal mode
  const [mainTab, setMainTab] = useState<PortalMainTab>('signin');
  const [signInMode, setSignInRoleMode] = useState<SignInRoleMode>('staff');

  // Selected / Branded School Portal State
  const [selectedSchool, setSelectedSchool] = useState<PublicSchoolSummary | null>(null);
  const [portalSlugError, setPortalSlugError] = useState<string | null>(null);
  const [schoolSearchOpen, setSchoolSearchOpen] = useState(false);
  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolResults, setSchoolResults] = useState<PublicSchoolSummary[]>([]);
  const [schoolSearching, setSchoolSearching] = useState(false);

  // Sign In state
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [parentUsePassword, setParentUsePassword] = useState(false);
  const [ambiguousSchools, setAmbiguousSchools] = useState<PublicSchoolSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Self-Activation state (Student & Parent)
  const [activateMode, setActivateMode] = useState<ActivateRoleMode>('STUDENT');
  const [actAdmissionNo, setActAdmissionNo] = useState('');
  const [actLastName, setActLastName] = useState('');
  const [actVerifValue, setActVerifValue] = useState('');
  const [actContact, setActContact] = useState('');
  const [actChildIdent, setActChildIdent] = useState('');
  const [actLoginEmail, setActLoginEmail] = useState('');
  const [actPassword, setActPassword] = useState('');
  const [showActPassword, setShowActPassword] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const [actLoading, setActLoading] = useState(false);

  // Outsider / Public Document Verification state
  const [verifyType, setVerifyType] = useState<'RECEIPT' | 'REPORT_CARD'>('RECEIPT');
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<PublicDocumentVerificationResult | null>(null);

  // Load branded school when initialPortalSlug changes (e.g., visiting /#portal/<slug>)
  useEffect(() => {
    let active = true;
    if (!initialPortalSlug) {
      return;
    }
    setPortalSlugError(null);
    api
      .getPublicSchoolBySlug(initialPortalSlug)
      .then((res) => {
        if (!active) return;
        setSelectedSchool(res.school);
        setSchoolSearchOpen(false);
      })
      .catch((err: any) => {
        if (!active) return;
        setPortalSlugError(err?.message || 'School portal link could not be found.');
      });
    return () => {
      active = false;
    };
  }, [initialPortalSlug]);

  // Search schools directory when picker opened or query typed
  useEffect(() => {
    if (!schoolSearchOpen) return;
    let active = true;
    setSchoolSearching(true);
    const timer = setTimeout(() => {
      api
        .searchPublicSchools(schoolQuery)
        .then((res) => {
          if (active) setSchoolResults(res.schools || []);
        })
        .catch(() => {
          if (active) setSchoolResults([]);
        })
        .finally(() => {
          if (active) setSchoolSearching(false);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [schoolQuery, schoolSearchOpen]);

  const handleSelectSchool = (school: PublicSchoolSummary) => {
    setSelectedSchool(school);
    setPortalSlugError(null);
    setSchoolSearchOpen(false);
    setSchoolQuery('');
    setAmbiguousSchools([]);
    setError(null);
    setActError(null);
    if (onPortalSlugChange) onPortalSlugChange(school.slug);
  };

  const handleClearSchool = () => {
    setSelectedSchool(null);
    setPortalSlugError(null);
    setAmbiguousSchools([]);
    if (onPortalSlugChange) onPortalSlugChange(null);
  };

  const isAdmissionOnlyMode =
    signInMode === 'student' || (signInMode === 'parent' && !parentUsePassword);

  const performAdmissionLogin = async (
    admNo: string,
    portalRole: 'STUDENT' | 'PARENT',
    schoolOverride?: PublicSchoolSummary | null
  ) => {
    const targetSchool = schoolOverride ?? selectedSchool;
    setLoading(true);
    setError(null);
    try {
      await admissionLogin({
        admission_number: admNo.trim(),
        portal_type: portalRole,
        school_id: targetSchool?.id,
        school_slug: targetSchool?.slug,
      });
      setAmbiguousSchools([]);
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      if (err?.data?.error === 'AMBIGUOUS_ADMISSION_NUMBER' && Array.isArray(err?.data?.schools)) {
        setAmbiguousSchools(err.data.schools);
        setError(err.message || 'Multiple schools share this admission number. Tap your school below.');
      } else {
        setAmbiguousSchools([]);
        setError(err?.message || 'Unable to sign in with that admission number.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAmbiguousSchools([]);

    if (isAdmissionOnlyMode) {
      await performAdmissionLogin(
        identifier,
        signInMode === 'parent' ? 'PARENT' : 'STUDENT'
      );
      return;
    }

    setLoading(true);
    try {
      if (signInMode === 'staff') {
        await login({
          email: email.trim(),
          password,
          schoolId: selectedSchool?.id,
        });
      } else {
        await login({
          identifier: identifier.trim(),
          password,
          schoolId: selectedSchool?.id,
          schoolSlug: selectedSchool?.slug,
        });
      }
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      setError(err?.message || 'Invalid login credentials or password.');
    } finally {
      setLoading(false);
    }
  };

  const handleActivateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActError(null);

    if (!selectedSchool) {
      setActError('Select your school first using the school selector above.');
      setSchoolSearchOpen(true);
      return;
    }

    setActLoading(true);
    try {
      const res = await api.activatePublicPortal({
        school_slug: selectedSchool.slug,
        school_id: selectedSchool.id,
        portal_type: activateMode,
        admission_number: activateMode === 'STUDENT' ? actAdmissionNo.trim() : undefined,
        last_name: actLastName.trim(),
        verification_value: activateMode === 'STUDENT' ? actVerifValue.trim() : undefined,
        contact: activateMode === 'PARENT' ? actContact.trim() : undefined,
        child_identifier: activateMode === 'PARENT' ? actChildIdent.trim() : undefined,
        login_email: actLoginEmail.trim() || undefined,
        password: actPassword,
      });
      await completeSessionAuth(res);
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      setActError(err?.message || 'Unable to verify your details against school records.');
    } finally {
      setActLoading(false);
    }
  };

  const handleVerifyDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError(null);
    setVerifyResult(null);
    if (!verifyCode.trim()) {
      setVerifyError('Enter a receipt number or report card verification code.');
      return;
    }
    setVerifyLoading(true);
    try {
      const res = await api.verifyPublicDocument({
        document_type: verifyType,
        code: verifyCode.trim(),
        school_slug: selectedSchool?.slug,
      });
      setVerifyResult(res);
    } catch (err: any) {
      setVerifyError(err?.message || 'No matching verified record was found.');
    } finally {
      setVerifyLoading(false);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto space-y-5">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        {/* Brand Banner (Adapts dynamically to selected/visited #portal/<slug> school) */}
        <div className="bg-slate-900 px-6 py-6 text-white">
          {selectedSchool ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 border border-emerald-400/40 text-white flex items-center justify-center font-black text-xl shrink-0 shadow-lg">
                    {selectedSchool.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                      Official School Portal
                    </span>
                    <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-white truncate">
                      {selectedSchool.name}
                    </h2>
                    <p className="text-[11px] text-slate-300 flex items-center gap-1.5 truncate">
                      <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span>
                        {selectedSchool.lga}, {selectedSchool.state} • {selectedSchool.type}
                      </span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSchoolSearchOpen(!schoolSearchOpen)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 border border-slate-700 shrink-0 cursor-pointer"
                >
                  Switch
                </button>
              </div>
              {(selectedSchool.phone || selectedSchool.email) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 border-t border-slate-800 text-[11px] text-slate-300">
                  {selectedSchool.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3 text-emerald-400" />
                      {selectedSchool.phone}
                    </span>
                  )}
                  {selectedSchool.email && (
                    <span className="flex items-center gap-1">
                      <Mail className="w-3 h-3 text-emerald-400" />
                      {selectedSchool.email}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleClearSchool}
                    className="ml-auto text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
                  >
                    Clear school filter
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 border border-emerald-400/40 text-white mx-auto flex items-center justify-center shadow-lg shadow-emerald-950/40">
                <span className="font-extrabold text-2xl tracking-tight">₦</span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-white">
                Bursar<span className="text-emerald-400">IQ</span> Portal Access
              </h2>
              <p className="text-xs text-slate-300 max-w-sm mx-auto">
                Dedicated role-separated portals for Administrators, Staff, Parents, Students, and Public Verifiers.
              </p>
              <button
                type="button"
                onClick={() => setSchoolSearchOpen(!schoolSearchOpen)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-emerald-300 transition cursor-pointer mt-1"
              >
                <Search className="w-3.5 h-3.5" />
                <span>{schoolSearchOpen ? 'Hide School Finder' : 'Find Your School Portal'}</span>
              </button>
            </div>
          )}

          {/* Inline School Directory Finder Dropdown */}
          {schoolSearchOpen && (
            <div className="mt-4 p-3 rounded-xl bg-slate-800/95 border border-slate-700 space-y-2.5 text-left">
              <div className="flex items-center justify-between gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={schoolQuery}
                    onChange={(e) => setSchoolQuery(e.target.value)}
                    placeholder="Search school name, state, or portal code..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-900 text-white placeholder-slate-400 border border-slate-600 rounded-lg focus:outline-none focus:border-emerald-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setSchoolSearchOpen(false)}
                  aria-label="Close school finder"
                  className="p-1.5 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="max-h-44 overflow-y-auto divide-y divide-slate-700/70">
                {schoolSearching ? (
                  <p className="py-3 text-center text-[11px] text-slate-400">Searching schools...</p>
                ) : schoolResults.length === 0 ? (
                  <p className="py-3 text-center text-[11px] text-slate-400">
                    No matching schools found. Ask your school admin for your direct #portal link.
                  </p>
                ) : (
                  schoolResults.map((sch) => (
                    <button
                      key={sch.id}
                      type="button"
                      onClick={() => handleSelectSchool(sch)}
                      className="w-full py-2 px-2.5 flex items-center justify-between gap-2 hover:bg-slate-700/70 rounded-lg text-left transition cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate">{sch.name}</p>
                        <p className="text-[10px] text-slate-300 truncate">
                          {sch.lga}, {sch.state} • {sch.type}
                        </p>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-300 shrink-0">#{sch.slug}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Main Portal Access Navigation Tabs */}
        <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50 text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setMainTab('signin');
              setError(null);
            }}
            className={`py-3 px-2 flex items-center justify-center gap-1.5 border-b-2 transition cursor-pointer ${
              mainTab === 'signin'
                ? 'border-emerald-600 text-emerald-700 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Portal Login</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMainTab('activate');
              setActError(null);
              if (!selectedSchool) setSchoolSearchOpen(true);
            }}
            className={`py-3 px-2 flex items-center justify-center gap-1.5 border-b-2 transition cursor-pointer ${
              mainTab === 'activate'
                ? 'border-emerald-600 text-emerald-700 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Activate Access</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMainTab('verify');
              setVerifyError(null);
            }}
            className={`py-3 px-2 flex items-center justify-center gap-1.5 border-b-2 transition cursor-pointer ${
              mainTab === 'verify'
                ? 'border-emerald-600 text-emerald-700 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileCheck2 className="w-3.5 h-3.5" />
            <span>Verify Document</span>
          </button>
        </div>

        <div className="p-6 sm:p-7">
          {portalSlugError && (
            <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <span>{portalSlugError} Use &ldquo;Find Your School Portal&rdquo; above to pick an active school.</span>
            </div>
          )}

          {/* TAB 1: SIGN IN */}
          {mainTab === 'signin' && (
            <>
              {/* Role Mode Selector */}
              <div className="mb-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Select Your Portal Role
                </p>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      setSignInRoleMode('staff');
                      setAmbiguousSchools([]);
                      setError(null);
                    }}
                    className={`py-2 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition cursor-pointer ${
                      signInMode === 'staff'
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span>Staff / Email</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSignInRoleMode('parent');
                      setAmbiguousSchools([]);
                      setError(null);
                    }}
                    className={`py-2 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition cursor-pointer ${
                      signInMode === 'parent'
                        ? 'bg-emerald-700 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Parent</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSignInRoleMode('student');
                      setAmbiguousSchools([]);
                      setError(null);
                    }}
                    className={`py-2 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition cursor-pointer ${
                      signInMode === 'student'
                        ? 'bg-teal-700 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <GraduationCap className="w-3.5 h-3.5" />
                    <span>Student</span>
                  </button>
                </div>
              </div>

              {error && (
                <div className="mb-4 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-600" />
                  <span>{error}</span>
                </div>
              )}

              {ambiguousSchools.length > 0 && (
                <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                  <p className="text-[11px] font-bold text-amber-900">
                    Multiple schools matched &ldquo;{identifier.trim()}&rdquo;. Tap your school:
                  </p>
                  <div className="space-y-1.5">
                    {ambiguousSchools.map((sch) => (
                      <button
                        key={sch.id}
                        type="button"
                        disabled={loading}
                        onClick={() => {
                          handleSelectSchool(sch);
                          performAdmissionLogin(
                            identifier,
                            signInMode === 'parent' ? 'PARENT' : 'STUDENT',
                            sch
                          );
                        }}
                        className="w-full p-2.5 rounded-lg bg-white hover:bg-emerald-50 border border-amber-200 hover:border-emerald-300 text-left flex items-center justify-between gap-2 transition cursor-pointer"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">{sch.name}</p>
                          <p className="text-[10px] text-slate-500 truncate">
                            {sch.lga}, {sch.state} • {sch.type}
                          </p>
                        </div>
                        <span className="text-[11px] font-bold text-emerald-700 shrink-0">
                          Open &rarr;
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {signInMode === 'staff' ? (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Personal or Official Account Email
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                          <Mail className="w-4 h-4" />
                        </div>
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="e.g. teacher@school.edu.ng or proprietor@gmail.com"
                          required
                          autoComplete="email"
                          className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl transition"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1.5">
                        <label className="block text-xs font-semibold text-slate-700">Password</label>
                        <button
                          type="button"
                          onClick={onForgotPassword}
                          className="text-xs text-emerald-600 hover:text-emerald-700 font-semibold cursor-pointer"
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
                  </>
                ) : signInMode === 'parent' && !parentUsePassword ? (
                  <div className="space-y-3">
                    <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900 flex items-start gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span>
                        <strong>Read-only Parent Portal:</strong> Enter your child&apos;s school-generated Admission Number to view results, report cards, attendance, and fees — no password or email required.
                      </span>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Child&apos;s Admission Number
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                          <GraduationCap className="w-4 h-4" />
                        </div>
                        <input
                          type="text"
                          value={identifier}
                          onChange={(e) => {
                            setIdentifier(e.target.value);
                            if (ambiguousSchools.length > 0) setAmbiguousSchools([]);
                          }}
                          placeholder="e.g. BMC/2026/0001 or ADM-2025-001"
                          required
                          autoComplete="off"
                          className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl transition"
                        />
                      </div>
                    </div>
                  </div>
                ) : signInMode === 'parent' ? (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Parent Email or Registered Phone Number
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                          <Phone className="w-4 h-4" />
                        </div>
                        <input
                          type="text"
                          value={identifier}
                          onChange={(e) => setIdentifier(e.target.value)}
                          placeholder="e.g. 08031234567 or parent@gmail.com"
                          required
                          autoComplete="username"
                          className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl transition"
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1.5">
                        <label className="block text-xs font-semibold text-slate-700">Password</label>
                        <button
                          type="button"
                          onClick={onForgotPassword}
                          className="text-xs text-emerald-600 hover:text-emerald-700 font-semibold cursor-pointer"
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
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="p-3 rounded-xl bg-teal-50 border border-teal-200 text-[11px] text-teal-900 flex items-start gap-2">
                      <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
                      <span>
                        <strong>Read-only Student Portal:</strong> Enter your school-generated Admission Number to view your results, report cards, attendance, and timetable — no password or email required.
                      </span>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Student Admission Number
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                          <GraduationCap className="w-4 h-4" />
                        </div>
                        <input
                          type="text"
                          value={identifier}
                          onChange={(e) => {
                            setIdentifier(e.target.value);
                            if (ambiguousSchools.length > 0) setAmbiguousSchools([]);
                          }}
                          placeholder="e.g. BMC/2026/0001 or ADM-2025-001"
                          required
                          autoComplete="off"
                          className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl transition"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm shadow-md hover:shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-70 cursor-pointer"
                >
                  {loading ? (
                    <span>Signing in...</span>
                  ) : (
                    <>
                      <span>
                        {signInMode === 'student'
                          ? 'View Student Portal'
                          : signInMode === 'parent' && !parentUsePassword
                          ? 'View Parent Portal'
                          : 'Sign In'}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              {signInMode === 'parent' && (
                <div className="mt-3 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setParentUsePassword(!parentUsePassword);
                      setAmbiguousSchools([]);
                      setError(null);
                    }}
                    className="text-[11px] font-semibold text-slate-500 hover:text-emerald-700 underline cursor-pointer"
                  >
                    {parentUsePassword
                      ? "Use Child's Admission Number Only (No Password)"
                      : 'Have a registered parent email/phone & password? Sign in with password'}
                  </button>
                </div>
              )}

              {signInMode === 'parent' && parentUsePassword && (
                <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-center justify-between gap-2">
                  <span>Need to link an activated email &amp; password?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setActivateMode('PARENT');
                      setMainTab('activate');
                      if (!selectedSchool) setSchoolSearchOpen(true);
                    }}
                    className="font-bold text-emerald-700 hover:underline shrink-0 cursor-pointer"
                  >
                    Activate Access &rarr;
                  </button>
                </div>
              )}
            </>
          )}

          {/* TAB 2: ZERO-TRUST SELF-ACTIVATION (STUDENT / PARENT) */}
          {mainTab === 'activate' && (
            <form onSubmit={handleActivateSubmit} className="space-y-4">
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900">
                Activate your own private <strong>{activateMode === 'STUDENT' ? 'Student' : 'Parent'}</strong> portal login using the records already saved by your school administrator — no admin password needed.
              </div>

              {!selectedSchool && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center justify-between gap-2">
                  <span>Select your school first using the School Finder above.</span>
                  <button
                    type="button"
                    onClick={() => setSchoolSearchOpen(true)}
                    className="px-2.5 py-1 bg-amber-600 text-white rounded-lg font-bold text-[11px] shrink-0 cursor-pointer"
                  >
                    Find School
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setActivateMode('STUDENT');
                    setActError(null);
                  }}
                  className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    activateMode === 'STUDENT' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600'
                  }`}
                >
                  <GraduationCap className="w-3.5 h-3.5" />
                  <span>I am a Student</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActivateMode('PARENT');
                    setActError(null);
                  }}
                  className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    activateMode === 'PARENT' ? 'bg-emerald-700 text-white shadow-sm' : 'text-slate-600'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>I am a Parent</span>
                </button>
              </div>

              {actError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                  <span>{actError}</span>
                </div>
              )}

              {activateMode === 'STUDENT' ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Admission Number *
                      </label>
                      <input
                        type="text"
                        required
                        value={actAdmissionNo}
                        onChange={(e) => setActAdmissionNo(e.target.value)}
                        placeholder="e.g. BMC/2026/0001 or ADM-2025-001"
                        className="w-full px-3 py-2 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Student Surname (Last Name) *
                      </label>
                      <input
                        type="text"
                        required
                        value={actLastName}
                        onChange={(e) => setActLastName(e.target.value)}
                        placeholder="e.g. Okafor"
                        className="w-full px-3 py-2 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-xl"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Verify Date of Birth, Phone, or Email on File *
                    </label>
                    <input
                      type="text"
                      required
                      value={actVerifValue}
                      onChange={(e) => setActVerifValue(e.target.value)}
                      placeholder="e.g. 2012-05-14 or 08031234567 or guardian email"
                      className="w-full px-3 py-2 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-xl"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Registered Phone or Email *
                      </label>
                      <input
                        type="text"
                        required
                        value={actContact}
                        onChange={(e) => setActContact(e.target.value)}
                        placeholder="e.g. 08031234567 or parent@mail.com"
                        className="w-full px-3 py-2 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Parent Surname (Last Name) *
                      </label>
                      <input
                        type="text"
                        required
                        value={actLastName}
                        onChange={(e) => setActLastName(e.target.value)}
                        placeholder="e.g. Okafor"
                        className="w-full px-3 py-2 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-xl"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Child&apos;s Admission Number or First Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={actChildIdent}
                      onChange={(e) => setActChildIdent(e.target.value)}
                      placeholder="e.g. ADM-2025-001 or Chidi"
                      className="w-full px-3 py-2 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-xl"
                    />
                  </div>
                </>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Personal Email (Optional)
                  </label>
                  <input
                    type="email"
                    value={actLoginEmail}
                    onChange={(e) => setActLoginEmail(e.target.value)}
                    placeholder="you@example.com (optional)"
                    className="w-full px-3 py-2 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Create Personal Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showActPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={actPassword}
                      onChange={(e) => setActPassword(e.target.value)}
                      placeholder="Min 6 characters"
                      className="w-full pl-3 pr-9 py-2 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-xl"
                    />
                    <button
                      type="button"
                      onClick={() => setShowActPassword(!showActPassword)}
                      className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600"
                    >
                      {showActPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={actLoading}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs sm:text-sm shadow-md transition flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
              >
                {actLoading ? (
                  <span>Verifying &amp; Activating...</span>
                ) : (
                  <>
                    <UserCheck className="w-4 h-4" />
                    <span>Activate My {activateMode === 'STUDENT' ? 'Student' : 'Parent'} Portal</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* TAB 3: PUBLIC / OUTSIDER DOCUMENT VERIFICATION */}
          {mainTab === 'verify' && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
                Third parties, banks, employers, and prospective families can authenticate official receipts or published report cards issued by any BursarIQ school without signing in.
              </div>

              <form onSubmit={handleVerifyDocument} className="space-y-3">
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      setVerifyType('RECEIPT');
                      setVerifyResult(null);
                      setVerifyError(null);
                    }}
                    className={`py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                      verifyType === 'RECEIPT' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Official Receipt
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVerifyType('REPORT_CARD');
                      setVerifyResult(null);
                      setVerifyError(null);
                    }}
                    className={`py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                      verifyType === 'REPORT_CARD' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Published Report Card
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {verifyType === 'RECEIPT' ? 'Receipt Number *' : 'Report Card Verification Code *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value)}
                    placeholder={verifyType === 'RECEIPT' ? 'e.g. RCP-2025-0001' : 'e.g. RC-8F3A12'}
                    className="w-full px-3.5 py-2.5 text-sm font-mono bg-slate-50 focus:bg-white border border-slate-300 rounded-xl"
                  />
                </div>

                <button
                  type="submit"
                  disabled={verifyLoading}
                  className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs sm:text-sm transition flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
                >
                  <FileCheck2 className="w-4 h-4 text-emerald-400" />
                  <span>{verifyLoading ? 'Verifying Authenticity...' : 'Verify Document Now'}</span>
                </button>
              </form>

              {verifyError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                  <span>{verifyError}</span>
                </div>
              )}

              {verifyResult?.valid && (
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-bold text-emerald-900">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      Authentic {verifyResult.document_type === 'RECEIPT' ? 'Payment Receipt' : 'Report Card'} Verified
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-emerald-950">
                    <div>
                      <span className="text-emerald-700 block">Issuing School</span>
                      <strong>{verifyResult.school.name}</strong>
                    </div>
                    <div>
                      <span className="text-emerald-700 block">Learner (Privacy Masked)</span>
                      <strong>{verifyResult.details.student_name_masked}</strong>
                    </div>
                    {verifyResult.document_type === 'RECEIPT' ? (
                      <>
                        <div>
                          <span className="text-emerald-700 block">Amount Paid</span>
                          <strong>{formatNairaFromKobo(verifyResult.details.amount_kobo)}</strong>
                        </div>
                        <div>
                          <span className="text-emerald-700 block">Status &amp; Method</span>
                          <strong>
                            {verifyResult.details.payment_status} ({verifyResult.details.payment_method})
                          </strong>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <span className="text-emerald-700 block">Class &amp; Session</span>
                          <strong>
                            {verifyResult.details.class_name} • {verifyResult.details.session_name}
                          </strong>
                        </div>
                        <div>
                          <span className="text-emerald-700 block">Term</span>
                          <strong>{verifyResult.details.term_name}</strong>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-slate-200 text-center">
            <p className="text-xs text-slate-600">
              School proprietor onboarding a new institution?{' '}
              <button
                type="button"
                onClick={onSwitchToRegister}
                className="font-bold text-emerald-600 hover:text-emerald-700 cursor-pointer"
              >
                Register Your School
              </button>
            </p>
          </div>
        </div>

        {/* Security Indicator Footer */}
        <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex items-center justify-center gap-2 text-[11px] text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Role-Isolated Access • Zero Shared Admin Passwords</span>
        </div>
      </div>
    </div>
  );
};