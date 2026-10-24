import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// Global cached prompt across component mounts / page navigations
let globalDeferredPrompt: BeforeInstallPromptEvent | null = (window as any).__pwaInstallPrompt || null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    globalDeferredPrompt = e as BeforeInstallPromptEvent;
    (window as any).__pwaInstallPrompt = e;
    window.dispatchEvent(new CustomEvent('pwa-prompt-ready'));
  });

  window.addEventListener('appinstalled', () => {
    globalDeferredPrompt = null;
    (window as any).__pwaInstallPrompt = null;
    window.dispatchEvent(new CustomEvent('pwa-installed'));
  });
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    globalDeferredPrompt || (typeof window !== 'undefined' ? (window as any).__pwaInstallPrompt : null)
  );
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Detect standalone mode (already installed or running inside installed PWA)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    // Detect iOS devices
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIOSDevice);

    const onPromptReady = () => {
      setDeferredPrompt(globalDeferredPrompt || (window as any).__pwaInstallPrompt);
    };

    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('pwa-prompt-ready', onPromptReady);
    window.addEventListener('pwa-installed', onInstalled);

    // Re-check global in case it was caught before this hook mounted
    if (!deferredPrompt && ((window as any).__pwaInstallPrompt || globalDeferredPrompt)) {
      setDeferredPrompt(globalDeferredPrompt || (window as any).__pwaInstallPrompt);
    }

    return () => {
      window.removeEventListener('pwa-prompt-ready', onPromptReady);
      window.removeEventListener('pwa-installed', onInstalled);
    };
  }, []);

  const install = async () => {
    const promptEvent = deferredPrompt || globalDeferredPrompt || (window as any).__pwaInstallPrompt;
    if (!promptEvent) return false;

    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setDeferredPrompt(null);
        globalDeferredPrompt = null;
        (window as any).__pwaInstallPrompt = null;
        return true;
      }
    } catch (err) {
      console.warn('[PWA Install Error]', err);
    }
    return false;
  };

  return {
    isInstallable: Boolean(deferredPrompt || globalDeferredPrompt || (typeof window !== 'undefined' && (window as any).__pwaInstallPrompt)),
    isInstalled,
    isIOS,
    install,
  };
}
