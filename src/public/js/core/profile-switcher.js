/**
 * profile-switcher.js — Profile switcher for multi-property dashboard
 *
 * Loads profiles from /api/rainbow/profiles, renders a dropdown in the topbar,
 * and injects x-profile-id header into all API calls when a non-default profile is active.
 *
 * Persists selected profile to localStorage.
 * Depends on: var API (from state.js)
 */
(function () {
  var STORAGE_KEY = 'rainbow_active_profile';
  // ⚙ Master (2026-09-08): a fixed, non-business entry in the switcher for
  // things that affect every profile (numbers, assistants, global defaults,
  // users). Not a profile id the server knows — API calls carry NO
  // x-profile-id while it is selected, and only the Master tab is shown.
  var MASTER_ID = '__master__';
  var LAST_REAL_KEY = 'rainbow_last_business_profile';
  var profiles = [];
  var defaultProfileId = 'pelangi';
  var activeProfileId = localStorage.getItem(STORAGE_KEY) || '';
  var dropdownOpen = false;

  // Promise that resolves after init() has validated the stored profile ID.
  // Callers (e.g. loadLiveChat) await this before sending x-profile-id headers
  // to prevent stale-localStorage race conditions on hard refresh.
  var _readyResolve;
  var ready = new Promise(function (resolve) { _readyResolve = resolve; });

  function canMaster() {
    var s = window.__SESSION__;
    return !(s && Array.isArray(s.tenants) && s.tenants.length > 0);
  }

  var switcher = {
    MASTER_ID: MASTER_ID,

    /** True while "⚙ Master · All businesses" is selected. */
    isMaster: function () { return activeProfileId === MASTER_ID; },

    /** Whether this session may open Master (unscoped admins only). */
    canMaster: canMaster,

    /** Get the active profile ID (empty string = default; '__master__' for Master) */
    getActiveProfileId: function () {
      return activeProfileId || defaultProfileId;
    },

    /** The business profile to return to when leaving Master (never Master). */
    getBusinessProfileId: function () {
      if (activeProfileId && activeProfileId !== MASTER_ID) return activeProfileId;
      var last = localStorage.getItem(LAST_REAL_KEY) || '';
      if (last && profiles.find(function (p) { return p.id === last; })) return last;
      return defaultProfileId;
    },

    /** Get headers to inject into fetch calls */
    getHeaders: function () {
      var id = activeProfileId || defaultProfileId;
      if (!id || id === defaultProfileId || id === MASTER_ID) return {};
      return { 'x-profile-id': id };
    },

    /** Toggle dropdown visibility */
    toggle: function () {
      dropdownOpen = !dropdownOpen;
      var dd = document.getElementById('profile-switcher-dropdown');
      var chevron = document.getElementById('profile-switcher-chevron');
      if (dd) dd.classList.toggle('hidden', !dropdownOpen);
      if (chevron) chevron.style.transform = dropdownOpen ? 'rotate(180deg)' : '';
    },

    /** Close dropdown */
    close: function () {
      dropdownOpen = false;
      var dd = document.getElementById('profile-switcher-dropdown');
      var chevron = document.getElementById('profile-switcher-chevron');
      if (dd) dd.classList.add('hidden');
      if (chevron) chevron.style.transform = '';
    },

    /** Switch to a profile by ID — updates URL for profile-specific tabs (US-809) */
    switchTo: function (profileId) {
      if (profileId === MASTER_ID && !canMaster()) return;
      var wasMaster = activeProfileId === MASTER_ID;
      activeProfileId = profileId;
      localStorage.setItem(STORAGE_KEY, profileId);
      if (profileId !== MASTER_ID) localStorage.setItem(LAST_REAL_KEY, profileId);
      this.close();
      this.renderLabel();
      this.renderDropdown();

      // 1. Clear cacheManager so stale data from previous profile is gone
      if (window.cacheManager && typeof window.cacheManager.clearAll === 'function') {
        window.cacheManager.clearAll();
      }

      // 2. Reset global cached state vars to their defaults (from state.js)
      cachedRouting = {};
      cachedKnowledge = { static: [], dynamic: {} };
      cachedWorkflows = { workflows: [] };
      cachedSettings = null;
      cachedIntentNames = [];

      // 3. Get current tab info
      var tabInfo = typeof window.getTabInfoFromUrl === 'function'
        ? window.getTabInfoFromUrl()
        : { main: 'dashboard', profileId: null, sub: null };

      // 3b. Master in / out: Master has exactly one tab; a business has none of it.
      if (profileId === MASTER_ID) {
        var msub = tabInfo.main === 'master' && tabInfo.sub ? tabInfo.sub : 'numbers';
        history.replaceState(null, '', '#master/' + msub);
        if (typeof window.loadTab === 'function') window.loadTab('master', msub);
        return;
      }
      if (wasMaster || tabInfo.main === 'master') {
        history.replaceState(null, '', '#dashboard/' + profileId);
        if (typeof window.loadTab === 'function') window.loadTab('dashboard', null);
        return;
      }

      // 4. US-809: Update URL hash for profile-specific tabs
      //    Use replaceState to avoid triggering hashchange loop
      var profileTabs = window.PROFILE_SPECIFIC_TABS || [];
      if (profileTabs.indexOf(tabInfo.main) !== -1) {
        var sub = (tabInfo.sub && tabInfo.sub !== profileId) ? '/' + tabInfo.sub : '';
        var newHash = '#' + tabInfo.main + '/' + profileId + sub;
        history.replaceState(null, '', newHash);
      }

      // 5. Reload the active tab with new profile context
      if (typeof window.loadTab === 'function') {
        window.loadTab(tabInfo.main, tabInfo.sub);
      }
    },

    /** Render the button label */
    renderLabel: function () {
      var label = document.getElementById('profile-switcher-label');
      if (!label) return;
      if (activeProfileId === MASTER_ID) { label.textContent = '⚙ Master'; return; }
      var current = profiles.find(function (p) { return p.id === (activeProfileId || defaultProfileId); });
      label.textContent = current ? current.name : 'Select Property';
    },

    /** Render dropdown items */
    renderDropdown: function () {
      var dd = document.getElementById('profile-switcher-dropdown');
      if (!dd) return;
      var currentId = activeProfileId || defaultProfileId;
      var html = '';
      // Fixed first item: ⚙ Master · All businesses (unscoped admins only).
      if (canMaster()) {
        var mActive = currentId === MASTER_ID;
        html += '<button onclick="window.profileSwitcher.switchTo(\'' + MASTER_ID + '\')" '
          + 'class="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition '
          + (mActive ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-neutral-700 hover:bg-neutral-50')
          + '" title="WhatsApp numbers, assistants, global defaults and users — for every business">'
          + '<span class="w-2 h-2 rounded-full flex-shrink-0 ' + (mActive ? 'bg-primary-500' : 'bg-neutral-300') + '"></span>'
          + '<span>⚙ Master <span class="text-neutral-400 font-normal">· All businesses</span></span>'
          + (mActive ? '<svg class="w-4 h-4 ml-auto text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>' : '')
          + '</button>'
          + '<div class="border-t border-neutral-100 my-1"></div>';
      }
      for (var i = 0; i < profiles.length; i++) {
        var p = profiles[i];
        var isActive = p.id === currentId;

        // External link icon — shown for non-active profiles that have a siteUrl set in profiles.json
        // Profile → siteUrl mapping (to verify in Vercel deployment):
        //   pelangi       → https://pelangicapsulehostel.com/
        //   southern      → https://pms-southern.vercel.app/
        //   makan-moments → https://fnb-online-order.vercel.app/en
        //   pms-capsule   → https://pms-capsule.vercel.app/
        //   pms-southern  → https://pms-southern.vercel.app/
        var externalLinkHtml = p.siteUrl
          ? '<a href="' + escHtml(p.siteUrl) + '" target="_blank" rel="noopener noreferrer" '
            + 'onclick="event.stopPropagation()" '
            + 'class="ml-auto flex-shrink-0 text-neutral-400 hover:text-primary-500 transition-colors" '
            + 'title="Open ' + escHtml(p.name) + ' site">'
            + '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
            + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" '
            + 'd="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>'
            + '</svg></a>'
          : '';

        html += '<button onclick="window.profileSwitcher.switchTo(\'' + p.id + '\')" '
          + 'class="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition '
          + (isActive
            ? 'bg-primary-50 text-primary-700 font-semibold'
            : 'text-neutral-700 hover:bg-neutral-50')
          + '">'
          + '<span class="w-2 h-2 rounded-full flex-shrink-0 '
          + (isActive ? 'bg-primary-500' : 'bg-neutral-300')
          + '"></span>'
          + '<span>' + escHtml(p.name) + '</span>'
          + (isActive
            ? '<svg class="w-4 h-4 ml-auto text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>'
            : externalLinkHtml)
          + '</button>';
      }
      // Add Business Profile button at the bottom
      html += '<div class="border-t border-neutral-100 mt-1 pt-1">'
        + '<button onclick="window.profileSwitcher.showAddWizard()" '
        + 'class="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 text-primary-600 hover:bg-primary-50 transition font-medium">'
        + '<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
        + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>'
        + '</svg>'
        + '<span>Add Business Profile</span>'
        + '</button>'
        + '</div>';

      dd.innerHTML = html;
    },

    /**
     * "+ New business" → the full-page setup wizard (#setup, 2026-09-23).
     * The old 3-step modal (create → restart → SSH) is gone; the wizard
     * creates, pairs, teaches, tests and hands over a login without a restart.
     */
    showAddWizard: function () {
      this.close();
      if (!canMaster()) return;
      window.location.hash = 'setup';
    },

    /** Profiles currently loaded (for the wizard's "copy from" list). */
    listProfiles: function () {
      return profiles.slice();
    },

    /**
     * Re-fetch /profiles (a profile was just created live). Resolves with the
     * list; does not change the active profile.
     */
    reload: function () {
      var self = this;
      return fetch(API + '/profiles', { cache: 'no-store', headers: { 'x-admin-key': (window.__ADMIN_KEY__ || '') } })
        .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
        .then(function (data) {
          profiles = (data.profiles || []).filter(function (p) { return p.enabled; });
          defaultProfileId = data.defaultProfileId || defaultProfileId;
          window.KNOWN_PROFILE_IDS = profiles.map(function (p) { return p.id; });
          self.renderLabel();
          self.renderDropdown();
          return profiles;
        });
    },

    /**
     * Mark a profile active WITHOUT reloading the current tab (the setup
     * wizard keeps its own page while later api() calls carry the new id).
     */
    setActiveQuiet: function (profileId) {
      if (!profileId || profileId === MASTER_ID) return;
      activeProfileId = profileId;
      localStorage.setItem(STORAGE_KEY, profileId);
      localStorage.setItem(LAST_REAL_KEY, profileId);
      if (window.cacheManager && typeof window.cacheManager.clearAll === 'function') window.cacheManager.clearAll();
      this.renderLabel();
      this.renderDropdown();
    },

    /** Load profiles from API and initialize */
    init: function () {
      var self = this;
      fetch(API + '/profiles', { cache: 'no-store', headers: { 'x-admin-key': (window.__ADMIN_KEY__ || '') } })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          profiles = (data.profiles || []).filter(function (p) { return p.enabled; });
          defaultProfileId = data.defaultProfileId || 'pelangi';
          // Validate stored profile still exists (Master survives only for unscoped admins)
          if (activeProfileId === MASTER_ID) {
            if (!canMaster()) { activeProfileId = ''; localStorage.removeItem(STORAGE_KEY); }
          } else if (activeProfileId && !profiles.find(function (p) { return p.id === activeProfileId; })) {
            activeProfileId = '';
            localStorage.removeItem(STORAGE_KEY);
          }
          _readyResolve();
          self.renderLabel();
          self.renderDropdown();
          // Always show switcher (has "Add Business Profile" action)
          var el = document.getElementById('profile-switcher');
          if (el) el.style.display = '';

          // US-809: Expose known profile IDs for URL parsing in tabs.js
          window.KNOWN_PROFILE_IDS = profiles.map(function (p) { return p.id; });

          // US-809: Re-check URL now that profile IDs are confirmed from API
          if (typeof window.getTabInfoFromUrl === 'function') {
            var urlInfo = window.getTabInfoFromUrl();
            var profileTabs = window.PROFILE_SPECIFIC_TABS || [];
            if (urlInfo.profileId && urlInfo.profileId !== (activeProfileId || defaultProfileId)) {
              // URL specifies a different profile — switch to it
              self.switchTo(urlInfo.profileId);
            } else if (profileTabs.indexOf(urlInfo.main) !== -1 && !urlInfo.profileId) {
              // Profile-specific tab without profileId — redirect to include it
              var pid = activeProfileId || defaultProfileId;
              window.location.hash = urlInfo.main + '/' + pid + (urlInfo.sub ? '/' + urlInfo.sub : '');
            }
          }
        })
        .catch(function (err) {
          console.error('[ProfileSwitcher] Failed to load profiles:', err.message, '| key set:', !!window.__ADMIN_KEY__);
          var label = document.getElementById('profile-switcher-label');
          if (label) label.textContent = 'Pelangi Capsule Hostel';
          // Resolve ready after 3s on failure so callers (loadLiveChat) don't hang
          setTimeout(function () { _readyResolve(); }, 3000);
          // Retry once after 2s (handles transient 503/429 after server restart)
          setTimeout(function () {
            fetch(API + '/profiles', { cache: 'no-store', headers: { 'x-admin-key': (window.__ADMIN_KEY__ || '') } })
              .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
              })
              .then(function (data) {
                profiles = (data.profiles || []).filter(function (p) { return p.enabled; });
                defaultProfileId = data.defaultProfileId || 'pelangi';
                if (activeProfileId === MASTER_ID) {
                  if (!canMaster()) { activeProfileId = ''; localStorage.removeItem(STORAGE_KEY); }
                } else if (activeProfileId && !profiles.find(function (p) { return p.id === activeProfileId; })) {
                  activeProfileId = '';
                  localStorage.removeItem(STORAGE_KEY);
                }
                _readyResolve();
                self.renderLabel();
                self.renderDropdown();
                var el = document.getElementById('profile-switcher');
                if (el) el.style.display = '';
                window.KNOWN_PROFILE_IDS = profiles.map(function (p) { return p.id; });
              })
              .catch(function (err2) {
                console.error('[ProfileSwitcher] Retry also failed:', err2.message);
              });
          }, 2000);
        });
    }
  };

  // ─── Add-Business-Profile modal wizard ──────────────────────────────
  // Removed 2026-09-23: replaced by the full-page setup wizard
  // (js/modules/setup.js, #setup). Modal markup + code are in git history.

  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Close dropdown on outside click
  document.addEventListener('click', function (e) {
    var el = document.getElementById('profile-switcher');
    if (el && !el.contains(e.target)) {
      switcher.close();
    }
  });

  // Expose ready promise so callers can await profile validation
  switcher.ready = ready;

  // ── Global profile-header guard ──────────────────────────────────────────
  // Several modules call raw fetch() instead of the api() helper and used to
  // hit /api/rainbow without x-profile-id — the server then served (and wrote!)
  // the DEFAULT profile's data while another business was selected. Patching
  // fetch once here covers every current and future call site.
  var _origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : ((input && input.url) || '');
      var isAdminAPI = url.indexOf('/api/rainbow') === 0
        || url.indexOf(location.origin + '/api/rainbow') === 0;
      if (isAdminAPI) {
        init = init || {};
        var h = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
        var ph = switcher.getHeaders();
        Object.keys(ph).forEach(function (k) {
          if (!h.has(k)) h.set(k, ph[k]);
        });
        init.headers = h;
      }
    } catch (e) { /* header injection must never break a request */ }
    return _origFetch.call(this, input, init);
  };

  // Expose globally
  window.profileSwitcher = switcher;

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { switcher.init(); });
  } else {
    switcher.init();
  }
})();