// ═══════════════════════════════════════════════════════════════
// Tickk Extension — Sync Script (Runs on tickk.online)
// Pulls auth token directly from localStorage and syncs to extension
// ═══════════════════════════════════════════════════════════════

(async function syncAuth() {
  const TICKK_API_BASE = 'https://tickk-backend.onrender.com';

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
      const accessToken = session.access_token;
      
      if (!accessToken) return;

      // Check if we already have the API key in storage to prevent infinite syncing
      chrome.storage.local.get(['tickk_api_key'], async (result) => {
        if (!result.tickk_api_key) {
          console.log('[Tickk Sync] Found web session, exchanging for Extension API Key...');
          
          try {
            const response = await fetch(`${TICKK_API_BASE}/api/extension/auth-token-exchange`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ accessToken })
            });
            
            const data = await response.json();
            
            if (data.apiKey) {
              chrome.storage.local.set({
                tickk_api_key: data.apiKey,
                tickk_user_id: data.userId,
                tickk_user_email: session.user?.email || null,
                tickk_auth_timestamp: Date.now()
              }, () => {
                console.log('✅ Tickk Auth Session Synced to Extension Storage!');
              });
            }
          } catch (err) {
            console.error('[Tickk Sync] Token exchange failed:', err);
          }
        }
      });
    } catch (e) {
      console.error('[Tickk Sync] Failed to parse auth token:', e);
    }
  }
})();
