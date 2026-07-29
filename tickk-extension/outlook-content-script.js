// ═══════════════════════════════════════════════════════════════
// Tickk Extension — Outlook Web Content Script
// Injects tracking pixel + action icon into Outlook compose pane
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const COMPOSE_BODY_SELECTOR = 'div[aria-label="Message body"]';
  const SEND_BUTTON_SELECTOR = 'button[aria-label="Send"]';
  const COMPOSE_TOOLBAR_SELECTOR =
    'div[role="toolbar"], div.ms-OverflowSet, div[class*="CommandBar"]';
  const TO_FIELD_SELECTOR =
    'input[aria-label="To"], div[aria-label="To"] input';
  const SUBJECT_FIELD_SELECTOR = 'input[aria-label="Add a subject"]';
  const PROCESSED_ATTR = 'data-tickk-processed';

  let trackingEnabledGlobal = true;
  let isInitialized = false;

  // ─── Initialize ───
  async function init() {
    const authed = await isAuthenticated();
    if (!authed) {
      console.log('[Tickk Outlook] Not authenticated — skipping injection.');
      return;
    }

    if (isInitialized) return;
    isInitialized = true;

    trackingEnabledGlobal = await isTrackingEnabled();
    observeComposeWindows();
    console.log('[Tickk Outlook] Content script initialized.');
  }

  // ─── MutationObserver: Watch for Compose Panes ───
  function observeComposeWindows() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

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

    // Also check for already-open compose windows on init
    document.querySelectorAll(COMPOSE_BODY_SELECTOR).forEach((body) => {
      if (!body.getAttribute(PROCESSED_ATTR)) {
        body.setAttribute(PROCESSED_ATTR, 'true');
        handleComposeWindow(body);
      }
    });
  }

  // ─── Handle Individual Compose Window ───
  function handleComposeWindow(composeBody) {
    console.log('[Tickk Outlook] Compose pane detected.');

    // Walk up to find the compose container
    const composeContainer =
      composeBody.closest('[role="dialog"]') ||
      composeBody.closest('[class*="compose"]') ||
      composeBody.parentElement?.parentElement?.parentElement;

    if (!composeContainer) {
      console.warn('[Tickk Outlook] Could not find compose container.');
      return;
    }

    // Inject Tickk button
    injectToolbarButton(composeContainer, composeBody);

    // Intercept Send button
    interceptSend(composeContainer, composeBody);
  }

  // ─── Inject Tickk Toggle Button in Outlook Toolbar ───
  function injectToolbarButton(composeContainer, composeBody) {
    // Outlook has various toolbar structures — try multiple selectors
    let toolbar = composeContainer.querySelector(COMPOSE_TOOLBAR_SELECTOR);

    // Fallback: look for the toolbar near the compose body
    if (!toolbar) {
      toolbar =
        composeBody.previousElementSibling ||
        composeBody.parentElement?.querySelector('[role="toolbar"]');
    }

    if (!toolbar) {
      console.warn(
        '[Tickk Outlook] Toolbar not found — retrying in 1s...'
      );
      setTimeout(
        () => injectToolbarButton(composeContainer, composeBody),
        1000
      );
      return;
    }

    // Don't inject if already present
    if (toolbar.querySelector('[data-tickk-btn]')) return;

    const tickkBtn = createTickkButton((btn) => {
      const isActive = btn.classList.toggle('tickk-action-btn--inactive');
      composeBody.setAttribute(
        'data-tickk-tracking',
        isActive ? 'disabled' : 'enabled'
      );
      showTickkToast(
        isActive ? 'Tracking disabled for this email' : 'Tracking enabled ✓',
        isActive ? 'info' : 'success'
      );
    });

    // Match Outlook's button styling
    tickkBtn.classList.add('tickk-outlook-btn');

    // Set initial state
    if (!trackingEnabledGlobal) {
      tickkBtn.classList.add('tickk-action-btn--inactive');
      composeBody.setAttribute('data-tickk-tracking', 'disabled');
    } else {
      composeBody.setAttribute('data-tickk-tracking', 'enabled');
    }

    toolbar.appendChild(tickkBtn);
    console.log('[Tickk Outlook] Action button injected.');
  }

  // ─── Intercept Send Button Click ───
  function interceptSend(composeContainer, composeBody) {
    composeContainer.addEventListener(
      'click',
      async (e) => {
        const sendBtn = e.target.closest(SEND_BUTTON_SELECTOR);
        if (!sendBtn) return;

        // Check tracking state
        const trackingState = composeBody.getAttribute('data-tickk-tracking');
        if (trackingState === 'disabled') {
          console.log(
            '[Tickk Outlook] Tracking disabled — skipping.'
          );
          return;
        }

        // Prevent duplicate pixel injection
        if (composeBody.querySelector('[data-tickk-pixel]')) {
          console.log('[Tickk Outlook] Pixel already injected — skipping.');
          return;
        }

        // Extract metadata
        const recipient = extractRecipient(composeContainer);
        const subject = extractSubject(composeContainer);

        if (!recipient || !subject) {
          console.warn(
            '[Tickk Outlook] Missing recipient/subject — skipping tracking.'
          );
          return;
        }

        // Block send temporarily
        e.preventDefault();
        e.stopPropagation();

        try {
          const result = await createTracker(recipient, subject);

          if (result.success && result.trackerId) {
            const pixel = createPixelElement(result.trackerId);
            composeBody.appendChild(pixel);
            console.log(
              `[Tickk Outlook] Pixel injected — Tracker ID: ${result.trackerId}`
            );
            showTickkToast('Email tracking activated ✓', 'success');
          } else {
            console.error(
              '[Tickk Outlook] Tracker creation failed:',
              result.error
            );
            if (result.error === 'Insufficient credits') {
              showTickkToast(
                'No credits remaining — tracking skipped',
                'error'
              );
            }
          }
        } catch (err) {
          console.error(
            '[Tickk Outlook] Error during send interception:',
            err
          );
        }

        // Trigger original send
        setTimeout(() => {
          sendBtn.click();
        }, 100);
      },
      true
    );
  }

  // ─── Extract Recipient Email ───
  function extractRecipient(composeContainer) {
    // Try standard To input
    const toInput = composeContainer.querySelector(TO_FIELD_SELECTOR);
    if (toInput && toInput.value) {
      return toInput.value.trim();
    }

    // Fallback: Outlook persona chips
    const personaChips = composeContainer.querySelectorAll(
      '[class*="PersonaContent"] span[title], div[aria-label*="@"]'
    );
    if (personaChips.length > 0) {
      const title = personaChips[0].getAttribute('title');
      if (title && title.includes('@')) return title;
    }

    // Deep fallback: look for email-like text in the To area
    const toArea = composeContainer.querySelector('div[aria-label="To"]');
    if (toArea) {
      const emailMatch = toArea.textContent.match(
        /[\w.-]+@[\w.-]+\.\w+/
      );
      if (emailMatch) return emailMatch[0];
    }

    return null;
  }

  // ─── Extract Subject Line ───
  function extractSubject(composeContainer) {
    const subjectInput = composeContainer.querySelector(
      SUBJECT_FIELD_SELECTOR
    );
    if (subjectInput && subjectInput.value) {
      return subjectInput.value.trim();
    }
    return '(No Subject)';
  }

  // ─── Storage Listener for Auth Sync ───
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.tickk_api_key && changes.tickk_api_key.newValue) {
      console.log('[Tickk Outlook] Auth synced from storage! Initializing...');
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
