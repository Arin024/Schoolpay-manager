import crypto from 'node:crypto';
import { db } from './db.ts';
import { toKobo, toNaira } from './financeUtils.ts';

export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'POS' | 'ONLINE' | 'OTHER' | 'CHEQUE';
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
export type GatewayProvider = 'MANUAL' | 'PAYSTACK' | 'FLUTTERWAVE' | 'MONIEPOINT' | 'BACHS' | 'TEST_SANDBOX';

export interface InitializePaymentParams {
  schoolId: string;
  studentId: string;
  invoiceId: string;
  amountKobo: number;
  currency?: string;
  email: string;
  studentName?: string;
  invoiceNumber?: string;
  callbackUrl?: string;
  metadata?: Record<string, any>;
}

export interface PaymentInitResult {
  success: boolean;
  provider: GatewayProvider;
  providerReference: string;
  internalReference: string;
  checkoutUrl?: string;
  authorizationUrl?: string;
  accessCode?: string;
  isSandbox?: boolean;
  message?: string;
}

export interface PaymentVerificationResult {
  success: boolean;
  status: PaymentStatus;
  amountKobo: number;
  currency: string;
  providerReference: string;
  internalReference: string;
  paidAt?: string;
  rawResponse?: any;
  message?: string;
}

export interface PaymentGatewayProvider {
  name: GatewayProvider;
  displayName: string;
  isConfigured(schoolId?: string): boolean;
  initializePayment(params: InitializePaymentParams): Promise<PaymentInitResult>;
  verifyPayment(providerReference: string, schoolId?: string): Promise<PaymentVerificationResult>;
  verifyWebhookSignature(rawBody: string, signature: string | undefined, schoolId?: string, timestamp?: string): boolean;
}

/**
 * Generate a unique, auditable internal payment reference
 * Format: PAY-{SCHOOL_SLUG}-{YEAR}-{SEQUENCE}
 */
export function generateInternalPaymentReference(schoolSlug: string, sequenceNumber?: number): string {
  const cleanSlug = schoolSlug.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'SCH';
  const year = new Date().getFullYear();
  const seq = String(sequenceNumber !== undefined ? sequenceNumber : Math.floor(1000 + Math.random() * 9000)).padStart(4, '0');
  const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `PAY-${cleanSlug}-${year}-${seq}-${randomSuffix}`;
}

/**
 * Generate a unique receipt number
 * Format: RCP-{SCHOOL_SLUG}-{YEAR}-{SEQUENCE}
 */
export function generateReceiptNumber(schoolSlug: string, sequenceNumber: number): string {
  const cleanSlug = schoolSlug.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'SCH';
  const year = new Date().getFullYear();
  const seq = String(sequenceNumber).padStart(4, '0');
  return `RCP-${cleanSlug}-${year}-${seq}`;
}

// -----------------------------------------------------------------------------
// 1. Paystack Gateway Provider
// -----------------------------------------------------------------------------
export class PaystackProvider implements PaymentGatewayProvider {
  name: GatewayProvider = 'PAYSTACK';
  displayName = 'Paystack (Cards, Bank Transfer, USSD, Apple Pay)';

  private getSecretKey(schoolId?: string): string | null {
    if (schoolId) {
      const setting = db.prepare('SELECT paystack_secret_key FROM school_settings WHERE school_id = ?').get(schoolId) as any;
      if (setting?.paystack_secret_key) return setting.paystack_secret_key;
    }
    return process.env.PAYSTACK_SECRET_KEY || null;
  }

  isConfigured(schoolId?: string): boolean {
    const key = this.getSecretKey(schoolId);
    return Boolean(key && key.startsWith('sk_'));
  }

