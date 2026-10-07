import React from 'react';
import { PORTFOLIO_URL } from '../../constants/index.js';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full py-6 mt-auto border-t border-slate-200/80 bg-white/60 backdrop-blur-xs text-center text-xs text-slate-500">
      <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-[11px] text-slate-400">
          © {new Date().getFullYear()} School Pay Manager. All rights reserved.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4 text-xs">
          <a
            href={PORTFOLIO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-slate-600 hover:text-emerald-700 transition underline underline-offset-4 decoration-slate-300 hover:decoration-emerald-500"
          >
            Engineered and designed by Arinzechukwu Christian
          </a>
          <span className="hidden sm:inline text-slate-300">•</span>
          <a
            href={PORTFOLIO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-slate-700 hover:text-emerald-700 transition underline underline-offset-4 decoration-slate-300 hover:decoration-emerald-500"
          >
            Powered by Arinze Web Studio
          </a>
        </div>
      </div>
    </footer>
  );
};
