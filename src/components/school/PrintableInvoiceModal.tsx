import React, { useRef } from 'react';
import {
  X,
  Printer,
  CheckCircle2,
  AlertCircle,
  Clock,
  Building2,
  Calendar,
  CreditCard,
  User,
  ShieldCheck,
  FileText,
} from 'lucide-react';
import { InvoiceDef } from '../../types/index.js';

interface PrintableInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: InvoiceDef | null;
  currentSchool?: {
    name: string;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    logo_url?: string | null;
  } | null;
}

export const PrintableInvoiceModal: React.FC<PrintableInvoiceModalProps> = ({
  isOpen,
  onClose,
  invoice,
  currentSchool,
}) => {
  const printRef = useRef<HTMLDivElement>(null);

  if (!isOpen || !invoice) return null;

  const handlePrint = () => {
    window.print();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PAID':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5" /> PAID IN FULL
          </span>
        );
      case 'PARTIALLY_PAID':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300">
            <Clock className="w-3.5 h-3.5" /> PARTIALLY PAID
          </span>
        );
      case 'OVERDUE':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-300">
            <AlertCircle className="w-3.5 h-3.5" /> OVERDUE
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-200 text-slate-700 border border-slate-300">
            CANCELLED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-blue-100 text-blue-800 border border-blue-300">
            ISSUED
          </span>
        );
    }
  };

  const schoolName = invoice.school_name || currentSchool?.name || 'School';
  const schoolAddress = invoice.school_address || currentSchool?.address || 'Nigeria';
  const schoolPhone = invoice.school_phone || currentSchool?.phone || '+234 800 000 0000';
  const schoolEmail = invoice.school_email || currentSchool?.email || 'bursary@school.edu.ng';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 print:p-0 print:bg-white print:fixed print:inset-0">
      <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden print:max-h-none print:shadow-none print:border-none print:rounded-none">
        {/* Modal Controls (Hidden in Print) */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 print:hidden">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/10 text-blue-600 flex items-center justify-center font-bold">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">Official School Invoice & Receipt</h3>
              <p className="text-xs text-slate-500 font-mono">{invoice.invoice_number}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" /> Print / Save PDF
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Invoice Sheet */}
        <div
          ref={printRef}
          className="p-8 sm:p-12 overflow-y-auto flex-1 font-sans text-slate-800 bg-white print:p-8"
        >
          {/* Header & School Branding */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-b-2 border-slate-900 pb-8">
            <div className="space-y-1 max-w-md">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-blue-700 text-white flex items-center justify-center font-black text-lg">
                  <Building2 className="w-6 h-6" />
                </div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">{schoolName}</h1>
              </div>
              <p className="text-xs text-slate-600 pt-1 leading-relaxed">{schoolAddress}</p>
              <p className="text-xs text-slate-600 font-mono">
                Tel: {schoolPhone} | Email: {schoolEmail}
              </p>
            </div>

            <div className="sm:text-right space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Official Bill & Invoice</div>
              <div className="text-xl font-mono font-black text-blue-700">{invoice.invoice_number}</div>
              <div>{getStatusBadge(invoice.status)}</div>
              <div className="text-xs text-slate-500 pt-1">
                Issued: <span className="font-semibold text-slate-700">{invoice.issue_date}</span>
              </div>
              <div className="text-xs text-slate-500">
                Due: <span className="font-semibold text-rose-700">{invoice.due_date}</span>
              </div>
            </div>
          </div>

          {/* Student & Session Information */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 my-8 p-5 bg-slate-50 rounded-2xl border border-slate-200">
            <div className="space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-blue-600" /> Bill To / Student
              </div>
              <div className="text-base font-bold text-slate-900">{invoice.student_name}</div>
              <div className="text-xs text-slate-600">
                Admission No: <span className="font-mono font-bold text-slate-800">{invoice.admission_number}</span>
              </div>
              <div className="text-xs text-slate-600">
                Class: <span className="font-semibold text-slate-800">{invoice.class_name || 'Class Record'}</span>
              </div>
            </div>

            <div className="space-y-1 sm:text-right">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 sm:justify-end">
                <Calendar className="w-3.5 h-3.5 text-blue-600" /> Academic Term
              </div>
              <div className="text-sm font-bold text-slate-900">
                {invoice.session_name || '2024/2025'} Session
              </div>
              <div className="text-xs text-slate-600">
                Term: <span className="font-semibold text-slate-800">{invoice.term_name || 'Current Term'}</span>
              </div>
              {invoice.notes && (
                <div className="text-xs text-slate-500 italic pt-1">
                  Note: {invoice.notes}
                </div>
              )}
            </div>
          </div>

          {/* Line Items Table */}
          <div className="overflow-hidden border border-slate-200 rounded-xl mb-6">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-900 text-white text-xs uppercase tracking-wider">
                  <th className="py-3 px-4 font-semibold w-12 text-center">#</th>
                  <th className="py-3 px-4 font-semibold">Fee Description</th>
                  <th className="py-3 px-4 font-semibold text-center w-20">Qty</th>
                  <th className="py-3 px-4 font-semibold text-right w-32">Unit Amount</th>
                  <th className="py-3 px-4 font-semibold text-right w-36">Total (NGN)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoice.items && invoice.items.length > 0 ? (
                  invoice.items.map((it, idx) => (
                    <tr key={it.id || idx} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 text-center text-slate-400 font-mono text-xs">{idx + 1}</td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{it.description}</div>
                        {it.category_name && (
                          <span className="text-[11px] text-blue-600 font-medium">{it.category_name}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-slate-600">{it.quantity}</td>
                      <td className="py-3 px-4 text-right font-mono text-slate-600">
                        ₦{(it.unit_amount / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                        ₦{(it.total_amount / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-slate-400 italic">
                      No fee line items available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Discounts / Adjustments Section if any */}
          {invoice.discounts && invoice.discounts.length > 0 && (
            <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl mb-6">
              <div className="text-xs font-bold text-amber-900 uppercase tracking-wider mb-2">
                Scholarships / Fee Waivers Applied
              </div>
              <div className="space-y-1 text-xs">
                {invoice.discounts.map((disc, idx) => (
                  <div key={disc.id || idx} className="flex justify-between items-center text-amber-800">
                    <div>
                      <span className="font-semibold">{disc.type}:</span> {disc.reason}
                    </div>
                    <div className="font-mono font-bold">
                      -₦{(disc.amount / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Financial Calculation Totals */}
          <div className="flex justify-end mb-8">
            <div className="w-full sm:w-80 space-y-2 text-sm bg-slate-50 p-5 rounded-2xl border border-slate-200">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal:</span>
                <span className="font-mono font-semibold text-slate-800">
                  ₦{(invoice.subtotal / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>

              {invoice.discount > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Scholarship / Discount:</span>
                  <span className="font-mono font-semibold">
                    -₦{(invoice.discount / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}

              <div className="flex justify-between text-base font-bold text-slate-900 border-t border-slate-200 pt-2">
                <span>Total Payable:</span>
                <span className="font-mono text-blue-700">
                  ₦{(invoice.total / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="flex justify-between text-slate-600">
                <span>Total Amount Paid:</span>
                <span className="font-mono font-bold text-emerald-700">
                  ₦{(invoice.amount_paid / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="flex justify-between text-base font-black border-t-2 border-slate-900 pt-2">
                <span>Outstanding Balance:</span>
                <span className={`font-mono ${invoice.balance > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                  ₦{(invoice.balance / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          {/* Payment Receipts History */}
          {invoice.payments && invoice.payments.length > 0 && (
            <div className="mb-8">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5 text-blue-600" /> Verified Payment Receipts
              </h4>
              <div className="overflow-hidden border border-slate-200 rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr>
                      <th className="py-2.5 px-3">Receipt Reference</th>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Method</th>
                      <th className="py-2.5 px-3 text-right">Amount Paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoice.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2 px-3 font-mono font-semibold text-slate-800">{p.payment_reference}</td>
                        <td className="py-2 px-3 text-slate-600">{p.payment_date}</td>
                        <td className="py-2 px-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                            {p.payment_method}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-700">
                          ₦{(p.amount / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Payment Instructions & Official Stamp Area */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-6 border-t border-slate-200 text-xs text-slate-500">
            <div className="space-y-1">
              <div className="font-bold text-slate-700 uppercase tracking-wider">Payment Instructions</div>
              <p>All fee payments must be remitted directly to the school designated bank accounts or paid via Bursary card terminals.</p>
              <p className="font-semibold text-slate-700">Please quote invoice number on all bank transfer descriptions.</p>
            </div>
            <div className="sm:text-right space-y-4 flex flex-col justify-end">
              <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 sm:justify-end">
                <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                Verified Multi-Tenant Cryptographic Record
              </div>
              <div className="pt-6 border-t border-slate-300 w-48 sm:ml-auto text-center">
                <div className="text-[11px] font-semibold text-slate-700">School Bursar / Finance Officer</div>
                <div className="text-[10px] text-slate-400">Authorized Signature & Stamp</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