  async initializePayment(params: InitializePaymentParams): Promise<PaymentInitResult> {
    const secretKey = this.getSecretKey(params.schoolId);
    const providerRef = `pstk_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const countRow = db.prepare('SELECT COUNT(*) as c FROM payments WHERE school_id = ?').get(params.schoolId) as { c: number };
    const internalRef = generateInternalPaymentReference('PAY', countRow.c + 1);

    if (!secretKey || !secretKey.startsWith('sk_')) {
      // Return unconfigured warning / sandbox option
      return {
        success: false,
        provider: this.name,
        providerReference: providerRef,
        internalReference: internalRef,
        message: 'Paystack is not configured with live credentials. Configure PAYSTACK_SECRET_KEY in School Settings or environment, or use Sandbox simulation.',
      };
    }

    try {
      // Paystack expects amount in minor units (kobo)
      const payload = {
        email: params.email,
        amount: params.amountKobo,
        reference: providerRef,
        callback_url: params.callbackUrl,
        metadata: {
          ...params.metadata,
          school_id: params.schoolId,
          student_id: params.studentId,
          invoice_id: params.invoiceId,
          internal_reference: internalRef,
        },
      };

      const response = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json() as any;
      if (!response.ok || !data.status) {
        return {
          success: false,
          provider: this.name,
          providerReference: providerRef,
          internalReference: internalRef,
          message: data.message || 'Failed to initialize Paystack payment',
        };
      }

      return {
        success: true,
        provider: this.name,
        providerReference: data.data.reference,
        internalReference: internalRef,
        authorizationUrl: data.data.authorization_url,
        checkoutUrl: data.data.authorization_url,
        accessCode: data.data.access_code,
      };
    } catch (err: any) {
      return {
        success: false,
        provider: this.name,
        providerReference: providerRef,
        internalReference: internalRef,
        message: err.message || 'Network error communicating with Paystack',
      };
    }
  }

  async verifyPayment(providerReference: string, schoolId?: string): Promise<PaymentVerificationResult> {
    const secretKey = this.getSecretKey(schoolId);
    if (!secretKey) {
      return {
        success: false,
        status: 'FAILED',
        amountKobo: 0,
        currency: 'NGN',
        providerReference,
        internalReference: '',
        message: 'Paystack secret key is missing.',
      };
    }

    try {
      const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(providerReference)}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      const data = await response.json() as any;

      if (!response.ok || !data.status) {
        return {
          success: false,
          status: 'FAILED',
          amountKobo: 0,
          currency: 'NGN',
          providerReference,
          internalReference: '',
          message: data.message || 'Paystack verification failed',
        };
      }

      const tx = data.data;
      const status: PaymentStatus = tx.status === 'success' ? 'SUCCESS' : 'FAILED';
      const internalRef = tx.metadata?.internal_reference || '';

      return {
        success: tx.status === 'success',
        status,
        amountKobo: Math.round(tx.amount), // Paystack returns amount in kobo
        currency: tx.currency || 'NGN',
        providerReference,
        internalReference: internalRef,
        paidAt: tx.paid_at || new Date().toISOString(),
        rawResponse: tx,
      };
    } catch (err: any) {
      return {
        success: false,
        status: 'FAILED',
        amountKobo: 0,
        currency: 'NGN',
        providerReference,
        internalReference: '',
        message: err.message || 'Network error during Paystack verification',
      };
    }
  }

  verifyWebhookSignature(rawBody: string, signature: string | undefined, schoolId?: string): boolean {
    const secretKey = this.getSecretKey(schoolId);
    if (!secretKey || !signature) return false;
    const hash = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
    return hash === signature;
  }
}

// -----------------------------------------------------------------------------
// 2. Flutterwave Gateway Provider
// -----------------------------------------------------------------------------
export class FlutterwaveProvider implements PaymentGatewayProvider {
  name: GatewayProvider = 'FLUTTERWAVE';
  displayName = 'Flutterwave (Cards, Bank Account, USSD, Barter)';

  private getSecretKey(schoolId?: string): string | null {
    if (schoolId) {
      const setting = db.prepare('SELECT flutterwave_secret_key FROM school_settings WHERE school_id = ?').get(schoolId) as any;
      if (setting?.flutterwave_secret_key) return setting.flutterwave_secret_key;
    }
    return process.env.FLUTTERWAVE_SECRET_KEY || null;
  }

  private getWebhookSecret(schoolId?: string): string | null {
    if (schoolId) {
      const setting = db.prepare('SELECT webhook_secret FROM school_settings WHERE school_id = ?').get(schoolId) as any;
      if (setting?.webhook_secret) return setting.webhook_secret;
    }
    return process.env.FLUTTERWAVE_SECRET_HASH || process.env.WEBHOOK_SECRET || null;
  }

  isConfigured(schoolId?: string): boolean {
    const key = this.getSecretKey(schoolId);
    return Boolean(key && key.startsWith('FLWSECK_'));
  }

  async initializePayment(params: InitializePaymentParams): Promise<PaymentInitResult> {
    const secretKey = this.getSecretKey(params.schoolId);
    const providerRef = `flw_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const countRow = db.prepare('SELECT COUNT(*) as c FROM payments WHERE school_id = ?').get(params.schoolId) as { c: number };
    const internalRef = generateInternalPaymentReference('PAY', countRow.c + 1);

    if (!secretKey || !secretKey.startsWith('FLWSECK_')) {
      return {
        success: false,
        provider: this.name,
        providerReference: providerRef,
        internalReference: internalRef,
        message: 'Flutterwave is not configured with live credentials. Configure FLUTTERWAVE_SECRET_KEY in School Settings or environment.',
      };
    }

    try {
      // Flutterwave expects amount in major units (Naira)
      const amountNaira = toNaira(params.amountKobo);
      const payload = {
        tx_ref: providerRef,
        amount: amountNaira,
        currency: 'NGN',
        redirect_url: params.callbackUrl,
        customer: {
          email: params.email,
          name: params.studentName || 'Student Guardian',
        },
        meta: {
          ...params.metadata,
          school_id: params.schoolId,
          student_id: params.studentId,
          invoice_id: params.invoiceId,
          internal_reference: internalRef,
        },
        customizations: {
          title: 'School Fees Payment',
          description: `Payment for Invoice #${params.invoiceNumber || params.invoiceId}`,
        },
      };

      const response = await fetch('https://api.flutterwave.com/v3/payments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json() as any;
      if (!response.ok || data.status !== 'success') {
        return {
          success: false,
          provider: this.name,
          providerReference: providerRef,
          internalReference: internalRef,
          message: data.message || 'Failed to initialize Flutterwave payment',
        };
      }

      return {
        success: true,
        provider: this.name,
        providerReference: providerRef,
        internalReference: internalRef,
        authorizationUrl: data.data.link,
        checkoutUrl: data.data.link,
      };
    } catch (err: any) {
      return {
        success: false,
        provider: this.name,
        providerReference: providerRef,
        internalReference: internalRef,
        message: err.message || 'Network error communicating with Flutterwave',
      };
    }
  }

  async verifyPayment(providerReference: string, schoolId?: string): Promise<PaymentVerificationResult> {
    const secretKey = this.getSecretKey(schoolId);
    if (!secretKey) {
      return {
        success: false,
        status: 'FAILED',
        amountKobo: 0,
        currency: 'NGN',
        providerReference,
        internalReference: '',
        message: 'Flutterwave secret key is missing.',
      };
    }

    try {
      const response = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(providerReference)}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      const data = await response.json() as any;

      if (!response.ok || data.status !== 'success') {
        return {
          success: false,
          status: 'FAILED',
          amountKobo: 0,
          currency: 'NGN',
          providerReference,
          internalReference: '',
          message: data.message || 'Flutterwave transaction verification failed',
        };
      }

      const tx = data.data;
      const status: PaymentStatus = (tx.status === 'successful') ? 'SUCCESS' : 'FAILED';
      const amountKobo = toKobo(tx.amount); // safely convert Naira back to kobo

      return {
        success: tx.status === 'successful',
        status,
        amountKobo,
        currency: tx.currency || 'NGN',
        providerReference,
        internalReference: tx.meta?.internal_reference || '',
        paidAt: tx.created_at || new Date().toISOString(),
        rawResponse: tx,
      };
    } catch (err: any) {
      return {
        success: false,
        status: 'FAILED',
        amountKobo: 0,
        currency: 'NGN',
        providerReference,
        internalReference: '',
        message: err.message || 'Network error during Flutterwave verification',
      };
    }
  }

