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
    const authed = await isAuthenticated();
    if (!authed) {
      console.log('[Tickk Gmail] Not authenticated — skipping injection.');
      return;
    }

    if (isInitialized) return;
    isInitialized = true;

    trackingEnabledGlobal = await isTrackingEnabled();
    injectHeaderWidget();
    observeComposeWindows();
    console.log('[Tickk Gmail] Content script initialized.');
  }

  // ─── MutationObserver: Watch for Compose Windows ───
  function observeComposeWindows() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // Check if this node or its children contain a compose body
          const composeBodies = node.matches?.(COMPOSE_BODY_SELECTOR)
            ? [node]
            : node.querySelectorAll?.(COMPOSE_BODY_SELECTOR) || [];

          for (const composeBody of composeBodies) {
            if (composeBody.getAttribute(PROCESSED_ATTR)) continue;
            composeBody.setAttribute(PROCESSED_ATTR, 'true');
            handleComposeWindow(composeBody);
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ─── Handle Individual Compose Window ───
  function handleComposeWindow(composeBody) {
    console.log('[Tickk Gmail] Compose window detected.');

    // Find the compose container (walk up to the compose root)
    const composeContainer = composeBody.closest('.M9');
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
  async function injectHeaderWidget() {
    if (document.querySelector('.tickk-header-widget')) return;

    // Look for Gmail's top right action container
    const headerContainer = document.querySelector('#gb') || document.querySelector('header');
    if (!headerContainer) {
      setTimeout(injectHeaderWidget, 1000);
      return;
    }

    const rightActionArea = headerContainer.querySelector('.gb_Se') || headerContainer.querySelector('[role="banner"] > div:last-child') || headerContainer.lastElementChild;
    if (!rightActionArea) {
      setTimeout(injectHeaderWidget, 1000);
      return;
    }

    const userInfo = await getUserInfo();
    const credits = userInfo.success ? userInfo.credits : 0;

    const widget = createHeaderWidget(credits, (btn) => {
      let card = btn.querySelector('.tickk-floating-card');
      if (!card) {
        card = createFloatingCard(credits);
        btn.appendChild(card);
      }
      card.classList.toggle('active');

      const closeHandler = (clickEvent) => {
        if (!card.contains(clickEvent.target) && !btn.contains(clickEvent.target)) {
          card.classList.remove('active');
          document.removeEventListener('click', closeHandler);
        }
      };
      setTimeout(() => document.addEventListener('click', closeHandler), 0);
    });

    rightActionArea.insertBefore(widget, rightActionArea.firstChild);
  }

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

    const tickkBtn = createTickkButton((btn, e) => {
      let popup = btn.parentElement.querySelector('.tickk-compose-popup');
      if (!popup) {
        popup = createComposePopup(trackingState, (newState) => {
          composeBody.setAttribute('data-tickk-tracking', newState.opens ? 'enabled' : 'disabled');
          composeBody.setAttribute('data-tickk-clicks', newState.clicks ? 'enabled' : 'disabled');
          
          if (newState.opens) {
            btn.classList.remove('tickk-action-btn--inactive');
          } else {
            btn.classList.add('tickk-action-btn--inactive');
          }
        });
        btn.parentElement.style.position = 'relative';
        btn.parentElement.appendChild(popup);
      }
      
      popup.classList.toggle('active');

      const closeHandler = (clickEvent) => {
        if (!popup.contains(clickEvent.target) && !btn.contains(clickEvent.target)) {
          popup.classList.remove('active');
          document.removeEventListener('click', closeHandler);
        }
      };
      setTimeout(() => document.addEventListener('click', closeHandler), 0);
    });

    // Set initial state based on global toggle
    if (!trackingEnabledGlobal) {
      tickkBtn.classList.add('tickk-action-btn--inactive');
      composeBody.setAttribute('data-tickk-tracking', 'disabled');
    } else {
      composeBody.setAttribute('data-tickk-tracking', 'enabled');
    }

    // Insert the button near the send button
    toolbar.appendChild(tickkBtn);

    console.log('[Tickk Gmail] Action button + popup injected.');
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
