import React from 'react';
import { CheckCircle2, ArrowRight, ShieldCheck, Mail, Phone, Calendar, Users, CreditCard } from 'lucide-react';

interface ThankYouPageProps {
  onGoToLogin: () => void;
  onGoToDashboard?: () => void;
  schoolName?: string;
}

export const ThankYouPage: React.FC<ThankYouPageProps> = ({
  onGoToLogin,
  onGoToDashboard,
  schoolName,
}) => {
  return (
    <div className="min-h-[75vh] flex items-center justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl w-full bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
        {/* Top Celebration Banner */}
        <div className="bg-gradient-to-br from-emerald-600 to-teal-800 p-8 text-white text-center relative overflow-hidden">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center mb-4 shadow-xl">
            <CheckCircle2 className="w-12 h-12 text-white" />
          </div>
          <span className="inline-block px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-white/20 text-emerald-100 font-mono mb-2">
            School Account Successfully Created
          </span>
          <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-white">
            Congratulations &amp; Welcome!
          </h1>
          <p className="mt-2 text-sm sm:text-base text-emerald-100 max-w-lg mx-auto">
            {schoolName
              ? `Your school account for "${schoolName}" has been successfully provisioned with a 30-day full access trial.`
              : 'Your school account has been successfully provisioned with a 30-day full access trial.'}
          </p>
        </div>

        {/* Content & Immediate Next Steps */}
        <div className="p-6 sm:p-8 space-y-6">
          <div className="space-y-3">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              <span>Recommended Quick Start Checklist:</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5">
                <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-xs">
                  1
                </div>
                <p className="font-bold text-slate-900">Sign In to Dashboard</p>
                <p className="text-slate-600 leading-relaxed">
                  Log in using your registered proprietor email &amp; password.
                </p>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5">
                <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-xs">
                  2
                </div>
                <p className="font-bold text-slate-900">Enroll Students</p>
                <p className="text-slate-600 leading-relaxed">
                  Configure classes and bulk import your student roster via CSV.
                </p>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5">
                <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-xs">
                  3
                </div>
                <p className="font-bold text-slate-900">Issue Invoices</p>
                <p className="text-slate-600 leading-relaxed">
                  Set up fee categories and collect bank transfer / online payments.
                </p>
              </div>
            </div>
          </div>

          {/* Primary Action Buttons */}
          <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
            <button
              type="button"
              onClick={onGoToDashboard || onGoToLogin}
              className="w-full sm:flex-1 py-3 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/20 transition cursor-pointer"
            >
              <span>{onGoToDashboard ? 'Open School Dashboard' : 'Sign In Now'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onGoToLogin}
              className="w-full sm:w-auto py-3 px-5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition cursor-pointer"
            >
              Switch Account / Sign In
            </button>
          </div>

          {/* Real Contact & Support Section */}
          <div className="pt-4 border-t border-slate-200/80 bg-slate-50/50 -mx-6 -mb-6 sm:-mx-8 sm:-mb-8 p-6 text-xs text-slate-600 space-y-2">
            <p className="font-bold text-slate-900">
              Need personalized onboarding or staff training?
            </p>
            <p className="text-slate-500">
              Our dedicated Nigerian customer support team is ready to assist you via WhatsApp, phone, or email:
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-1 font-semibold text-slate-700">
              <a
                href="mailto:support@bursariq.com.ng"
                className="flex items-center gap-1.5 hover:text-emerald-700"
              >
                <Mail className="w-4 h-4 text-emerald-600" />
                <span>support@bursariq.com.ng</span>
              </a>
              <a
                href="tel:08160754659"
                className="flex items-center gap-1.5 hover:text-emerald-700"
              >
                <Phone className="w-4 h-4 text-emerald-600" />
                <span>08160754659</span>
              </a>
              <a
                href="https://wa.me/2348160754659"
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 hover:bg-emerald-200 font-bold"
              >
                WhatsApp: 08160754659
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
