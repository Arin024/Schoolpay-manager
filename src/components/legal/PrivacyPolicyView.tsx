import React from 'react';
import { ShieldCheck, ArrowLeft, Mail, Phone, Lock, Eye, FileText, CheckCircle2 } from 'lucide-react';

interface PrivacyPolicyViewProps {
  onBack: () => void;
}

export const PrivacyPolicyView: React.FC<PrivacyPolicyViewProps> = ({ onBack }) => {
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
          Last Updated: October 2026 • NDPA Compliant
        </span>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-10 space-y-8 text-slate-700 leading-relaxed text-sm">
        <div className="border-b border-slate-200 pb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold uppercase tracking-wider mb-3">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Nigeria Data Protection Act (NDPA 2023) Standard</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Privacy Policy &amp; Data Governance
          </h1>
          <p className="mt-2 text-slate-600 text-sm">
            BursarIQ (bursariq.com.ng) is committed to protecting the confidential records of educational institutions, administrators, teachers, parents, and minor students across Nigeria.
          </p>
        </div>

        {/* Section 1 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold">1</span>
            <span>Multi-Tenant Architecture &amp; Data Ownership</span>
          </h2>
          <p>
            BursarIQ operates as a secure multi-tenant Software-as-a-Service (SaaS). <strong>Every school owns 100% of its educational and financial records.</strong> BursarIQ acts strictly as a Data Processor under the Nigeria Data Protection Act 2023. We never sell, rent, monetize, or expose student or institutional data to advertisers or third parties.
          </p>
        </section>

        {/* Section 2 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold">2</span>
            <span>Information We Collect &amp; Process</span>
          </h2>
          <ul className="list-disc pl-5 space-y-1.5 text-xs sm:text-sm text-slate-600">
            <li><strong>Institutional Records:</strong> School name, registration number, state, LGA, physical address, and contact phone numbers.</li>
            <li><strong>Proprietor &amp; Staff Records:</strong> Name, official email, phone number, and cryptographic password salts (passwords are one-way hashed with PBKDF2/SHA-512 and never stored in plain text).</li>
            <li><strong>Student Roster Data:</strong> Student names, admission numbers, class arms, date of birth, gender, and linked parent/guardian contact details.</li>
            <li><strong>Financial Invoicing &amp; Receipts:</strong> Tuition schedules, bank payment references, and payment verification timestamps. Minor unit (kobo) precision is strictly enforced.</li>
          </ul>
        </section>

        {/* Section 3 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold">3</span>
            <span>Strict School Data Isolation &amp; Confidentiality (Data Protection Defense)</span>
          </h2>
          <p>
            Our software employs server-authoritative middleware that binds every database operation to the authenticated user’s verified <code>school_id</code>. School A cannot query, view, or alter records belonging to School B, even if request headers or parameters are manipulated. All unauthorized cross-tenant attempts generate an immediate HTTP 403 Forbidden and log an immutable security alert.
          </p>
        </section>

        {/* Section 4 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold">4</span>
            <span>Children’s &amp; Student Privacy</span>
          </h2>
          <p>
            Because student information concerns minors, access to student lists and personal information is strictly restricted to authorized school bursars, principals, and proprietors who hold role-based access tokens (RBAC). We do not collect behavioral tracking, cookies, or location data on students.
          </p>
        </section>

        {/* Section 5 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold">5</span>
            <span>Cookie &amp; Local Storage Policy</span>
          </h2>
          <p>
            We use strictly necessary browser session tokens to maintain persistent user authentication and school context. We do not use third-party behavioral advertising cookies. Optional anonymous performance cookies help us optimize mobile rendering on low-speed 2G/3G networks in Nigeria.
          </p>
        </section>

        {/* Section 6 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold">6</span>
            <span>Data Export &amp; Retention Rights</span>
          </h2>
          <p>
            Schools retain the permanent right to export their entire student roster, fee invoices, and payment receipts in standard CSV format at any time. In the event of account cancellation, data is preserved during a 30-day grace period to prevent accidental loss before safe archival.
          </p>
        </section>

        {/* Section 7 */}
        <section className="space-y-3 pt-4 border-t border-slate-200">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold">7</span>
            <span>Data Protection Officer &amp; Contact Details</span>
          </h2>
          <p className="text-xs sm:text-sm">
            For inquiries regarding privacy governance, data export, or audit compliance, please contact our Data Protection Officer:
          </p>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2 text-xs">
            <p className="font-bold text-slate-900">Platform Support &amp; Data Controller:</p>
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
