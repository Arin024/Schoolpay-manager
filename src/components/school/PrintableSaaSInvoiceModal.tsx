import React from 'react';
import { X, Printer, CheckCircle2, Shield, Building2, Calendar, CreditCard, DollarSign } from 'lucide-react';
import { PlatformInvoice } from '../../types/index.js';

interface PrintableSaaSInvoiceModalProps {
  invoice: PlatformInvoice | null;
  platformSettings?: any;
  onClose: () => void;
}

export const PrintableSaaSInvoiceModal: React.FC<PrintableSaaSInvoiceModalProps> = ({
  invoice,
  platformSettings,
  onClose,
}) => {
  if (!invoice) return null;

  const handlePrint = () => {
    window.print();
  };

  const isPaid = invoice.payment_status === 'PAID';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative bg-white rounded-3xl max-w-3xl w-full shadow-2xl border border-slate-200 overflow-hidden my-8">
        {/* Modal Controls Bar */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white print:hidden">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-400" />
            <span className="text-sm font-bold">Official SaaS Subscription Invoice</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition cursor-pointer shadow"
            >
              <Printer className="w-4 h-4" />
              <span>Print / Save PDF</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Invoice Printable Sheet */}
        <div className="p-8 sm:p-12 space-y-8 bg-white print:p-0">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 pb-6 border-b-2 border-slate-900">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center text-emerald-400 font-black text-xl">
                  B
                </div>
                <div>
                  <h1 className="text-xl font-black text-slate-900 tracking-tight">BURSARIQ</h1>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Intelligent Bursary SaaS Platform</p>
                </div>
              </div>
              <p className="text-xs text-slate-600 mt-2">
                {platformSettings?.platform_account_name || 'BursarIQ Global Ltd'}
              </p>
              <p className="text-xs text-slate-500">
                bursariq.com.ng • {platformSettings?.platform_contact_email || 'support@bursariq.com.ng'} • Tel/WhatsApp: {platformSettings?.platform_contact_phone || '08160754659'}
              </p>
            </div>

            <div className="text-left sm:text-right">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${
                isPaid ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-amber-100 text-amber-800 border border-amber-300'
              }`}>
                {isPaid ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : null}
                <span>{invoice.payment_status}</span>
              </span>
              <p className="text-xs font-mono font-bold text-slate-900 mt-2">Invoice #: {invoice.invoice_number}</p>
              <p className="text-xs text-slate-500">Issue Date: {invoice.issue_date}</p>
              <p className="text-xs text-slate-500">Due Date: {invoice.due_date}</p>
            </div>
          </div>

          {/* Billed To */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-5 rounded-2xl bg-slate-50 border border-slate-200">
            <div>
              <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Billed To (School)</p>
              <h2 className="text-base font-bold text-slate-900 mt-0.5">{invoice.school_name || 'School Client'}</h2>
              <p className="text-xs text-slate-600 mt-1">{invoice.school_address || 'Registered School Address'}</p>
              <p className="text-xs text-slate-500">{invoice.school_email || ''} {invoice.school_phone ? `• ${invoice.school_phone}` : ''}</p>
            </div>

            <div>
              <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Subscription Period</p>
              <p className="text-sm font-bold text-slate-900 mt-0.5">{invoice.billing_period || 'Annual SaaS Subscription'}</p>
              <p className="text-xs text-slate-500 mt-1">Platform Plan: <span className="font-semibold text-slate-800">{invoice.plan_display_name || 'Standard Tier'}</span></p>
              {isPaid && (
                <p className="text-xs text-emerald-700 font-semibold mt-1">
                  Paid via: {invoice.payment_method || 'Online Checkout'} on {invoice.paid_at?.slice(0, 10) || invoice.issue_date}
                </p>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-hidden border border-slate-200 rounded-2xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 uppercase text-[10px] tracking-wider font-bold">
                <tr>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4 text-center">Interval</th>
                  <th className="py-3 px-4 text-right">Standard Price</th>
                  <th className="py-3 px-4 text-right">Discount / Override</th>
                  <th className="py-3 px-4 text-right">Final Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                <tr>
                  <td className="py-4 px-4 font-semibold">
                    BursarIQ SaaS Subscription ({invoice.plan_display_name || 'Tier'})
                    <span className="block text-[11px] text-slate-500 font-normal">
                      Full multi-tenant access, bursary controls, parent receipts, online payments &amp; student records.
                    </span>
                  </td>
                  <td className="py-4 px-4 text-center text-slate-500">1 Cycle</td>
                  <td className="py-4 px-4 text-right font-mono">₦{invoice.standard_price_naira.toLocaleString()}</td>
                  <td className="py-4 px-4 text-right font-mono text-emerald-600">
                    {invoice.discount_naira > 0 ? `-₦${invoice.discount_naira.toLocaleString()}` : (invoice.negotiated_price_naira ? 'Custom Price' : '₦0')}
                  </td>
                  <td className="py-4 px-4 text-right font-mono font-bold text-slate-900">
                    ₦{invoice.final_amount_naira.toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Total Calculation */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 pt-4">
            <div className="text-xs text-slate-500 max-w-sm space-y-1">
              <p className="font-bold text-slate-700">Official Settlement Account Details:</p>
              <p>Bank: <span className="font-semibold text-slate-800">{platformSettings?.platform_bank_name || 'Zenith Bank Plc'}</span></p>
              <p>Account Name: <span className="font-semibold text-slate-800">{platformSettings?.platform_account_name || 'BursarIQ Global Ltd'}</span></p>
              <p>Account Number: <span className="font-mono font-bold text-slate-900">{platformSettings?.platform_account_number || '1012345678'}</span></p>
            </div>

            <div className="w-full sm:w-64 space-y-2">
              <div className="flex justify-between text-xs text-slate-600">
                <span>Standard Plan:</span>
                <span className="font-mono font-semibold">₦{invoice.standard_price_naira.toLocaleString()}</span>
              </div>
              {invoice.discount_naira > 0 && (
                <div className="flex justify-between text-xs text-emerald-700">
                  <span>Discount Applied:</span>
                  <span className="font-mono font-semibold">-₦{invoice.discount_naira.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-black text-slate-900 pt-2 border-t border-slate-200">
                <span>Total Due ({invoice.currency || 'NGN'}):</span>
                <span className="font-mono text-emerald-600">₦{invoice.final_amount_naira.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="pt-6 border-t border-slate-200 text-center text-[11px] text-slate-400">
            <p>Thank you for partnering with BursarIQ. This document constitutes an official platform SaaS invoice.</p>
            <p className="mt-0.5">BursarIQ Global Ltd (bursariq.com.ng) • Regulated Nigerian EdTech Infrastructure</p>
          </div>
        </div>
      </div>
    </div>
  );
};
