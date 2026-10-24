import express from 'express';
import crypto from 'node:crypto';
import { db } from './db.ts';
import { requireAuth, requireTenant, type AuthenticatedRequest } from './tenantMiddleware.ts';
import { paymentService, generateInternalPaymentReference } from './paymentService.ts';
import { toKobo, toNaira } from './financeUtils.ts';
import { logAudit } from './audit.ts';

export const schoolBillingRouter = express.Router();

// ==============================================================================
// 1. GET CURRENT SCHOOL SUBSCRIPTION & BILLING STATUS
// ==============================================================================
schoolBillingRouter.get('/subscription', requireAuth, requireTenant, (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;

  // 1. Fetch school's current active or recent subscription
  const sub = db.prepare(`
    SELECT sub.*,
           p.name as plan_name,
           p.display_name as plan_display_name,
           p.description as plan_description,
           p.student_limit as plan_student_limit,
           p.staff_limit as plan_staff_limit,
           p.storage_limit_mb as plan_storage_limit,
           p.feature_flags as plan_feature_flags
    FROM school_subscriptions sub
    JOIN subscription_plans p ON sub.plan_id = p.id
    WHERE sub.school_id = ?
    ORDER BY CASE WHEN sub.status = 'ACTIVE' THEN 0 ELSE 1 END, sub.rowid DESC
    LIMIT 1
  `).get(schoolId) as any;

  // 2. Fetch current tenant usage
  const studentCount = (db.prepare('SELECT COUNT(*) as c FROM students WHERE school_id = ?').get(schoolId) as any).c;
  const staffCount = (db.prepare('SELECT COUNT(*) as c FROM staff WHERE school_id = ?').get(schoolId) as any).c;

  // 3. Platform settings for payment instructions and grace period
  const platformSettings = db.prepare('SELECT * FROM platform_settings WHERE id = ?').get('platform_global_settings') as any;

  // 4. Available active plans that school can view
  const availablePlans = db.prepare(`
    SELECT * FROM subscription_plans WHERE active = 1 ORDER BY price ASC
  `).all() as any[];

  return res.json({
    success: true,
    subscription: sub ? {
      ...sub,
      standard_plan_price_naira: toNaira(sub.standard_plan_price || sub.amount_paid || 0),
      negotiated_price_naira: sub.negotiated_price !== null && sub.negotiated_price !== undefined ? toNaira(sub.negotiated_price) : null,
      discount_amount_naira: toNaira(sub.discount_amount || 0),
      final_amount_naira: toNaira(sub.final_amount || sub.amount_paid || 0),
      amount_paid_naira: toNaira(sub.amount_paid || 0),
      feature_flags: typeof sub.plan_feature_flags === 'string' ? JSON.parse(sub.plan_feature_flags || '{}') : sub.plan_feature_flags,
    } : null,
    usage: {
      students: studentCount,
      staff: staffCount,
    },
    platformSettings: {
      default_currency: platformSettings?.default_currency || 'NGN',
      default_grace_period_days: platformSettings?.default_grace_period_days || 7,
      bachs_enabled: Boolean(platformSettings?.bachs_enabled ?? 1),
      bank_transfer_enabled: Boolean(platformSettings?.bank_transfer_enabled ?? 1),
      invoice_payments_enabled: Boolean(platformSettings?.invoice_payments_enabled ?? 1),
      platform_bank_name: platformSettings?.platform_bank_name || 'Zenith Bank',
      platform_account_name: platformSettings?.platform_account_name || 'Nwajiaku Arinze Christian',
      platform_account_number: platformSettings?.platform_account_number || '2208744650',
      opay_account_name: platformSettings?.opay_account_name || 'Nwajiaku Arinzechukwu Christian',
      opay_account_number: platformSettings?.opay_account_number || '8160754659',

      platform_contact_email: platformSettings?.platform_contact_email || 'support@bursariq.com.ng',
      platform_contact_phone: platformSettings?.platform_contact_phone || '08160754659',
    },
    availablePlans: availablePlans.map((p) => ({
      ...p,
      price_naira: toNaira(p.price),
      feature_flags: typeof p.feature_flags === 'string' ? JSON.parse(p.feature_flags || '{}') : p.feature_flags,
    })),
  });
});

// ==============================================================================
// 2. GET SCHOOL'S SAAS PAYMENT HISTORY & INVOICES
// ==============================================================================
schoolBillingRouter.get('/history', requireAuth, requireTenant, (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;

  // 1. SaaS Platform Payments paid by this school
  const payments = db.prepare(`
    SELECT pp.*, p.display_name as plan_display_name
    FROM platform_payments pp
    LEFT JOIN subscription_plans p ON pp.plan_id = p.id
    WHERE pp.school_id = ?
    ORDER BY pp.created_at DESC
  `).all(schoolId) as any[];

  // 2. SaaS Invoices issued to this school
  const invoices = db.prepare(`
    SELECT pi.*, p.display_name as plan_display_name
    FROM platform_invoices pi
    LEFT JOIN subscription_plans p ON pi.plan_id = p.id
    WHERE pi.school_id = ?
    ORDER BY pi.issue_date DESC
  `).all(schoolId) as any[];

  return res.json({
    success: true,
    payments: payments.map((p) => ({
      ...p,
      amount_naira: toNaira(p.amount),
    })),
    invoices: invoices.map((inv) => ({
      ...inv,
      standard_price_naira: toNaira(inv.standard_price),
      discount_naira: toNaira(inv.discount),
      final_amount_naira: toNaira(inv.final_amount),
    })),
  });
});

