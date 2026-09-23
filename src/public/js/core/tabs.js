/**
 * Tab Management System
 * Handles tab switching and dynamic template loading
 */

// Track loaded templates to avoid reloading
const loadedTemplates = new Set();

// Track the currently active tab for cleanup (US-160)
let _currentTab = null;

// US-809: Profile-specific tabs include profileId in URL hash
const PROFILE_SPECIFIC_TABS = [
  'dashboard', 'intents', 'understanding', 'responses',
  'performance', 'chat-simulator', 'tests', 'knowledge-base', 'workflows',
  'settings', 'staff-review', 'wa-template-authoring'
];
window.PROFILE_SPECIFIC_TABS = PROFILE_SPECIFIC_TABS;

// Known profile IDs — filled by profile-switcher.js from /api/rainbow/profiles.
// Deliberately EMPTY until then: the old hardcoded list lacked senai-app,
// kb-aircond and dental-world, so a cold deep link like #settings/senai-app
// parsed "senai-app" as a sub-tab and the Settings tab rendered broken.
// Until the list arrives, any second segment of a profile-specific tab is
// treated as a candidate profile id (see getTabInfoFromUrl).
if (!window.KNOWN_PROFILE_IDS) {
  window.KNOWN_PROFILE_IDS = [];
}

// Sub-tab ids that can legitimately follow a profile-specific tab, used to
// disambiguate #settings/<x> when the profile list hasn't loaded yet.
const KNOWN_SUB_TABS = [
  'numbers', 'assistants', 'defaults', // ⚙ Master sub-tabs
  'ai-models', 'bot-avatar', 'notifications', 'operators', 'users', 'ai-exceptions',
  'profile', 'failover', 'mcp-servers', 'messaging-limits', 'template-linter',
  'appearance', 'intelligence-export', 'whatsapp', 'webchat', 'live', 'simulator',
  'knowledge', 'knowledge-base', 'quick-replies', 'workflows', 'system-messages',
  'static-replies', 'workflow', 'templates', 't1', 't2', 't3', 't4'
];

// ── Simple / Advanced UI mode (2026-09-23) ──────────────────────────────
// Simple (default) shows five flat nav items — Home · Chats · Knowledge ·
// Test · Settings — for the "simple IT knowledge" operator. Advanced is the
// full nav. Nav buttons opt into Simple with data-simple="true" and may carry
// a data-simple-label; everything else is advanced-only. Stored per browser.
const UI_MODE_KEY = 'rainbow-ui-mode';
const SIMPLE_ALWAYS_TABS = ['setup', 'help', 'master']; // never force Advanced for these

function getUiMode() {
  try {
    const v = localStorage.getItem(UI_MODE_KEY);
    return v === 'advanced' ? 'advanced' : 'simple';
  } catch (_) { return 'simple'; }
}

function setUiMode(mode, reapply = true) {
  mode = mode === 'advanced' ? 'advanced' : 'simple';
  try { localStorage.setItem(UI_MODE_KEY, mode); } catch (_) { /* private mode */ }
  if (reapply) applyUiMode(mode);
}

function toggleUiMode() {
  const next = getUiMode() === 'simple' ? 'advanced' : 'simple';
  setUiMode(next);
  // Re-run the active tab so tab-local Simple-mode logic (Settings sub-nav,
  // dashboard cards) re-evaluates without a reload.
  const info = getTabInfoFromUrl();
  if (next === 'simple' && !isSimpleTab(info.main)) {
    window.location.hash = 'dashboard';
  } else if (typeof window.loadTab === 'function') {
    window.loadTab(info.main, info.sub);
  }
}

function isSimpleTab(tabName) {
  const eff = tabNameMapping[tabName] || tabName;
  if (SIMPLE_ALWAYS_TABS.includes(eff)) return true;
  const btn = document.querySelector('.sidebar-nav .nav-item[data-tab="' + eff + '"]');
  return !!(btn && btn.dataset.simple === 'true');
}

/**
 * Apply the UI mode to the sidebar + body. Must run AFTER applyMasterNav on
 * every loadTab (Master un-hides everything). While Master is selected the
 * toggle is hidden and the nav is left to applyMasterNav.
 */