  verifyWebhookSignature(_rawBody: string, signature: string | undefined, schoolId?: string): boolean {
    const secret = this.getWebhookSecret(schoolId);
    if (!secret || !signature) return false;
    return secret === signature;
  }
}

// -----------------------------------------------------------------------------
// 3. Test Sandbox / Simulation Gateway Provider
// -----------------------------------------------------------------------------
export class TestSandboxProvider implements PaymentGatewayProvider {
  name: GatewayProvider = 'TEST_SANDBOX';
  displayName = 'Instant Sandbox Checkout (Testing & Demo Verification)';

  isConfigured(_schoolId?: string): boolean {
    return true; // Always available in demo / sandbox mode
  }

  async initializePayment(params: InitializePaymentParams): Promise<PaymentInitResult> {
    const providerRef = `test_sndbx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const countRow = db.prepare('SELECT COUNT(*) as c FROM payments WHERE school_id = ?').get(params.schoolId) as { c: number };
    const internalRef = generateInternalPaymentReference('SNDBX', countRow.c + 1);

    return {
      success: true,
      provider: this.name,
      providerReference: providerRef,
      internalReference: internalRef,
      isSandbox: true,
      message: 'Sandbox transaction initialized. Ready for instant simulation.',
    };
  }

  async verifyPayment(providerReference: string): Promise<PaymentVerificationResult> {
    return {
      success: true,
      status: 'SUCCESS',
      amountKobo: 0, // determined by invoice context in caller
      currency: 'NGN',
      providerReference,
      internalReference: '',
      paidAt: new Date().toISOString(),
      rawResponse: { mode: 'sandbox', verified: true },
    };
  }

  verifyWebhookSignature(_rawBody: string, signature: string | undefined): boolean {
    return !signature || signature === 'sandbox-test-sig';
  }
}

// -----------------------------------------------------------------------------
// 4. Manual Gateway Provider (Cash, Bank Transfer, POS, Cheque)
// -----------------------------------------------------------------------------
export class ManualProvider implements PaymentGatewayProvider {
  name: GatewayProvider = 'MANUAL';
  displayName = 'Manual Bursary Entry (Cash, POS, Direct Bank Transfer)';

  isConfigured(_schoolId?: string): boolean {
    return true;
  }

  async initializePayment(params: InitializePaymentParams): Promise<PaymentInitResult> {
    const countRow = db.prepare('SELECT COUNT(*) as c FROM payments WHERE school_id = ?').get(params.schoolId) as { c: number };
    const internalRef = generateInternalPaymentReference('MAN', countRow.c + 1);
    const providerRef = `man_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    return {
      success: true,
      provider: this.name,
      providerReference: providerRef,
      internalReference: internalRef,
    };
  }

