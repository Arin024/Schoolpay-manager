import React, { useState } from 'react';
import { Building2, User, ShieldCheck, Mail, Phone, MapPin, Lock, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { NIGERIAN_STATES, SCHOOL_TYPES, PORTFOLIO_URL } from '../../constants/index.js';

interface RegisterFormProps {
  onSwitchToLogin: () => void;
}

export const RegisterForm: React.FC<RegisterFormProps> = ({ onSwitchToLogin }) => {
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
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError('Password must be at least 8 characters long.');
      return;
    }

    setLoading(true);
    try {
      const response = await api.registerSchool(formData);
      registerSchoolSuccess(response);
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
              &quot;Simple school payments. Smarter school management.&quot;
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
                <input
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Min 8 characters"
                  required
                  className="w-full px-3 py-2 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-lg focus:ring-1 focus:ring-emerald-500 transition"
                />
              </div>
            </div>
          </div>

          {/* Submission and Architecture Promises */}
          <div className="pt-2">
            <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-200 text-xs text-slate-600 mb-4 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
              <span>
                By registering, a unique tenant container is provisioned with <strong>TRIAL</strong> status. 
                Owner credentials and financial defaults are initialized with bank-grade isolation.
              </span>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm sm:text-base shadow-md hover:shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-70 cursor-pointer"
            >
              {loading ? (
                <span>Provisioning Tenant &amp; Account...</span>
              ) : (
                <>
                  <span>Create School Tenant &amp; Get Started</span>
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