function applyUiMode(mode, isMaster = false) {
  mode = mode || getUiMode();
  const simple = mode === 'simple';
  document.body.classList.toggle('ui-mode-simple', simple);
  const toggle = document.getElementById('ui-mode-toggle');
  if (toggle) {
    toggle.classList.toggle('hidden', !!isMaster);
    const lab = toggle.querySelector('.ui-mode-label');
    if (lab) lab.textContent = simple ? 'Simple' : 'Advanced';
    toggle.title = simple ? 'Simple view — click for the full Advanced dashboard' : 'Advanced view — click for the Simple 5-item view';
  }
  if (isMaster) return;
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
    const tab = btn.dataset.tab;
    if (tab === 'master' || tab === 'setup') return; // owned by applyMasterNav / always hidden
    const label = btn.querySelector('.nav-label');
    if (label && !btn.dataset.advancedLabel) btn.dataset.advancedLabel = label.textContent.trim();
    if (simple) {
      const inSimple = btn.dataset.simple === 'true';
      btn.classList.toggle('hidden', !inSimple);
      if (inSimple && label && btn.dataset.simpleLabel) label.textContent = btn.dataset.simpleLabel;
    } else {
      btn.classList.remove('hidden');
      if (label && btn.dataset.advancedLabel) label.textContent = btn.dataset.advancedLabel;
    }
  });
  document.querySelectorAll('.sidebar-nav .sidebar-group-label').forEach(el => {
    el.classList.toggle('hidden', simple);
  });
}

window.getUiMode = getUiMode;
window.setUiMode = setUiMode;
window.toggleUiMode = toggleUiMode;
window.applyUiMode = applyUiMode;
window.isSimpleTab = isSimpleTab;

/**
 * Map old tab names to new ones for backward compatibility
 */
const tabNameMapping = {
  // Main tabs
  'dashboard': 'dashboard',
  'real-chat': 'live-chat',
  'live-chat': 'live-chat',
  'widget-chats': 'live-chat', // operator notify deep-links (?session=) land on live-chat
  'chat-simulator': 'chat-simulator',
  'history': 'history',
  'settings': 'settings',
  'master': 'master', // ⚙ Master · All businesses (numbers|assistants|defaults|users)
  'setup': 'setup', // New-business setup wizard (#setup or #setup/<profileId>)
  'status': 'system-status', // Redirect to status
  'system-status': 'system-status',
  'monitor': 'performance',
  'performance': 'performance',
  'help': 'help',

  // Knowledge/Response tabs
  'responses': 'responses',
  'knowledge': 'responses', // Old Knowledge Base -> new Responses
  'static-replies': 'responses', // Old Static Messages -> new Responses
  'workflow': 'responses', // Old Workflow -> new Responses
  'templates': 'responses',

  // Understanding
  'understanding': 'understanding',
  // 'intents': 'understanding', // Removed: Smart Routing is now its own tab

  // WhatsApp
  'whatsapp': 'system-status', // Redirect to status
  'whatsapp-accounts': 'system-status',

  // Old aliases
  'preview': 'chat-simulator',
  'chat': 'live-chat',
  'feedback-stats': 'performance',
  'intent-accuracy': 'performance'
};

/**
 * Get current tab, profile ID, and sub-tab from URL
 * US-809: Profile-specific tabs use format #tab/profileId or #tab/profileId/subTab
 * Global tabs use format #tab or #tab/subTab
 * @returns {{main: string, profileId: string|null, sub: string|null}}
 */