  async verifyPayment(providerReference: string): Promise<PaymentVerificationResult> {
    return {
      success: true,
      status: 'SUCCESS',
      amountKobo: 0,
      currency: 'NGN',
      providerReference,
      internalReference: '',
      paidAt: new Date().toISOString(),
    };
  }

  verifyWebhookSignature(): boolean {
    return false;
  }
}

// -----------------------------------------------------------------------------
// 5. Bachs.io Payment Provider (SaaS Subscriptions & Online Collections)
// -----------------------------------------------------------------------------
export class BachsPaymentProvider implements PaymentGatewayProvider {
  name: GatewayProvider = 'BACHS';
  displayName = 'Bachs.io (Cards, Bank Transfer, USSD, Stablecoins & Mobile Money)';

  private getApiKey(schoolId?: string): string | null {
    if (schoolId) {
      const setting = db.prepare('SELECT * FROM school_settings WHERE school_id = ?').get(schoolId) as any;
      if (setting?.bachs_api_key) return setting.bachs_api_key;
    }
    return process.env.BACHS_API_KEY || process.env.BACHS_SECRET_KEY || null;
  }

  private getWebhookSecret(schoolId?: string): string | null {
    if (schoolId) {
      const setting = db.prepare('SELECT * FROM school_settings WHERE school_id = ?').get(schoolId) as any;
      if (setting?.bachs_webhook_secret) return setting.bachs_webhook_secret;
    }
    return process.env.BACHS_WEBHOOK_SECRET || null;
  }

  private getApiBase(): string {
    const key = this.getApiKey();
    if (key && key.startsWith('sk_live_')) {
      return 'https://api.bachs.io';
    }
    return 'https://sandbox-api.bachs.io';
  }

  isConfigured(schoolId?: string): boolean {
    const key = this.getApiKey(schoolId);
    const secret = this.getWebhookSecret(schoolId);
    return Boolean((key && (key.startsWith('sk_live_') || key.startsWith('sk_sandbox_'))) || secret);
  }

