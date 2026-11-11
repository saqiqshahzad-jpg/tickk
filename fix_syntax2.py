import sys

filepath = r'c:\tickk backend\tickk-extension\gmail-content-script.js'
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if line.startswith('  function toggleMiniDashboard(trigger) {'):
        start_idx = i
    if "Run on interval / observer to ensure Gmail SPA doesn't wipe it" in line:
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    new_func = """  function toggleMiniDashboard(trigger) {
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
"""
    lines[start_idx:end_idx] = [new_func]
    with open(filepath, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print('Fixed syntax error')
else:
    print('Could not find bounds')