// ==============================================================================
// 3. INITIATE SAAS CHECKOUT SESSION (BACHS.IO / ONLINE GATEWAY)
// ==============================================================================
// CRITICAL SECURITY (Section 6 & 19): The frontend NEVER dictates the charge amount.
// The backend strictly retrieves the authenticated school's subscription and final_amount.
schoolBillingRouter.post('/checkout', requireAuth, requireTenant, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const { plan_id, callback_url } = req.body;

  // Retrieve school
  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId) as any;
  if (!school) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'School tenant not found' });
  }

  // Retrieve school's active subscription
  let sub = db.prepare(`
    SELECT * FROM school_subscriptions
    WHERE school_id = ?
    ORDER BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END, rowid DESC
    LIMIT 1
  `).get(schoolId) as any;

  // If upgrading or changing plan, or no subscription exists, determine authoritative plan
  const targetPlanId = plan_id || sub?.plan_id || school.current_plan_id || 'plan_standard';
  const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(targetPlanId) as any;

  if (!plan) {
    return res.status(404).json({ error: 'PLAN_NOT_FOUND', message: 'Selected subscription plan not found' });
  }

  // Authoritative amount calculation (Server-side ONLY!)
  let standardPriceKobo = plan.price;
  let finalAmountKobo = standardPriceKobo;
  let discountKobo = 0;

  // If school has negotiated price or final_amount for this plan on an active subscription, honor it as authoritative!
  if (sub && sub.plan_id === targetPlanId && sub.final_amount > 0) {
    finalAmountKobo = sub.final_amount;
  } else if (sub && sub.plan_id === targetPlanId && sub.negotiated_price !== null && sub.negotiated_price !== undefined) {
    finalAmountKobo = sub.negotiated_price;
  } else {
    // Only check for any active promotional discount if no school-specific negotiated subscription exists
    const discountRow = db.prepare(`
      SELECT * FROM subscription_discounts
      WHERE active = 1 AND (school_id = ? OR school_id IS NULL) AND (plan_id = ? OR plan_id IS NULL)
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
      ORDER BY discount_type ASC LIMIT 1
    `).get(schoolId, targetPlanId) as any;

    if (discountRow) {
      if (discountRow.discount_type === 'PERCENTAGE') {
        discountKobo = Math.round((standardPriceKobo * discountRow.discount_value) / 100);
      } else {
        discountKobo = discountRow.discount_value;
      }
      finalAmountKobo = Math.max(0, standardPriceKobo - discountKobo);
    }
  }

  // Internal reference for auditable SaaS subscription payment
  const internalRef = `PLT-${school.slug.slice(0, 4).toUpperCase()}-${Date.now().toString().slice(-6)}`;
  const paymentId = `ppay_${crypto.randomBytes(6).toString('hex')}`;

  // Record initial PENDING platform payment record
  db.prepare(`
    INSERT INTO platform_payments (
      id, school_id, subscription_id, plan_id, amount, currency, payment_method, provider,
      internal_reference, status, notes
    ) VALUES (?, ?, ?, ?, ?, 'NGN', 'ONLINE', 'BACHS', ?, 'PENDING', ?)
  `).run(
    paymentId,
    schoolId,
    sub?.id || null,
    plan.id,
    finalAmountKobo,
    internalRef,
    `Bachs checkout initiated for ${plan.display_name}`
  );

  try {
    const bachsProvider = paymentService.getProvider('BACHS');
    const initResult = await bachsProvider.initializePayment({
      schoolId,
      studentId: req.user!.id,
      invoiceId: sub?.id || 'sub_init',
      amountKobo: finalAmountKobo,
      currency: 'NGN',
      email: req.user!.email || school.email,
      studentName: school.name,
      callbackUrl: callback_url || `${process.env.APP_URL || 'http://localhost:3000'}/?status=success&ref=${internalRef}`,
      metadata: {
        school_id: schoolId,
        subscription_id: sub?.id || null,
        plan_id: plan.id,
        platform_payment_id: paymentId,
        internal_reference: internalRef,
      },
    });

    // Update platform payment with provider reference
    db.prepare('UPDATE platform_payments SET provider_reference = ? WHERE id = ?').run(
      initResult.providerReference,
      paymentId
    );

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'SAAS_CHECKOUT_SESSION_INITIATED',
      entity: 'PLATFORM_PAYMENT',
      entityId: paymentId,
      ipAddress: req.ip || '127.0.0.1',
      metadata: { plan_id: plan.id, amountKobo: finalAmountKobo, internalRef, provider: 'BACHS' },
    });

    return res.json({
      success: true,
      checkoutUrl: initResult.checkoutUrl,
      providerReference: initResult.providerReference,
      internalReference: internalRef,
      finalAmountNaira: toNaira(finalAmountKobo),
      finalAmountKobo,
    });
  } catch (err: any) {
    db.prepare('UPDATE platform_payments SET status = ? WHERE id = ?').run('FAILED', paymentId);
    return res.status(500).json({ error: 'CHECKOUT_FAILED', message: err.message || 'Failed to initiate checkout with Bachs' });
  }
});

