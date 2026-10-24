/**
 * BURSARIQ - FINANCIAL RECONCILIATION HARDENING ENGINE
 *
 * Strict read-only audit and ledger verification utility:
 * 1. Analyzes invoices, line items, discounts, payments, receipts, and reversals.
 * 2. Accounts explicitly for:
 *    - SUCCESS payments (reduce balance).
 *    - PENDING / FAILED payments (must NEVER reduce balance or be counted as collections).
 *    - REVERSED payments (must restore balance and be documented in payment_reversals).
 *    - Invoice items vs Subtotal.
 *    - Applied discounts vs Net Total.
 * 3. Never mutates or silently rewrites ledger records.
 * 4. Outputs structured, categorised diagnostic discrepancy reports.
 */

export interface InvoiceDiscrepancy {
  invoiceId: string;
  invoiceNumber: string;
  schoolId: string;
  studentId: string;
  category:
    | 'SUBTOTAL_MISMATCH'
    | 'DISCOUNT_MISMATCH'
    | 'TOTAL_CALCULATION_ERROR'
    | 'PAYMENT_SUM_MISMATCH'
    | 'BALANCE_EQUATION_VIOLATION'
    | 'STATUS_INCONSISTENCY'
    | 'ORPHAN_PAYMENT'
    | 'UNRECORDED_REVERSAL'
    | 'NEGATIVE_BALANCE';
  expectedAmountKobo: number;
  observedAmountKobo: number;
  differenceKobo: number;
  explanation: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFORMATIONAL';
}

export interface ReconciliationReport {
  timestamp: string;
  schoolId?: string;
  totalInvoicesChecked: number;
  totalPaymentsChecked: number;
  totalDiscountsChecked: number;
  totalReversalsChecked: number;
  ledgerBalanced: boolean;
  discrepancies: InvoiceDiscrepancy[];
  summary: {
    totalExpectedInvoicedKobo: number;
    totalObservedInvoicedKobo: number;
    totalExpectedCollectedKobo: number;
    totalObservedCollectedKobo: number;
    totalExpectedOutstandingKobo: number;
    totalObservedOutstandingKobo: number;
  };
}

/**
 * Reconciles an invoice ledger snapshot against authoritative ACID invariants
 */
