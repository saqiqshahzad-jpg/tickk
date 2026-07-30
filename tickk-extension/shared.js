// ═══════════════════════════════════════════════════════════════
// Tickk Extension — Shared Utilities
// Common API calls & helpers used by both content scripts
// ═══════════════════════════════════════════════════════════════

const TICKK_API_BASE = 'https://tickk-backend.onrender.com';

/**
 * Retrieve stored auth credentials from chrome.storage.local
 * @returns {Promise<{apiKey: string|null, userId: string|null}>}
 */
async function getStoredAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['tickk_api_key', 'tickk_user_id', 'tickk_user_email', 'tickk_opens_count'], (result) => {
      resolve({
        apiKey: result.tickk_api_key || null,
        userId: result.tickk_user_id || null,
        email: result.tickk_user_email || 'Not Connected',
        opensCount: result.tickk_opens_count || 0
      });
    });
  });
}

/**
 * Check if user is authenticated
 * @returns {Promise<boolean>}
 */
async function isAuthenticated() {
  const { apiKey } = await getStoredAuth();
  return !!apiKey;
}

/**
 * Create a new tracker via the backend API
 * @param {string} recipient - Email recipient address
 * @param {string} subject - Email subject line
 * @returns {Promise<{success: boolean, trackerId?: string, error?: string}>}
 */
async function createTracker(recipient, subject) {
  const { apiKey } = await getStoredAuth();
  if (!apiKey) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const response = await fetch(`${TICKK_API_BASE}/api/track/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ recipient, subject }),
    });

    const data = await response.json();
    return data;
  } catch (err) {
    console.error('[Tickk] Tracker creation failed:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Build tracking pixel URL from tracker ID
 * @param {string} trackerId - UUID of the tracker
 * @returns {string} Full pixel URL
 */
function getPixelUrl(trackerId) {
  return `${TICKK_API_BASE}/api/track/${trackerId}/pixel.png`;
}

/**
 * Build the tracking pixel <img> element
 * @param {string} trackerId - UUID of the tracker
 * @returns {HTMLImageElement}
 */
function createPixelElement(trackerId) {
  const img = document.createElement('img');
  img.src = getPixelUrl(trackerId);
  img.width = 1;
  img.height = 1;
  img.style.cssText =
    'display:none!important;width:1px!important;height:1px!important;opacity:0!important;position:absolute!important;';
  img.alt = '';
  img.setAttribute('data-tickk-pixel', 'true');
  return img;
}

/**
 * Fetch user info (credits + recent emails) from backend
 * @returns {Promise<{success: boolean, credits?: number, recent_emails?: Array}>}
 */
async function getUserInfo() {
  const { apiKey } = await getStoredAuth();
  if (!apiKey) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const response = await fetch(`${TICKK_API_BASE}/api/extension/user-info`, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });

    return await response.json();
  } catch (err) {
    console.error('[Tickk] User info fetch failed:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Check if tracking is enabled (user preference)
 * @returns {Promise<boolean>}
 */
async function isTrackingEnabled() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['tickk_tracking_enabled'], (result) => {
      // Default to enabled
      resolve(result.tickk_tracking_enabled !== false);
    });
  });
}

/**
 * Create the Tickk action button element for compose toolbars
 * @param {Function} onClick - Click handler
 * @returns {HTMLButtonElement}
 */
function createTickkButton(onClick) {
  const btn = document.createElement('button');
  btn.className = 'tickk-action-btn';
  btn.title = 'Tickk — Email Tracking Active';
  btn.setAttribute('data-tickk-btn', 'true');
  btn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"/>
    </svg>
  `;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onClick) onClick(btn);
  });
  return btn;
}

/**
 * Show a small toast notification in the page
 * @param {string} message - Notification text
 * @param {'success'|'error'|'info'} type - Toast type
 */
