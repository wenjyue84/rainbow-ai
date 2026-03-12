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

    /** Switch to a profile by ID */
    switchTo: function (profileId) {
      activeProfileId = profileId;
      localStorage.setItem(STORAGE_KEY, profileId);
      this.close();
      this.renderLabel();
      this.renderDropdown();
      // Reload current tab data with new profile context
      if (typeof window.reloadCurrentTab === 'function') {
        window.reloadCurrentTab();
      } else if (typeof window.loadTab === 'function') {
        // Find the active tab and reload it
        var activeTab = document.querySelector('.tab-content:not([style*="display: none"])');
        if (activeTab) {
          var tabName = activeTab.id.replace('tab-', '');
          window.loadTab(tabName);
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
          + (isActive ? '<svg class="w-4 h-4 ml-auto text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>' : '')
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
