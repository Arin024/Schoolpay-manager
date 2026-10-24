import React from 'react';
import { ArrowRight, LogIn, MessageCircle } from 'lucide-react';
import { analytics } from '../../services/analytics.js';

interface StickyMobileCTAProps {
  onRegister: () => void;
  onLogin: () => void;
  activeView: string;
}

export const StickyMobileCTA: React.FC<StickyMobileCTAProps> = ({
  onRegister,
  onLogin,
  activeView,
}) => {
  const handleRegisterClick = () => {
    analytics.trackCtaClick('Sticky Mobile Register', 'mobile_bottom_bar');
    onRegister();
  };

  const handleLoginClick = () => {
    analytics.trackCtaClick('Sticky Mobile Sign In', 'mobile_bottom_bar');
    onLogin();
  };

  return (
    <div
      role="region"
      aria-label="Quick mobile action"
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 p-2.5 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 shadow-2xl safe-area-pb"
    >
      <div className="flex items-center gap-2 max-w-lg mx-auto">
        <a
          href="https://wa.me/2348160754659?text=Hello%2C%20I%20would%20like%20to%20inquire%20about%20BursarIQ"
          target="_blank"
          rel="noopener noreferrer"
          title="Chat with support on WhatsApp"
          aria-label="WhatsApp platform support"
          className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center flex-shrink-0"
        >
          <MessageCircle className="w-5 h-5" />
        </a>

        {activeView === 'register' ? (
          <button
            type="button"
            onClick={handleLoginClick}
            className="flex-1 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-2 border border-slate-700 transition"
          >
            <LogIn className="w-4 h-4 text-emerald-400" />
            <span>Already registered? Sign In</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleLoginClick}
              className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 border border-slate-700 transition"
            >
              <LogIn className="w-3.5 h-3.5 text-emerald-400" />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              onClick={handleRegisterClick}
              className="flex-1 py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950/40 transition"
            >
              <span>Register Free (30-Day Trial)</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
