/**
 * BURSARIQ - POSTGRESQL-NATIVE FINANCIAL TRANSACTION SERVICE
 *
 * Dedicated, ACID-compliant PostgreSQL transaction routines for:
 * 1. Invoice creation with items and optional discounts
 * 2. Payment recording with row-level invoice locking, overpayment rejection, and idempotency
 * 3. Payment reversal with audit trail and balance restoration
 *
 * Strict Architectural Guarantees:
 * - Dedicated checked-out pg.PoolClient for each transaction
 * - BEGIN -> Operations -> COMMIT -> Release in finally block
 * - Guaranteed ROLLBACK on any failure
 * - Tenant isolation enforced explicitly in SQL WHERE clauses
 * - Isolated behind feature flag / programmatic invocation (zero silent fallback)
 */

import crypto from 'node:crypto';
import type pg from 'pg';
import { getPgPool, isPgConnected } from './db.ts';

export interface CreateInvoiceParams {
  schoolId: string;
  studentId: string;
  classId?: string | null;
  feeStructureId?: string | null;
  academicSessionId?: string | null;
  termId?: string | null;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  items: Array<{
    feeCategoryId?: string | null;
    description: string;
    quantity: number;
    unitAmount: number; // in kobo
    totalAmount: number; // in kobo
  }>;
  discounts?: Array<{
    name: string;
    type: 'FIXED' | 'PERCENTAGE' | 'SCHOLARSHIP' | 'WAIVER';
    amount: number; // in kobo
    reason?: string;
  }>;
  notes?: string | null;
  createdByUserId: string;
}

export interface RecordPaymentParams {
  schoolId: string;
  invoiceId: string;
  amountKobo: number;
  paymentMethod: string;
  paymentReference: string;
  internalReference?: string;
  provider?: string;
  providerReference?: string | null;
  paymentDate?: string;
  notes?: string | null;
  receivedByUserId: string;
  isPending?: boolean;
}

export interface ReversePaymentParams {
  schoolId: string;
  paymentId: string;
  reason: string;
  reversedByUserId: string;
  reversedByUserEmail: string;
}

export interface FinancialServiceResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

/**
 * 1. Create Invoice with line items and optional discounts atomically in PostgreSQL
 */
