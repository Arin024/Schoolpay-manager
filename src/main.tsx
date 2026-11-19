import { registerSW } from 'virtual:pwa-register';

// Register and auto-update PWA service worker on canonical hosts (skip if Render is redirecting apex)
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

// If an already-open tab had an older Service Worker and a brand-new SW takes control,
// perform a single safe reload so the tab immediately runs the latest JS bundle (never loops).
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloadedForNewSw = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloadedForNewSw) return;
    try {
      const lastReload = Number(sessionStorage.getItem('bursariq_sw_last_reload') || '0');
      if (Date.now() - lastReload < 15_000) return;
      sessionStorage.setItem('bursariq_sw_last_reload', String(Date.now()));
    } catch {}
    reloadedForNewSw = true;
    window.location.reload();
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
