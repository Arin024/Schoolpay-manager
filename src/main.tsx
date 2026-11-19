import { registerSW } from 'virtual:pwa-register';

const isRedirectingApexHost =
  typeof window !== 'undefined' && window.location?.hostname === 'bursariq.com.ng';

if (isRedirectingApexHost) {
  // Never install a Service Worker on the redirecting apex domain; clean up any stale registration
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {});
  }
} else {
  // Automatically register and update the PWA service worker on canonical hosts whenever a new version is deployed
  const updateSW = registerSW({
    onNeedRefresh() {
      console.log('[PWA] New version detected, refreshing cache...');
      updateSW(true);
    },
    onOfflineReady() {
      console.log('[PWA] App is ready for offline caching.');
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      let lastCheck = Date.now();
      const checkForUpdate = () => {
        if (navigator.onLine === false) return;
        const now = Date.now();
        if (now - lastCheck < 60_000) return;
        lastCheck = now;
        registration.update().catch(() => {});
      };
      window.addEventListener('online', checkForUpdate);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
    },
  });
}

// Global resilience: Intercept unhandled HTML responses and prevent raw "<!doctype ... is not valid JSON" errors
if (typeof window !== 'undefined' && window.Response) {
  const origJson = Response.prototype.json;
  Response.prototype.json = async function () {
    try {
      return await origJson.apply(this);
    } catch (err: any) {
      if (
        err?.message?.includes('JSON') ||
        err?.message?.includes('token') ||
        err?.message?.includes('doctype') ||
        err?.message?.includes('<')
      ) {
        throw new Error(
          'The server is temporarily initializing or returned an unexpected response. Please try again shortly.'
        );
      }
      throw err;
    }
  };
}

import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
