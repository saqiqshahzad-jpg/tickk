// ═══════════════════════════════════════════════════════════════
// Tickk Extension — Service Worker (Background Script)
// Handles: onInstall onboarding, token exchange, message relay
// ═══════════════════════════════════════════════════════════════

const TICKK_API_BASE = 'https://tickk-backend.onrender.com';
const ONBOARDING_URL = 'https://tickk.online/onboarding';

// ─── 1. On Install: Open Onboarding Page ───
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: ONBOARDING_URL });
    console.log('[Tickk BG] Extension installed — onboarding page opened.');
  }
});

// ─── 2. External Message Handler (Token Handoff from tickk.online) ───
// Web app sends: chrome.runtime.sendMessage(EXTENSION_ID, { type: 'AUTH_TOKEN', accessToken: '...' })
// Legacy support: also accepts { type: 'TICKK_AUTH_SUCCESS', apiKey: '...' }
chrome.runtime.onMessageExternal.addListener(
  async (message, sender, sendResponse) => {
    // Validate sender origin
    if (!sender.url || !sender.url.startsWith('https://tickk.online')) {
      sendResponse({ success: false, error: 'Unauthorized origin' });
      return;
    }

    // Accept both message types for compatibility
    const isAuthToken = message.type === 'AUTH_TOKEN' && message.accessToken;
    const isLegacyAuth = message.type === 'TICKK_AUTH_SUCCESS' && (message.accessToken || message.apiKey);

    if (isAuthToken || isLegacyAuth) {
      try {
        let apiKey, userId;

        if (message.accessToken) {
          // Primary flow: exchange Supabase JWT for persistent API key
          const result = await exchangeToken(message.accessToken);
          if (!result.success) {
            sendResponse({ success: false, error: result.error });
            return;
          }
          apiKey = result.apiKey;
          userId = result.userId;
        } else if (message.apiKey) {
          // Legacy fallback: apiKey sent directly
          apiKey = message.apiKey;
          userId = message.userId || null;
        }

        if (apiKey) {
          // Save API key + user ID + email to storage
          const storageData = {
            tickk_api_key: apiKey,
            tickk_auth_timestamp: Date.now(),
          };
          if (userId) storageData.tickk_user_id = userId;
          if (message.email) storageData.tickk_user_email = message.email;

          await chrome.storage.local.set(storageData);
          console.log('[Tickk BG] Auth synced successfully.');
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No credentials received' });
        }
      } catch (err) {
        console.error('[Tickk BG] Token exchange failed:', err);
        sendResponse({ success: false, error: err.message });
      }
    } else {
      sendResponse({ success: false, error: 'Unknown message type' });
    }

    // Required to keep the message port open for async response
    return true;
  }
);

// ─── 3. Internal Message Handler (from content scripts & popup) ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'AUTH_TOKEN_FROM_SYNC' && message.accessToken) {
    exchangeToken(message.accessToken).then(result => {
      if (result.success && result.apiKey) {
        const storageData = {
          tickk_api_key: result.apiKey,
          tickk_auth_timestamp: Date.now(),
        };
        if (result.userId || message.userId) storageData.tickk_user_id = result.userId || message.userId;
        if (message.email) storageData.tickk_user_email = message.email;

        chrome.storage.local.set(storageData, () => {
          console.log('[Tickk BG] Auth synced successfully via content script bridge.');
        });
      } else {
        console.error('[Tickk BG] Token exchange failed via sync bridge:', result.error);
      }
    });
    // Fire and forget, no sendResponse needed for this
    return false;
  }

  if (message.type === 'GET_AUTH_STATUS') {
    chrome.storage.local.get(
      ['tickk_api_key', 'tickk_user_id'],
      (result) => {
        sendResponse({
          authenticated: !!result.tickk_api_key,
          userId: result.tickk_user_id || null,
        });
      }
    );
    return true; // Async response
  }

  if (message.type === 'LOGOUT') {
    chrome.storage.local.remove(
      ['tickk_api_key', 'tickk_user_id', 'tickk_auth_timestamp'],
      () => {
        console.log('[Tickk BG] User logged out.');
        sendResponse({ success: true });
      }
    );
    return true;
  }

  if (message.type === 'OPEN_TAB') {
    chrome.tabs.create({ url: message.url });
    sendResponse({ success: true });
    return false;
  }
});