function showTickkToast(message, type = 'info') {
  // Remove existing toast if any
  const existing = document.querySelector('.tickk-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `tickk-toast tickk-toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('tickk-toast--visible');
  });

  // Auto dismiss after 3s
  setTimeout(() => {
    toast.classList.remove('tickk-toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * Create the Top-Right Header Widget (Pill)
 * @param {boolean} authed - Is the user authenticated
 * @param {Function} onClick - Click handler to open floating card
 * @returns {HTMLDivElement}
 */
function createHeaderWidget(authed, onClick) {
  const widget = document.createElement('div');
  widget.className = 'tickk-header-widget';
  if (authed) {
    widget.innerHTML = `
      <div class="tickk-status-dot"></div>
      <span>Tickk Active</span>
    `;
  } else {
    widget.innerHTML = `
      <div class="tickk-status-dot" style="background-color: #ef4444; box-shadow: 0 0 6px #ef4444;"></div>
      <span>Connect Account</span>
    `;
  }
  
  widget.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onClick) onClick(widget, e);
  });
  return widget;
}

/**
 * Create the Floating Dashboard Card attached to the Header Widget
 * @param {string} email - Connected user email
 * @param {number} credits - User's current credits
 * @param {number} opensCount - User's quick opens count
 * @returns {HTMLDivElement}
 */
function createFloatingCard(email, credits, opensCount) {
  const card = document.createElement('div');
  card.className = 'tickk-floating-card';
  card.innerHTML = `
    <div class="tickk-card-header">
      <div class="tickk-card-title">
        <span class="tickk-card-logo">✓✓</span> 
        <span style="font-size: 13px; font-weight: 500; color: #9ca3af; margin-left: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;" title="${email}">${email}</span>
      </div>
    </div>
    <div class="tickk-card-stat" style="background: transparent; border: 1px solid #374151; justify-content: center; margin-bottom: 12px;">
      <div class="tickk-status-dot" style="margin-right: 8px;"></div>
      <span style="font-weight: 500; color: #10b981;">Tracking Active</span>
    </div>
    <div class="tickk-card-stat">
      <span>Quick Opens</span>
      <span class="tickk-stat-value" style="color: #60a5fa;">${opensCount}</span>
    </div>
    <div class="tickk-card-stat">
      <span>Credits</span>
      <span class="tickk-stat-value">${credits}</span>
    </div>
    <div class="tickk-card-footer">
      <button class="tickk-btn" id="tickk-open-dashboard-btn">Open Full Dashboard ↗</button>
    </div>
  `;
  
  // Prevent clicks inside card from propagating and closing it
  card.addEventListener('click', (e) => e.stopPropagation());

  card.querySelector('#tickk-open-dashboard-btn').addEventListener('click', () => {
    window.open('https://tickk.online/dashboard', '_blank');
  });

  return card;
}

/**
 * Create the Compose Pop-up Menu for toggling tracking settings
 * @param {Object} state - Initial state { opens: boolean, clicks: boolean }
 * @param {Function} onChange - Callback when state changes
 * @returns {HTMLDivElement}
 */
function createComposePopup(state, onChange) {
  const popup = document.createElement('div');
  popup.className = 'tickk-compose-popup';
  
  popup.innerHTML = `
    <div class="tickk-popup-item">
      <span>Track Opens</span>
      <label class="tickk-toggle">
        <input type="checkbox" id="tickk-toggle-opens" ${state.opens ? 'checked' : ''}>
        <span class="tickk-toggle-slider"></span>
      </label>
    </div>
    <div class="tickk-popup-item">
      <span>Track Clicks</span>
      <label class="tickk-toggle">
        <input type="checkbox" id="tickk-toggle-clicks" ${state.clicks ? 'checked' : ''}>
        <span class="tickk-toggle-slider"></span>
      </label>
    </div>
  `;

  // Prevent closing when interacting with popup
  popup.addEventListener('click', (e) => e.stopPropagation());

  const opensToggle = popup.querySelector('#tickk-toggle-opens');
  const clicksToggle = popup.querySelector('#tickk-toggle-clicks');

  opensToggle.addEventListener('change', () => {
    state.opens = opensToggle.checked;
    onChange(state);
  });

  clicksToggle.addEventListener('change', () => {
    state.clicks = clicksToggle.checked;
    onChange(state);
  });

  return popup;
}
