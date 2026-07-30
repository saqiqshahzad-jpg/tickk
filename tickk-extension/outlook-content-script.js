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
    if (isInitialized) return;
    isInitialized = true;

    const authed = await isAuthenticated();
    
    injectHeaderWidget(authed);
    
    if (authed) {
      trackingEnabledGlobal = await isTrackingEnabled();
      observeComposeWindows();
      console.log('[Tickk Outlook] Content script initialized.');
    } else {
      console.log('[Tickk Outlook] Not authenticated — injected Connect button only.');
    }
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

  // ─── Header Injection ───
  async function injectHeaderWidget(authed) {
    if (document.querySelector('.tickk-header-widget')) return;

    // Look for Outlook's top right action container near Settings
    const settingsBtn = document.querySelector('#O365_MainLink_Settings');
    const headerContainer = settingsBtn ? settingsBtn.parentElement : (document.querySelector('#O365_NavHeader') || document.querySelector('header'));
    
    if (!headerContainer) {
      setTimeout(() => injectHeaderWidget(authed), 1000);
      return;
    }

    let credits = 0;
    let authData = { email: 'Not Connected', opensCount: 0 };
    if (authed) {
      const userInfo = await getUserInfo();
      credits = userInfo.success ? userInfo.credits : 0;
      authData = await getStoredAuth();
    }

    const widget = createHeaderWidget(authed, (btn) => {
      if (!authed) {
        window.open('https://tickk.online/onboarding', '_blank');
        return;
      }

      let card = btn.querySelector('.tickk-floating-card');
      if (!card) {
        card = createFloatingCard(authData.email, credits, authData.opensCount);
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

    headerContainer.insertBefore(widget, headerContainer.firstChild);
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
    console.log('[Tickk Outlook] Action button + popup injected.');
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
