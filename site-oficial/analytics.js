(() => {
  'use strict';
  const host = location.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(location.protocol) || ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) return;
  if (window.__invoxViewTrackingStarted) return;
  window.__invoxViewTrackingStarted = true;
  let eventId;
  try {
    if (window.crypto.randomUUID) eventId = window.crypto.randomUUID();
    else {
      const bytes = window.crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
      eventId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch { return; }
  let attempts = 0;
  let complete = false;
  let sending = false;
  let retryTimer;
  async function track() {
    if (complete || sending || attempts >= 3 || document.visibilityState !== 'visible') return;
    if (typeof window.InvoxBackend?.trackView !== 'function') return;
    sending = true;
    attempts += 1;
    try {
      const receipt = await window.InvoxBackend.trackView(eventId);
      if (typeof receipt?.recorded === 'boolean') complete = true;
    } catch (error) {
      if (error.code === 'offline' && attempts < 2) retryTimer = setTimeout(track, 4000);
    } finally { sending = false; }
  }
  document.addEventListener('visibilitychange', track);
  window.addEventListener('online', track);
  window.addEventListener('pagehide', () => clearTimeout(retryTimer));
  track();
})();
