import { registerSW } from 'virtual:pwa-register';

// Automatically register and update the PWA service worker whenever a new version is deployed
const updateSW = registerSW({
  onNeedRefresh() {
    console.log('[PWA] New version detected, refreshing cache...');
    updateSW(true);
  },
  onOfflineReady() {
    console.log('[PWA] App is ready for offline caching.');
  },
});

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