function getTabInfoFromUrl() {
  const hash = window.location.hash.slice(1); // Remove #
  if (!hash) return { main: 'dashboard', profileId: null, sub: null };

  // Handle query params if any (e.g. ?audience=developer)
  const cleanHash = hash.split('?')[0];
  // (deep-link params like ?session= are read separately via getHashParams)

  const parts = cleanHash.split('/');
  const rawMain = parts[0];
  const main = tabNameMapping[rawMain] || rawMain || 'dashboard';

  // For profile-specific tabs, parts[1] may be a profileId
  if (PROFILE_SPECIFIC_TABS.includes(main) && parts.length >= 2) {
    const knownIds = window.KNOWN_PROFILE_IDS || [];
    // Confirmed profile id, OR (profile list not loaded yet) any segment that
    // is not a known sub-tab — the switcher validates it once /profiles lands.
    const looksLikeProfile = knownIds.length > 0
      ? knownIds.includes(parts[1])
      : (parts.length > 2 || !KNOWN_SUB_TABS.includes(parts[1]));
    if (looksLikeProfile) {
      return {
        main: main,
        profileId: parts[1],
        sub: parts.length > 2 ? parts[2] : null
      };
    }
  }

  // Global tab or unrecognized profileId in parts[1]
  return {
    main: main,
    profileId: null,
    sub: parts.length > 1 ? parts[1] : null
  };
}

/**
 * Parse query params embedded in the hash (e.g. #widget-chats?session=x&profile=y).
 * Operator WhatsApp notifies deep-link here; the path→hash conversion in
 * initTabs() also folds a real ?query into the hash so both URL forms work.
 */
function getHashParams() {
  const q = (window.location.hash.split('?')[1] || '');
  return new URLSearchParams(q);
}

/**
 * Open a webchat session from a deep link once the live-chat modules have
 * lazy-loaded (retries for up to 6s, then gives up silently).
 */
function openWebchatDeepLink(sessionId, attempt = 0) {
  if (typeof window.switchLiveChatTab === 'function' && typeof window.wcOpenConversation === 'function') {
    window.switchLiveChatTab('webchat');
    window.wcOpenConversation(sessionId);
    return;
  }
  if (attempt < 12) {
    setTimeout(() => openWebchatDeepLink(sessionId, attempt + 1), 500);
  }
}

/**
 * Load template for a tab if not already loaded
 * @param {HTMLElement} tabSection - Tab section element
 * @returns {Promise<void>}
 */
async function loadTabTemplate(tabSection) {
  const templateName = tabSection.dataset.template;
  if (!templateName || loadedTemplates.has(templateName)) {
    return; // Already loaded or no template needed
  }

  try {
    const response = await fetch(`/api/rainbow/templates/${templateName}`, { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`Template ${templateName} not found (${response.status})`);
    }

    const html = await response.text();
    tabSection.innerHTML = html;
    loadedTemplates.add(templateName);

    console.log(`[Tabs] Loaded template: ${templateName}`);
  } catch (err) {
    console.error(`[Tabs] Failed to load template ${templateName}:`, err);
    tabSection.innerHTML = `
      <div class="p-8 text-center text-danger-500">
        <p>Failed to load ${templateName} tab</p>
        <button onclick="location.reload()" class="mt-4 px-4 py-2 bg-primary-500 text-white rounded hover:bg-primary-600">
          Reload Page
        </button>
      </div>
    `;
  }
}

/**
 * US-160: Clean up intervals and event listeners from the previous tab
 * before switching to a new one. Each tab module exposes a cleanup function
 * that clears its setInterval/setTimeout/SSE handlers.
 *
 * @param {string|null} previousTab - The tab being deactivated
 * @param {string} nextTab - The tab being activated
 */
function cleanupCurrentTab(previousTab, nextTab) {
  if (!previousTab || previousTab === nextTab) return;

  switch (previousTab) {
    case 'dashboard':
      // Dashboard has: status poll timer, SSE activity stream, activity timestamp updater
      if (typeof window.stopStatusPolling === 'function') window.stopStatusPolling();
      if (typeof window.cleanupDashboardHelpers === 'function') window.cleanupDashboardHelpers();
      break;

    case 'live-chat':
      // Live Chat has: autoRefresh (10s), waStatusPoll (15s)
      if (typeof window.cleanupLiveChat === 'function') window.cleanupLiveChat();
      break;

    case 'chat-simulator':
      // Chat Simulator contains Live Simulation sub-tab with: autoRefresh (3s), waStatusPoll (15s), timestampUpdater (1s)
      if (typeof window.cleanupLiveSimulation === 'function') window.cleanupLiveSimulation();
      break;

    case 'performance':
      // Performance has: feedbackRefreshInterval (30s), intentAccuracyRefreshInterval (30s)
      if (typeof window.cleanupPerformance === 'function') window.cleanupPerformance();
      break;

    case 'setup':
      // Setup wizard has: QR poll (3s)
      if (typeof window.cleanupSetup === 'function') window.cleanupSetup();
      break;

    default:
      break;
  }

  console.log(`[Tabs] Cleanup: ${previousTab} -> ${nextTab}`);
}

