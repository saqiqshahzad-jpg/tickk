// ═══════════════════════════════════════════════════════════════
// Tickk Extension — Sync Bridge (Runs on tickk.online)
// Web app localStorage se auth token utha kar extension storage mein daalta hai
// ═══════════════════════════════════════════════════════════════

function syncTokenToExtension() {
  // Web App localStorage se auth token keys search karo
  const authKey = Object.keys(localStorage).find(k => k.includes('auth-token') || k.includes('supabase'));
  const authData = authKey ? localStorage.getItem(authKey) : null;

  if (authData) {
    try {
      const parsed = JSON.parse(authData);
      const email = parsed?.user?.email || parsed?.currentSession?.user?.email;

      chrome.storage.local.set({
        tickk_session: parsed,
        tickk_user_email: email || 'saqibmemon988@gmail.com',
        tickk_user: {
          email: email || 'saqibmemon988@gmail.com',
          token: parsed?.access_token || '',
          connected: true
        }
      }, () => {
        console.log('⚡ Tickk Token Synced to Extension Storage successfully!');
        console.log('📧 Email:', email);
        console.log('🔑 Key found:', authKey);
      });
    } catch (e) {
      console.error('[Tickk Sync] Parse error:', e);
    }
  } else {
    console.warn('[Tickk Sync] ❌ No auth token found in localStorage!');
    console.log('[Tickk Sync] Available keys:', Object.keys(localStorage));
  }
}

// Run immediately
syncTokenToExtension();

// Re-run every 3 seconds to catch late Supabase auth loads & token refreshes
setInterval(syncTokenToExtension, 3000);
