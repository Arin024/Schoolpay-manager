import crypto from 'node:crypto';
import type { Router, Request, Response, NextFunction } from 'express';

/**
 * Escapes HTML special characters to prevent Reflected / Stored XSS.
 */
export function escapeHtml(input: unknown): string {
  const str = String(input ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Prevents CSV Formula Injection (DDE / Excel / Sheets formula execution)
 * and properly escapes RFC 4180 CSV double quotes.
 */
export function sanitizeCsvCell(input: unknown): string {
  let str = String(input ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Strictly validates uploaded payment proof receipts (base64 data URLs only).
 * Only permits PNG, JPEG, WEBP, and PDF payloads up to 2.5MB encoded size.
 */
const ALLOWED_RECEIPT_DATA_URL = /^data:(image\/(png|jpeg|jpg|webp)|application\/pdf);base64,[A-Za-z0-9+/=\s]+$/i;
const MAX_RECEIPT_BYTES = 2_500_000;

export function validateReceiptDataUrl(value: unknown): { valid: boolean; sanitized: string | null; reason?: string } {
  if (value === undefined || value === null || value === '') {
    return { valid: true, sanitized: null };
  }
  if (typeof value !== 'string') {
    return { valid: false, sanitized: null, reason: 'Receipt file must be a valid base64 data URL string.' };
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_RECEIPT_BYTES) {
    return { valid: false, sanitized: null, reason: 'Receipt file exceeds the maximum allowed size (2MB).' };
  }
  if (!ALLOWED_RECEIPT_DATA_URL.test(trimmed)) {
    return {
      valid: false,
      sanitized: null,
      reason: 'Unsupported or unsafe receipt format. Only PNG, JPEG, WEBP, or PDF files are permitted.',
    };
  }
  return { valid: true, sanitized: trimmed.replace(/\s+/g, '') };
}

/**
 * Constant-time string comparison helper for secrets & tokens.
 */
export function timingSafeEqualStr(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Wraps an Express Router so async route handlers automatically forward
 * rejected promises to Express's central error middleware instead of crashing.
 */
export function wrapRouterAsync(router: Router): Router {
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all'] as const) {
    const orig = (router as any)[method].bind(router);
    (router as any)[method] = (path: any, ...handlers: any[]) =>
      orig(
        path,
        ...handlers.map((fn) =>
          typeof fn === 'function' && fn.length < 4
            ? (req: Request, res: Response, next: NextFunction) =>
                Promise.resolve(fn(req, res, next)).catch(next)
            : fn
        )
      );
  }
  return router;
}

/**
 * Prevents internal database/filesystem/stack details from leaking in 5xx API responses.
 */
export function safeClientError(err: any, fallback = 'An unexpected server error occurred. Please try again.'): string {
  const msg = String(err?.message || '');
  if (!msg) return fallback;
  const sensitivePattern = /(sql|sqlite|postgres|pg_|relation\s+"|column\s+"|syntax error|enoent|econn|stack|at\s+\/|password|secret|token|key)/i;
  if (sensitivePattern.test(msg) || process.env.NODE_ENV === 'production') {
    return fallback;
  }
  return fallback;
}
