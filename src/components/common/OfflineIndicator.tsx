import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-xl border border-amber-500/50">
      <WifiOff className="w-4 h-4 animate-pulse" />
      <span>Offline Mode — Cached data is being viewed. Financial mutations paused.</span>
    </div>
  );
};
