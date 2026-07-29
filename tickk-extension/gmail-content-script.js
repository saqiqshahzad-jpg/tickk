// ═══════════════════════════════════════════════════════════════
// Tickk Extension — Gmail Content Script
// Injects tracking pixel + action icon into Gmail compose window
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const COMPOSE_BODY_SELECTOR = 'div[aria-label="Message Body"]';
  const SEND_BUTTON_SELECTOR = 'div[aria-label="Send"]';
  const COMPOSE_TOOLBAR_SELECTOR = '.btC'; // Gmail compose bottom toolbar
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

  // ─── Inject Tickk Toggle Button in Compose Toolbar ───
  function injectToolbarButton(composeContainer, composeBody) {
    const toolbar = composeContainer.querySelector(COMPOSE_TOOLBAR_SELECTOR);
    if (!toolbar) {
      console.warn('[Tickk Gmail] Toolbar not found.');
      return;
    }

    // Don't inject if already present
    if (toolbar.querySelector('[data-tickk-btn]')) return;

    const tickkBtn = createTickkButton((btn) => {
      const isActive = btn.classList.toggle('tickk-action-btn--inactive');
      // Store per-compose tracking state on the compose body element
      composeBody.setAttribute(
        'data-tickk-tracking',
        isActive ? 'disabled' : 'enabled'
      );
      showTickkToast(
        isActive ? 'Tracking disabled for this email' : 'Tracking enabled ✓',
        isActive ? 'info' : 'success'
      );
    });

    // Set initial state based on global toggle
    if (!trackingEnabledGlobal) {
      tickkBtn.classList.add('tickk-action-btn--inactive');
      composeBody.setAttribute('data-tickk-tracking', 'disabled');
    } else {
      composeBody.setAttribute('data-tickk-tracking', 'enabled');
    }

    // Insert the button into toolbar area
    const toolbarRight = toolbar.querySelector('.bAK') || toolbar;
    toolbarRight.insertBefore(tickkBtn, toolbarRight.firstChild);

    console.log('[Tickk Gmail] Action button injected.');
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
