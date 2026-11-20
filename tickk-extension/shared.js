// ═══════════════════════════════════════════════════════════════
// Tickk Extension — Shared Utilities
// Common API calls & helpers used by both content scripts
// ═══════════════════════════════════════════════════════════════

const TICKK_API_BASE = 'https://tickk-k5zw.onrender.com';

// ═══════════════════════════════════════════════════════════════
// Tickk High-Visibility Colored Console Logger
// ═══════════════════════════════════════════════════════════════
const TickkLog = {
  dispatch: (recipient, subject, trackerId) => {
    console.log(
      '%c 📤 TICKK %c EMAIL DISPATCHED %c To: %c' + recipient + ' %c| Subject: "%c' + subject + '%c" | ID: %c' + trackerId,
      'background: #2563eb; color: #ffffff; font-weight: bold; border-radius: 4px 0 0 4px; padding: 2px 6px; font-size: 11px;',
      'background: #059669; color: #ffffff; font-weight: bold; border-radius: 0 4px 4px 0; padding: 2px 6px; font-size: 11px;',
      'color: #94a3b8; font-weight: normal;',
      'color: #38bdf8; font-weight: bold;',
      'color: #94a3b8; font-weight: normal;',
      'color: #facc15; font-weight: bold;',
      'color: #94a3b8; font-weight: normal;',
      'color: #a78bfa; font-weight: bold;'
    );
  },
  pixelInjected: (trackerId) => {
    console.log(
      '%c 🎯 TICKK %c PIXEL INJECTED %c Tracker ID: %c' + trackerId,
      'background: #7c3aed; color: #ffffff; font-weight: bold; border-radius: 4px 0 0 4px; padding: 2px 6px; font-size: 11px;',
      'background: #18181b; color: #a78bfa; font-weight: bold; border-radius: 0 4px 4px 0; padding: 2px 6px; font-size: 11px; border: 1px solid #4c1d95;',
      'color: #94a3b8;',
      'color: #c4b5fd; font-weight: bold;'
    );
  },
  open: (trackerId, openCount, recipient, subject) => {
    console.log(
      '%c 🔔 TICKK %c OPEN DETECTED [Count: #' + openCount + '] %c To: %c' + (recipient || 'N/A') + ' %c| "%c' + (subject || 'N/A') + '%c" | ID: ' + trackerId,
      'background: #16a34a; color: #ffffff; font-weight: bold; border-radius: 4px 0 0 4px; padding: 2px 6px; font-size: 11px;',
      'background: #15803d; color: #ffffff; font-weight: bold; border-radius: 0 4px 4px 0; padding: 2px 6px; font-size: 11px;',
      'color: #94a3b8;',
      'color: #38bdf8; font-weight: bold;',
      'color: #94a3b8;',
      'color: #facc15; font-weight: bold;',
      'color: #94a3b8;'
    );
  },
  success: (action, detail = '') => {
    console.log(
      '%c ✓ TICKK %c ' + action + ' %c ' + detail,
      'background: #10b981; color: #ffffff; font-weight: bold; border-radius: 4px 0 0 4px; padding: 2px 6px; font-size: 11px;',
      'background: #18181b; color: #34d399; font-weight: bold; border-radius: 0 4px 4px 0; padding: 2px 6px; font-size: 11px; border: 1px solid #064e3b;',
      'color: #a7f3d0;'
    );
  },
  error: (action, err = '') => {
    console.error(
      '%c ✕ TICKK %c ERROR: ' + action + ' %c ' + (err?.message || err || ''),
      'background: #dc2626; color: #ffffff; font-weight: bold; border-radius: 4px 0 0 4px; padding: 2px 6px; font-size: 11px;',
      'background: #18181b; color: #f87171; font-weight: bold; border-radius: 0 4px 4px 0; padding: 2px 6px; font-size: 11px; border: 1px solid #7f1d1d;',
      'color: #fca5a5;'
    );
  },
  info: (action, detail = '') => {
    console.log(
      '%c ⚡ TICKK %c ' + action + ' %c ' + detail,
      'background: #3b82f6; color: #ffffff; font-weight: bold; border-radius: 4px 0 0 4px; padding: 2px 6px; font-size: 11px;',
      'background: #18181b; color: #60a5fa; font-weight: bold; border-radius: 0 4px 4px 0; padding: 2px 6px; font-size: 11px; border: 1px solid #1e3a8a;',
      'color: #bfdbfe;'
    );
  }
};

// ═══════════════════════════════════════════════════════════════
// Safe Storage Wrapper (Guards against invalid extension context)
// ═══════════════════════════════════════════════════════════════
const SafeStorage = {
  get: (keys) => {
    return new Promise((resolve) => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(keys, (res) => {
            if (chrome.runtime?.lastError) {
              resolve({});
            } else {
              resolve(res || {});
            }
          });
        } else {
          resolve({});
        }
      } catch (e) {
        resolve({});
      }
    });
  },
  set: (data) => {
    return new Promise((resolve) => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set(data, () => {
            if (chrome.runtime?.lastError) {}
            resolve();
          });
        } else {
          resolve();
        }
      } catch (e) {
        resolve();
      }
    });
  }
};

