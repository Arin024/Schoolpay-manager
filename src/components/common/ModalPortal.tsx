import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ModalPortalProps {
  children: React.ReactNode;
  onEscape?: () => void;
}

/**
 * Renders modal overlays directly into document.body via React Portal so
 * parent overflow-hidden, stacking contexts, or mobile scroll containers can
 * never clip, trap, or block modals from opening cleanly.
 */
export const ModalPortal: React.FC<ModalPortalProps> = ({ children, onEscape }) => {
  useEffect(() => {
    if (!onEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape]);

  if (typeof document === 'undefined') return <>{children}</>;
  return createPortal(children, document.body);
};
