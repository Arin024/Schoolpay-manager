import { PWAInstallButton } from './PWAInstallButton.js';
import React from 'react';
import { Mail, Phone, ShieldCheck, Heart } from 'lucide-react';
import { PORTFOLIO_URL } from '../../constants/index.js';

interface FooterProps {
  onNavigateView?: (view: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigateView }) => {
  return (
    <footer className="w-full mt-auto border-t border-slate-200/90 bg-white/95 backdrop-blur-md text-xs text-slate-600">
      {/* pb-36 on mobile reserves ample clearance so fixed bottom CTA bars never obstruct the footer */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 sm:pt-10 pb-36 sm:pb-16 md:pb-10 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Col 1: Platform Branding */}
          <div className="space-y-3 md:col-span-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-white font-extrabold text-sm shadow">
                ₦
              </div>
              <span className="font-extrabold text-slate-900 text-sm tracking-tight">
                Bursar<span className="text-emerald-600">IQ</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Nigeria&apos;s trusted school fee management and bursary portal (bursariq.com.ng). Effortless collections, instant digital receipts, and real-time reconciliation.
            </p>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-800 text-[11px] font-semibold border border-emerald-200">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>100% Secure &amp; Bank-Grade Privacy</span>
            </div>
          </div>

          {/* Col 2: Navigation Links */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
              Quick Links
            </h4>
            <ul className="space-y-1.5 text-xs text-slate-600">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateView?.('login')}
                  className="hover:text-emerald-700 transition cursor-pointer"
                >
                  Sign In to Your School
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateView?.('register')}
                  className="hover:text-emerald-700 transition cursor-pointer"
                >
                  Register New School (30-Day Free Trial)
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateView?.('privacy')}
                  className="hover:text-emerald-700 transition cursor-pointer"
                >
                  Privacy Policy &amp; NDPA Compliance
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateView?.('terms')}
                  className="hover:text-emerald-700 transition cursor-pointer"
                >
                  Terms and Conditions of Service
                </button>
              </li>
            </ul>
          </div>

          {/* Col 3: Direct Platform Support Contacts */}
          <div className="space-y-2 md:col-span-2">
            <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
              Platform Support &amp; Enquiries
            </h4>
            <div className="space-y-2 text-xs text-slate-600">
              <p className="text-slate-500">
                Direct official support channels for Nigerian school proprietors, bursars, and onboarding:
              </p>
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <a
                  href="mailto:support@bursariq.com.ng"
                  className="flex items-center gap-1.5 text-slate-700 hover:text-emerald-700 font-semibold"
                >
                  <Mail className="w-4 h-4 text-emerald-600" />
                  <span>support@bursariq.com.ng</span>
                </a>
                <a
                  href="tel:08160754659"
                  className="flex items-center gap-1.5 text-slate-700 hover:text-emerald-700 font-semibold"
                >
                  <Phone className="w-4 h-4 text-emerald-600" />
                  <span>08160754659</span>
                </a>
                <a
                  href="https://wa.me/2348160754659"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-800 hover:bg-emerald-200 font-bold text-xs"
                >
                  WhatsApp: 08160754659
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Sub-footer */}
        <div className="pt-6 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          {/* Prominent Designer / Engineer Attribution Badge */}
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 sm:gap-4">
            <a
              href={PORTFOLIO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50/90 hover:bg-emerald-100/90 text-slate-800 hover:text-emerald-900 border border-emerald-200 transition shadow-sm font-semibold text-xs group"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
              <span>
                Engineered and designed by Arinzechukwu Christian
              </span>
            </a>
            <span className="hidden sm:inline text-slate-300">•</span>
            <a
              href={PORTFOLIO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-slate-600 hover:text-emerald-700 transition underline underline-offset-4 decoration-slate-300 hover:decoration-emerald-500 text-xs"
            >
              Powered by Arinze Web Studio
            </a>
          </div>

          <p className="text-[11px] text-slate-500 text-center sm:text-right">
            © {new Date().getFullYear()} BursarIQ (bursariq.com.ng). All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};
