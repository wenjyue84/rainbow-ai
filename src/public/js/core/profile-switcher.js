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
  var profiles = [];
  var defaultProfileId = 'pelangi';
  var activeProfileId = localStorage.getItem(STORAGE_KEY) || '';
  var dropdownOpen = false;

  var switcher = {
    /** Get the active profile ID (empty string = default) */
    getActiveProfileId: function () {
      return activeProfileId || defaultProfileId;
    },

    /** Get headers to inject into fetch calls */
    getHeaders: function () {
      var id = activeProfileId || defaultProfileId;
      if (!id || id === defaultProfileId) return {};
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

    /** US-809: Apply profile switch state without changing URL (used by tabs.js hashchange) */
    _applyProfileSwitch: function (profileId) {
      activeProfileId = profileId;
      localStorage.setItem(STORAGE_KEY, profileId);
      this.renderLabel();
      this.renderDropdown();

      // Clear cacheManager so stale data from previous profile is gone
      if (window.cacheManager && typeof window.cacheManager.clearAll === 'function') {
        window.cacheManager.clearAll();
      }

      // Reset global cached state vars to their defaults (from state.js)
      cachedRouting = {};
      cachedKnowledge = { static: [], dynamic: {} };
      cachedWorkflows = { workflows: [] };
      cachedSettings = null;
      cachedIntentNames = [];
    },

    /** Switch to a profile by ID — updates URL for profile-specific tabs */
    switchTo: function (profileId) {
      this._applyProfileSwitch(profileId);
      this.close();

      // US-809: Update URL hash for profile-specific tabs
      var tabInfo = typeof window.getTabInfoFromUrl === 'function'
        ? window.getTabInfoFromUrl()
        : { main: 'dashboard', profileId: null, sub: null };

      if (window.PROFILE_SPECIFIC_TABS &&
          window.PROFILE_SPECIFIC_TABS.indexOf(tabInfo.main) !== -1) {
        var newHash = tabInfo.main + '/' + profileId;
        if (tabInfo.sub) newHash += '/' + tabInfo.sub;
        window.location.hash = newHash;
        // hashchange will trigger loadTab
      } else {
        // Global tab — reload directly
        if (typeof window.loadTab === 'function') {
          window.loadTab(tabInfo.main, tabInfo.sub);
        }
      }
    },

    /** Render the button label */
    renderLabel: function () {
      var label = document.getElementById('profile-switcher-label');
      if (!label) return;
      var current = profiles.find(function (p) { return p.id === (activeProfileId || defaultProfileId); });
      label.textContent = current ? current.name : 'Select Property';
    },

    /** Render dropdown items */
    renderDropdown: function () {
      var dd = document.getElementById('profile-switcher-dropdown');
      if (!dd) return;
      var currentId = activeProfileId || defaultProfileId;
      var html = '';
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
      dd.innerHTML = html;
    },

    /** Load profiles from API and initialize */
    init: function () {
      var self = this;
      fetch(API + '/profiles', { cache: 'no-store' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          profiles = (data.profiles || []).filter(function (p) { return p.enabled; });
          defaultProfileId = data.defaultProfileId || 'pelangi';
          // Validate stored profile still exists
          if (activeProfileId && !profiles.find(function (p) { return p.id === activeProfileId; })) {
            activeProfileId = '';
            localStorage.removeItem(STORAGE_KEY);
          }
          self.renderLabel();
          self.renderDropdown();
          // Hide switcher if only 1 profile
          var el = document.getElementById('profile-switcher');
          if (el && profiles.length <= 1) el.style.display = 'none';

          // US-809: Expose known profile IDs for URL parsing in tabs.js
          window.KNOWN_PROFILE_IDS = profiles.map(function (p) { return p.id; });

          // US-809: Re-check URL for profile-scoped navigation now that IDs are known
          if (typeof window.getTabInfoFromUrl === 'function') {
            var urlInfo = window.getTabInfoFromUrl();
            if (urlInfo.profileId && urlInfo.profileId !== (activeProfileId || defaultProfileId)) {
              // URL specifies a different profile — switch to it and reload tab
              self._applyProfileSwitch(urlInfo.profileId);
              if (typeof window.loadTab === 'function') {
                window.loadTab(urlInfo.main, urlInfo.sub);
              }
            } else if (window.PROFILE_SPECIFIC_TABS &&
                       window.PROFILE_SPECIFIC_TABS.indexOf(urlInfo.main) !== -1 &&
                       !urlInfo.profileId) {
              // Profile-specific tab without profileId — redirect to include it
              var pid = activeProfileId || defaultProfileId;
              window.location.hash = urlInfo.main + '/' + pid + (urlInfo.sub ? '/' + urlInfo.sub : '');
            }
          }
        })
        .catch(function (err) {
          console.warn('[ProfileSwitcher] Failed to load profiles:', err.message);
          var label = document.getElementById('profile-switcher-label');
          if (label) label.textContent = 'Pelangi Capsule Hostel';
        });
    }
  };

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

  // Expose globally
  window.profileSwitcher = switcher;

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { switcher.init(); });
  } else {
    switcher.init();
  }
})();
