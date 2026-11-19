/**
 * Reliable cross-browser & mobile WebView clipboard helper.
 * Uses navigator.clipboard.writeText when available in secure contexts,
 * and gracefully falls back to an off-screen textarea + document.execCommand('copy').
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to legacy textarea fallback
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(ta);
    return copied;
  } catch {
    return false;
  }
}
