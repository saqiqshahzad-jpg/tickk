// ═══════════════════════════════════════════════════════════════
// Tickk Extension — Permanent Auto-Sync (Runs on tickk.online)
// Automatically reads logged-in user email from Supabase localStorage
// and writes it to chrome.storage.local for the extension
// ═══════════════════════════════════════════════════════════════

function autoSyncUserSession() {
  // LocalStorage se Supabase Auth User read karo
  const authKeys = Object.keys(localStorage).filter(k => k.includes('auth-token') || k.includes('sb-'));

  for (let key of authKeys) {
    try {
      const data = JSON.parse(localStorage.getItem(key));
      const email = data?.user?.email || data?.currentSession?.user?.email;

      if (email) {
        chrome.storage.local.set({ tickk_user_email: email }, () => {
          console.log('⚡ Tickk Permanent Auto-Sync Success:', email);
        });
        break;
      }
    } catch (e) {}
  }
}

autoSyncUserSession();
setInterval(autoSyncUserSession, 3000);