// ─── 4. Token Exchange Function ───
async function exchangeToken(accessToken) {
  try {
    const response = await fetch(
      `${TICKK_API_BASE}/api/extension/auth-token-exchange`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      return {
        success: false,
        error: errorData.error || 'Token exchange failed',
      };
    }

    return await response.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── 5. Periodic Auth Validation (every 6 hours) ───
chrome.alarms.create('tickk-auth-check', { periodInMinutes: 360 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'tickk-auth-check') {
    const result = await chrome.storage.local.get(['tickk_api_key']);
    if (!result.tickk_api_key) return;

    try {
      const response = await fetch(
        `${TICKK_API_BASE}/api/extension/user-info`,
        {
          method: 'GET',
          headers: { 'x-api-key': result.tickk_api_key },
        }
      );

      if (!response.ok) {
        // Token invalid — clear stored auth
        await chrome.storage.local.remove([
          'tickk_api_key',
          'tickk_user_id',
          'tickk_auth_timestamp',
        ]);
        console.warn(
          '[Tickk BG] Auth validation failed — credentials cleared.'
        );
      }
    } catch (err) {
      console.error('[Tickk BG] Auth check network error:', err);
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// 6. BULLETPROOF TAB WATCHER — Sync auth from tickk.online
// When user visits tickk.online (logged in), background.js injects
// a script that reads localStorage and sends back the email.
// No content script dependency. No timing issues.
// ═══════════════════════════════════════════════════════════════

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only act when a tickk.online page finishes loading
  if (
    changeInfo.status === 'complete' &&
    tab.url &&
    tab.url.startsWith('https://tickk.online')
  ) {
    console.log('[Tickk BG] tickk.online tab detected, attempting auth sync...');
    extractAuthFromTab(tabId, 0);
  }
});

// Also check when any tab is activated (user switches to tickk.online tab)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url && tab.url.startsWith('https://tickk.online')) {
      console.log('[Tickk BG] Switched to tickk.online tab, syncing...');
      extractAuthFromTab(activeInfo.tabId, 0);
    }
  } catch (e) {}
});

async function extractAuthFromTab(tabId, attempt) {
  if (attempt >= 5) {
    console.warn('[Tickk BG] Auth extraction failed after 5 attempts.');
    return;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // This runs IN the tickk.online page context
        // It can access the page's localStorage
        const keys = Object.keys(localStorage).filter(
          (k) => k.includes('auth-token') || k.includes('sb-')
        );
        for (const key of keys) {
          try {
            const data = JSON.parse(localStorage.getItem(key));
            const email =
              data?.user?.email || data?.currentSession?.user?.email;
            const accessToken = data?.access_token || data?.session?.access_token || data?.currentSession?.access_token;
            if (email) return { email, accessToken };
          } catch (e) {}
        }
        return null;
      },
    });

    const result = results?.[0]?.result;

    if (result && result.email) {
      await chrome.storage.local.set({ tickk_user_email: result.email });
      console.log('[Tickk BG] ⚡ AUTH SYNCED FROM TAB (email):', result.email);
      
      if (result.accessToken) {
        const exResult = await exchangeToken(result.accessToken);
        if (exResult.success && exResult.apiKey) {
          const storageData = {
            tickk_api_key: exResult.apiKey,
            tickk_auth_timestamp: Date.now(),
          };
          if (exResult.userId) storageData.tickk_user_id = exResult.userId;
          await chrome.storage.local.set(storageData);
          console.log('[Tickk BG] ⚡ API KEY SYNCED FROM TAB');
        }
      }
    } else {
      // Auth might not be in localStorage yet — retry after 1 second
      console.log(
        `[Tickk BG] No auth found, retrying (${attempt + 1}/5)...`
      );
      setTimeout(() => extractAuthFromTab(tabId, attempt + 1), 1000);
    }
  } catch (err) {
    console.error('[Tickk BG] Script injection failed:', err);
  }
}
