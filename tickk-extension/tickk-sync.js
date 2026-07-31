// ═══════════════════════════════════════════════════════════════
// Tickk Extension — Sync Script (Runs on tickk.online)
// Pulls auth token directly from localStorage and syncs to extension
// ═══════════════════════════════════════════════════════════════

(function syncAuth() {
  // Find the Supabase auth token in localStorage (key format: sb-<project_ref>-auth-token or supabase.auth.token)
  let rawAuth = null;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.includes('-auth-token') || key === 'supabase.auth.token')) {
      rawAuth = localStorage.getItem(key);
      break;
    }
  }

  if (rawAuth) {
    try {
      const session = JSON.parse(rawAuth);
      const sessionToken = session.access_token;
      
      if (sessionToken) {
        chrome.storage.local.set({
          tickk_user: {
            email: session.user?.email || 'Logged Out',
            token: sessionToken,
            connected: true
          }
        }, () => {
          console.log('✅ Tickk Auth Session Synced to Extension Storage!');
        });
      }
    } catch (e) {
      console.error('[Tickk Sync] Failed to parse auth token:', e);
    }
  } else {
    // If not found on tickk.online, clear the session
    chrome.storage.local.remove(['tickk_user']);
  }
})();
