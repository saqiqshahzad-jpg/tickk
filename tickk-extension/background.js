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
chrome.runtime.onMessageExternal.addListener(
  async (message, sender, sendResponse) => {
    // Validate sender origin
    if (!sender.url || !sender.url.startsWith('https://tickk.online')) {
      sendResponse({ success: false, error: 'Unauthorized origin' });
      return;
    }

    if (message.type === 'AUTH_TOKEN' && message.accessToken) {
      try {
        const result = await exchangeToken(message.accessToken);
        if (result.success) {
          // Save API key + user ID to storage
          await chrome.storage.local.set({
            tickk_api_key: result.apiKey,
            tickk_user_id: result.userId,
            tickk_auth_timestamp: Date.now(),
          });
          console.log('[Tickk BG] Auth synced successfully.');
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: result.error });
        }
      } catch (err) {
        console.error('[Tickk BG] Token exchange failed:', err);
        sendResponse({ success: false, error: err.message });
      }
    }

    // Required to keep the message port open for async response
    return true;
  }
);

// ─── 3. Internal Message Handler (from content scripts & popup) ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
