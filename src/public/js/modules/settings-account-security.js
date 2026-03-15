/**
 * settings-account-security.js
 *
 * Account Security tab for the Settings panel.
 *
 * WCAG 2.2 SC 3.3.8 (Accessible Authentication Minimum, Level AA) compliance:
 * - All credential inputs carry appropriate autocomplete attributes so that
 *   password managers and browsers can autofill without user involvement.
 * - Paste is NEVER blocked on credential inputs (no onpaste="return false").
 * - No image-recognition CAPTCHA is used.
 *
 * Autocomplete values used:
 *   username input   → autocomplete="username"
 *   password input   → autocomplete="current-password"
 *   TOTP / OTP input → autocomplete="one-time-code"
 *   new-password     → autocomplete="new-password"  (register form)
 */

import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml as esc } from '../core/utils.js';

// ─── Public entry-point ────────────────────────────────────────────────────────

export function renderAccountSecurityTab(container) {
  container.innerHTML = buildTabHtml();
  attachEventListeners(container);
}

// ─── HTML template ─────────────────────────────────────────────────────────────

function buildTabHtml() {
  return `
    <div class="space-y-6 max-w-lg">

      <!-- Section heading -->
      <div>
        <h3 class="text-base font-semibold text-neutral-800">Account Security</h3>
        <p class="text-sm text-neutral-500 mt-1">
          Manage admin credentials and two-factor authentication (2FA).
          All credential fields support password-manager autofill and copy-paste
          in compliance with WCAG 2.2 SC 3.3.8.
        </p>
      </div>

      <!-- ── Login / verify identity ───────────────────────────────────────── -->
      <div class="rounded-xl border border-neutral-200 bg-white p-5 space-y-4">
        <h4 class="text-sm font-semibold text-neutral-700">Verify Identity</h4>
        <p class="text-xs text-neutral-500">
          Enter your admin credentials to access account security actions below.
        </p>

        <!-- Username -->
        <div>
          <label for="sec-username" class="block text-xs font-medium text-neutral-600 mb-1">
            Username
          </label>
          <!--
            autocomplete="username" — WCAG 2.2 SC 3.3.8 / HTML spec:
            Allows browsers and password managers to autofill the username field.
          -->
          <input
            id="sec-username"
            type="text"
            name="username"
            autocomplete="username"
            placeholder="admin"
            class="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <!-- Password -->
        <div>
          <label for="sec-password" class="block text-xs font-medium text-neutral-600 mb-1">
            Password
          </label>
          <!--
            autocomplete="current-password" — WCAG 2.2 SC 3.3.8 / HTML spec:
            Allows password managers to autofill the current password.
            Do NOT use autocomplete="off" on credential fields — that would
            violate WCAG 2.2 SC 3.3.8 by forcing manual re-entry.
          -->
          <input
            id="sec-password"
            type="password"
            name="password"
            autocomplete="current-password"
            placeholder="••••••••"
            class="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <button
          id="sec-verify-btn"
          onclick="window._secVerifyIdentity()"
          class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition"
        >
          Verify
        </button>

        <!-- 2FA challenge (shown only when server returns requires2fa) -->
        <div id="sec-totp-section" class="hidden space-y-3 pt-2 border-t border-neutral-100">
          <p class="text-xs text-neutral-500">
            Your account has two-factor authentication enabled. Enter the 6-digit code
            from your authenticator app.
          </p>
          <div>
            <label for="sec-totp-code" class="block text-xs font-medium text-neutral-600 mb-1">
              Authenticator Code
            </label>
            <!--
              autocomplete="one-time-code" — WCAG 2.2 SC 3.3.8 / HTML spec:
              Allows browsers and password managers to autofill OTP / TOTP codes.
              Paste MUST be permitted — paste-blocking (onpaste="return false") is
              prohibited by WCAG 2.2 SC 3.3.8.
            -->
            <input
              id="sec-totp-code"
              type="text"
              inputmode="numeric"
              pattern="[0-9]{6}"
              maxlength="6"
              autocomplete="one-time-code"
              placeholder="123456"
              class="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <button
            id="sec-totp-btn"
            onclick="window._secVerifyTotp()"
            class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition"
          >
            Confirm Code
          </button>
        </div>

        <div id="sec-identity-status" class="hidden"></div>
      </div>

      <!-- ── 2FA management (shown after successful identity verification) ─── -->
      <div id="sec-2fa-section" class="hidden rounded-xl border border-neutral-200 bg-white p-5 space-y-4">
        <h4 class="text-sm font-semibold text-neutral-700">Two-Factor Authentication</h4>
        <div id="sec-2fa-status-badge"></div>

        <!-- Enable 2FA -->
        <div id="sec-enable-2fa" class="hidden space-y-3">
          <p class="text-xs text-neutral-500">
            Scan the QR code below with your authenticator app (e.g. Google Authenticator,
            Authy, Bitwarden) then enter the generated code to confirm enrolment.
          </p>
          <button
            onclick="window._secSetup2fa()"
            class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition"
          >
            Set Up 2FA
          </button>
          <div id="sec-qr-section" class="hidden space-y-3">
            <div id="sec-qr-code" class="flex justify-center"></div>
            <p class="text-xs text-neutral-500 text-center">
              Can't scan? Enter this secret manually:
            </p>
            <code id="sec-totp-secret"
              class="block text-center text-xs font-mono bg-neutral-50 border border-neutral-200 rounded px-3 py-2 break-all select-all"
            ></code>
            <div>
              <label for="sec-enrol-code" class="block text-xs font-medium text-neutral-600 mb-1">
                Confirm Code
              </label>
              <!--
                autocomplete="one-time-code" — WCAG 2.2 SC 3.3.8:
                Allows autofill of the enrolment confirmation OTP.
              -->
              <input
                id="sec-enrol-code"
                type="text"
                inputmode="numeric"
                pattern="[0-9]{6}"
                maxlength="6"
                autocomplete="one-time-code"
                placeholder="123456"
                class="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <button
              onclick="window._secConfirmEnrol()"
              class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition"
            >
              Confirm Enrolment
            </button>
          </div>
        </div>

        <!-- Disable 2FA -->
        <div id="sec-disable-2fa" class="hidden space-y-3">
          <p class="text-xs text-amber-600">
            Two-factor authentication is currently <strong>enabled</strong>. Disabling it
            reduces your account security.
          </p>
          <button
            onclick="window._secDisable2fa()"
            class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition"
          >
            Disable 2FA
          </button>
        </div>
      </div>

    </div>
  `;
}

