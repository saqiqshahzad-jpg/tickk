// ═══════════════════════════════════════════════════════════════
// Tickk Extension — Bulletproof Sync Bridge (Content Script on tickk.online)
//
// TWO sync channels:
//   1. window.postMessage listener — INSTANT, triggered by web app
//   2. localStorage polling — BACKUP, runs every 500ms
//
// The web app calls: window.postMessage({ type: 'TICKK_AUTH_SYNC', email: '...' }, '*')
// This content script receives it instantly and writes to chrome.storage.local
// ═══════════════════════════════════════════════════════════════

// ─── Channel 1: Instant postMessage Bridge ───
// Web app (Onboarding.tsx / ExtensionAuth.tsx) sends email via postMessage
// Content script receives it and writes directly to chrome.storage.local
window.addEventListener('message', (event) => {
  // Only accept messages from tickk.online
  if (event.origin !== 'https://tickk.online') return;
  
  if (event.data && event.data.type === 'TICKK_AUTH_SYNC' && event.data.email) {
    chrome.storage.local.set({ tickk_user_email: event.data.email }, () => {
      console.log('⚡ TICKK INSTANT SYNC SUCCESS:', event.data.email);
      // Confirm back to web app that sync is complete
      window.postMessage({ type: 'TICKK_SYNC_CONFIRMED', email: event.data.email }, '*');
    });
  }
});

// ─── Channel 2: localStorage Polling Backup ───
// Catches cases where postMessage was missed
function autoSyncUserSession() {
  const authKeys = Object.keys(localStorage).filter(k => k.includes('auth-token') || k.includes('sb-'));

  for (let key of authKeys) {
    try {
      const data = JSON.parse(localStorage.getItem(key));
      const email = data?.user?.email || data?.currentSession?.user?.email;

      if (email) {
        chrome.storage.local.set({ tickk_user_email: email }, () => {
          console.log('⚡ Tickk Auto-Sync (polling):', email);
        });
        return; // Found and synced
      }
    } catch (e) {}
  }
}

// Run immediately + poll every 500ms (fast enough to beat the 2s redirect)
autoSyncUserSession();
setInterval(autoSyncUserSession, 500);