export function reconcileInvoiceLedger(
  invoices: any[],
  items: any[],
  discounts: any[],
  payments: any[],
  reversals: any[]
): ReconciliationReport {
  const discrepancies: InvoiceDiscrepancy[] = [];

  // Group items by invoice_id
  const itemsByInvoice = new Map<string, any[]>();
  for (const it of items) {
    const list = itemsByInvoice.get(it.invoice_id) || [];
    list.push(it);
    itemsByInvoice.set(it.invoice_id, list);
  }

  // Group discounts by invoice_id
  const discountsByInvoice = new Map<string, any[]>();
  for (const d of discounts) {
    const list = discountsByInvoice.get(d.invoice_id) || [];
    list.push(d);
    discountsByInvoice.set(d.invoice_id, list);
  }

  // Group payments by invoice_id
  const paymentsByInvoice = new Map<string, any[]>();
  for (const p of payments) {
    const list = paymentsByInvoice.get(p.invoice_id) || [];
    list.push(p);
    paymentsByInvoice.set(p.invoice_id, list);
  }

  // Group reversals by payment_id
  const reversalsByPayment = new Map<string, any[]>();
  for (const r of reversals) {
    const list = reversalsByPayment.get(r.payment_id) || [];
    list.push(r);
    reversalsByPayment.set(r.payment_id, list);
  }

  let totalExpectedInvoicedKobo = 0;
  let totalObservedInvoicedKobo = 0;
  let totalExpectedCollectedKobo = 0;
  let totalObservedCollectedKobo = 0;
  let totalExpectedOutstandingKobo = 0;
  let totalObservedOutstandingKobo = 0;

  for (const inv of invoices) {
    const invItems = itemsByInvoice.get(inv.id) || [];
    const invDiscounts = discountsByInvoice.get(inv.id) || [];
    const invPayments = paymentsByInvoice.get(inv.id) || [];

    const observedSubtotal = Number(inv.subtotal || 0);
    const observedDiscount = Number(inv.discount || 0);
    const observedTotal = Number(inv.total || 0);
    const observedPaid = Number(inv.amount_paid || 0);
    const observedBalance = Number(inv.balance || 0);

    totalObservedInvoicedKobo += observedTotal;
    totalObservedCollectedKobo += observedPaid;
    totalObservedOutstandingKobo += observedBalance;

    // Rule 1: Sum of item line amounts == invoice subtotal
    if (invItems.length > 0) {
      const calculatedSubtotal = invItems.reduce((acc, it) => acc + Number(it.total_amount || 0), 0);
      if (calculatedSubtotal !== observedSubtotal) {
        discrepancies.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoice_number,
          schoolId: inv.school_id,
          studentId: inv.student_id,
          category: 'SUBTOTAL_MISMATCH',
          expectedAmountKobo: calculatedSubtotal,
          observedAmountKobo: observedSubtotal,
          differenceKobo: observedSubtotal - calculatedSubtotal,
          explanation: `Invoice subtotal (${observedSubtotal}) does not match sum of line items (${calculatedSubtotal})`,
          severity: 'CRITICAL',
        });
      }
    }

    // Rule 2: Sum of applied discounts == invoice discount
    const calculatedDiscount = invDiscounts.reduce((acc, d) => acc + Number(d.amount || 0), 0);
    if (invDiscounts.length > 0 && calculatedDiscount !== observedDiscount) {
      discrepancies.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        schoolId: inv.school_id,
        studentId: inv.student_id,
        category: 'DISCOUNT_MISMATCH',
        expectedAmountKobo: calculatedDiscount,
        observedAmountKobo: observedDiscount,
        differenceKobo: observedDiscount - calculatedDiscount,
        explanation: `Invoice recorded discount (${observedDiscount}) does not match sum of discount breakdown (${calculatedDiscount})`,
        severity: 'WARNING',
      });
    }

    // Rule 3: Total == Math.max(0, Subtotal - Discount)
    const expectedTotal = Math.max(0, observedSubtotal - (invDiscounts.length > 0 ? calculatedDiscount : observedDiscount));
    if (expectedTotal !== observedTotal) {
      discrepancies.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        schoolId: inv.school_id,
        studentId: inv.student_id,
        category: 'TOTAL_CALCULATION_ERROR',
        expectedAmountKobo: expectedTotal,
        observedAmountKobo: observedTotal,
        differenceKobo: observedTotal - expectedTotal,
        explanation: `Invoice net total (${observedTotal}) is inconsistent with Subtotal minus Discount (${expectedTotal})`,
        severity: 'CRITICAL',
      });
    }

    // Rule 4: Payment reconciliation
    // Payments that are SUCCESS count towards amount_paid.
    // Payments with status REVERSED or PENDING/FAILED must NOT reduce balance.
    let expectedPaid = 0;
    for (const p of invPayments) {
      if (p.status === 'SUCCESS') {
        expectedPaid += Number(p.amount || 0);
      } else if (p.status === 'REVERSED') {
        // Verify reversal has an audit record
        const revRecords = reversalsByPayment.get(p.id) || [];
        if (revRecords.length === 0) {
          discrepancies.push({
            invoiceId: inv.id,
            invoiceNumber: inv.invoice_number,
            schoolId: inv.school_id,
            studentId: inv.student_id,
            category: 'UNRECORDED_REVERSAL',
            expectedAmountKobo: Number(p.amount || 0),
            observedAmountKobo: 0,
            differenceKobo: Number(p.amount || 0),
            explanation: `Payment ${p.payment_reference || p.id} is marked REVERSED but lacks an immutable entry in payment_reversals`,
            severity: 'CRITICAL',
          });
        }
      }
    }

    if (expectedPaid !== observedPaid) {
      discrepancies.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        schoolId: inv.school_id,
        studentId: inv.student_id,
        category: 'PAYMENT_SUM_MISMATCH',
        expectedAmountKobo: expectedPaid,
        observedAmountKobo: observedPaid,
        differenceKobo: observedPaid - expectedPaid,
        explanation: `Invoice amount_paid (${observedPaid}) does not match sum of confirmed SUCCESS payments (${expectedPaid})`,
        severity: 'CRITICAL',
      });
    }

    // Rule 5: Balance invariant: Balance == Total - Paid
    const expectedBalance = Math.max(0, observedTotal - expectedPaid);
    if (expectedBalance !== observedBalance) {
      discrepancies.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        schoolId: inv.school_id,
        studentId: inv.student_id,
        category: 'BALANCE_EQUATION_VIOLATION',
        expectedAmountKobo: expectedBalance,
        observedAmountKobo: observedBalance,
        differenceKobo: observedBalance - expectedBalance,
        explanation: `Invoice balance (${observedBalance}) violates ledger invariant [Balance = Total - Paid] (${expectedBalance})`,
        severity: 'CRITICAL',
      });
    }

    // Rule 6: Negative balance guard
    if (observedBalance < 0) {
      discrepancies.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        schoolId: inv.school_id,
        studentId: inv.student_id,
        category: 'NEGATIVE_BALANCE',
        expectedAmountKobo: 0,
        observedAmountKobo: observedBalance,
        differenceKobo: observedBalance,
        explanation: `Invoice has an illegal negative balance: ${observedBalance}`,
        severity: 'CRITICAL',
      });
    }

    // Rule 7: Status consistency check
    let expectedStatus = inv.status;
    if (observedBalance === 0 && observedTotal > 0) {
      expectedStatus = 'PAID';
    } else if (observedPaid > 0 && observedBalance > 0) {
      expectedStatus = 'PARTIALLY_PAID';
    }

    if (
      inv.status !== 'CANCELLED' &&
      inv.status !== 'VOID' &&
      expectedStatus !== inv.status &&
      (expectedStatus === 'PAID' || expectedStatus === 'PARTIALLY_PAID')
    ) {
      discrepancies.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        schoolId: inv.school_id,
        studentId: inv.student_id,
        category: 'STATUS_INCONSISTENCY',
        expectedAmountKobo: 0,
        observedAmountKobo: 0,
        differenceKobo: 0,
        explanation: `Invoice status is ${inv.status} but payment state requires ${expectedStatus}`,
        severity: 'WARNING',
      });
    }

    totalExpectedInvoicedKobo += expectedTotal;
    totalExpectedCollectedKobo += expectedPaid;
    totalExpectedOutstandingKobo += expectedBalance;
  }

  return {
    timestamp: new Date().toISOString(),
    totalInvoicesChecked: invoices.length,
    totalPaymentsChecked: payments.length,
    totalDiscountsChecked: discounts.length,
    totalReversalsChecked: reversals.length,
    ledgerBalanced: discrepancies.length === 0,
    discrepancies,
    summary: {
      totalExpectedInvoicedKobo,
      totalObservedInvoicedKobo,
      totalExpectedCollectedKobo,
      totalObservedCollectedKobo,
      totalExpectedOutstandingKobo,
      totalObservedOutstandingKobo,
    },
  };
}
