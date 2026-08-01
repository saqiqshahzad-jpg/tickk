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
    chrome.storage.local.get(['tickk_user', 'tickk_opens_count', 'tickk_api_key', 'tickk_user_email'], (result) => {
      const user = result.tickk_user;
      resolve({
        apiKey: result.tickk_api_key || (user ? user.token : null),
        userId: user ? user.email : null,
        email: result.tickk_user_email || (user ? user.email : 'Not Connected'),
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
  btn.id = 'tickk-compose-btn';
  btn.title = 'Tickk — Email Tracking Active';
  btn.setAttribute('data-tickk-btn', 'true');
  btn.innerHTML = `<span class="tickk-btn-icon">✓✓</span>`;
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
  widget.id = 'tickk-header-badge';
  
  if (authed) {
    widget.innerHTML = `
      <div class="tickk-status-dot"></div>
      <span class="tickk-badge-icon">✓✓</span>
      <span class="tickk-badge-label">Active</span>
    `;
  } else {
    widget.innerHTML = `
      <div class="tickk-status-dot" style="background-color: #52525b; box-shadow: none; animation: none;"></div>
      <span class="tickk-badge-icon" style="color: #52525b;">✓✓</span>
      <span class="tickk-badge-label">Connect Account</span>
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
        <span class="tickk-card-email" title="${email}">${email}</span>
      </div>
    </div>
    <div class="tickk-card-stat tickk-card-stat--status">
      <div class="tickk-status-dot"></div>
      <span class="tickk-stat-value">Tracking Active</span>
    </div>
    <div class="tickk-card-stat">
      <span>Quick Opens</span>
      <span class="tickk-stat-value tickk-stat-value--blue">${opensCount}</span>
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
    <div class="tickk-stealth-hint-badge" title="Recipients will not see anything.">
      <div class="tickk-stealth-dot"></div>
      <span>100% Invisible / Silent</span>
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

/**
 * Create the inline toolbar container for Compose (Toggle + Button)
 * @param {Object} state - tracking state
 * @param {Function} onToggle - callback on toggle change
 * @param {Function} onBtnClick - callback on button click
 */
function createToolbarContainer(state, onToggle, onBtnClick) {
  const host = document.createElement('div');
  host.className = 'tickk-toolbar-host';
  host.setAttribute('data-tickk-btn', 'true');
  host.style.all = 'initial';
  host.style.display = 'inline-flex';
  host.style.alignItems = 'center';
  host.style.marginLeft = '4px';

  const shadowRoot = host.attachShadow({ mode: 'open' });
  
  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; font-family: Inter, sans-serif; }
    
    .tickk-toolbar-container {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 4px 0 8px;
      border-radius: 9999px;
      border-left: 1px solid #27272a; /* Zinc 800 */
    }

    .tickk-toolbar-toggle-label {
      font-size: 11px;
      color: #71717a; /* Zinc 500 */
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }

    /* Toggle Switch */
    .tickk-toggle {
      position: relative;
      display: inline-block;
      width: 28px;
      height: 16px;
    }
    .tickk-toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .tickk-toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: #52525b; /* Zinc 600 */
      transition: all 0.15s ease;
      border-radius: 16px;
    }
    .tickk-toggle-slider:before {
      position: absolute;
      content: "";
      height: 12px;
      width: 12px;
      left: 2px;
      bottom: 2px;
      background-color: #ffffff;
      transition: all 0.15s ease;
      border-radius: 50%;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }
    .tickk-toggle input:checked + .tickk-toggle-slider {
      background-color: #10b981; /* Emerald 500 */
    }
    .tickk-toggle input:checked + .tickk-toggle-slider:before {
      transform: translateX(12px);
    }

    .tickk-action-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      color: #10b981; /* Emerald 500 */
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      margin: 0 2px;
      padding: 0;
      font-weight: 700;
      font-size: 13px;
      line-height: 1;
      letter-spacing: -0.5px;
    }
    .tickk-action-btn:hover {
      background: rgba(16, 185, 129, 0.08);
      border-color: rgba(16, 185, 129, 0.2);
    }
    .tickk-action-btn:active {
      transform: scale(0.92);
      background: rgba(16, 185, 129, 0.12);
    }
    .tickk-action-btn--inactive {
      color: #71717a; /* Zinc 500 */
      opacity: 0.5;
    }
    .tickk-action-btn--inactive:hover {
      background: rgba(113, 113, 122, 0.08);
      border-color: rgba(113, 113, 122, 0.2);
      color: #a1a1aa; /* Zinc 400 */
    }
  `;
  shadowRoot.appendChild(style);

  const container = document.createElement('div');
  container.className = 'tickk-toolbar-container';

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'tickk-toolbar-toggle-label';
  toggleLabel.innerHTML = `
    <span>Track</span>
    <div class="tickk-toggle">
      <input type="checkbox" id="tickk-inline-toggle" ${state.opens ? 'checked' : ''}>
      <span class="tickk-toggle-slider"></span>
    </div>
  `;
  
  const toggleInput = toggleLabel.querySelector('input');
  toggleInput.addEventListener('change', (e) => {
    state.opens = e.target.checked;
    onToggle(state);
  });

  const btn = document.createElement('button');
  btn.className = 'tickk-action-btn' + (!state.opens ? ' tickk-action-btn--inactive' : '');
  btn.id = 'tickk-compose-btn';
  btn.title = 'Tickk Options';
  btn.innerHTML = `<span class="tickk-btn-icon">✓✓</span>`;
  
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onBtnClick) onBtnClick(host, e); // Pass host instead of inner btn
  });
  
  container.appendChild(toggleLabel);
  container.appendChild(btn);
  shadowRoot.appendChild(container);

  return { container: host, btn: host, toggleInput };
}
