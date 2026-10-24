import React from 'react';
import { FileText, ArrowLeft, ShieldCheck, Mail, Phone, CheckCircle2 } from 'lucide-react';

interface TermsAndConditionsViewProps {
  onBack: () => void;
}

export const TermsAndConditionsView: React.FC<TermsAndConditionsViewProps> = ({ onBack }) => {
  return (
    <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-200/80 hover:bg-slate-300 text-slate-800 text-xs font-bold transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Application</span>
        </button>

        <span className="text-xs text-slate-500 font-mono">
          Commercial SaaS Agreement • Active
        </span>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-10 space-y-8 text-slate-700 leading-relaxed text-sm">
        <div className="border-b border-slate-200 pb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-xs font-bold uppercase tracking-wider mb-3">
            <FileText className="w-4 h-4 text-blue-600" />
            <span>Commercial Multi-Tenant Terms of Service</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Terms &amp; Conditions of Service
          </h1>
          <p className="mt-2 text-slate-600 text-sm">
            Please read these terms carefully before registering your educational institution with BursarIQ (bursariq.com.ng).
          </p>
        </div>

        {/* Term 1 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center text-xs font-bold">1</span>
            <span>Agreement &amp; Eligibility</span>
          </h2>
          <p>
            By registering a school tenant, creating administrator credentials, or utilizing BursarIQ, you represent that you are an authorized proprietor, principal, bursar, or legal representative of an educational institution registered in the Federal Republic of Nigeria, and agree to these Terms.
          </p>
        </section>

        {/* Term 2 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center text-xs font-bold">2</span>
            <span>SaaS Subscriptions &amp; 30-Day Free Trial</span>
          </h2>
          <p>
            New institutions receive an automatic <strong>30-day full-access trial</strong> upon registration. Following the trial period, schools may select an ongoing tier (Standard, Premium, or Enterprise). Subscription payments are for platform licensing and hosting only.
          </p>
        </section>

        {/* Term 3 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center text-xs font-bold">3</span>
            <span>School Fee Collections &amp; Financial Autonomy</span>
          </h2>
          <p>
            BursarIQ provides software tooling for tuition invoicing, receipts, and bank reconciliation. <strong>BursarIQ is not a bank and does not hold school tuition.</strong> All tuition payments collected via online gateways (e.g. Bachs, Paystack, Flutterwave) or bank direct transfers are settled directly into the school’s registered corporate bank accounts according to provider settlement schedules.
          </p>
        </section>

        {/* Term 4 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center text-xs font-bold">4</span>
            <span>Security &amp; Role-Based Access Control</span>
          </h2>
          <p>
            Administrators are responsible for maintaining the confidentiality of their login credentials. Any staff member provisioned with bursar, accountant, or admin permissions must be authorized by the school proprietor. Our platform logs all sensitive financial mutations in an immutable audit trail.
          </p>
        </section>

        {/* Term 5 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center text-xs font-bold">5</span>
            <span>Data Ownership &amp; Export Policy</span>
          </h2>
          <p>
            All student records, class structures, parent contacts, invoices, and payment histories remain the exclusive intellectual and proprietary property of the registering school. Schools may export their database in CSV format at any time without fees or lock-in penalties.
          </p>
        </section>

        {/* Term 6 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center text-xs font-bold">6</span>
            <span>Non-Destructive Suspension &amp; Grace Periods</span>
          </h2>
          <p>
            In the event of an overdue SaaS platform subscription, a 14-day grace period is provided. During suspension, active write mutations may pause, but existing student and invoice data is never deleted, ensuring continuity upon subscription renewal.
          </p>
        </section>

        {/* Term 7 */}
        <section className="space-y-3 pt-4 border-t border-slate-200">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center text-xs font-bold">7</span>
            <span>Governing Law &amp; Operational Contacts</span>
          </h2>
          <p className="text-xs sm:text-sm">
            These Terms are governed by and construed in accordance with the Laws of the Federal Republic of Nigeria.
          </p>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2 text-xs">
            <p className="font-bold text-slate-900">Legal &amp; Support Inquiries:</p>
            <div className="flex flex-wrap items-center gap-4">
              <a href="mailto:support@bursariq.com.ng" className="text-emerald-700 hover:underline font-semibold flex items-center gap-1.5">
                <Mail className="w-4 h-4" />
                <span>support@bursariq.com.ng</span>
              </a>
              <a href="tel:08160754659" className="text-emerald-700 hover:underline font-semibold flex items-center gap-1.5">
                <Phone className="w-4 h-4" />
                <span>08160754659</span>
              </a>
              <a href="https://wa.me/2348160754659" target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline font-semibold">
                WhatsApp: 08160754659
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
