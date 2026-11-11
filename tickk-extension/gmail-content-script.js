console.log('🔥 TICKK GMAIL SCRIPT LOADED SUCCESSFULLY!');

// ═══════════════════════════════════════════════════════════════
// Auto-capture email from Onboarding redirect URL
// ═══════════════════════════════════════════════════════════════
(function captureTickkAuth() {
  const urlParams = new URLSearchParams(window.location.search || window.location.hash.split('?')[1]);
  const emailFromUrl = urlParams.get('tickk_email');
  if (emailFromUrl) {
    // Save user email to extension storage
    chrome.storage.local.set({ tickk_user_email: decodeURIComponent(emailFromUrl) }, () => {
      console.log('⚡ Tickk Auth Caught From Redirect URL:', emailFromUrl);
      // URL clean karo taake address bar saaf ho jaye
      window.history.replaceState({}, document.title, window.location.pathname);
      // location.reload();
    });
  }
})();

// ═══════════════════════════════════════════════════════════════
// Tickk Extension — Gmail Content Script
// Injects tracking pixel + action icon into Gmail compose window
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const COMPOSE_BODY_SELECTOR = 'div[aria-label="Message Body"]';
  const SEND_BUTTON_SELECTOR = 'div[aria-label*="Send"], [data-tooltip*="Send"], .aoO, .T-I-atl';
  const COMPOSE_TOOLBAR_SELECTOR = 'div[role="dialog"] .gU.Up, .btC';
  const TO_FIELD_SELECTOR = 'input[aria-label="To recipients"]';
  const SUBJECT_FIELD_SELECTOR = 'input[name="subjectbox"]';
  const PROCESSED_ATTR = 'data-tickk-processed';

  let trackingEnabledGlobal = true;
  let isInitialized = false;

  // ─── Initialize ───
  async function init() {
    try {
      if (isInitialized) return;
      isInitialized = true;

      const authed = await isAuthenticated();
      
      // Inject header widget regardless of auth state
      injectTopRightHeaderIcon();
      
      // ALWAYS observe compose windows (so the UI draws even if not authenticated)
      trackingEnabledGlobal = await isTrackingEnabled();
      observeComposeWindows();
      console.log('[Tickk Gmail] Content script initialized.');

      // Listen for background token syncs to update header dynamically without reloading
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && (changes.tickk_user || changes.tickk_api_key || changes.tickk_user_email || changes.tickk_session)) {
          const oldTrigger = document.querySelector('#tickk-header-trigger');
          if (oldTrigger) oldTrigger.remove();
          injectTopRightHeaderIcon();
          
          // Re-render modal if open
          const modal = document.querySelector('#tickk-mini-popup');
          if (modal && modal.style.display !== 'none') {
             modal.remove();
             toggleMiniDashboard(document.querySelector('#tickk-header-trigger'));
          }
        }
      });
    } catch (e) {
      console.error('TICKK ERROR:', e);
    }
  }

  // ─── Robust DOM Polling for Compose Windows ───
  function observeComposeWindows() {
    let scanTimeout = null;

    const checkForComposeWindows = () => {
      const sendButtonTables = document.querySelectorAll('.gU.Up');
      
      sendButtonTables.forEach((table) => {
        const composeContainer = table.closest('[role="dialog"]') || table.closest('form') || table.parentElement;
        if (!composeContainer) return;
        
        // Use the compose body for metadata attributes
        const composeBody = composeContainer.querySelector(COMPOSE_BODY_SELECTOR);
        if (!composeBody) return;

        if (composeBody.getAttribute(PROCESSED_ATTR)) return;
        composeBody.setAttribute(PROCESSED_ATTR, 'true');
        
        handleComposeWindow(composeBody, composeContainer);
      });
    };

    const observer = new MutationObserver(() => {
      if (scanTimeout) cancelAnimationFrame(scanTimeout);
      scanTimeout = requestAnimationFrame(() => {
        checkForComposeWindows();
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    
    // Also run once on load
    checkForComposeWindows();
  }

  // ─── Handle Individual Compose Window ───
  function handleComposeWindow(composeBody, providedContainer) {
    console.log('[Tickk Gmail] Compose window detected.');

    // Find the compose container (walk up to the compose root)
    const composeContainer = providedContainer || composeBody.closest('.M9');
    if (!composeContainer) {
      console.warn('[Tickk Gmail] Could not find compose container.');
      return;
    }

    // Inject Tickk button into toolbar
    injectToolbarButton(composeContainer, composeBody);

    // Intercept Send button
    interceptSend(composeContainer, composeBody);
  }

  // ─── Header Injection ───
  function injectTopRightHeaderIcon() {
    if (document.querySelector('#tickk-header-trigger')) return;

    // Target Gmail Top Header Right Container
    const gbHeader = document.querySelector('#gb');
    if (!gbHeader) return;

    const trigger = document.createElement('div');
    trigger.id = 'tickk-header-trigger';
    // Styling is handled entirely by content-style.css
    // Safe image URL getter
    const iconUrl = (typeof chrome !== 'undefined' && chrome.runtime?.getURL) 
      ? chrome.runtime.getURL('icons/icon48.png') 
      : '';
    
    if (iconUrl) {
      trigger.innerHTML = `<img src="${iconUrl}" style="width: 22px; height: 22px; display: block;" />`;
    }
    
    // Modal Toggle
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMiniDashboard(trigger);
    });

    // Insert directly to #gb, but protect it with a MutationObserver
    gbHeader.appendChild(trigger);

    // Watch for Gmail's SPA wiping the element and re-insert immediately
    if (!window.tickkHeaderObserver) {
      window.tickkHeaderObserver = new MutationObserver(() => {
        if (!document.querySelector('#tickk-header-trigger')) {
          const currentGb = document.querySelector('#gb');
          if (currentGb) currentGb.appendChild(trigger);
        }
      });
      window.tickkHeaderObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  function toggleMiniDashboard(trigger) {
    let modal = document.querySelector('#tickk-mini-popup');
    if (modal) {
      modal.style.display = modal.style.display === 'none' ? 'block' : 'none';
      return;
    }
    
    // Build Modal Container
    modal = document.createElement('div');
    modal.id = 'tickk-mini-popup';
    
    // Styling is completely handled by content-style.css to prevent Gmail overrides
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
      console.warn("Tickk Extension: Context invalidated. Please reload the page.");
      modal.innerHTML = `
        <div style="padding: 16px; text-align: center; background: #18181b; border: 1px solid #3f3f46; border-radius: 12px; font-family: 'Inter', sans-serif;">
          <p style="margin: 0 0 8px 0; color: #ef4444; font-weight: 600;">Update Required</p>
          <p style="margin: 0 0 16px 0; font-size: 13px; color: #a1a1aa;">Tickk Extension was updated in the background. Please reload the page to continue.</p>
          <button onclick="window.location.reload()" style="background: #10b981; color: #ffffff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; width: 100%;">Reload Gmail</button>
        </div>
      `;
      document.body.appendChild(modal);
      
      // Close modal when clicking outside
      const closeHandler = (e) => {
        if (!modal.contains(e.target) && !trigger.contains(e.target)) {
          modal.style.display = 'none';
          document.removeEventListener('click', closeHandler);
        }
      };
      setTimeout(() => document.addEventListener('click', closeHandler), 0);
      return;
    }

    try {
      chrome.storage.local.get(['tickk_user', 'tickk_user_email'], (res) => {
        const user = res.tickk_user;
        // Prefer tickk_user_email (set by sync bridge) over tickk_user object
        const syncedEmail = res.tickk_user_email;
        const isLoggedIn = syncedEmail ? true : (user && user.connected);
        const email = syncedEmail || (user ? user.email : null) || 'Logged Out';
        
        if (isLoggedIn) {
          modal.innerHTML = `
            <!-- HEADER SECTION -->
            <div class="tickk-header">
              <div class="tickk-brand">
                <span class="tickk-logo-dot">t</span>
                <span class="tickk-email">${email}</span>
              </div>
              <div class="tickk-status-badge">
                <span class="tickk-pulse"></span>
                <span>ACTIVE</span>
              </div>
            </div>
            <!-- STATS DASHBOARD GRID -->
            <div class="tickk-stats-container">
              <div class="tickk-stat-box">
                <div class="tickk-stat-number">24</div>
                <div class="tickk-stat-label">TRACKED TODAY</div>
              </div>
              <div class="tickk-stat-box">
                <div class="tickk-stat-number">85<span class="tickk-unit">%</span></div>
                <div class="tickk-stat-label">OPEN RATE</div>
              </div>
            </div>
            <!-- PRIMARY CTA BUTTON -->
            <button id="tickk-dash-btn" class="tickk-primary-btn">
              <span>Open Full Dashboard</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </button>
          `;
        } else {
          modal.innerHTML = `
            <!-- HEADER SECTION -->
            <div class="tickk-header">
              <div class="tickk-brand">
                <span class="tickk-logo-dot" style="background: #52525b !important;">t</span>
                <span class="tickk-email">Logged Out</span>
              </div>
              <div class="tickk-status-badge tickk-status-badge-offline">
                <span class="tickk-pulse tickk-pulse-offline"></span>
                <span>OFFLINE</span>
              </div>
            </div>
            <div class="tickk-auth-prompt">
              <p>🔴 Connection Required</p>
              <span>Link your account to enable tracking</span>
            </div>
            <!-- PRIMARY CTA BUTTON -->
            <button id="tickk-dash-btn" class="tickk-main-btn tickk-main-btn-connect">
              <span>Connect Account ⚡</span>
            </button>
          `;
        }
        
        document.body.appendChild(modal);
        
        document.getElementById('tickk-dash-btn').onclick = () => {
          const targetUrl = isLoggedIn ? 'https://tickk.online/dashboard' : 'https://tickk.online/onboarding';
          window.open(targetUrl, '_blank');
          modal.style.display = 'none';
        };

        // Close modal when clicking outside
        const closeHandler = (e) => {
          if (!modal.contains(e.target) && !trigger.contains(e.target)) {
            modal.style.display = 'none';
            document.removeEventListener('click', closeHandler);
          }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
      });
    } catch (err) {
      console.warn("Tickk Extension: Storage access failed.", err);
    }
  }
  // Run on interval / observer to ensure Gmail SPA doesn't wipe it
  setInterval(injectTopRightHeaderIcon, 1000);

  // ─── Inject Tickk Toggle Button in Compose Toolbar ───
  function injectToolbarButton(composeContainer, composeBody) {
    let toolbar = composeContainer.querySelector(COMPOSE_TOOLBAR_SELECTOR);
    if (!toolbar) {
      console.warn('[Tickk Gmail] Toolbar not found.');
      return;
    }

    // Don't inject if already present
    if (toolbar.querySelector('[data-tickk-btn]')) return;

    const trackingState = { opens: trackingEnabledGlobal, clicks: false };

    const { container, btn } = createToolbarContainer(trackingState, (newState) => {
      composeBody.setAttribute('data-tickk-tracking', newState.opens ? 'enabled' : 'disabled');
      composeBody.setAttribute('data-tickk-clicks', newState.clicks ? 'enabled' : 'disabled');
      if (newState.opens) {
        btn.classList.remove('tickk-action-btn--inactive');
      } else {
        btn.classList.add('tickk-action-btn--inactive');
      }
    }, (btnElement) => {
      let popup = container.querySelector('.tickk-compose-popup');
      if (!popup) {
        popup = createComposePopup(trackingState, (newState) => {
          composeBody.setAttribute('data-tickk-tracking', newState.opens ? 'enabled' : 'disabled');
          composeBody.setAttribute('data-tickk-clicks', newState.clicks ? 'enabled' : 'disabled');
          
          if (newState.opens) {
            btnElement.classList.remove('tickk-action-btn--inactive');
          } else {
            btnElement.classList.add('tickk-action-btn--inactive');
          }
          
          const inlineToggle = container.querySelector('#tickk-inline-toggle');
          if (inlineToggle) inlineToggle.checked = newState.opens;
        });
        container.style.position = 'relative';
        container.appendChild(popup);
      }
      
      popup.classList.toggle('active');

      const closeHandler = (clickEvent) => {
        if (!popup.contains(clickEvent.target) && !btnElement.contains(clickEvent.target)) {
          popup.classList.remove('active');
          document.removeEventListener('click', closeHandler);
        }
      };
      setTimeout(() => document.addEventListener('click', closeHandler), 0);
    });

    // Set initial state based on global toggle
    if (!trackingEnabledGlobal) {
      composeBody.setAttribute('data-tickk-tracking', 'disabled');
    } else {
      composeBody.setAttribute('data-tickk-tracking', 'enabled');
    }

    // Insert the container near the send button
    toolbar.appendChild(container);
    
    injectStealthHint(composeContainer);

    console.log('[Tickk Gmail] Action button + popup injected.');
  }

  // ─── Inject Stealth Reassurance Hint ───
  function injectStealthHint(composeContainer) {
    if (composeContainer.querySelector('.tickk-stealth-hint')) return;

    const hint = document.createElement('div');
    hint.className = 'tickk-stealth-hint';
    hint.textContent = "🤫 Silent Proxy Active — Recipient won't see a thing.";

    const toolbar = composeContainer.querySelector(COMPOSE_TOOLBAR_SELECTOR);
    if (toolbar && toolbar.parentElement) {
      toolbar.parentElement.insertBefore(hint, toolbar.parentElement.firstChild);
    }
  }

  // ─── Intercept Send Button Click (The Ultimate Fallback) ───
  function interceptSend(composeContainer, composeBody) {
    composeContainer.addEventListener(
      'click',
      async (e) => {
        let isSendButton = false;
        let clickedElement = e.target;
        
        // Method 1: Check by role and text content (The most reliable for modern Gmail)
        const roleButton = clickedElement.closest('[role="button"]');
        if (roleButton) {
          const text = roleButton.innerText || roleButton.textContent || "";
          // Checks if the button says "Send" (case-insensitive)
          if (text.trim().toLowerCase() === "send") {
            isSendButton = true;
            clickedElement = roleButton; // Treat the role container as the main button
          }
        }

        // Method 2: Fallback to the classic selector just in case
        if (!isSendButton) {
          const classicSend = clickedElement.closest('.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3, div[data-tooltip^="Send"], div[aria-label^="Send"]');
          if (classicSend) {
             isSendButton = true;
             clickedElement = classicSend;
          }
        }

        console.log("🔥 [Tickk] SEND BUTTON DETECTED:", isSendButton ? clickedElement : "null");
        
        // If it's still not the send button, let normal click happen
        if (!isSendButton) return;

        // Prevent infinite loops when programmatically clicked or if pixel already injected
        if (clickedElement.classList.contains('tickk-auto-sending') || composeBody.querySelector('[data-tickk-pixel]')) {
          return;
        }

        const trackingState = composeBody.getAttribute('data-tickk-tracking');
        console.log("🔥 [Tickk] TRACKING STATE:", trackingState);
        
        if (trackingState === 'disabled') return;

        e.preventDefault();
        e.stopPropagation();

        try {
          const recipientInput = composeContainer.querySelector('input[name="to"], [name="to"] input, input[peoplekit-id]');
          const subjectInput = composeContainer.querySelector('input[name="subjectbox"]');
          
          // Basic fallback values if inputs aren't immediately readable
          const recipient = recipientInput ? recipientInput.value : "Unknown Recipient";
          const subject = subjectInput ? subjectInput.value : "No Subject";
          
          const result = await createTracker(recipient, subject);

          if (result.success && result.trackerId) {
            const pixel = createPixelElement(result.trackerId);
            composeBody.appendChild(pixel);
            showTickkToast('Email tracking activated ✓', 'success');
          }
        } catch (err) {
          console.error('[Tickk Gmail] Error during send interception:', err);
        }

        // Add a tiny class to prevent infinite loops when we programmatically click it again
        clickedElement.classList.add('tickk-auto-sending');
        
        setTimeout(() => {
          // Temporarily remove our listener or bypass it by dispatching a low-level event if standard click() loops
          const nativeClick = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
          clickedElement.dispatchEvent(nativeClick);
        }, 100);
      },
      true 
    );
  }

  // ─── Extract Recipient Email ───
  function extractRecipient(composeContainer) {
    // Try the To input field first
    const toInput = composeContainer.querySelector(TO_FIELD_SELECTOR);
    if (toInput && toInput.value) {
      return toInput.value.trim();
    }

    // Fallback: look for recipient chips/spans
    const recipientChips = composeContainer.querySelectorAll(
      'div[data-hovercard-id], span[email]'
    );
    if (recipientChips.length > 0) {
      const email =
        recipientChips[0].getAttribute('data-hovercard-id') ||
        recipientChips[0].getAttribute('email');
      if (email) return email;
    }

    return null;
  }

  // ─── Extract Subject Line ───
  function extractSubject(composeContainer) {
    const subjectInput = composeContainer.querySelector(SUBJECT_FIELD_SELECTOR);
    if (subjectInput && subjectInput.value) {
      return subjectInput.value.trim();
    }
    return '(No Subject)';
  }

  // ─── Storage Listener for Auth Sync ───
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.tickk_api_key && changes.tickk_api_key.newValue) {
      console.log('[Tickk Gmail] Auth synced from storage! Initializing...');
      init();
    }
  });

  // ─── Boot ───
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
