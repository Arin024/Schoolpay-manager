// Deterministic financial utilities for Nigerian Naira (NGN) in integer Kobo minor units
// 1 NGN = 100 Kobo. NEVER use floating-point arithmetic or AI for money.

export function toKobo(naira: number | string): number {
  if (typeof naira === 'string') {
    const cleaned = naira.replace(/[^0-9.-]+/g, '');
    naira = parseFloat(cleaned) || 0;
  }
  if (isNaN(Number(naira))) return 0;
  return Math.round(Number(naira) * 100);
}

export function toNaira(kobo: number): number {
  if (isNaN(Number(kobo))) return 0;
  return Number(kobo) / 100;
}

export function formatNaira(kobo: number): string {
  const naira = toNaira(kobo);
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
  }).format(naira);
}

export function calculateItemsSubtotalKobo(
  items: Array<{ unit_amount: number; quantity?: number }>
): number {
  return items.reduce((sum, item) => {
    const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
    const unitKobo = Math.round(Number(item.unit_amount) || 0);
    return sum + unitKobo * qty;
  }, 0);
}

export function calculateDiscountKobo(
  subtotalKobo: number,
  discounts: Array<{ type: string; amount?: number; percentage?: number }>
): number {
  let totalDiscount = 0;
  for (const d of discounts) {
    if (d.type === 'PERCENTAGE' && typeof d.percentage === 'number') {
      const clampedPct = Math.min(100, Math.max(0, d.percentage));
      const pctAmount = Math.round((subtotalKobo * clampedPct) / 100);
      totalDiscount += pctAmount;
    } else if (d.amount) {
      totalDiscount += Math.round(Number(d.amount));
    }
  }
  return Math.min(subtotalKobo, Math.max(0, totalDiscount));
}

export function determineInvoiceStatus(
  totalKobo: number,
  paidKobo: number,
  dueDateStr?: string | null,
  currentStatus = 'ISSUED'
): 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED' {
  if (currentStatus === 'CANCELLED') return 'CANCELLED';
  if (currentStatus === 'DRAFT') return 'DRAFT';
  if (paidKobo >= totalKobo && totalKobo > 0) return 'PAID';
  if (paidKobo > 0 && paidKobo < totalKobo) return 'PARTIALLY_PAID';

  if (dueDateStr) {
    const due = new Date(dueDateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!isNaN(due.getTime()) && due < today && paidKobo < totalKobo) {
      return 'OVERDUE';
    }
  }

  return 'ISSUED';
}

export function generateInvoiceNumber(schoolSlugOrPrefix: string, sequenceNum: number): string {
  const year = new Date().getFullYear();
  const seq = String(sequenceNum).padStart(4, '0');
  const cleanPrefix = (schoolSlugOrPrefix || 'INV').slice(0, 4).toUpperCase();
  return `INV-${cleanPrefix}-${year}-${seq}`;
}

export function generatePaymentReference(schoolSlugOrPrefix: string, sequenceNum: number): string {
  const year = new Date().getFullYear();
  const seq = String(sequenceNum).padStart(4, '0');
  const cleanPrefix = (schoolSlugOrPrefix || 'PAY').slice(0, 4).toUpperCase();
  return `PAY-${cleanPrefix}-${year}-${seq}`;
}