/**
 * Load tab and call its loader function
 * @param {string} tabName - Tab name (e.g., 'status', 'intents')
 * @param {string|null} subTab - Optional sub-tab ID
 */
/**
 * ⚙ Master mode: while the Master "profile" is selected only the Master nav
 * item (+ Help) is shown; a business profile never shows the Master item.
 */
function applyMasterNav(isMaster) {
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
    const tab = btn.dataset.tab;
    if (tab === 'master') btn.classList.toggle('hidden', !isMaster);
    else if (tab === 'setup') btn.classList.add('hidden'); // never listed; reached via #setup
    else if (tab !== 'help') btn.classList.toggle('hidden', isMaster);
  });
  document.querySelectorAll('.sidebar-nav .sidebar-group-label').forEach(el => {
    el.classList.toggle('hidden', isMaster && el.textContent.trim() !== 'System');
  });
}

async function loadTab(tabName, subTab = null) {
  // Normalize tab name
  const effectiveTabName = tabNameMapping[tabName] || tabName;

  applyMasterNav(effectiveTabName === 'master');
  // Simple/Advanced must run after Master (Master un-hides every nav item).
  applyUiMode(getUiMode(), effectiveTabName === 'master');

  // ── US-160: Clean up intervals/listeners from the previous tab ──
  cleanupCurrentTab(_currentTab, effectiveTabName);
  _currentTab = effectiveTabName;

  // Save last-visited tab for restoration on next load
  localStorage.setItem('rainbow_last_tab', window.location.hash || ('#' + effectiveTabName));

  // Hide Prisma Bot FAB when navigating away from responses tab
  if (typeof window.hidePrismaBotFab === 'function') {
    window.hidePrismaBotFab();
  }

  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.add('hidden');
  });

  // Remove active class from all nav tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    // Check if the button targets this tab (or one of its aliases)
    const btnTab = tabNameMapping[btn.dataset.tab] || btn.dataset.tab;
    const isMatch = btnTab === effectiveTabName;

    // Toggle active classes
    if (isMatch) {
      btn.classList.add('bg-primary-50', 'text-primary-700');
      btn.classList.remove('text-neutral-600', 'hover:bg-neutral-50');
    } else {
      btn.classList.remove('bg-primary-50', 'text-primary-700');
      btn.classList.add('text-neutral-600', 'hover:bg-neutral-50');
    }
  });

  // Show selected tab
  const tabSection = document.getElementById('tab-' + effectiveTabName);
  if (!tabSection) {
    console.error(`[Tabs] Tab not found: tab-${effectiveTabName}`);
    return;
  }

  tabSection.classList.remove('hidden');

  // Load template if needed
  await loadTabTemplate(tabSection);

  // ── US-158: Lazy-load tab modules on demand ──────────────────
  // Ensures the tab's JS modules are imported before calling the loader.
  // window._ensureTabModules is provided by lazy-loader.js (loaded via module-registry.js).
  if (typeof window._ensureTabModules === 'function') {
    try {
      await window._ensureTabModules(effectiveTabName);
    } catch (err) {
      console.error(`[Tabs] Failed to lazy-load modules for ${effectiveTabName}:`, err);
    }
  }

  // Call tab-specific loader function if exists
  const loaderFunctionName = 'load' + effectiveTabName.split('-').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join('');

  if (typeof window[loaderFunctionName] === 'function') {
    try {
      // Pass subTab to the loader function
      await window[loaderFunctionName](subTab);
      console.log(`[Tabs] Loaded: ${effectiveTabName} ${subTab ? `(${subTab})` : ''}`);
    } catch (err) {
      console.error(`[Tabs] Error loading ${effectiveTabName}:`, err);
    }
  }

  // Handle sub-tab switching logic for specific tabs
  // This ensures that even if loader doesn't handle it, we try to switch
  if (subTab) {
    // Wait a bit for any internal rendering
    setTimeout(() => {
      if (effectiveTabName === 'settings' && typeof window.switchSettingsTab === 'function') {
        window.switchSettingsTab(subTab, false);
      } else if (effectiveTabName === 'master' && typeof window.switchMasterTab === 'function') {
        if (window.activeMasterTab !== subTab) window.switchMasterTab(subTab, false);
      } else if (effectiveTabName === 'responses' && typeof window.switchResponseTab === 'function') {
        window.switchResponseTab(subTab, false);
      } else if (effectiveTabName === 'chat-simulator' && typeof window.switchSimulatorTab === 'function') {
        window.switchSimulatorTab(subTab, false);
      } else if (effectiveTabName === 'live-chat' && typeof window.switchLiveChatTab === 'function') {
        window.switchLiveChatTab(subTab, false);
      } else if (effectiveTabName === 'understanding' && typeof window.toggleTier === 'function') {
        // Check if already open to avoid toggle spam
        const content = document.getElementById(subTab + '-content');
        if (content && content.classList.contains('hidden')) {
          window.toggleTier(subTab, false); // false = don't update hash (already set)
        }
        // Scroll to it
        if (content) content.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  }
}

/**
 * Wait for the lazy-loader to be bootstrapped by module-registry.js.
 * Because module-registry.js is a `type="module"` script, it runs after
 * DOMContentLoaded.  This helper polls briefly (max ~500ms) so the
 * initial loadTab() can use lazy loading.  If the loader never appears
 * (e.g. script error), we proceed anyway — the tab will just show the
 * template without its JS module.
 *
 * @returns {Promise<void>}
 */
function waitForLazyLoader() {
  if (typeof window._ensureTabModules === 'function') {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    let attempts = 0;
    const maxAttempts = 50; // 50 * 10ms = 500ms max wait
    const interval = setInterval(() => {
      attempts++;
      if (typeof window._ensureTabModules === 'function' || attempts >= maxAttempts) {
        clearInterval(interval);
        if (attempts >= maxAttempts) {
          console.warn('[Tabs] Lazy loader not available after 500ms, proceeding without it');
        }
        resolve();
      }
    }, 10);
  });
}

/**
 * US-809: Handle navigation with profile-scoped URLs.
 * - Profile-specific tabs auto-append profileId if missing
 * - Auto-switches profile when URL contains a different profileId
 */
function handleNavigation() {
  const { main, profileId, sub } = getTabInfoFromUrl();
  const sw = window.profileSwitcher;

  // ⚙ Master: #master/<sub> selects the Master "profile"; any other tab while
  // Master is selected drops back to the last business profile first.
  if (main === 'master') {
    if (sw && !sw.canMaster()) { window.location.hash = 'dashboard'; return; }
    if (sw && !sw.isMaster()) { sw.switchTo(sw.MASTER_ID); return; } // switchTo loads the tab
    loadTab('master', sub);
    return;
  }
  if (sw && sw.isMaster()) {
    sw.switchTo(sw.getBusinessProfileId()); // lands on #dashboard/<profile>
    if (main !== 'dashboard') window.location.hash = main + (sub ? '/' + sub : '');
    return;
  }

  // Simple mode + deep link to an advanced-only tab → switch to Advanced
  // (same precedent as the Master URL switching above): the link wins.
  if (getUiMode() === 'simple' && !isSimpleTab(main)) {
    setUiMode('advanced', false);
  }

  // Auto-append profileId for profile-specific tabs if missing
  if (PROFILE_SPECIFIC_TABS.includes(main) && !profileId) {
    const activeProfile = (window.profileSwitcher && window.profileSwitcher.getActiveProfileId()) || 'pelangi';
    var safeSub = (sub && sub !== activeProfile) ? '/' + sub : '';
    window.location.hash = main + '/' + activeProfile + safeSub;
    return; // hashchange will fire again with profileId present
  }

  // Auto-switch profile if URL specifies a different one
  if (profileId && window.profileSwitcher) {
    const currentProfile = window.profileSwitcher.getActiveProfileId();
    if (currentProfile !== profileId) {
      window.profileSwitcher.switchTo(profileId);
      return; // switchTo handles loadTab internally
    }
  }

  loadTab(main, sub);

  // Deep link: open a specific webchat session (operator notify links).
  const params = getHashParams();
  if (main === 'live-chat' && params.get('session')) {
    openWebchatDeepLink(params.get('session'));
  }
}

/**
 * Initialize tabs on page load
 */
async function initTabs() {
  // Convert path-based URLs (e.g., /understanding) to hash-based URLs (/#understanding)
  const path = window.location.pathname || '/';
  if (path !== '/') {
    const pathTab = path.slice(1); // Remove leading /
    const existingHash = window.location.hash || '';
    // Use the path as the tab name if no hash exists. Fold a real ?query into
    // the hash so deep-link params (?session=, ?profile=) survive conversion.
    const hash = existingHash || '#' + pathTab + (window.location.search || '');
    window.history.replaceState(null, '', window.location.origin + '/' + hash);
  }

  // US-158: Wait for lazy-loader bootstrap before first loadTab
  await waitForLazyLoader();

  // Restore last-visited tab if no hash is present in the URL
  if (!window.location.hash || window.location.hash === '#') {
    const lastTab = localStorage.getItem('rainbow_last_tab');
    if (lastTab && lastTab !== '#' && lastTab !== '#dashboard') {
      window.location.hash = lastTab.replace(/^#/, '');
      // handleNavigation() below will pick up the new hash
    }
  }

  // Profile isolation: wait for the profile switcher to validate the stored
  // profile before the first navigation so the first API calls carry the right
  // x-profile-id header (ready resolves within 3s even if /profiles fails).
  if (window.profileSwitcher && window.profileSwitcher.ready) {
    await window.profileSwitcher.ready;
  }

  // Deep link: honor ?profile= (operator notify links carry the business the
  // chat belongs to — without this, a senai chat is invisible under pelangi).
  const dlProfile = getHashParams().get('profile');
  if (dlProfile && window.profileSwitcher
      && window.profileSwitcher.getActiveProfileId() !== dlProfile) {
    window.profileSwitcher.switchTo(dlProfile);
  }

  // US-809: Initial load with profile-scoped URL handling
  handleNavigation();

  // Header WhatsApp pill: render the real bridge state on EVERY entry point,
  // not just the dashboard tab (deep links used to sit on "Connecting...").
  if (typeof window.refreshWaBadge === 'function') {
    window.refreshWaBadge();
    setInterval(window.refreshWaBadge, 60000);
  }

  // Listen for hash changes
  window.addEventListener('hashchange', handleNavigation);

  // Simple / Advanced pill in the topbar
  const modeToggle = document.getElementById('ui-mode-toggle');
  if (modeToggle) modeToggle.addEventListener('click', toggleUiMode);

  // Add click handlers
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const tabName = tabNameMapping[btn.dataset.tab] || btn.dataset.tab;

      // US-809: Include profileId for profile-specific tabs
      if (tabName === 'master') {
        window.location.hash = 'master/' + (window.activeMasterTab || 'numbers');
      } else if (tabName === 'responses' && getUiMode() === 'simple') {
        // Simple "Knowledge" → straight to the KB editor sub-tab.
        const activeProfile = (window.profileSwitcher && window.profileSwitcher.getActiveProfileId()) || 'pelangi';
        window.location.hash = 'responses/' + activeProfile + '/knowledge-base';
      } else if (PROFILE_SPECIFIC_TABS.includes(tabName)) {
        const activeProfile = (window.profileSwitcher && window.profileSwitcher.getActiveProfileId()) || 'pelangi';
        window.location.hash = tabName + '/' + activeProfile;
      } else {
        window.location.hash = tabName;
      }
      // hashchange event will trigger handleNavigation -> loadTab
    });
  });

  console.log('[Tabs] Initialized with lazy-loading and profile-scoped URLs');
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTabs);
} else {
  initTabs();
}

// Export functions to global scope
window.loadTab = loadTab;
window.initTabs = initTabs;
window.getTabInfoFromUrl = getTabInfoFromUrl;
