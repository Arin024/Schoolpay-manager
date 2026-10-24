import React, { useState } from 'react';
import { Building2, User, ShieldCheck, Mail, Phone, MapPin, Lock, CheckCircle2, AlertCircle, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { NIGERIAN_STATES, SCHOOL_TYPES, PORTFOLIO_URL, PRESET_SECURITY_QUESTIONS } from '../../constants/index.js';
import { KeyRound, ShieldAlert, HelpCircle } from 'lucide-react';

interface RegisterFormProps {
  onSwitchToLogin: () => void;
  onSuccess?: (schoolData: any) => void;
}

export const RegisterForm: React.FC<RegisterFormProps> = ({ onSwitchToLogin, onSuccess }) => {
  const { registerSchoolSuccess } = useAuth();

  const [formData, setFormData] = useState({
    schoolName: '',
    schoolType: 'Secondary',
    state: 'Lagos',
    lga: '',
    address: '',
    phone: '',
    email: '',
    website: '',
    ownerName: '',
    ownerEmail: '',
    password: '',
    question1: PRESET_SECURITY_QUESTIONS[0] || 'What was the name of your first primary school?',
    answer1: '',
    question2: PRESET_SECURITY_QUESTIONS[1] || 'In what city or town were you born?',
    answer2: '',
    recoveryEmail: '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters long for bank-grade security.');
      return;
    }

    if (!formData.answer1.trim() || !formData.answer2.trim()) {
      setError('Please provide answers for both security recovery questions.');
      return;
    }

    if (formData.question1 === formData.question2) {
      setError('Please choose two different security questions for account recovery.');
      return;
    }

    setLoading(true);
    try {
      const response = await api.registerSchool(formData);
      registerSchoolSuccess(response);
      if (onSuccess) {
        onSuccess(response);
      }
    } catch (err: any) {
      setError(err?.message || 'Registration failed. Please check your details.');
    } finally {
      setLoading(false);
    }
  };

  // Quick helper to fill a realistic Nigerian school demo
  const fillSampleSchool = () => {
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    setFormData({
      schoolName: `Crown Heights Academy ${randomSuffix}`,
      schoolType: 'Comprehensive / K-12',
      state: 'Oyo',
      lga: 'Ibadan North',
      address: 'Plot 12 Bodija Estate, University Road, Ibadan',
      phone: '+234803999' + randomSuffix,
      email: `info@crownheights${randomSuffix}.sch.ng`,
      website: `https://crownheights${randomSuffix}.sch.ng`,
      ownerName: 'Dr. Adeyemi Adeleke',
      ownerEmail: `proprietor${randomSuffix}@crownheights.sch.ng`,
      password: 'CrownSchool@2025!',
      question1: PRESET_SECURITY_QUESTIONS[0] || 'What was the name of your first primary school?',
      answer1: 'Government College Ibadan',
      question2: PRESET_SECURITY_QUESTIONS[1] || 'In what city or town were you born?',
      answer2: 'Ibadan',
      recoveryEmail: `adeyemi.backup${randomSuffix}@gmail.com`,
    });
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200/80 overflow-hidden">
        {/* Banner Header */}
        <div className="bg-slate-900 px-6 sm:px-8 py-6 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-2">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Multi-Tenant School Onboarding</span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Register Your School</h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-1">
              &quot;Simple school payments. Smarter bursary management.&quot;
            </p>
          </div>
          <button
            type="button"
            onClick={fillSampleSchool}
            className="self-start sm:self-center px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 rounded-lg text-xs font-semibold transition"
          >
            Auto-fill Sample Data
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-6">
          {error && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-600" />
              <div>
                <p className="font-semibold">Registration Incomplete</p>
                <p className="mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {/* Section 1: School Identity */}
          <div>
            <div className="flex items-center gap-2 pb-2 border-b border-slate-200 mb-4">
              <Building2 className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                1. School Institutional Details
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  School Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="schoolName"
                  value={formData.schoolName}
                  onChange={handleChange}
                  placeholder="e.g. Corona Secondary School"
                  required
                  className="w-full px-3 py-2 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-lg focus:ring-1 focus:ring-emerald-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  School Type <span className="text-red-500">*</span>
                </label>
                <select
                  name="schoolType"
                  value={formData.schoolType}
                  onChange={handleChange}
                  required
                  className="w-full px-3 py-2 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-lg focus:ring-1 focus:ring-emerald-500 transition"
                >
                  {SCHOOL_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Official Phone <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="+234 803 000 0000"
                  required
                  className="w-full px-3 py-2 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-lg focus:ring-1 focus:ring-emerald-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  State in Nigeria <span className="text-red-500">*</span>
                </label>
                <select
                  name="state"
                  value={formData.state}
                  onChange={handleChange}
                  required
                  className="w-full px-3 py-2 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-lg focus:ring-1 focus:ring-emerald-500 transition"
                >
                  {NIGERIAN_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  LGA (Local Government) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="lga"
                  value={formData.lga}
                  onChange={handleChange}
                  placeholder="e.g. Ikeja, AMAC, Ibadan North"
                  required
                  className="w-full px-3 py-2 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-lg focus:ring-1 focus:ring-emerald-500 transition"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Physical Campus Address
                </label>
                <input
                  type="text"
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  placeholder="e.g. Km 12 Lekki-Epe Expressway, Lagos"
                  className="w-full px-3 py-2 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-lg focus:ring-1 focus:ring-emerald-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Official School Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="info@school.edu.ng"
                  required
                  className="w-full px-3 py-2 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-lg focus:ring-1 focus:ring-emerald-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Website (Optional)
                </label>
                <input
                  type="url"
                  name="website"
                  value={formData.website}
                  onChange={handleChange}
                  placeholder="https://myschool.edu.ng"
                  className="w-full px-3 py-2 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-lg focus:ring-1 focus:ring-emerald-500 transition"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Proprietor / Owner Details */}
          <div>
            <div className="flex items-center gap-2 pb-2 border-b border-slate-200 mb-4">
              <User className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                2. School Owner / Proprietor Credentials
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Owner Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="ownerName"
                  value={formData.ownerName}
                  onChange={handleChange}
                  placeholder="e.g. Chief / Dr. / Mrs. Folashade Adeleke"
                  required
                  className="w-full px-3 py-2 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-lg focus:ring-1 focus:ring-emerald-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Owner Login Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  name="ownerEmail"
                  value={formData.ownerEmail}
                  onChange={handleChange}
                  placeholder="proprietor@school.edu.ng"
                  required
                  className="w-full px-3 py-2 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-lg focus:ring-1 focus:ring-emerald-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Password <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-3.5 h-3.5" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="Min 8 characters"
                    required
                    autoComplete="new-password"
                    className="w-full pl-9 pr-10 py-2 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-lg focus:ring-1 focus:ring-emerald-500 transition font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 focus:outline-hidden transition cursor-pointer"
                    title={showPassword ? 'Hide password' : 'Show password'}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4 text-emerald-600" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

                    {/* Section 3: Bank-Grade Security Recovery Questions */}
          <div className="bg-slate-50/80 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200/90 dark:border-slate-800">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-slate-800 mb-3">
              <KeyRound className="w-4 h-4 text-emerald-600" />
              <div className="flex-1">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                  <span>3. Account Protection & Security Recovery Questions</span>
                  <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold px-1.5 py-0.5 rounded-full lowercase">
                    mandatory
                  </span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  If you ever forget your password or lose access to your email, you will use these questions to quickly and securely regain access to your school account.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Question 1 */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Security Question 1 <span className="text-red-500">*</span>
                </label>
                <select
                  name="question1"
                  value={formData.question1}
                  onChange={handleChange}
                  required
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-slate-800 dark:text-white outline-hidden mb-2"
                >
                  {PRESET_SECURITY_QUESTIONS.map((q, idx) => (
                    <option key={idx} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  name="answer1"
                  value={formData.answer1}
                  onChange={handleChange}
                  placeholder="Your confidential answer (case-insensitive)"
                  required
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-slate-800 dark:text-white outline-hidden"
                />
              </div>

              {/* Question 2 */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Security Question 2 <span className="text-red-500">*</span>
                </label>
                <select
                  name="question2"
                  value={formData.question2}
                  onChange={handleChange}
                  required
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-slate-800 dark:text-white outline-hidden mb-2"
                >
                  {PRESET_SECURITY_QUESTIONS.map((q, idx) => (
                    <option key={idx} value={q} disabled={q === formData.question1}>
                      {q} {q === formData.question1 ? '(already selected in Question 1)' : ''}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  name="answer2"
                  value={formData.answer2}
                  onChange={handleChange}
                  placeholder="Your confidential answer (case-insensitive)"
                  required
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-slate-800 dark:text-white outline-hidden"
                />
              </div>

              {/* Optional Secondary Emergency Recovery Email */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                  <span>Backup Recovery Email (Optional)</span>
                  <span className="text-[10px] text-slate-400 font-normal">Personal or alternate inbox</span>
                </label>
                <input
                  type="email"
                  name="recoveryEmail"
                  value={formData.recoveryEmail}
                  onChange={handleChange}
                  placeholder="e.g. personal-backup@gmail.com"
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-slate-800 dark:text-white outline-hidden"
                />
              </div>
            </div>
          </div>

          {/* Submission and Architecture Promises */}
          <div className="pt-2">
            <div className="p-3.5 bg-emerald-50/80 rounded-xl border border-emerald-200/80 text-xs text-slate-700 mb-4 flex items-start gap-2.5 shadow-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <span className="font-bold text-slate-900 block mb-0.5">Instant 30-Day Free Access • No Credit Card Required</span>
                <span>
                  Your school account will be set up immediately with full access to fee collection, student invoicing, and automated receipts. All records are 100% private and protected with bank-grade security.
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm sm:text-base shadow-md hover:shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-70 cursor-pointer"
            >
              {loading ? (
                <span>Setting Up Your School Account...</span>
              ) : (
                <>
                  <span>Register School &amp; Start 30-Day Free Trial</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          <div className="text-center pt-2">
            <p className="text-xs text-slate-600">
              Already have a school account registered?{' '}
              <button
                type="button"
                onClick={onSwitchToLogin}
                className="font-bold text-emerald-600 hover:text-emerald-700"
              >
                Sign In to Existing School
              </button>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};