export async function createInvoicePg(
  params: CreateInvoiceParams,
  clientOverride?: pg.PoolClient
): Promise<FinancialServiceResult<{ invoice: any; items: any[]; discounts: any[] }>> {
  if (!clientOverride) {
    const pool = getPgPool();
    if (!pool || !isPgConnected()) {
      return {
        success: false,
        error: 'PostgreSQL database is offline or not configured',
        code: 'DATABASE_OFFLINE',
      };
    }
  }

  const client = clientOverride || (await getPgPool()!.connect());
  const shouldManageTx = true; // Always manage atomic transaction per payment execution

  try {
    if (shouldManageTx) await client.query('BEGIN');

    // 1. Verify student exists in target school
    const stuCheck = await client.query(
      'SELECT id, first_name, last_name FROM students WHERE id = $1 AND school_id = $2',
      [params.studentId, params.schoolId]
    );
    if (stuCheck.rows.length === 0) {
      if (shouldManageTx) await client.query('ROLLBACK');
      return { success: false, error: 'Student not found in specified school tenant', code: 'STUDENT_NOT_FOUND' };
    }

    // 2. Validate items
    if (!params.items || params.items.length === 0) {
      if (shouldManageTx) await client.query('ROLLBACK');
      return { success: false, error: 'Invoice must have at least one line item', code: 'EMPTY_ITEMS' };
    }

    let subtotal = 0;
    for (const itm of params.items) {
      if (itm.unitAmount < 0 || itm.quantity <= 0) {
        if (shouldManageTx) await client.query('ROLLBACK');
        return { success: false, error: 'Invalid line item unit amount or quantity', code: 'INVALID_ITEM_AMOUNTS' };
      }
      subtotal += Math.round(itm.totalAmount || itm.unitAmount * itm.quantity);
    }

    let discountTotal = 0;
    if (params.discounts && params.discounts.length > 0) {
      for (const disc of params.discounts) {
        if (disc.amount < 0) {
          if (shouldManageTx) await client.query('ROLLBACK');
          return { success: false, error: 'Discount amount cannot be negative', code: 'INVALID_DISCOUNT' };
        }
        discountTotal += Math.round(disc.amount);
      }
    }

    const total = Math.max(0, subtotal - discountTotal);
    const balance = total; // Brand new invoice has 0 paid
    const invoiceId = `inv_${crypto.randomBytes(8).toString('hex')}`;

    // 3. Insert Invoice
    const invRes = await client.query(
      `INSERT INTO invoices (
        id, school_id, student_id, class_id, fee_structure_id,
        academic_session_id, term_id, invoice_number, issue_date, due_date,
        subtotal, discount, total, amount_paid, balance, status, notes, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, 0, $14, 'ISSUED', $15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ) RETURNING *`,
      [
        invoiceId,
        params.schoolId,
        params.studentId,
        params.classId || null,
        params.feeStructureId || null,
        params.academicSessionId || null,
        params.termId || null,
        params.invoiceNumber,
        params.issueDate,
        params.dueDate,
        subtotal,
        discountTotal,
        total,
        balance,
        params.notes || null,
      ]
    );

    // 4. Insert Invoice Items
    const insertedItems: any[] = [];
    for (const itm of params.items) {
      const itemId = `ii_${crypto.randomBytes(8).toString('hex')}`;
      const itmTotal = Math.round(itm.totalAmount || itm.unitAmount * itm.quantity);
      const itmRes = await client.query(
        `INSERT INTO invoice_items (
          id, invoice_id, fee_category_id, description, amount, school_id, quantity, unit_amount, total_amount, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP
        ) RETURNING *`,
        [
          itemId,
          invoiceId,
          itm.feeCategoryId || null,
          itm.description,
          itmTotal,
          params.schoolId,
          itm.quantity,
          itm.unitAmount,
          itmTotal,
        ]
      );
      insertedItems.push(itmRes.rows[0]);
    }

    // 5. Insert Invoice Discounts
    const insertedDiscounts: any[] = [];
    if (params.discounts && params.discounts.length > 0) {
      for (const disc of params.discounts) {
        const discId = `disc_${crypto.randomBytes(8).toString('hex')}`;
        const discRes = await client.query(
          `INSERT INTO invoice_discounts (
            id, invoice_id, name, type, value, amount, reason, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP
          ) RETURNING *`,
          [
            discId,
            invoiceId,
            disc.name,
            disc.type,
            disc.amount,
            disc.amount,
            disc.reason || null,
          ]
        );
        insertedDiscounts.push(discRes.rows[0]);
      }
    }

    if (shouldManageTx) await client.query('COMMIT');

    return {
      success: true,
      data: {
        invoice: invRes.rows[0],
        items: insertedItems,
        discounts: insertedDiscounts,
      },
    };
  } catch (err: any) {
    if (shouldManageTx) await client.query('ROLLBACK').catch(() => {});
    return {
      success: false,
      error: err.message,
      code: err.code === '23505' ? 'DUPLICATE_INVOICE_NUMBER' : 'TRANSACTION_FAILED',
    };
  } finally {
    if (!clientOverride) client.release();
  }
}

/**
 * 2. Record Payment against Invoice with row-level locking (FOR UPDATE) in PostgreSQL
 */
