import React from 'react';
import { Printer, X, CheckCircle, ShieldCheck, Download, School as SchoolIcon, Receipt } from 'lucide-react';
import { ReceiptItem } from '../../types/index.js';

interface PrintableReceiptModalProps {
  receipt: ReceiptItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export const PrintableReceiptModal: React.FC<PrintableReceiptModalProps> = ({
  receipt,
  isOpen,
  onClose,
}) => {
  if (!isOpen || !receipt) return null;

  const handlePrint = () => {
    window.print();
  };

  const formattedAmount = (receipt.amount_naira || receipt.amount / 100).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const formattedPrevBalance = (
    receipt.previous_balance_naira || receipt.previous_balance / 100
  ).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const formattedCurBalance = (
    receipt.current_balance_naira || receipt.current_balance / 100
  ).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 print:p-0 print:bg-white print:static">
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden print:border-none print:shadow-none print:w-full print:max-w-none">
        
        {/* Modal Controls - Hidden during print */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white print:hidden">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-emerald-400" />
            <span className="font-semibold text-sm tracking-wide uppercase">Official Payment Voucher</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer shadow-xs"
            >
              <Printer className="w-4 h-4" />
              Print Receipt
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* PRINTABLE RECEIPT CONTENT */}
        <div className="p-8 sm:p-10 space-y-6 print:p-6 bg-white text-slate-800" id="printable-receipt">
          
          {/* Header & School Branding */}
          <div className="border-b-2 border-slate-900/10 pb-6">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-center gap-4">
                {receipt.school_logo_url ? (
                  <img
                    src={receipt.school_logo_url}
                    alt={receipt.school_name || 'School Logo'}
                    className="w-16 h-16 object-contain rounded-xl border border-slate-200 p-1"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center font-bold text-2xl shadow-inner">
                    <SchoolIcon className="w-8 h-8" />
                  </div>
                )}
                <div>
                  <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight uppercase">
                    {receipt.school_name || 'BursarIQ'}
                  </h1>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    {receipt.school_type || 'Comprehensive Education'}
                  </p>
                  <p className="text-xs text-slate-600 mt-1 max-w-md leading-relaxed">
                    {[receipt.school_address, receipt.school_lga, receipt.school_state].filter(Boolean).join(', ')}
                  </p>
                  <div className="flex flex-wrap gap-x-4 text-[11px] text-slate-500 mt-1">
                    {receipt.school_phone && <span>Tel: {receipt.school_phone}</span>}
                    {receipt.school_email && <span>Email: {receipt.school_email}</span>}
                  </div>
                </div>
              </div>

              {/* Receipt Title Card */}
              <div className="text-right">
                <div className="inline-block px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-md uppercase tracking-wider mb-2">
                  Payment Confirmed
                </div>
                <div className="text-sm font-semibold text-slate-900">
                  Receipt No:
                </div>
                <div className="text-base sm:text-lg font-black text-emerald-700 font-mono">
                  {receipt.receipt_number}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Issue Date: <span className="font-medium text-slate-700">{receipt.issue_date}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Student & Billing Meta Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs">
            <div>
              <span className="text-slate-400 block font-medium">Student Name</span>
              <span className="text-slate-900 font-bold text-sm block mt-0.5">
                {receipt.student_name || 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Admission No</span>
              <span className="text-slate-900 font-semibold font-mono block mt-0.5">
                {receipt.admission_number || 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Class / Arm</span>
              <span className="text-slate-900 font-semibold block mt-0.5">
                {receipt.class_display_name || receipt.class_name || 'N/A'}
                {receipt.class_arm_name ? ` (${receipt.class_arm_name})` : ''}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Invoice Number</span>
              <span className="text-slate-900 font-semibold font-mono block mt-0.5">
                {receipt.invoice_number || 'N/A'}
              </span>
            </div>
          </div>

          {/* Payment Detail Section */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/75 border-b border-slate-200 text-slate-600 font-semibold">
                <tr>
                  <th className="py-3 px-4">Transaction Description</th>
                  <th className="py-3 px-4">Payment Method</th>
                  <th className="py-3 px-4">Internal Reference</th>
                  <th className="py-3 px-4 text-right">Amount Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                <tr>
                  <td className="py-3.5 px-4 font-medium">
                    Term Fee Settlement
                    {receipt.notes && (
                      <span className="block text-[11px] text-slate-500 font-normal mt-0.5">
                        Note: {receipt.notes}
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-200 text-slate-800 uppercase">
                      {receipt.payment_method?.replace('_', ' ') || 'BANK TRANSFER'}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-[11px] text-slate-600">
                    {receipt.internal_reference || receipt.payment_reference || 'N/A'}
                  </td>
                  <td className="py-3.5 px-4 text-right font-black text-sm text-slate-900">
                    ₦{formattedAmount}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Ledger Summary Box */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-5 rounded-xl bg-slate-900 text-white shadow-sm">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
                <CheckCircle className="w-4 h-4" />
                Electronic Payment Settlement
              </div>
              <p className="text-xs text-slate-400 max-w-sm">
                This transaction has been authenticated by the School Bursary Department and credited to student's ledger.
              </p>
            </div>
            <div className="w-full sm:w-64 space-y-2 border-t sm:border-t-0 sm:border-l border-slate-800 pt-3 sm:pt-0 sm:pl-5 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>Previous Balance:</span>
                <span className="font-mono text-slate-300">₦{formattedPrevBalance}</span>
              </div>
              <div className="flex justify-between font-bold text-white text-sm">
                <span>Amount Paid:</span>
                <span className="font-mono text-emerald-400">₦{formattedAmount}</span>
              </div>
              <div className="border-t border-slate-800 pt-2 flex justify-between font-black text-slate-200">
                <span>Current Balance:</span>
                <span className={`font-mono ${receipt.current_balance <= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  ₦{formattedCurBalance}
                </span>
              </div>
            </div>
          </div>

          {/* Verification & Stamp Footer */}
          <div className="border-t border-slate-200 pt-6 flex flex-col sm:flex-row justify-between items-end gap-6 text-xs text-slate-500">
            <div>
              <div className="flex items-center gap-1.5 text-slate-700 font-semibold mb-1">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Verified & Authorized Voucher
              </div>
              <p className="text-[11px] text-slate-400 leading-normal max-w-xs">
                Generated via BursarIQ (bursariq.com.ng) Multi-Tenant Engine. Valid with or without physical stamp when reference is verifiable.
              </p>
              <div className="text-[10px] text-slate-400 font-mono mt-2">
                Verification Hash: {receipt.id.slice(0, 12).toUpperCase()} • {new Date().toISOString()}
              </div>
            </div>

            {/* Bursar Stamp Simulation */}
            <div className="text-center sm:text-right">
              <div className="inline-block border-2 border-dashed border-emerald-600/60 rounded-xl px-4 py-2 bg-emerald-50/50 text-emerald-800 font-mono text-[11px] transform -rotate-2">
                <div className="font-bold uppercase tracking-wider text-emerald-900">★ OFFICIAL RECEIPT ★</div>
                <div className="text-[10px] text-emerald-700 mt-0.5">CONFIRMED & RECONCILED</div>
                <div className="text-[9px] text-emerald-600">{receipt.issuer_name || 'BURSARY OFFICER'}</div>
              </div>
              <div className="text-[10px] text-slate-400 mt-2">Authorized Signatory / Bursar</div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
