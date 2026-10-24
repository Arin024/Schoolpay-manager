/**
 * SEO & Dynamic Meta Service
 * Dynamically updates document title, meta descriptions, OpenGraph, Twitter cards,
 * canonical link, and JSON-LD structured data on client-side route/tab transitions.
 */

export interface SeoConfig {
  title: string;
  description: string;
  canonicalUrl?: string;
  ogType?: string;
  ogImage?: string;
}

const DEFAULT_DESCRIPTION =
  'Nigeria’s leading school fee payment and bursary management platform. Collect tuition seamlessly, stop cash leakage, issue instant verified receipts, and delight parents.';
const DEFAULT_OG_IMAGE = '/og-image.png';
const BASE_URL = 'https://bursariq.com.ng';

export function updateSeo(config: Partial<SeoConfig>) {
  const fullTitle = config.title
    ? config.title.includes('BursarIQ')
      ? config.title
      : `${config.title} | BursarIQ`
    : 'BursarIQ – Simple School Payments. Smarter Bursary Management.';

  const description = config.description || DEFAULT_DESCRIPTION;
  const canonicalUrl = config.canonicalUrl || `${BASE_URL}${window.location.pathname || '/'}`;
  const ogImage = config.ogImage || DEFAULT_OG_IMAGE;
  const ogType = config.ogType || 'website';

  // 1. Update Title
  document.title = fullTitle;

  // 2. Helper to set or update meta tag by name
  const setMetaByName = (name: string, content: string) => {
    let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', name);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  };

  // 3. Helper to set or update meta tag by property
  const setMetaByProperty = (property: string, content: string) => {
    let el = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null;
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('property', property);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  };

  // Meta Descriptions
  setMetaByName('description', description);
  setMetaByProperty('og:title', fullTitle);
  setMetaByProperty('og:description', description);
  setMetaByProperty('og:type', ogType);
  setMetaByProperty('og:url', canonicalUrl);
  setMetaByProperty('og:image', ogImage);
  setMetaByProperty('og:site_name', 'BursarIQ');

  // Twitter cards
  setMetaByName('twitter:card', 'summary_large_image');
  setMetaByName('twitter:title', fullTitle);
  setMetaByName('twitter:description', description);
  setMetaByName('twitter:image', ogImage);

  // Canonical tag
  let canonicalEl = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!canonicalEl) {
    canonicalEl = document.createElement('link');
    canonicalEl.setAttribute('rel', 'canonical');
    document.head.appendChild(canonicalEl);
  }
  canonicalEl.setAttribute('href', canonicalUrl);
}
