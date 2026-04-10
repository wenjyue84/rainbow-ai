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

    /** Switch to a profile by ID — updates URL for profile-specific tabs (US-809) */
    switchTo: function (profileId) {
      activeProfileId = profileId;
      localStorage.setItem(STORAGE_KEY, profileId);
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

    /** Show add-business-profile wizard */
    showAddWizard: function () {
      this.close();
      wizardState.step = 1;
      wizardState.name = '';
      wizardState.profileId = '';
      wizardState.sourceId = defaultProfileId;
      var modal = document.getElementById('add-profile-wizard-modal');
      if (!modal) return;
      modal.classList.remove('hidden');
      renderWizardStep();
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
          // Validate stored profile still exists
          if (activeProfileId && !profiles.find(function (p) { return p.id === activeProfileId; })) {
            activeProfileId = '';
            localStorage.removeItem(STORAGE_KEY);
          }
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
                if (activeProfileId && !profiles.find(function (p) { return p.id === activeProfileId; })) {
                  activeProfileId = '';
                  localStorage.removeItem(STORAGE_KEY);
                }
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

  // ─── Add-Business-Profile Wizard ────────────────────────────────────
  var wizardState = { step: 1, name: '', profileId: '', sourceId: '' };

  function slugify(str) {
    return str.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/[\s]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 40);
  }

  function renderWizardStep() {
    var s1 = document.getElementById('wizard-step-1');
    var s2 = document.getElementById('wizard-step-2');
    var s3 = document.getElementById('wizard-step-3');
    var s4 = document.getElementById('wizard-step-4');
    [s1, s2, s3, s4].forEach(function (el) { if (el) el.classList.add('hidden'); });

    var stepEl = document.getElementById('wizard-step-' + wizardState.step);
    if (stepEl) stepEl.classList.remove('hidden');

    // Update step indicators
    for (var i = 1; i <= 3; i++) {
      var dot = document.getElementById('wizard-dot-' + i);
      if (!dot) continue;
      dot.className = 'w-2.5 h-2.5 rounded-full transition-colors ' + (i === wizardState.step ? 'bg-primary-500' : (i < wizardState.step ? 'bg-primary-300' : 'bg-neutral-300'));
    }

    if (wizardState.step === 1) {
      var nameEl = document.getElementById('wizard-name');
      var idEl = document.getElementById('wizard-id');
      if (nameEl) nameEl.value = wizardState.name;
      if (idEl) idEl.value = wizardState.profileId;
    }
    if (wizardState.step === 2) {
      renderWizardTemplates();
    }
    if (wizardState.step === 3) {
      renderWizardReview();
    }
  }

  function renderWizardTemplates() {
    var container = document.getElementById('wizard-templates');
    if (!container) return;
    var html = '';
    for (var i = 0; i < profiles.length; i++) {
      var p = profiles[i];
      var isSelected = wizardState.sourceId === p.id;
      html += '<label class="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition '
        + (isSelected ? 'border-primary-400 bg-primary-50' : 'border-neutral-200 hover:border-neutral-300 bg-white')
        + '">'
        + '<input type="radio" name="wizard-source" value="' + escHtml(p.id) + '" '
        + (isSelected ? 'checked' : '')
        + ' onchange="window.profileSwitcher._wizardSelectSource(\'' + escHtml(p.id) + '\')" class="text-primary-500">'
        + '<div class="min-w-0">'
        + '<div class="text-sm font-medium text-neutral-800">' + escHtml(p.name) + '</div>'
        + '<div class="text-xs text-neutral-500">Clone from ' + escHtml(p.id) + '</div>'
        + '</div>'
        + '</label>';
    }
    container.innerHTML = html;
  }

  function renderWizardReview() {
    var el = document.getElementById('wizard-review');
    if (!el) return;
    var sourceName = '';
    var found = profiles.find(function (p) { return p.id === wizardState.sourceId; });
    if (found) sourceName = found.name;
    el.innerHTML = '<dl class="space-y-3 text-sm">'
      + '<div class="flex justify-between"><dt class="text-neutral-500">Business Name</dt><dd class="font-semibold text-neutral-800">' + escHtml(wizardState.name) + '</dd></div>'
      + '<div class="flex justify-between"><dt class="text-neutral-500">Profile ID</dt><dd class="font-mono text-xs bg-neutral-100 px-2 py-0.5 rounded text-neutral-700">' + escHtml(wizardState.profileId) + '</dd></div>'
      + '<div class="flex justify-between"><dt class="text-neutral-500">Template</dt><dd class="font-semibold text-neutral-800">' + escHtml(sourceName || wizardState.sourceId) + '</dd></div>'
      + '</dl>'
      + '<p class="mt-4 text-xs text-neutral-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">The new profile will be created but requires a server restart to become active.</p>';
  }

  // Expose for inline onchange
  switcher._wizardSelectSource = function (id) {
    wizardState.sourceId = id;
    renderWizardTemplates();
  };

  switcher.wizardNext = function () {
    if (wizardState.step === 1) {
      var nameEl = document.getElementById('wizard-name');
      var idEl = document.getElementById('wizard-id');
      var name = nameEl ? nameEl.value.trim() : '';
      var profileId = idEl ? idEl.value.trim() : '';
      if (!name) { var err = document.getElementById('wizard-name-error'); if (err) { err.textContent = 'Business name is required'; err.classList.remove('hidden'); } return; }
      if (!profileId || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(profileId) && !/^[a-z0-9]$/.test(profileId)) {
        var err2 = document.getElementById('wizard-id-error'); if (err2) { err2.textContent = 'Profile ID must be lowercase letters, numbers, and hyphens'; err2.classList.remove('hidden'); } return;
      }
      wizardState.name = name;
      wizardState.profileId = profileId;
    }
    wizardState.step = Math.min(wizardState.step + 1, 3);
    renderWizardStep();
  };

  switcher.wizardBack = function () {
    wizardState.step = Math.max(wizardState.step - 1, 1);
    renderWizardStep();
  };

  switcher.wizardCreate = function () {
    var btn = document.getElementById('wizard-create-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

    fetch(API + '/profiles/' + encodeURIComponent(wizardState.sourceId) + '/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': (window.__ADMIN_KEY__ || '') },
      body: JSON.stringify({ newProfileId: wizardState.profileId, displayName: wizardState.name })
    })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
      .then(function (result) {
        wizardState.step = 4;
        var s1 = document.getElementById('wizard-step-1');
        var s2 = document.getElementById('wizard-step-2');
        var s3 = document.getElementById('wizard-step-3');
        var s4 = document.getElementById('wizard-step-4');
        [s1, s2, s3].forEach(function (el) { if (el) el.classList.add('hidden'); });
        if (s4) s4.classList.remove('hidden');
        var resultEl = document.getElementById('wizard-result');
        if (resultEl) {
          if (result.ok) {
            resultEl.innerHTML = '<div class="text-center py-4">'
              + '<div class="text-4xl mb-3">🎉</div>'
              + '<p class="font-semibold text-neutral-800 mb-1">Profile created!</p>'
              + '<p class="text-sm text-neutral-500 mb-4">Restart the server to activate <span class="font-mono bg-neutral-100 px-1 rounded">' + escHtml(wizardState.profileId) + '</span>.</p>'
              + '<p class="text-xs text-neutral-400">Cloned from: ' + escHtml(wizardState.sourceId) + ' (' + (result.data.copied || []).length + ' config files)</p>'
              + '</div>';
          } else {
            resultEl.innerHTML = '<div class="text-center py-4">'
              + '<div class="text-4xl mb-3">⚠️</div>'
              + '<p class="font-semibold text-danger-600 mb-1">Creation failed</p>'
              + '<p class="text-sm text-neutral-500">' + escHtml(result.data.error || 'Unknown error') + '</p>'
              + '</div>';
          }
        }
        if (btn) { btn.disabled = false; btn.textContent = 'Create Profile'; }
      })
      .catch(function (err) {
        var s3 = document.getElementById('wizard-step-3');
        var s4 = document.getElementById('wizard-step-4');
        if (s3) s3.classList.add('hidden');
        if (s4) s4.classList.remove('hidden');
        var resultEl = document.getElementById('wizard-result');
        if (resultEl) resultEl.innerHTML = '<div class="text-center py-4"><div class="text-4xl mb-3">⚠️</div><p class="font-semibold text-danger-600 mb-1">Request failed</p><p class="text-sm text-neutral-500">' + escHtml(err.message) + '</p></div>';
        if (btn) { btn.disabled = false; btn.textContent = 'Create Profile'; }
      });
  };

  switcher.wizardClose = function () {
    var modal = document.getElementById('add-profile-wizard-modal');
    if (modal) modal.classList.add('hidden');
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
