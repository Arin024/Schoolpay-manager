import React, { useState } from 'react';
import {
  X,
  Building2,
  Shield,
  CreditCard,
  UserCheck,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Layers,
  Sparkles,
} from 'lucide-react';
import { NIGERIAN_STATES, SCHOOL_TYPES, SCHOOL_STATUSES } from '../../constants/index.js';
import { SchoolStatusBadge } from '../common/StatusBadge.js';
import { SubscriptionPlan, School } from '../../types/index.js';

// ==============================================================================
// 1. CREATE SCHOOL TENANT MODAL
// ==============================================================================
interface CreateSchoolModalProps {
  isOpen: boolean;
  onClose: () => void;
  plans: SubscriptionPlan[];
  onSubmit: (data: any) => Promise<void>;
}

export const CreateSchoolModal: React.FC<CreateSchoolModalProps> = ({
  isOpen,
  onClose,
  plans,
  onSubmit,
}) => {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [type, setType] = useState(SCHOOL_TYPES[1]);
  const [state, setState] = useState(NIGERIAN_STATES[24]); // Lagos
  const [lga, setLga] = useState('Ikeja');
  const [phone, setPhone] = useState('+234 ');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [planId, setPlanId] = useState(plans[0]?.id || 'plan_trial');
  const [status, setStatus] = useState<'TRIAL' | 'ACTIVE'>('TRIAL');

  // Initial Owner Account
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('Password123!');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        name,
        slug: slug || name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        type,
        state,
        lga,
        phone,
        email,
        address,
        plan_id: planId,
        status,
        owner_name: ownerName || `${name} Proprietor`,
        owner_email: ownerEmail || email,
        owner_phone: ownerPhone || phone,
        owner_password: ownerPassword,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create school');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-600 flex items-center justify-center text-white">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">Register New School Account</h3>
              <p className="text-xs text-slate-400">Isolated database partition and initial owner account</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 text-xs flex-1">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl">
              {error}
            </div>
          )}

          {/* Section: School Information */}
          <div className="space-y-3">
            <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider text-purple-700 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" /> School Institutional Profile
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">School Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Royal Crest Academy"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 24));
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">URL Identifier (Slug) *</label>
                <input
                  type="text"
                  required
                  placeholder="royal-crest"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-[11px]"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">School Category</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  {SCHOOL_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Subscription Plan</label>
                <select
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold"
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name} (₦{(p.price / 100).toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">State *</label>
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  {NIGERIAN_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">LGA *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ikeja"
                  value={lga}
                  onChange={(e) => setLga(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Official Email *</label>
                <input
                  type="email"
                  required
                  placeholder="admin@school.sch.ng"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Official Phone *</label>
                <input
                  type="text"
                  required
                  placeholder="+234 800 000 0000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Campus Physical Address</label>
              <input
                type="text"
                placeholder="Plot 12, Education Way, Phase 2"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          {/* Section: Primary Proprietor / Owner Account */}
          <div className="space-y-3 pt-3 border-t border-slate-200">
            <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider text-purple-700 flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5" /> Initial Proprietor / Owner Account
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Owner Full Name</label>
                <input
                  type="text"
                  placeholder="Dr. Samuel Okonkwo"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Owner Login Email *</label>
                <input
                  type="email"
                  required
                  placeholder="proprietor@school.sch.ng"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Initial Password</label>
                <input
                  type="text"
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Initial Lifecycle Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold"
                >
                  <option value="TRIAL">TRIAL (30-day evaluation)</option>
                  <option value="ACTIVE">ACTIVE (Paid &amp; verified)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg shadow disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? 'Provisioning...' : 'Provision Tenant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ==============================================================================
// 2. ASSIGN / UPGRADE SUBSCRIPTION MODAL
// ==============================================================================
interface AssignSubscriptionModalProps {
  school: any | null;
  plans: SubscriptionPlan[];
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (schoolId: string, data: any) => Promise<void>;
}

export const AssignSubscriptionModal: React.FC<AssignSubscriptionModalProps> = ({
  school,
  plans,
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [selectedPlanId, setSelectedPlanId] = useState(plans[0]?.id || 'plan_standard');
  const [durationMonths, setDurationMonths] = useState(4);
  const [amountPaidNaira, setAmountPaidNaira] = useState('');
  const [provider, setProvider] = useState('BANK_TRANSFER');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen || !school) return null;

  const currentPlan = plans.find((p) => p.id === selectedPlanId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(school.id, {
        plan_id: selectedPlanId,
        duration_months: durationMonths,
        amount_paid_naira: amountPaidNaira ? Number(amountPaidNaira) : undefined,
        provider,
        notes,
      });
      onClose();
    } catch (err: any) {
      alert(err?.message || 'Failed to assign subscription');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white">
          <div>
            <h3 className="font-bold text-sm text-white">Manage Subscription Plan</h3>
            <p className="text-[11px] text-slate-400">{school.name}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Select SaaS Plan</label>
            <select
              value={selectedPlanId}
              onChange={(e) => {
                setSelectedPlanId(e.target.value);
                const pl = plans.find((p) => p.id === e.target.value);
                if (pl) setAmountPaidNaira(String(pl.price_naira));
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name} — ₦{p.price_naira.toLocaleString()} ({p.billing_interval})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Duration (Months)</label>
              <input
                type="number"
                min="1"
                max="36"
                value={durationMonths}
                onChange={(e) => setDurationMonths(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Amount Paid (₦)</label>
              <input
                type="number"
                placeholder={String(currentPlan?.price_naira || 0)}
                value={amountPaidNaira}
                onChange={(e) => setAmountPaidNaira(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Payment Method</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            >
              <option value="BANK_TRANSFER">Direct Bank Settlement</option>
              <option value="PAYSTACK">Paystack Online</option>
              <option value="FLUTTERWAVE">Flutterwave</option>
              <option value="MANUAL">Manual Bursary Receipt</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Administrative Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Annual partnership renewal confirmed"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg shadow disabled:opacity-50"
            >
              {submitting ? 'Applying...' : 'Activate Subscription'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
