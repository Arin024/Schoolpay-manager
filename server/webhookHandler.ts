import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { db } from './db.ts';
import { toKobo, toNaira, determineInvoiceStatus } from './financeUtils.ts';
import { paymentService, generateInternalPaymentReference, type GatewayProvider } from './paymentService.ts';
import { issueOfficialReceipt } from './paymentRoutes.ts';
import { notificationService } from './notificationService.ts';
import { logAudit } from './audit.ts';

export async function handlePaymentWebhook(req: Request, res: Response) {
  const provider = (req.params.provider || 'BACHS').toUpperCase() as GatewayProvider;
  const rawBody = (req as any).rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  const signature = (
    req.headers['x-bachs-signature'] ||
    req.headers['x-webhook-signature'] ||
    req.headers['x-signature'] ||
    req.headers['x-hub-signature-256'] ||
    req.headers['x-paystack-signature'] ||
    req.headers['verif-hash']
  ) as string | undefined;
  const timestamp = (
    req.headers['x-bachs-timestamp'] ||
    req.headers['x-webhook-timestamp'] ||
    req.headers['x-timestamp']
  ) as string | undefined;

  const eventId = `wh_${crypto.randomBytes(8).toString('hex')}`;
  let payload: any = {};
  if (typeof req.body === 'object' && req.body !== null) {
    payload = req.body;
  } else {
    try {
      payload = JSON.parse(rawBody || '{}');
    } catch {
      payload = {};
    }
  }

  let providerReference = '';
  let internalReference = '';
  let eventType = 'unknown';
  let amountKobo = 0;
  let currency = 'NGN';
  let schoolId = '';
  let invoiceId = '';
  let studentId = '';
  let platformPaymentId = '';

  // Extract metadata and fields depending on provider
  if (provider === 'PAYSTACK') {
    eventType = payload.event || 'charge.success';
    const data = payload.data || {};
    providerReference = data.reference || '';
    amountKobo = Math.round(Number(data.amount) || 0);
    currency = data.currency || 'NGN';
    const meta = data.metadata || {};
    schoolId = meta.school_id || '';
    invoiceId = meta.invoice_id || '';
    studentId = meta.student_id || '';
    internalReference = meta.internal_reference || '';
    platformPaymentId = meta.platform_payment_id || '';
  } else if (provider === 'FLUTTERWAVE') {
    eventType = payload.event || payload['event.type'] || 'charge.completed';
    const data = payload.data || {};
    providerReference = data.tx_ref || data.flw_ref || '';
    amountKobo = toKobo(Number(data.amount) || 0);
    currency = data.currency || 'NGN';
    const meta = data.meta || {};
    schoolId = meta.school_id || '';
    invoiceId = meta.invoice_id || '';
    studentId = meta.student_id || '';
    internalReference = meta.internal_reference || '';
    platformPaymentId = meta.platform_payment_id || '';
  } else if (provider === 'BACHS') {
    eventType = payload.event || 'payment.success';
    const data = payload.data || payload;
    providerReference = data.reference || data.id || payload.reference || '';
    amountKobo = Number(data.amount) || Number(payload.amount_kobo) || toKobo(Number(payload.amount) || 0);
    currency = data.currency || payload.currency || 'NGN';
    const meta = data.metadata || payload.metadata || {};
    schoolId = meta.school_id || '';
    invoiceId = meta.invoice_id || '';
    studentId = meta.student_id || '';
    internalReference = meta.internal_reference || '';
    platformPaymentId = meta.platform_payment_id || '';
  } else {
    // Generic / Sandbox webhook
    eventType = payload.event || 'payment.success';
    providerReference = payload.reference || payload.provider_reference || '';
    amountKobo = Number(payload.amount_kobo) || toKobo(Number(payload.amount) || 0);
    currency = payload.currency || 'NGN';
    const meta = payload.metadata || {};
    schoolId = payload.school_id || meta.school_id || '';
    invoiceId = payload.invoice_id || meta.invoice_id || '';
    studentId = payload.student_id || meta.student_id || '';
    internalReference = payload.internal_reference || meta.internal_reference || '';
    platformPaymentId = payload.platform_payment_id || meta.platform_payment_id || '';
  }

  const idempotencyKey = `${provider}:${providerReference}:${eventType}`;

  // 1. Idempotency Check: prevent duplicate processing
  const existingEvent = db.prepare('SELECT id, status FROM webhook_events WHERE idempotency_key = ?').get(idempotencyKey) as any;
  if (existingEvent && existingEvent.status === 'PROCESSED') {
    return res.status(200).json({ status: 'ignored', message: 'Webhook event has already been processed.' });
  }

  // 2. Check if this is a Platform SaaS Subscription Payment
  let platPaymentRow = null;
  if (platformPaymentId) {
    platPaymentRow = db.prepare('SELECT * FROM platform_payments WHERE id = ?').get(platformPaymentId) as any;
  }
  if (!platPaymentRow && (providerReference || internalReference)) {
    platPaymentRow = db.prepare(`
      SELECT * FROM platform_payments
      WHERE provider_reference = ? OR internal_reference = ?
    `).get(providerReference, internalReference) as any;
  }

  const isPlatformSaaSPayment = Boolean(
    platPaymentRow ||
    platformPaymentId ||
    (internalReference && internalReference.startsWith('PLT-')) ||
    (payload.metadata && (payload.metadata.subscription_id || payload.metadata.plan_id))
  );

  // 3. Log webhook event as PENDING
  db.prepare(`
    INSERT OR REPLACE INTO webhook_events (id, school_id, provider, event_type, idempotency_key, provider_reference, payload, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
  `).run(
    eventId,
    schoolId || platPaymentRow?.school_id || null,
    provider,
    eventType,
    idempotencyKey,
    providerReference,
    rawBody
  );

  // 4. Signature validation
  try {
    const gateway = paymentService.getProvider(provider);
    const hasGlobalSecret = provider === 'BACHS' ? Boolean(process.env.BACHS_WEBHOOK_SECRET) : false;
    if (gateway.isConfigured(schoolId || undefined) || hasGlobalSecret) {
      const isValid = gateway.verifyWebhookSignature(rawBody, signature, schoolId || undefined, timestamp);
      if (!isValid) {
        db.prepare('UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?').run('FAILED', 'Invalid signature', eventId);
        return res.status(401).json({ error: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed.' });
      }
    }
  } catch (err: any) {
    db.prepare('UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?').run('FAILED', err.message, eventId);
    return res.status(400).json({ error: 'PROVIDER_ERROR', message: err.message });
  }

  // ============================================================================
  // BRANCH A: PLATFORM SAAS SUBSCRIPTION PAYMENT (School pays SaaS platform)
  // ============================================================================
  if (isPlatformSaaSPayment) {
    return processPlatformSubscriptionWebhook({
      res,
      eventId,
      provider,
      providerReference,
      internalReference,
      amountKobo,
      currency,
      platPaymentRow,
      schoolId: schoolId || platPaymentRow?.school_id,
      metadata: payload.metadata || {},
      eventType,
      payload,
    });
  }

  // ============================================================================
  // BRANCH B: SCHOOL STUDENT FEE PAYMENT (Parent pays School)
  // ============================================================================
  // Check if payment already recorded with this provider reference
  const existingPayment = db.prepare('SELECT id, status FROM payments WHERE provider_reference = ?').get(providerReference) as any;
  if (existingPayment && existingPayment.status === 'SUCCESS') {
    return res.status(200).json({ status: 'ignored', message: 'Payment record already exists and confirmed.' });
  }

  // Check if fee payment event indicates failure
  const isFailedFeeEvent =
    eventType.includes('failed') ||
    eventType.includes('declined') ||
    eventType.includes('cancelled') ||
    payload?.status === 'failed' ||
    payload?.data?.status === 'failed';

  if (isFailedFeeEvent) {
    db.prepare('UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?').run('FAILED', `Payment ${eventType}`, eventId);
    return res.status(200).json({ status: 'failed', message: `Recorded fee payment failure: ${eventType}` });
  }

  // Verify invoice, student, and school ownership
  if (!invoiceId) {
    db.prepare('UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?').run('IGNORED', 'No invoice_id associated', eventId);
    return res.status(200).json({ status: 'ignored', message: 'No invoice specified in webhook payload.' });
  }

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
  if (!invoice) {
    db.prepare('UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?').run('FAILED', 'Invoice not found', eventId);
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Invoice not found.' });
  }

  // Verify school ownership matches invoice
  if (schoolId && invoice.school_id !== schoolId) {
    db.prepare('UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?').run('FAILED', 'School ID mismatch with invoice', eventId);
    return res.status(403).json({ error: 'FORBIDDEN', message: 'School ownership mismatch.' });
  }

  schoolId = invoice.school_id;
  studentId = invoice.student_id;

  // Currency verification
  if (currency.toUpperCase() !== 'NGN') {
    db.prepare('UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?').run('FAILED', 'Invalid currency', eventId);
    return res.status(400).json({ error: 'INVALID_CURRENCY', message: 'Currency must be NGN.' });
  }

  // Overpayment check
  if (amountKobo <= 0 || amountKobo > invoice.balance) {
    db.prepare('UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?').run('FAILED', 'Amount exceeds invoice balance', eventId);
    return res.status(400).json({ error: 'OVERPAYMENT', message: 'Webhook amount exceeds invoice balance.' });
  }

  // Atomic payment recording & balance update
  const schoolRow = db.prepare('SELECT slug FROM schools WHERE id = ?').get(schoolId) as { slug: string } | undefined;
  const slug = schoolRow?.slug || 'SCH';
  const countRow = db.prepare('SELECT COUNT(*) as c FROM payments WHERE school_id = ?').get(schoolId) as { c: number };
  if (!internalReference) {
    internalReference = generateInternalPaymentReference(slug, countRow.c + 1);
  }
  const paymentId = `pay_${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO payments (
        id, school_id, invoice_id, student_id, payment_reference, internal_reference,
        amount, currency, payment_method, provider, provider_reference, status,
        payment_date, paid_at, verified_at, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'NGN', 'ONLINE', ?, ?, 'SUCCESS', ?, ?, ?, 'Automated webhook verified payment', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      paymentId,
      schoolId,
      invoice.id,
      invoice.student_id,
      internalReference,
      internalReference,
      amountKobo,
      provider,
      providerReference,
      now.slice(0, 10),
      now,
      now
    );

    const newAmountPaid = invoice.amount_paid + amountKobo;
    const newBalance = Math.max(0, invoice.total - newAmountPaid);
    const newStatus = determineInvoiceStatus(invoice.total, newAmountPaid, invoice.due_date, invoice.status);

    db.prepare(`
      UPDATE invoices SET
        amount_paid = ?,
        balance = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(newAmountPaid, newBalance, newStatus, invoice.id, schoolId);

    // Issue Official Receipt
    const receiptData = issueOfficialReceipt({
      schoolId,
      paymentId,
      invoiceId: invoice.id,
      studentId: invoice.student_id,
      amountKobo,
      previousBalanceKobo: invoice.balance,
      currentBalanceKobo: newBalance,
      notes: `Automated Webhook from ${provider}`,
    });

    // Mark webhook event as PROCESSED
    db.prepare('UPDATE webhook_events SET status = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?').run('PROCESSED', eventId);

    // Dispatch notifications
    notificationService.notifySchoolAdmins(
      schoolId,
      'PAYMENT_VERIFIED',
      `Webhook Payment Verified: ₦${toNaira(amountKobo).toLocaleString()}`,
      `Webhook received from ${provider}. Receipt #${receiptData.receiptNumber} generated for Invoice #${invoice.invoice_number}.`,
      { invoiceId: invoice.id, paymentId, receiptId: receiptData.receiptId, amountKobo }
    );

    notificationService.notifyParentsOfStudent(
      schoolId,
      invoice.student_id,
      'RECEIPT_AVAILABLE',
      `Payment Confirmed: ₦${toNaira(amountKobo).toLocaleString()}`,
      `Your payment via ${provider} has been confirmed. Receipt #${receiptData.receiptNumber} is ready.`,
      { invoiceId: invoice.id, paymentId, receiptId: receiptData.receiptId, amountKobo }
    );

    logAudit({
      actorId: null,
      actorEmail: `webhook@${provider.toLowerCase()}.com`,
      schoolId,
      action: 'PROCESS_WEBHOOK_PAYMENT',
      entity: 'PAYMENT',
      entityId: paymentId,
      ipAddress: req.ip,
      metadata: { provider, providerReference, internalReference, amountKobo, receiptNumber: receiptData.receiptNumber },
    });

    return res.status(200).json({
      status: 'success',
      message: 'Webhook processed successfully.',
      paymentId,
      receiptNumber: receiptData.receiptNumber,
    });
  } catch (err: any) {
    db.prepare('UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?').run('FAILED', err.message, eventId);
    return res.status(500).json({ error: 'WEBHOOK_PROCESSING_FAILED', message: err.message });
  }
}

/**
 * Handle Platform SaaS Subscription Payment Webhook
 * Updates school_subscriptions, platform_payments, schools, platform_invoices
 */
async function processPlatformSubscriptionWebhook(params: {
  res: Response;
  eventId: string;
  provider: GatewayProvider;
  providerReference: string;
  internalReference: string;
  amountKobo: number;
  currency: string;
  platPaymentRow: any;
  schoolId: string;
  metadata: any;
  eventType?: string;
  payload?: any;
}) {
  const { res, eventId, provider, providerReference, internalReference, currency, metadata, eventType = 'payment.success', payload = {} } = params;
  let { platPaymentRow, schoolId, amountKobo } = params;

  // Check if platform subscription payment event indicates failure
  const isFailedEvent =
    eventType.includes('failed') ||
    eventType.includes('declined') ||
    eventType.includes('cancelled') ||
    payload?.status === 'failed' ||
    payload?.data?.status === 'failed';

  if (isFailedEvent) {
    if (platPaymentRow) {
      db.prepare(`
        UPDATE platform_payments SET
          status = 'FAILED',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(platPaymentRow.id);
    }
    db.prepare('UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?').run('FAILED', `Payment ${eventType}`, eventId);
    return res.status(200).json({ status: 'failed', message: `Recorded subscription payment failure: ${eventType}` });
  }

  if (!platPaymentRow && schoolId) {
    platPaymentRow = db.prepare(`
      SELECT * FROM platform_payments
      WHERE school_id = ? AND status = 'PENDING'
      ORDER BY created_at DESC LIMIT 1
    `).get(schoolId) as any;
  }

  if (platPaymentRow && platPaymentRow.status === 'SUCCESS') {
    db.prepare('UPDATE webhook_events SET status = ? WHERE id = ?').run('PROCESSED', eventId);
    return res.status(200).json({ status: 'ignored', message: 'Platform subscription payment already confirmed.' });
  }

  // Underpayment verification against existing invoice/payment record
  if (platPaymentRow && platPaymentRow.amount > 0 && amountKobo > 0 && amountKobo < platPaymentRow.amount) {
    db.prepare('UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?').run('FAILED', 'Payment amount is less than expected subscription amount', eventId);
    return res.status(400).json({ error: 'AMOUNT_MISMATCH', message: 'Paid amount is less than required subscription amount.' });
  }

  // Determine authoritative school and plan
  if (!schoolId && platPaymentRow) {
    schoolId = platPaymentRow.school_id;
  }

  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId) as any;
  if (!school) {
    db.prepare('UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?').run('FAILED', 'School tenant not found', eventId);
    return res.status(404).json({ error: 'SCHOOL_NOT_FOUND', message: 'School not found for SaaS subscription payment' });
  }

  const planId = platPaymentRow?.plan_id || metadata?.plan_id || school.current_plan_id || 'plan_standard';
  const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(planId) as any;
  if (!plan) {
    db.prepare('UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?').run('FAILED', 'Plan not found', eventId);
    return res.status(404).json({ error: 'PLAN_NOT_FOUND', message: 'Subscription plan not found' });
  }

  if (amountKobo <= 0 && platPaymentRow) {
    amountKobo = platPaymentRow.amount;
  }

  const nowIso = new Date().toISOString();
  const todayStr = nowIso.slice(0, 10);

  // Calculate new subscription end date based on plan's billing interval
  const interval = (plan.billing_interval || 'ANNUAL').toUpperCase();
  const count = plan.billing_interval_count || 1;
  const endDateObj = new Date();

  if (interval === 'MONTHLY') {
    endDateObj.setMonth(endDateObj.getMonth() + (1 * count));
  } else if (interval === 'QUARTERLY') {
    endDateObj.setMonth(endDateObj.getMonth() + (3 * count));
  } else if (interval === 'SEMI_ANNUAL') {
    endDateObj.setMonth(endDateObj.getMonth() + (6 * count));
  } else if (interval === 'ANNUAL') {
    endDateObj.setFullYear(endDateObj.getFullYear() + (1 * count));
  } else if (interval === 'ONE_TIME') {
    endDateObj.setFullYear(endDateObj.getFullYear() + 10); // 10 years for one-time perpetual
  } else {
    // Default / TERM
    endDateObj.setMonth(endDateObj.getMonth() + (4 * count));
  }
  const newEndDateStr = endDateObj.toISOString().slice(0, 10);

  try {
    // 1. Update or Insert Platform Payment Record
    let paymentId = platPaymentRow?.id;
    if (paymentId) {
      db.prepare(`
        UPDATE platform_payments SET
          status = 'SUCCESS',
          provider_reference = COALESCE(?, provider_reference),
          paid_at = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(providerReference, nowIso, paymentId);
    } else {
      paymentId = `ppay_${crypto.randomBytes(6).toString('hex')}`;
      const intRef = internalReference || `PLT-${school.slug.slice(0, 4).toUpperCase()}-${Date.now().toString().slice(-6)}`;
      db.prepare(`
        INSERT INTO platform_payments (
          id, school_id, plan_id, amount, currency, payment_method, provider,
          provider_reference, internal_reference, status, paid_at, notes
        ) VALUES (?, ?, ?, ?, 'NGN', 'ONLINE', ?, ?, ?, 'SUCCESS', ?, ?)
      `).run(
        paymentId, schoolId, plan.id, amountKobo, provider, providerReference, intRef,
        nowIso, `Automated SaaS payment via ${provider}`
      );
    }

    // 2. Update or Create School Subscription
    const activeSub = db.prepare(`
      SELECT * FROM school_subscriptions WHERE school_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(schoolId) as any;

    let subId = activeSub?.id;
    if (activeSub && activeSub.plan_id === plan.id) {
      db.prepare(`
        UPDATE school_subscriptions SET
          status = 'ACTIVE',
          amount_paid = ?,
          final_amount = ?,
          start_date = ?,
          end_date = ?,
          expiry_date = ?,
          renewal_date = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(amountKobo, amountKobo, todayStr, newEndDateStr, newEndDateStr, newEndDateStr, activeSub.id);
    } else {
      subId = `sub_${crypto.randomBytes(6).toString('hex')}`;
      // Deactivate older subscriptions
      db.prepare("UPDATE school_subscriptions SET status = 'EXPIRED' WHERE school_id = ? AND status = 'ACTIVE'").run(schoolId);
      db.prepare(`
        INSERT INTO school_subscriptions (
          id, school_id, plan_id, status, start_date, end_date, amount_paid,
          standard_plan_price, final_amount, currency, expiry_date, renewal_date, provider, notes
        ) VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, 'NGN', ?, ?, ?, ?)
      `).run(
        subId, schoolId, plan.id, todayStr, newEndDateStr, amountKobo,
        plan.price, amountKobo, newEndDateStr, newEndDateStr, provider,
        `Activated via ${provider} online checkout`
      );
    }

    // 3. Update School Status to ACTIVE
    db.prepare(`
      UPDATE schools SET
        status = 'ACTIVE',
        current_plan_id = ?,
        subscription_end_date = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(plan.id, newEndDateStr, schoolId);

    // 4. Update or Generate Platform Invoice
    const existingInvoice = db.prepare(`
      SELECT * FROM platform_invoices WHERE school_id = ? AND payment_status = 'PENDING' ORDER BY created_at DESC LIMIT 1
    `).get(schoolId) as any;

    if (existingInvoice) {
      db.prepare(`
        UPDATE platform_invoices SET
          payment_status = 'PAID',
          paid_at = ?,
          payment_method = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nowIso, provider, existingInvoice.id);
    } else {
      const invNumber = `INV-PLT-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
      db.prepare(`
        INSERT INTO platform_invoices (
          id, invoice_number, school_id, subscription_id, plan_id, billing_period,
          standard_price, discount, final_amount, currency, payment_status,
          issue_date, due_date, paid_at, payment_method, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'NGN', 'PAID', ?, ?, ?, ?, 'Automated platform subscription receipt')
      `).run(
        `pinv_${crypto.randomBytes(6).toString('hex')}`,
        invNumber,
        schoolId,
        subId,
        plan.id,
        `${todayStr} to ${newEndDateStr}`,
        plan.price,
        amountKobo,
        todayStr,
        todayStr,
        nowIso,
        provider
      );
    }

    // 5. Mark webhook event as PROCESSED
    db.prepare('UPDATE webhook_events SET status = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?').run('PROCESSED', eventId);

    // 6. Log Audit Event
    logAudit({
      actorId: null,
      actorEmail: `billing@${provider.toLowerCase()}.com`,
      schoolId,
      action: 'SAAS_SUBSCRIPTION_ACTIVATED_WEBHOOK',
      entity: 'PLATFORM_PAYMENT',
      entityId: paymentId,
      metadata: {
        provider,
        providerReference,
        amountKobo,
        planId: plan.id,
        newEndDate: newEndDateStr,
      },
    });

    // 7. Dispatch notification
    notificationService.notifySchoolAdmins(
      schoolId,
      'SYSTEM',
      `SaaS Subscription Activated: ${plan.display_name}`,
      `Your subscription to ${plan.display_name} has been confirmed. Expiry date extended to ${newEndDateStr}.`,
      { planId: plan.id, expiryDate: newEndDateStr, paymentId, event: 'SUBSCRIPTION_RENEWED' }
    );

    return res.status(200).json({
      status: 'success',
      message: `SaaS subscription activated successfully for ${school.name}.`,
      paymentId,
      planId: plan.id,
      expiryDate: newEndDateStr,
    });
  } catch (err: any) {
    db.prepare('UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?').run('FAILED', err.message, eventId);
    return res.status(500).json({ error: 'SUBSCRIPTION_WEBHOOK_FAILED', message: err.message });
  }
}

/**
 * Bachs Demo Checkout UI & Simulator
 * Handles GET /api/v1/webhooks/bachs-demo-checkout
 */
export function handleBachsDemoCheckout(req: Request, res: Response) {
  const { ref, internal, amount, school: schoolId } = req.query;

  const school = schoolId ? db.prepare('SELECT name, email, slug FROM schools WHERE id = ?').get(String(schoolId)) as any : null;
  const amountKobo = Number(amount) || 0;
  const amountNaira = toNaira(amountKobo);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bachs.io Secure Hosted Checkout</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen flex items-center justify-center p-4">
  <div class="max-w-md w-full bg-slate-800 border border-slate-700 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
    <div class="flex items-center justify-between pb-4 border-b border-slate-700">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-xl bg-emerald-500 flex items-center justify-center text-slate-950 font-black">
          B
        </div>
        <span class="font-bold text-lg text-white tracking-tight">bachs<span class="text-emerald-400">.io</span></span>
      </div>
      <span class="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
        Demo Sandbox
      </span>
    </div>

    <div>
      <p class="text-xs text-slate-400">Subscribing Organization</p>
      <h2 class="text-xl font-black text-white">${school ? school.name : 'Nigerian School Tenant'}</h2>
      <p class="text-xs text-slate-400 mt-1 font-mono">${internal || ref || 'PLT-SUBSCRIPTION'}</p>
    </div>

    <div class="p-4 rounded-2xl bg-slate-950/70 border border-slate-700/80 flex items-center justify-between">
      <div>
        <p class="text-[11px] font-semibold text-slate-400">Total Payable Amount</p>
        <p class="text-xs text-slate-500">Includes secure checkout fees</p>
      </div>
      <div class="text-right">
        <span class="text-2xl font-black text-emerald-400">₦${amountNaira.toLocaleString()}</span>
        <span class="block text-[10px] text-slate-500 font-mono">NGN</span>
      </div>
    </div>

    <div class="space-y-3">
      <p class="text-xs font-bold text-slate-300">Select Test Payment Channel:</p>
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div class="p-3 rounded-xl bg-slate-700/50 border border-emerald-500/50 text-emerald-300 font-semibold flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          Card / Debit
        </div>
        <div class="p-3 rounded-xl bg-slate-700/30 border border-slate-600/50 text-slate-300 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-slate-500"></span>
          Bank Transfer
        </div>
        <div class="p-3 rounded-xl bg-slate-700/30 border border-slate-600/50 text-slate-300 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-slate-500"></span>
          USSD
        </div>
        <div class="p-3 rounded-xl bg-slate-700/30 border border-slate-600/50 text-slate-300 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-slate-500"></span>
          USDC / Crypto
        </div>
      </div>
    </div>

    <form method="POST" action="/api/v1/webhooks/bachs-demo-checkout/complete" class="space-y-3 pt-2">
      <input type="hidden" name="ref" value="${ref || ''}" />
      <input type="hidden" name="internal" value="${internal || ''}" />
      <input type="hidden" name="amount" value="${amountKobo}" />
      <input type="hidden" name="school" value="${schoolId || ''}" />

      <button type="submit" class="w-full py-3.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm transition shadow-lg shadow-emerald-500/20 cursor-pointer">
        Simulate Successful Payment (Instant Webhook)
      </button>

      <a href="/?status=cancelled&ref=${ref || ''}" class="block text-center text-xs text-slate-400 hover:text-white py-2">
        Cancel and return to BursarIQ
      </a>
    </form>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  return res.send(html);
}

/**
 * Handle completion of Bachs Demo Checkout
 * Dispatches simulated webhook to activate subscription
 */
export async function handleBachsDemoCheckoutComplete(req: Request, res: Response) {
  const { ref, internal, amount, school } = req.body;
  const amountKobo = Number(amount) || 0;

  // Find or update platform payment
  let platPayment = db.prepare(`
    SELECT * FROM platform_payments
    WHERE provider_reference = ? OR internal_reference = ?
  `).get(ref, internal) as any;

  if (!platPayment && school) {
    platPayment = db.prepare(`
      SELECT * FROM platform_payments
      WHERE school_id = ? AND status = 'PENDING'
      ORDER BY created_at DESC LIMIT 1
    `).get(school) as any;
  }

  const schoolId = school || platPayment?.school_id;
  const targetSchool = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId) as any;

  if (targetSchool) {
    const planId = platPayment?.plan_id || targetSchool.current_plan_id || 'plan_standard';
    const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(planId) as any;

    const endDateObj = new Date();
    endDateObj.setFullYear(endDateObj.getFullYear() + 1);
    const newEndDateStr = endDateObj.toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    if (platPayment) {
      db.prepare(`
        UPDATE platform_payments SET
          status = 'SUCCESS',
          paid_at = ?,
          provider_reference = COALESCE(?, provider_reference),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nowIso, ref || 'bch_simulated_success', platPayment.id);
    }

    db.prepare(`
      UPDATE school_subscriptions SET
        status = 'ACTIVE',
        end_date = ?,
        expiry_date = ?,
        renewal_date = ?,
        amount_paid = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE school_id = ? AND (status = 'ACTIVE' OR status = 'TRIAL' OR status = 'EXPIRED')
    `).run(newEndDateStr, newEndDateStr, newEndDateStr, amountKobo || plan?.price || 0, schoolId);

    db.prepare(`
      UPDATE schools SET
        status = 'ACTIVE',
        subscription_end_date = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newEndDateStr, schoolId);

    logAudit({
      actorId: null,
      actorEmail: 'bachs_demo_checkout@system.local',
      schoolId,
      action: 'SAAS_SUBSCRIPTION_ACTIVATED_WEBHOOK',
      entity: 'PLATFORM_PAYMENT',
      entityId: platPayment?.id || ref,
      metadata: { simulated: true, provider: 'BACHS', newEndDate: newEndDateStr },
    });
  }

  return res.redirect(`/?status=success&ref=${ref || internal || 'demo'}`);
}

/**
 * Dedicated Bachs.io Webhook Handler for POST /api/webhooks/bachs
 */
export async function handleBachsWebhook(req: Request, res: Response) {
  req.params = req.params || {};
  req.params.provider = 'BACHS';
  return handlePaymentWebhook(req, res);
}