  async initializePayment(params: InitializePaymentParams): Promise<PaymentInitResult> {
    const apiKey = this.getApiKey(params.schoolId);
    const countRow = db.prepare('SELECT COUNT(*) as c FROM payments WHERE school_id = ?').get(params.schoolId) as { c: number };
    const internalRef = generateInternalPaymentReference('BCH', countRow.c + 1);
    const providerRef = `bch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    if (!apiKey) {
      // Return simulated Bachs checkout session for seamless local testing & demo
      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      const checkoutUrl = `${appUrl}/api/v1/webhooks/bachs-demo-checkout?ref=${providerRef}&internal=${internalRef}&amount=${params.amountKobo}&school=${params.schoolId}`;

      return {
        success: true,
        provider: this.name,
        providerReference: providerRef,
        internalReference: internalRef,
        checkoutUrl,
        authorizationUrl: checkoutUrl,
        isSandbox: true,
        message: 'Bachs sandbox session initialized (API key in demo mode)',
      };
    }

    try {
      const payload = {
        amount: params.amountKobo, // in minor units
        currency: params.currency || 'NGN',
        customer: {
          email: params.email,
          name: params.studentName || 'BursarIQ Subscriber',
        },
        metadata: {
          ...params.metadata,
          school_id: params.schoolId,
          student_id: params.studentId,
          invoice_id: params.invoiceId,
          internal_reference: internalRef,
        },
        success_url: params.callbackUrl || `${process.env.APP_URL || 'http://localhost:3000'}/?status=success&ref=${providerRef}`,
        cancel_url: params.callbackUrl || `${process.env.APP_URL || 'http://localhost:3000'}/?status=cancelled&ref=${providerRef}`,
      };

      const res = await fetch(`${this.getApiBase()}/v1/checkouts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json() as any;

      if (!res.ok) {
        throw new Error(data.message || `Bachs checkout error: HTTP ${res.status}`);
      }

      return {
        success: true,
        provider: this.name,
        providerReference: data.id || data.reference || providerRef,
        internalReference: internalRef,
        checkoutUrl: data.checkout_url || data.hosted_url || data.url,
        authorizationUrl: data.checkout_url || data.hosted_url || data.url,
      };
    } catch (err: any) {
      console.warn('[BachsPaymentProvider] API call failed, falling back to simulated sandbox:', err.message);
      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      const checkoutUrl = `${appUrl}/api/v1/webhooks/bachs-demo-checkout?ref=${providerRef}&internal=${internalRef}&amount=${params.amountKobo}&school=${params.schoolId}`;

      return {
        success: true,
        provider: this.name,
        providerReference: providerRef,
        internalReference: internalRef,
        checkoutUrl,
        authorizationUrl: checkoutUrl,
        isSandbox: true,
        message: `Bachs sandbox fallback: ${err.message}`,
      };
    }
  }

  async verifyPayment(providerReference: string, schoolId?: string): Promise<PaymentVerificationResult> {
    const apiKey = this.getApiKey(schoolId);
    if (!apiKey) {
      return {
        success: true,
        status: 'SUCCESS',
        amountKobo: 0,
        currency: 'NGN',
        providerReference,
        internalReference: '',
        paidAt: new Date().toISOString(),
        rawResponse: { mode: 'sandbox_fallback', verified: true },
      };
    }

    try {
      const res = await fetch(`${this.getApiBase()}/v1/checkouts/${providerReference}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      const data = await res.json() as any;
      if (!res.ok) {
        return {
          success: false,
          status: 'FAILED',
          amountKobo: 0,
          currency: 'NGN',
          providerReference,
          internalReference: '',
          message: data.message || `HTTP ${res.status}`,
        };
      }

      const statusMap: Record<string, PaymentStatus> = {
        succeeded: 'SUCCESS',
        paid: 'SUCCESS',
        completed: 'SUCCESS',
        pending: 'PENDING',
        failed: 'FAILED',
        expired: 'CANCELLED',
      };

      const status: PaymentStatus = statusMap[data.status] || 'PENDING';

      return {
        success: status === 'SUCCESS',
        status,
        amountKobo: Number(data.amount) || 0,
        currency: data.currency || 'NGN',
        providerReference,
        internalReference: data.metadata?.internal_reference || '',
        paidAt: data.paid_at || new Date().toISOString(),
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        success: false,
        status: 'FAILED',
        amountKobo: 0,
        currency: 'NGN',
        providerReference,
        internalReference: '',
        message: err.message,
      };
    }
  }

  /**
   * Verify Bachs webhook signature.
   * Format: HMAC-SHA256 of `${timestamp}.${rawBody}` (or `${timestamp}${rawBody}` or `rawBody`) compared against X-Bachs-Signature
   */
  verifyWebhookSignature(rawBody: string, signature: string | undefined, schoolId?: string, timestamp?: string): boolean {
    const secret = this.getWebhookSecret(schoolId);

    // If a webhook secret is configured (e.g. BACHS_WEBHOOK_SECRET), strict verification is mandatory
    if (secret) {
      if (!signature) {
        return false;
      }

      // Verify timestamp tolerance if timestamp provided (5 min / 300 sec tolerance)
      if (timestamp) {
        const now = Math.floor(Date.now() / 1000);
        const ts = parseInt(timestamp, 10);
        if (!isNaN(ts) && Math.abs(now - ts) > 300) {
          console.warn('[Bachs] Webhook timestamp outside 300s window (replay defense)');
          return false;
        }
      }

      try {
        // Strip prefixes if present (e.g. sha256=... or t=...,v1=...)
        let cleanSignature = signature.trim();
        if (cleanSignature.startsWith('sha256=')) {
          cleanSignature = cleanSignature.slice(7);
        } else if (cleanSignature.includes('v1=')) {
          const parts = cleanSignature.split(',');
          const v1Part = parts.find((p) => p.startsWith('v1='));
          if (v1Part) cleanSignature = v1Part.slice(3);
        }

        const candidates = timestamp
          ? [`${timestamp}.${rawBody}`, `${timestamp}${rawBody}`, rawBody]
          : [rawBody];

        for (const payloadToSign of candidates) {
          const computed = crypto.createHmac('sha256', secret).update(payloadToSign).digest('hex');
          if (cleanSignature.toLowerCase() === computed.toLowerCase()) {
            return true;
          }
          try {
            const sigBuffer = Buffer.from(cleanSignature, 'hex');
            const compBuffer = Buffer.from(computed, 'hex');
            if (sigBuffer.length === compBuffer.length && crypto.timingSafeEqual(sigBuffer, compBuffer)) {
              return true;
            }
          } catch {
            // continue checking
          }
        }
        return false;
      } catch {
        return false;
      }
    }

    // If NO secret is configured, allow local sandbox demo signatures
    if (!signature || signature === 'bachs-sandbox-sig' || signature === 'test-signature') {
      return true;
    }

    return false;
  }
}

// -----------------------------------------------------------------------------
// Payment Service Manager (Singleton)
// -----------------------------------------------------------------------------
export class PaymentService {
  private providers: Map<GatewayProvider, PaymentGatewayProvider> = new Map();

  constructor() {
    this.registerProvider(new PaystackProvider());
    this.registerProvider(new FlutterwaveProvider());
    this.registerProvider(new BachsPaymentProvider());
    this.registerProvider(new ManualProvider());
    this.registerProvider(new TestSandboxProvider());
  }

  registerProvider(provider: PaymentGatewayProvider) {
    this.providers.set(provider.name, provider);
  }

  getProvider(name: GatewayProvider): PaymentGatewayProvider {
    const provider = this.providers.get(name) || this.providers.get(String(name).toUpperCase() as GatewayProvider);
    if (!provider) {
      throw new Error(`Unsupported payment provider: ${name}`);
    }
    return provider;
  }

  getRegisteredGateways(): GatewayProvider[] {
    return Array.from(this.providers.keys());
  }

  isConfigured(name: GatewayProvider, schoolId?: string): boolean {
    return this.getProvider(name).isConfigured(schoolId);
  }

  getAllProviders(schoolId?: string) {
    return Array.from(this.providers.values()).map((p) => ({
      name: p.name,
      displayName: p.displayName,
      isConfigured: p.isConfigured(schoolId),
    }));
  }
}

export const paymentService = new PaymentService();