// ─── State ─────────────────────────────────────────────────────────────────────

let _state = {
  username: '',
  challengeToken: null,   // set when server returns requires2fa
  authenticated: false,
  totpEnabled: false,
};

// ─── Event wiring ──────────────────────────────────────────────────────────────

function attachEventListeners(container) {
  // Allow Enter key in password field to trigger verify
  const pwInput = container.querySelector('#sec-password');
  if (pwInput) {
    pwInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') window._secVerifyIdentity();
    });
  }

  // Allow Enter key in TOTP code field to confirm
  const totpInput = container.querySelector('#sec-totp-code');
  if (totpInput) {
    totpInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') window._secVerifyTotp();
    });
  }

  // Allow Enter in enrolment code field
  const enrolInput = container.querySelector('#sec-enrol-code');
  if (enrolInput) {
    enrolInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') window._secConfirmEnrol();
    });
  }
}

// ─── Actions (exposed as window._ to allow inline onclick attributes) ──────────

/** Step 1: username + password login */
window._secVerifyIdentity = async function () {
  const username = document.getElementById('sec-username')?.value?.trim();
  const password = document.getElementById('sec-password')?.value;

  if (!username || !password) {
    toast('Please enter both username and password.', 'error');
    return;
  }

  const btn = document.getElementById('sec-verify-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }

  try {
    const data = await api('/auth/login', { method: 'POST', body: { username, password } });

    _state.username = username;

    if (data.requires2fa) {
      // Show TOTP challenge input
      _state.challengeToken = data.challengeToken;
      document.getElementById('sec-totp-section')?.classList.remove('hidden');
      document.getElementById('sec-totp-code')?.focus();
      setIdentityStatus('2FA code required. Check your authenticator app.', 'info');
    } else {
      // Authenticated without 2FA
      _state.authenticated = true;
      _state.totpEnabled = false;
      onAuthenticated(username, false);
    }
  } catch (err) {
    setIdentityStatus(err.message || 'Invalid credentials.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Verify'; }
  }
};

/** Step 2 (optional): TOTP code after username/password */
window._secVerifyTotp = async function () {
  const token = document.getElementById('sec-totp-code')?.value?.trim();
  if (!token) { toast('Enter the 6-digit code.', 'error'); return; }

  const btn = document.getElementById('sec-totp-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Confirming…'; }

  try {
    await api('/auth/verify-totp', {
      method: 'POST',
      body: { challengeToken: _state.challengeToken, token },
    });

    _state.authenticated = true;
    _state.totpEnabled = true;
    onAuthenticated(_state.username, true);
  } catch (err) {
    setIdentityStatus(err.message || 'Invalid code. Try again.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Code'; }
  }
};

/** Show 2FA management UI after successful auth */
function onAuthenticated(username, totpEnabled) {
  _state.totpEnabled = totpEnabled;
  setIdentityStatus(`Verified as <strong>${esc(username)}</strong>.`, 'success');

  const section2fa = document.getElementById('sec-2fa-section');
  if (!section2fa) return;
  section2fa.classList.remove('hidden');

  const badge = document.getElementById('sec-2fa-status-badge');
  if (badge) {
    badge.innerHTML = totpEnabled
      ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">✓ 2FA Enabled</span>'
      : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 text-xs font-bold">2FA Disabled</span>';
  }

  document.getElementById('sec-enable-2fa')?.classList.toggle('hidden', totpEnabled);
  document.getElementById('sec-disable-2fa')?.classList.toggle('hidden', !totpEnabled);
}

/** Begin 2FA setup — fetch QR code + secret */
window._secSetup2fa = async function () {
  const username = _state.username;
  const password = document.getElementById('sec-password')?.value;

  try {
    const data = await api('/auth/setup-2fa', { method: 'POST', body: { username, password } });

    document.getElementById('sec-qr-section')?.classList.remove('hidden');
    document.getElementById('sec-totp-secret').textContent = data.secret || '';

    // Render QR code as image via otpauth URI
    const qrDiv = document.getElementById('sec-qr-code');
    if (qrDiv && data.otpauthUri) {
      // Use a public QR code API to render the code (no external tracking — data encoded in URL)
      const encoded = encodeURIComponent(data.otpauthUri);
      qrDiv.innerHTML = `<img
        src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encoded}"
        alt="Scan this QR code with your authenticator app"
        width="180" height="180"
        class="rounded border border-neutral-200"
      />`;
    }
  } catch (err) {
    toast(err.message || 'Failed to start 2FA setup.', 'error');
  }
};

/** Confirm 2FA enrolment with the user's first TOTP code */
window._secConfirmEnrol = async function () {
  const username = _state.username;
  const password = document.getElementById('sec-password')?.value;
  const token = document.getElementById('sec-enrol-code')?.value?.trim();

  if (!token) { toast('Enter the 6-digit code from your authenticator.', 'error'); return; }

  try {
    await api('/auth/verify-setup', { method: 'POST', body: { username, password, token } });
    toast('Two-factor authentication enabled successfully.', 'success');
    onAuthenticated(username, true);
    document.getElementById('sec-qr-section')?.classList.add('hidden');
  } catch (err) {
    toast(err.message || 'Invalid code. Try again.', 'error');
  }
};

/** Disable 2FA (requires a fresh TOTP token entered inline) */
window._secDisable2fa = async function () {
  const username = _state.username;
  const password = document.getElementById('sec-password')?.value;

  // Prompt for a fresh TOTP before disabling
  const token = prompt('Enter your current 6-digit authenticator code to disable 2FA:');
  if (!token) return;

  try {
    await api('/auth/disable-2fa', { method: 'POST', body: { username, password, token } });
    toast('Two-factor authentication disabled.', 'success');
    onAuthenticated(username, false);
  } catch (err) {
    toast(err.message || 'Failed to disable 2FA.', 'error');
  }
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function setIdentityStatus(html, type) {
  const el = document.getElementById('sec-identity-status');
  if (!el) return;
  el.classList.remove('hidden');
  const colours = {
    success: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    error:   'text-red-700 bg-red-50 border-red-200',
    info:    'text-blue-700 bg-blue-50 border-blue-200',
  };
  el.className = `text-xs rounded-lg border px-3 py-2 ${colours[type] || colours.info}`;
  el.innerHTML = html;
}