export async function recordPaymentPg(
  params: RecordPaymentParams,
  clientOverride?: pg.PoolClient
): Promise<FinancialServiceResult<{ payment: any; invoice: any; receipt: any | null }>> {
  if (!clientOverride) {
    const pool = getPgPool();
    if (!pool || !isPgConnected()) {
      return {
        success: false,
        error: 'PostgreSQL database is offline or not configured',
        code: 'DATABASE_OFFLINE',
      };
    }
  }

  if (params.amountKobo <= 0) {
    return { success: false, error: 'Payment amount must be greater than zero', code: 'INVALID_AMOUNT' };
  }

  const client = clientOverride || (await getPgPool()!.connect());
  const shouldManageTx = true; // Always manage atomic transaction per payment execution

  try {
    if (shouldManageTx) await client.query('BEGIN');

    // 1. Row-level Lock on target invoice (FOR UPDATE ensures serialized concurrent payments)
    const invLockRes = await client.query(
      `SELECT * FROM invoices 
       WHERE id = $1 AND school_id = $2 
       FOR UPDATE`,
      [params.invoiceId, params.schoolId]
    );

    if (invLockRes.rows.length === 0) {
      if (shouldManageTx) await client.query('ROLLBACK');
      return { success: false, error: 'Invoice not found in specified school', code: 'INVOICE_NOT_FOUND' };
    }

    const invoice = invLockRes.rows[0];

    if (invoice.status === 'CANCELLED') {
      if (shouldManageTx) await client.query('ROLLBACK');
      return { success: false, error: 'Cannot record payment for a CANCELLED invoice', code: 'INVOICE_CANCELLED' };
    }

    const currentBalance = Number(invoice.balance);
    const currentPaid = Number(invoice.amount_paid);
    const invoiceTotal = Number(invoice.total);

    if (currentBalance <= 0 || invoice.status === 'PAID') {
      if (shouldManageTx) await client.query('ROLLBACK');
      return { success: false, error: 'Invoice is already fully settled', code: 'ALREADY_PAID' };
    }

    // 2. Strict Overpayment Defense
    if (params.amountKobo > currentBalance) {
      if (shouldManageTx) await client.query('ROLLBACK');
      return {
        success: false,
        error: `Payment amount (${params.amountKobo} kobo) exceeds outstanding balance (${currentBalance} kobo)`,
        code: 'OVERPAYMENT_NOT_ALLOWED',
      };
    }

    // 3. Idempotency Check on payment_reference within tenant
    const existingRefRes = await client.query(
      `SELECT id, amount, status FROM payments WHERE school_id = $1 AND payment_reference = $2`,
      [params.schoolId, params.paymentReference]
    );

    if (existingRefRes.rows.length > 0) {
      if (shouldManageTx) await client.query('ROLLBACK');
      return {
        success: false,
        error: `A payment with reference "${params.paymentReference}" has already been processed`,
        code: 'DUPLICATE_PAYMENT_REFERENCE',
      };
    }

    const paymentId = `pay_${crypto.randomBytes(8).toString('hex')}`;
    const initialStatus = params.isPending ? 'PENDING' : 'SUCCESS';
    const paidAt = new Date().toISOString();
    const verifiedAt = params.isPending ? null : paidAt;
    const verifiedBy = params.isPending ? null : params.receivedByUserId;

    // 4. Insert Payment Record
    const payRes = await client.query(
      `INSERT INTO payments (
        id, school_id, invoice_id, student_id, payment_reference, internal_reference,
        amount, currency, payment_method, provider, provider_reference, status,
        payment_date, paid_at, verified_at, verified_by, notes, received_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, 'NGN', $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ) RETURNING *`,
      [
        paymentId,
        params.schoolId,
        params.invoiceId,
        invoice.student_id,
        params.paymentReference,
        params.internalReference || params.paymentReference,
        params.amountKobo,
        params.paymentMethod,
        params.provider || 'MANUAL',
        params.providerReference || null,
        initialStatus,
        params.paymentDate || paidAt,
        paidAt,
        verifiedAt,
        verifiedBy,
        params.notes || null,
        params.receivedByUserId,
      ]
    );

    let updatedInvoice = invoice;
    let receiptRow: any = null;

    // 5. Update invoice balance and status if payment is confirmed SUCCESS
    if (initialStatus === 'SUCCESS') {
      const newPaid = currentPaid + params.amountKobo;
      const newBalance = Math.max(0, invoiceTotal - newPaid);
      const newStatus = newBalance === 0 ? 'PAID' : 'PARTIALLY_PAID';

      const invUpdateRes = await client.query(
        `UPDATE invoices SET
          amount_paid = $1,
          balance = $2,
          status = $3,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $4 AND school_id = $5
        RETURNING *`,
        [newPaid, newBalance, newStatus, params.invoiceId, params.schoolId]
      );
      updatedInvoice = invUpdateRes.rows[0];

      // 6. Generate Official Receipt
      // 6. Generate Official Receipt with sequence locking & school slug
      const schoolSlugRes = await client.query('SELECT slug FROM schools WHERE id = $1 FOR UPDATE', [params.schoolId]);
      const schoolSlug = schoolSlugRes.rows[0]?.slug || 'SCH';
      const countRecRes = await client.query('SELECT COUNT(*) as c FROM receipts WHERE school_id = $1', [params.schoolId]);
      let recSeq = parseInt(countRecRes.rows[0]?.c || '0', 10) + 1;
      let receiptNumber = `RCP-${schoolSlug.toUpperCase().slice(0, 4)}-${new Date().getFullYear()}-${String(recSeq).padStart(4, '0')}`;
      
      while (true) {
        const existRec = await client.query('SELECT id FROM receipts WHERE school_id = $1 AND receipt_number = $2', [params.schoolId, receiptNumber]);
        if (existRec.rows.length === 0) break;
        recSeq++;
        receiptNumber = `RCP-${schoolSlug.toUpperCase().slice(0, 4)}-${new Date().getFullYear()}-${String(recSeq).padStart(4, '0')}`;
      }
      const receiptId = `rcp_${crypto.randomBytes(8).toString('hex')}`;

      const recRes = await client.query(
        `INSERT INTO receipts (
          id, school_id, payment_id, invoice_id, student_id, receipt_number,
          amount, previous_balance, current_balance, issued_at, issue_date, issued_by, notes, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, CURRENT_TIMESTAMP, $10, $11, $12, CURRENT_TIMESTAMP
        ) RETURNING *`,
        [
          receiptId,
          params.schoolId,
          paymentId,
          params.invoiceId,
          invoice.student_id,
          receiptNumber,
          params.amountKobo,
          currentBalance,
          newBalance,
          paidAt.slice(0, 10),
          params.receivedByUserId,
          params.notes || null,
        ]
      );
      receiptRow = recRes.rows[0];
    }

    if (shouldManageTx) await client.query('COMMIT');

    return {
      success: true,
      data: {
        payment: payRes.rows[0],
        invoice: updatedInvoice,
        receipt: receiptRow,
      },
    };
  } catch (err: any) {
    if (shouldManageTx) await client.query('ROLLBACK').catch(() => {});
    return {
      success: false,
      error: err.message,
      code: err.code === '23505' ? 'DUPLICATE_RECORD' : 'TRANSACTION_FAILED',
    };
  } finally {
    if (!clientOverride) client.release();
  }
}