// ==============================================================================
// 4. SUBMIT MANUAL BANK TRANSFER PROOF FOR SAAS SUBSCRIPTION
// ==============================================================================
schoolBillingRouter.post('/bank-transfer/submit', requireAuth, requireTenant, (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const { plan_id, bank_name, transaction_reference, depositor_name, amount_naira, notes, receipt_file, receipt_filename } = req.body;

  // We require either receipt_file (image/pdf proof) OR transaction_reference, plus depositor name
  if (!depositor_name) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Depositor name is required' });
  }
  if (!receipt_file && !transaction_reference) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Please upload a bank transfer receipt (Image or PDF) or enter a transaction reference' });
  }

  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId) as any;
  const sub = db.prepare('SELECT * FROM school_subscriptions WHERE school_id = ? ORDER BY created_at DESC LIMIT 1').get(schoolId) as any;

  const targetPlanId = plan_id || sub?.plan_id || school.current_plan_id || 'plan_standard';
  const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(targetPlanId) as any;
  if (!plan) {
    return res.status(404).json({ error: 'PLAN_NOT_FOUND', message: 'Subscription plan not found' });
  }

  // Authoritative amount
  const authoritativeAmountKobo = sub?.final_amount > 0 ? sub.final_amount : plan.price;
  const submittedAmountKobo = amount_naira ? toKobo(Number(amount_naira)) : authoritativeAmountKobo;

  const internalRef = `PLT-TRF-${school.slug.slice(0, 4).toUpperCase()}-${Date.now().toString().slice(-6)}`;
  const paymentId = `ppay_${crypto.randomBytes(6).toString('hex')}`;

  db.prepare(`
    INSERT INTO platform_payments (
      id, school_id, subscription_id, plan_id, amount, currency, payment_method, provider,
      provider_reference, internal_reference, status, notes, metadata
    ) VALUES (?, ?, ?, ?, ?, 'NGN', 'BANK_TRANSFER', 'MANUAL', ?, ?, 'PENDING', ?, ?)
  `).run(
    paymentId,
    schoolId,
    sub?.id || null,
    plan.id,
    submittedAmountKobo,
    transaction_reference,
    internalRef,
    `Manual Bank Transfer submitted by ${depositor_name}. Notes: ${notes || 'None'}${receipt_filename ? ` [Receipt: ${receipt_filename}]` : ''}`,
    JSON.stringify({ 
      bank_name, 
      depositor_name, 
      notes, 
      receipt_file: receipt_file || null, 
      receipt_filename: receipt_filename || null 
    })
  );

  logAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    schoolId,
    action: 'MANUAL_SAAS_PAYMENT_SUBMITTED',
    entity: 'PLATFORM_PAYMENT',
    entityId: paymentId,
    ipAddress: req.ip || '127.0.0.1',
    metadata: { depositor_name, transaction_reference, amountKobo: submittedAmountKobo, plan_id: plan.id },
  });

  return res.status(201).json({
    success: true,
    message: 'Bank transfer payment proof submitted. Platform administrator will review and approve within 24 hours.',
    internalReference: internalRef,
    paymentId,
  });
});

// ==============================================================================
// 5. DOWNLOAD / VIEW PRINTABLE SAAS INVOICE
// ==============================================================================
schoolBillingRouter.get('/invoices/:invoiceId', requireAuth, requireTenant, (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const { invoiceId } = req.params;

  const invoice = db.prepare(`
    SELECT pi.*,
           s.name as school_name,
           s.address as school_address,
           s.email as school_email,
           s.phone as school_phone,
           p.name as plan_name,
           p.display_name as plan_display_name
    FROM platform_invoices pi
    JOIN schools s ON pi.school_id = s.id
    JOIN subscription_plans p ON pi.plan_id = p.id
    WHERE pi.id = ? AND pi.school_id = ?
  `).get(invoiceId, schoolId) as any;

  if (!invoice) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Platform invoice not found for this school' });
  }

  const platformSettings = db.prepare('SELECT * FROM platform_settings WHERE id = ?').get('platform_global_settings') as any;

  return res.json({
    success: true,
    invoice: {
      ...invoice,
      standard_price_naira: toNaira(invoice.standard_price),
      discount_naira: toNaira(invoice.discount),
      final_amount_naira: toNaira(invoice.final_amount),
    },
    platformSettings,
  });
});
