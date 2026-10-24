/**
 * Lightweight, Privacy-Friendly Client-Side Analytics for BursarIQ (bursariq.com.ng)
 * Respects Nigerian Data Protection Act (NDPA 2023) and user cookie preferences.
 */

export interface AnalyticsEvent {
  category: string;
  action: string;
  label?: string;
  value?: number;
  timestamp: string;
  networkSpeed?: string;
}

const CONSENT_STORAGE_KEY = 'bursariq_cookie_consent';

export function getCookieConsent(): 'all' | 'essential' | null {
  try {
    const val = localStorage.getItem(CONSENT_STORAGE_KEY) || localStorage.getItem('schoolpay_cookie_consent');
    if (val === 'all' || val === 'essential') return val;
    return null;
  } catch {
    return null;
  }
}

export function setCookieConsent(val: 'all' | 'essential') {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, val);
  } catch {}
}

export function isAnalyticsAllowed(): boolean {
  return getCookieConsent() === 'all';
}

function getNetworkSpeed(): string {
  if (typeof navigator !== 'undefined' && 'connection' in navigator) {
    const conn = (navigator as any).connection;
    return conn?.effectiveType || 'unknown';
  }
  return 'unknown';
}

class BursarIQAnalytics {
  private events: AnalyticsEvent[] = [];

  trackPageView(page: string, path?: string) {
    if (!isAnalyticsAllowed()) return;
    const event: AnalyticsEvent = {
      category: 'Navigation',
      action: 'page_view',
      label: `${page} (${path || window.location.pathname})`,
      timestamp: new Date().toISOString(),
      networkSpeed: getNetworkSpeed(),
    };
    this.recordEvent(event);
  }

  trackCtaClick(ctaName: string, location: string) {
    if (!isAnalyticsAllowed()) return;
    const event: AnalyticsEvent = {
      category: 'CTA_Click',
      action: 'click',
      label: `${ctaName} on ${location}`,
      timestamp: new Date().toISOString(),
      networkSpeed: getNetworkSpeed(),
    };
    this.recordEvent(event);
  }

  trackEvent(category: string, action: string, label?: string, value?: number) {
    if (!isAnalyticsAllowed()) return;
    const event: AnalyticsEvent = {
      category,
      action,
      label,
      value,
      timestamp: new Date().toISOString(),
      networkSpeed: getNetworkSpeed(),
    };
    this.recordEvent(event);
  }

  private recordEvent(event: AnalyticsEvent) {
    this.events.push(event);
    if (this.events.length > 50) {
      this.events.shift();
    }
  }

  getRecentEvents(): AnalyticsEvent[] {
    return [...this.events];
  }
}

export const analytics = new BursarIQAnalytics();

// Attach to window for easy verification
if (typeof window !== 'undefined') {
  (window as any).bursarIQAnalytics = analytics;
  (window as any).schoolPayAnalytics = analytics;
}