/**
 * 3. Reverse Confirmed Payment atomically with audit trail in PostgreSQL
 */
export async function reversePaymentPg(
  params: ReversePaymentParams,
  clientOverride?: pg.PoolClient
): Promise<FinancialServiceResult<{ reversal: any; payment: any; invoice: any }>> {
  if (!params.reason || params.reason.trim().length < 3) {
    return {
      success: false,
      error: 'A mandatory reason (minimum 3 characters) is required to reverse a confirmed payment',
      code: 'REASON_REQUIRED',
    };
  }

  if (!clientOverride) {
    const pool = getPgPool();
    if (!pool || !isPgConnected()) {
      return {
        success: false,
        error: 'PostgreSQL database is offline or not configured',
        code: 'DATABASE_OFFLINE',
      };
    }
  }

  const client = clientOverride || (await getPgPool()!.connect());
  const shouldManageTx = true; // Always manage atomic transaction per payment execution

  try {
    if (shouldManageTx) await client.query('BEGIN');

    // 1. Lock payment row (FOR UPDATE)
    const payLockRes = await client.query(
      `SELECT * FROM payments WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [params.paymentId, params.schoolId]
    );

    if (payLockRes.rows.length === 0) {
      if (shouldManageTx) await client.query('ROLLBACK');
      return { success: false, error: 'Payment not found in specified school', code: 'PAYMENT_NOT_FOUND' };
    }

    const payment = payLockRes.rows[0];

    // 2. Eligibility checks
    if (payment.status === 'REVERSED' || payment.is_reversed === 1) {
      if (shouldManageTx) await client.query('ROLLBACK');
      return { success: false, error: 'This payment has already been reversed', code: 'ALREADY_REVERSED' };
    }

    if (payment.status !== 'CONFIRMED' && payment.status !== 'SUCCESS') {
      if (shouldManageTx) await client.query('ROLLBACK');
      return {
        success: false,
        error: `Cannot reverse payment with status "${payment.status}". Only confirmed payments can be reversed`,
        code: 'INVALID_STATUS',
      };
    }

    // 3. Lock associated invoice (FOR UPDATE)
    const invLockRes = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [payment.invoice_id, params.schoolId]
    );

    if (invLockRes.rows.length === 0) {
      if (shouldManageTx) await client.query('ROLLBACK');
      return { success: false, error: 'Associated invoice not found', code: 'INVOICE_NOT_FOUND' };
    }

    const invoice = invLockRes.rows[0];
    const reversalAmount = Number(payment.amount);
    const newPaid = Math.max(0, Number(invoice.amount_paid) - reversalAmount);
    const newBalance = Math.min(Number(invoice.total), Number(invoice.total) - newPaid);
    const newStatus = newPaid === 0 ? 'ISSUED' : 'PARTIALLY_PAID';

    // 4. Update Payment to REVERSED (Preserves original event record)
    const payUpdateRes = await client.query(
      `UPDATE payments SET
        status = 'REVERSED',
        is_reversed = 1,
        reversed_at = CURRENT_TIMESTAMP,
        reversed_by = $1,
        reversal_reason = $2,
        notes = COALESCE(notes, '') || ' | REVERSED: ' || $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 AND school_id = $5
      RETURNING *`,
      [params.reversedByUserEmail, params.reason.trim(), params.reason.trim(), params.paymentId, params.schoolId]
    );

    // 5. Insert into payment_reversals audit table
    const reversalId = `rev_${crypto.randomBytes(8).toString('hex')}`;
    const revAuditRes = await client.query(
      `INSERT INTO payment_reversals (
        id, school_id, payment_id, invoice_id, student_id, amount, amount_kobo,
        reason, requested_by, approved_by, status, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, 'APPROVED', CURRENT_TIMESTAMP
      ) RETURNING *`,
      [
        reversalId,
        params.schoolId,
        params.paymentId,
        invoice.id,
        payment.student_id,
        reversalAmount,
        reversalAmount,
        params.reason.trim(),
        params.reversedByUserEmail,
        params.reversedByUserEmail,
      ]
    );

    // 6. Restore Invoice Balance
    const invUpdateRes = await client.query(
      `UPDATE invoices SET
        amount_paid = $1,
        balance = $2,
        status = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 AND school_id = $5
      RETURNING *`,
      [newPaid, newBalance, newStatus, invoice.id, params.schoolId]
    );

    if (shouldManageTx) await client.query('COMMIT');

    return {
      success: true,
      data: {
        reversal: revAuditRes.rows[0],
        payment: payUpdateRes.rows[0],
        invoice: invUpdateRes.rows[0],
      },
    };
  } catch (err: any) {
    if (shouldManageTx) await client.query('ROLLBACK').catch(() => {});
    return {
      success: false,
      error: err.message,
      code: 'REVERSAL_TRANSACTION_FAILED',
    };
  } finally {
    if (!clientOverride) client.release();
  }
}
