console.log('🔥 TICKK GMAIL SCRIPT LOADED SUCCESSFULLY!');
// ═══════════════════════════════════════════════════════════════
// Tickk Extension — Gmail Content Script
// Injects tracking pixel + action icon into Gmail compose window
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const COMPOSE_BODY_SELECTOR = 'div[aria-label="Message Body"]';
  const SEND_BUTTON_SELECTOR = 'div[aria-label="Send"]';
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
          const modal = document.querySelector('#tickk-mini-modal');
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
    trigger.innerHTML = `<img src="${chrome.runtime.getURL('icons/icon48.png')}" style="width: 22px; height: 22px; display: block;" />`;
    
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
    let modal = document.querySelector('#tickk-mini-modal');
    if (modal) {
      modal.style.display = modal.style.display === 'none' ? 'block' : 'none';
      return;
    }
    
    // Build Modal Container
    modal = document.createElement('div');
    modal.id = 'tickk-mini-modal';
    
    // Styling is completely handled by content-style.css to prevent Gmail overrides
    chrome.storage.local.get(['tickk_user', 'tickk_user_email'], (res) => {
      const user = res.tickk_user;
      // Prefer tickk_user_email (set by sync bridge) over tickk_user object
      const syncedEmail = res.tickk_user_email;
      const isLoggedIn = syncedEmail ? true : (user && user.connected);
      const email = syncedEmail || (user ? user.email : null) || 'Logged Out';
      
      modal.innerHTML = `
        <div style="display: flex; align-items: center; margin-bottom: 16px;">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: ${isLoggedIn ? '#10b981' : '#52525b'}; margin-right: 8px; box-shadow: ${isLoggedIn ? '0 0 6px rgba(16, 185, 129, 0.5)' : 'none'};"></span>
          <span style="font-weight: 600; font-size: 14px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${email}</span>
        </div>
        <div style="font-size: 13px; color: #a1a1aa; margin-bottom: 16px; background: rgba(255, 255, 255, 0.03); padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.05);">
          <p style="margin: 0; display: flex; align-items: center; gap: 6px;">
            ${isLoggedIn ? '✨ Silent Email Tracking Active' : '🔴 Connection Required'}
          </p>
        </div>
        <button id="tickk-dash-btn">
          ${isLoggedIn ? 'Open Dashboard ↗' : 'Connect Account ⚡'}
        </button>
      `;
      
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

  // ─── Intercept Send Button Click ───
  function interceptSend(composeContainer, composeBody) {
    // Use event delegation on the compose container
    composeContainer.addEventListener(
      'click',
      async (e) => {
        const sendBtn = e.target.closest(SEND_BUTTON_SELECTOR);
        if (!sendBtn) return;

        // Check if tracking is enabled for this compose
        const trackingState = composeBody.getAttribute('data-tickk-tracking');
        if (trackingState === 'disabled') {
          console.log(
            '[Tickk Gmail] Tracking disabled for this compose — skipping.'
          );
          return; // Let send proceed normally
        }

        // Check if pixel already injected (prevent duplicates)
        if (composeBody.querySelector('[data-tickk-pixel]')) {
          console.log('[Tickk Gmail] Pixel already injected — skipping.');
          return;
        }

        // Extract email metadata
        const recipient = extractRecipient(composeContainer);
        const subject = extractSubject(composeContainer);

        if (!recipient || !subject) {
          console.warn(
            '[Tickk Gmail] Could not extract recipient/subject — skipping tracking.'
          );
          return;
        }

        // Prevent immediate send — we need to inject pixel first
        e.preventDefault();
        e.stopPropagation();

        try {
          // Create tracker via API
          const result = await createTracker(recipient, subject);

          if (result.success && result.trackerId) {
            // Inject tracking pixel into compose body
            const pixel = createPixelElement(result.trackerId);
            composeBody.appendChild(pixel);
            console.log(
              `[Tickk Gmail] Pixel injected — Tracker ID: ${result.trackerId}`
            );
            showTickkToast('Email tracking activated ✓', 'success');
          } else {
            console.error('[Tickk Gmail] Tracker creation failed:', result.error);
            if (result.error === 'Insufficient credits') {
              showTickkToast('No credits remaining — tracking skipped', 'error');
            }
          }
        } catch (err) {
          console.error('[Tickk Gmail] Error during send interception:', err);
        }

        // Trigger original send after pixel injection
        // Small delay to ensure pixel is in DOM before Gmail processes the body
        setTimeout(() => {
          sendBtn.click();
        }, 100);
      },
      true // Capture phase — fires before Gmail's own handler
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