/**
 * Fallback to extract current logged-in user email from Gmail/Outlook DOM
 */
function extractUserEmailFromDOM() {
  try {
    // 1. From document.title (e.g., "Inbox (1,524) - saqiqshahzad@gmail.com - Gmail")
    const titleMatch = document.title.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (titleMatch && titleMatch[1]) {
      return titleMatch[1].trim();
    }
    // 2. From Gmail account button / profile hovercard
    const accountEl = document.querySelector('[aria-label*="@"], [data-hovercard-id*="@"], a[href*="SignOutOptions"]');
    if (accountEl) {
      const match = (accountEl.getAttribute('aria-label') || accountEl.getAttribute('data-hovercard-id') || accountEl.textContent || '').match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
  } catch (e) {}
  return null;
}

/**
 * Retrieve stored auth credentials from chrome.storage.local
 * @returns {Promise<{apiKey: string|null, userId: string|null, email: string}>}
 */
async function getStoredAuth() {
  const fallbackKey = 'tk_live_6fb4826a011b569287f92a7b6c8820eca9c25658e4819419';
  const fallbackEmail = extractUserEmailFromDOM() || 'saqiqshahzad@gmail.com';

  try {
    const result = await SafeStorage.get([
      'tickk_user',
      'tickk_opens_count',
      'tickk_api_key',
      'tickk_user_email',
      'userEmail',
      'email'
    ]);
    const user = result.tickk_user;
    let apiKey = result.tickk_api_key || (user ? user.token : null);
    let email = result.tickk_user_email || result.userEmail || result.email || (user ? user.email : null);

    if (!email) {
      email = extractUserEmailFromDOM() || fallbackEmail;
    }

    if (!apiKey) {
      apiKey = fallbackKey;
      SafeStorage.set({ tickk_api_key: apiKey });
    }

    if (email && email !== result.tickk_user_email) {
      SafeStorage.set({ tickk_user_email: email });
    }

    return {
      apiKey: apiKey || fallbackKey,
      userId: user ? user.email : email,
      email: email || fallbackEmail,
      opensCount: result.tickk_opens_count || 0
    };
  } catch (err) {
    return {
      apiKey: fallbackKey,
      userId: fallbackEmail,
      email: fallbackEmail,
      opensCount: 0
    };
  }
}

/**
 * Check if user is authenticated
 * @returns {Promise<boolean>}
 */
async function isAuthenticated() {
  const { apiKey, email } = await getStoredAuth();
  return !!(apiKey || email);
}

/**
 * Create a new tracker via the backend API
 * @param {string} recipient - Email recipient address
 * @param {string} subject - Email subject line
 * @returns {Promise<{success: boolean, trackerId?: string, error?: string}>}
 */
async function createTracker(recipient, subject, trackerId = null) {
  TickkLog.info('Tracker Request Initiated', `Recipient: ${recipient} | Subject: "${subject}" | ID: ${trackerId || 'auto-generating'}`);
  try {
    const { apiKey, email } = await getStoredAuth();
    TickkLog.info('Auth Credentials', `API Key: ${apiKey ? (apiKey.slice(0, 12) + '...') : 'none'} | User Email: ${email || 'none'}`);

    const headers = {
      'Content-Type': 'application/json',
    };
    if (apiKey) headers['x-api-key'] = apiKey;
    if (email) headers['x-user-email'] = email;

    const payload = {
      recipient,
      subject,
      email: email || undefined
    };
    if (trackerId) {
      payload.id = trackerId;
      payload.tracker_id = trackerId;
    }

    const response = await fetch(`${TICKK_API_BASE}/api/track/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    const finalTrackerId = data.tracker_id || data.trackerId || trackerId;

    if (data.success !== false) {
      TickkLog.success('Tracker Registered On Server', `ID: ${finalTrackerId} | Status: Sent | Recipient: ${recipient}`);
    } else {
      TickkLog.error('Server Returned Notice', data.error);
    }

    if (data.apiKey && !apiKey) {
      SafeStorage.set({ tickk_api_key: data.apiKey }).then(() => {
        TickkLog.success('Storage Updated', `Auto-synced API Key to extension storage`);
      });
    }

    return {
      success: data.success !== false,
      trackerId: finalTrackerId,
      tracker_id: finalTrackerId,
      error: data.error
    };
  } catch (err) {
    TickkLog.error('Tracker Network Call Failed', err);
    return { success: false, trackerId: trackerId, tracker_id: trackerId, error: err.message };
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
  try {
    const result = await SafeStorage.get(['tickk_tracking_enabled']);
    return result.tickk_tracking_enabled !== false;
  } catch (e) {
    return true;
  }
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
