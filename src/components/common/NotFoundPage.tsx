import React from 'react';
import { ShieldAlert, Home, ArrowLeft, HelpCircle, Phone, Mail } from 'lucide-react';

interface NotFoundPageProps {
  onGoHome: () => void;
  onGoLogin: () => void;
}

export const NotFoundPage: React.FC<NotFoundPageProps> = ({ onGoHome, onGoLogin }) => {
  return (
    <div className="min-h-[70vh] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200/90 shadow-xl p-8 text-center space-y-6">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-amber-50 border-2 border-amber-200 flex items-center justify-center text-amber-600 shadow-inner">
          <ShieldAlert className="w-10 h-10" />
        </div>

        <div>
          <span className="inline-block px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-slate-100 text-slate-700 font-mono mb-2">
            HTTP 404 Error
          </span>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Page or Section Not Found
          </h1>
          <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
            The link you followed may be invalid, the school resource may belong to a different tenant, or the page was moved.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={onGoHome}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <Home className="w-4 h-4 text-emerald-400" />
            <span>Return to Dashboard</span>
          </button>
          <button
            type="button"
            onClick={onGoLogin}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-xs border border-emerald-200 flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Sign In / Switch School</span>
          </button>
        </div>

        {/* Support contact info */}
        <div className="pt-4 border-t border-slate-100 text-xs text-slate-500 space-y-2">
          <p className="font-semibold text-slate-700 flex items-center justify-center gap-1">
            <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
            <span>Need immediate technical assistance?</span>
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href="mailto:support@bursariq.com.ng"
              className="hover:text-emerald-700 font-medium flex items-center gap-1"
            >
              <Mail className="w-3.5 h-3.5 text-emerald-600" />
              <span>support@bursariq.com.ng</span>
            </a>
            <a
              href="https://wa.me/2348160754659"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-emerald-700 font-medium flex items-center gap-1"
            >
              <Phone className="w-3.5 h-3.5 text-emerald-600" />
              <span>WhatsApp: 08160754659</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
