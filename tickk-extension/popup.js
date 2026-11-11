// ═══════════════════════════════════════════════════════════════
// Tickk Extension — Popup Script
// Handles: auth state, credits display, recent emails, settings
// ═══════════════════════════════════════════════════════════════

const TICKK_API_BASE = 'https://tickk-k5zw.onrender.com';
const TICKK_DASHBOARD_URL = 'https://tickk.online/dashboard';
const TICKK_LOGIN_URL = 'https://tickk.online/onboarding';

// ─── DOM References ───
const loadingState = document.getElementById('loading-state');
const authState = document.getElementById('auth-state');
const dashboardState = document.getElementById('dashboard-state');
const settingsState = document.getElementById('settings-state');

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const dashboardBtn = document.getElementById('dashboard-btn');
const settingsBtn = document.getElementById('settings-btn');
const backBtn = document.getElementById('back-btn');

const creditsBadge = document.getElementById('credits-badge');
const trackingToggle = document.getElementById('tracking-toggle');
const toggleStatus = document.getElementById('toggle-status');
const recentList = document.getElementById('recent-list');

const defaultTrackingToggle = document.getElementById('default-tracking-toggle');
const toastToggle = document.getElementById('toast-toggle');

// ─── State Management ───
function showState(stateEl) {
  [loadingState, authState, dashboardState, settingsState].forEach((s) => {
    s.style.display = 'none';
  });
  stateEl.style.display = 'block';
}

// ─── Initialize Popup ───
async function initPopup() {
  showState(loadingState);

  try {
    const result = await chrome.storage.local.get([
      'tickk_api_key',
      'tickk_user_id',
      'tickk_tracking_enabled',
      'tickk_show_toasts',
    ]);

    if (!result.tickk_api_key) {
      showState(authState);
      return;
    }

    // Fetch user info from backend
    const userInfo = await fetchUserInfo(result.tickk_api_key);

    if (!userInfo.success) {
      // Token might be expired — show auth
      showState(authState);
      return;
    }

    // Populate dashboard
    creditsBadge.textContent = userInfo.credits || 0;

    // Tracking toggle state
    const trackingEnabled = result.tickk_tracking_enabled !== false;
    trackingToggle.checked = trackingEnabled;
    toggleStatus.textContent = trackingEnabled ? 'Active' : 'Paused';
    toggleStatus.className = `toggle-status ${trackingEnabled ? '' : 'inactive'}`;

    // Settings toggles
    defaultTrackingToggle.checked = trackingEnabled;
    toastToggle.checked = result.tickk_show_toasts !== false;

    // Render recent emails
    renderRecentEmails(userInfo.recent_emails || []);

    showState(dashboardState);
  } catch (err) {
    console.error('[Tickk Popup] Init error:', err);
    showState(authState);
  }
}

// ─── Fetch User Info ───
async function fetchUserInfo(apiKey) {
  try {
    const response = await fetch(`${TICKK_API_BASE}/api/extension/user-info`, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });
    return await response.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Render Recent Emails ───
function renderRecentEmails(emails) {
  if (!emails || emails.length === 0) {
    recentList.innerHTML = `
      <div class="empty-state">
        <p>No tracked emails yet</p>
      </div>
    `;
    return;
  }

  recentList.innerHTML = emails
    .map((email) => {
      const status = (email.status || 'sent').toUpperCase();
      const statusClass =
        status === 'OPENED' ? 'status--opened' : 'status--sent';
      const openCount = email.open_count || 0;
      const statusLabel =
        status === 'OPENED' ? `${openCount}× opened` : 'Sent';

      return `
      <div class="recent-item">
        <div class="recent-item-info">
          <div class="recent-item-recipient">${escapeHtml(email.recipient)}</div>
          <div class="recent-item-subject">${escapeHtml(email.subject)}</div>
        </div>
        <span class="recent-item-status ${statusClass}">${statusLabel}</span>
      </div>
    `;
    })
    .join('');
}

// ─── Utility: Escape HTML ───
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// ─── Event Listeners ───

// Login
loginBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: TICKK_LOGIN_URL });
  window.close();
});

// Logout
logoutBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove([
    'tickk_api_key',
    'tickk_user_id',
    'tickk_auth_timestamp',
  ]);
  showState(authState);
});

// Open Dashboard
dashboardBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: TICKK_DASHBOARD_URL });
  window.close();
});

// Tracking Toggle
trackingToggle.addEventListener('change', async () => {
  const enabled = trackingToggle.checked;
  await chrome.storage.local.set({ tickk_tracking_enabled: enabled });
  toggleStatus.textContent = enabled ? 'Active' : 'Paused';
  toggleStatus.className = `toggle-status ${enabled ? '' : 'inactive'}`;
});

// Settings
settingsBtn.addEventListener('click', () => {
  showState(settingsState);
});

backBtn.addEventListener('click', () => {
  showState(dashboardState);
});

// Settings: Default Tracking
defaultTrackingToggle.addEventListener('change', async () => {
  await chrome.storage.local.set({
    tickk_tracking_enabled: defaultTrackingToggle.checked,
  });
  trackingToggle.checked = defaultTrackingToggle.checked;
  toggleStatus.textContent = defaultTrackingToggle.checked ? 'Active' : 'Paused';
  toggleStatus.className = `toggle-status ${defaultTrackingToggle.checked ? '' : 'inactive'}`;
});

// Settings: Toast Notifications
toastToggle.addEventListener('change', async () => {
  await chrome.storage.local.set({
    tickk_show_toasts: toastToggle.checked,
  });
});

// ─── Boot ───
document.addEventListener('DOMContentLoaded', initPopup);
