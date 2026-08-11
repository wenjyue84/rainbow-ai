/**
 * settings-users.js — Admin Users management tab for the Settings page.
 *
 * Calls:
 *   GET    /api/rainbow/admin-users          → list users
 *   POST   /api/rainbow/admin-users          → create user
 *   PUT    /api/rainbow/admin-users/{id}     → update user
 *   DELETE /api/rainbow/admin-users/{id}     → delete user
 *
 * Scoping: if window.__SESSION__ indicates a scoped session, the
 * "All profiles (unrestricted)" option is hidden and own-tenant users only
 * are shown (the server enforces this too — UI mirrors it for UX only).
 */

import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml as esc } from '../core/utils.js';

// ─── State ───────────────────────────────────────────────────────────────────

let _users = [];         // current user list
let _profiles = [];      // profile ids for the tenant selector
let _isScoped = false;   // whether the current session is scoped
let _ownTenants = [];    // tenants the current session is limited to
let _editingId = null;   // user id being edited in the modal (null = create)

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Render the Users tab into `container`.
 * Called by switchSettingsTab('users') in settings.js.
 */
export async function renderUsersTab(container) {
  container.innerHTML = `
    <div class="bg-white border rounded-2xl p-6">
      <div class="flex items-start justify-between mb-6">
        <div>
          <h3 class="font-semibold text-lg flex items-center gap-2">
            <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M12 11c0-1.657-1.343-3-3-3S6 9.343 6 11m0 0c0 1.657 1.343 3 3 3s3-1.343 3-3m0 0h6m-3-3v6" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M17 20H7m10 0a3 3 0 003-3v-1m-3 4a3 3 0 01-3-3m0 0H7m3 3a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v10" />
            </svg>
            Admin Users
          </h3>
          <p class="text-sm text-neutral-500 mt-1 font-medium">Manage who can log in to this dashboard and which profiles they can access.</p>
        </div>
        <button onclick="openUserModal(null)"
          class="px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition text-sm font-bold flex items-center gap-2 shadow-medium">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Add User
        </button>
      </div>

      <!-- Table header -->
      <div class="grid grid-cols-12 gap-2 px-4 py-2 bg-neutral-100 rounded-t-xl text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
        <div class="col-span-3">Username</div>
        <div class="col-span-2">Role</div>
        <div class="col-span-5">Access</div>
        <div class="col-span-2 text-right">Actions</div>
      </div>

      <!-- User rows -->
      <div id="users-list" class="space-y-px border-x border-b rounded-b-xl overflow-hidden mb-6">
        <div class="text-center text-neutral-400 py-12 text-sm bg-white">
          <div class="spinner mx-auto mb-3"></div>
          Loading users...
        </div>
      </div>
    </div>

    <!-- Modal overlay -->
    <div id="user-modal-overlay" class="fixed inset-0 bg-black/50 z-50 hidden flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onclick="event.stopPropagation()">
        <div class="flex items-center justify-between mb-5">
          <h4 id="user-modal-title" class="font-semibold text-lg">Add User</h4>
          <button onclick="closeUserModal()" class="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-xl transition">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-neutral-700 mb-1.5">Username</label>
            <input type="text" id="user-modal-username" placeholder="e.g. dental_operator"
              class="w-full px-4 py-2.5 border rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition" />
          </div>

          <div>
            <label class="block text-xs font-bold text-neutral-700 mb-1.5">
              Password <span id="user-modal-pw-hint" class="text-neutral-400 font-normal">(leave blank to keep current)</span>
            </label>
            <input type="password" id="user-modal-password" placeholder="New password"
              class="w-full px-4 py-2.5 border rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition" />
          </div>

          <div>
            <label class="block text-xs font-bold text-neutral-700 mb-1.5">Role</label>
            <select id="user-modal-role"
              class="w-full px-4 py-2.5 border rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition bg-white">
              <option value="admin">Admin</option>
              <option value="operator" selected>Operator</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-bold text-neutral-700 mb-2">Profile Access</label>
            <div id="user-modal-access" class="space-y-2">
              <!-- Populated by _renderAccessOptions() -->
            </div>
          </div>
        </div>

        <div class="flex gap-3 mt-6">
          <button onclick="closeUserModal()" class="flex-1 px-4 py-2.5 border rounded-xl text-sm font-medium hover:bg-neutral-50 transition">
            Cancel
          </button>
          <button onclick="saveUser()" class="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition">
            Save
          </button>
        </div>
      </div>
    </div>
  `;

  // Detect scoped session from window.__SESSION__ (injected by the SPA bootstrap
  // if available, or detected from the /profiles/active response shape).
  const sess = window.__SESSION__;
  if (sess && sess.allowedTenants && sess.allowedTenants.length > 0) {
    _isScoped = true;
    _ownTenants = sess.allowedTenants;
  } else {
    _isScoped = false;
    _ownTenants = [];
  }

  // Load profiles for the tenant selector.
  try {
    const res = await api('/profiles');
    _profiles = (res.profiles || []).map(p => p.id);
  } catch (_) {
    _profiles = [];
  }

  await _loadUsers();
}
window.renderUsersTab = renderUsersTab;

// ─── Load & Render ────────────────────────────────────────────────────────────

async function _loadUsers() {
  try {
    const res = await api('/admin-users');
    _users = res.users || [];
    _renderUsersList();
  } catch (e) {
    const list = document.getElementById('users-list');
    if (list) {
      list.innerHTML = `<div class="p-6 text-sm text-red-500">Failed to load users: ${esc(e.message || String(e))}</div>`;
    }
  }
}

function _renderUsersList() {
  const list = document.getElementById('users-list');
  if (!list) return;

  if (_users.length === 0) {
    list.innerHTML = `
      <div class="text-center text-neutral-400 py-12 text-sm bg-white">
        No users found. Click "Add User" to create the first one.
      </div>
    `;
    return;
  }

  list.innerHTML = _users.map(u => {
    const accessLabel = (u.allowedTenants && u.allowedTenants.length > 0)
      ? u.allowedTenants.map(t => `<span class="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-[10px] font-bold">${esc(t)}</span>`).join(' ')
      : '<span class="px-2 py-0.5 bg-green-50 text-green-700 rounded-full text-[10px] font-bold">All profiles</span>';

    const roleBadge = u.role === 'admin'
      ? `<span class="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-bold uppercase">${esc(u.role)}</span>`
      : `<span class="px-2 py-0.5 bg-neutral-100 text-neutral-600 rounded-full text-[10px] font-bold uppercase">${esc(u.role)}</span>`;

    return `
      <div class="bg-white px-4 py-3 flex items-center gap-2 group hover:bg-neutral-50 transition-colors">
        <div class="col-span-3 w-3/12 text-sm font-medium text-neutral-800 truncate">${esc(u.username)}</div>
        <div class="col-span-2 w-2/12">${roleBadge}</div>
        <div class="col-span-5 w-5/12 flex flex-wrap gap-1">${accessLabel}</div>
        <div class="col-span-2 w-2/12 text-right flex items-center justify-end gap-1">
          <button onclick="openUserModal(${u.id})"
            class="p-1.5 text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
            title="Edit user">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button onclick="deleteUser(${u.id}, '${esc(u.username)}')"
            class="p-1.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
            title="Delete user">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function _renderAccessOptions(selectedTenants) {
  const container = document.getElementById('user-modal-access');
  if (!container) return;

  const isScoped = _isScoped;
  const rows = [];

  // "All profiles" option — only for unrestricted sessions.
  if (!isScoped) {
    const checked = !selectedTenants || selectedTenants.length === 0;
    rows.push(`
      <label class="flex items-center gap-3 p-3 rounded-xl border hover:bg-neutral-50 cursor-pointer transition">
        <input type="radio" name="user-access-type" value="all" ${checked ? 'checked' : ''}
          onchange="toggleAccessType(this.value)"
          class="w-4 h-4 text-indigo-600 border-neutral-300 focus:ring-indigo-500">
        <div>
          <span class="text-sm font-medium text-neutral-800">All profiles (unrestricted)</span>
          <span class="block text-xs text-neutral-500">Full access to all profiles and global settings</span>
        </div>
      </label>
    `);
  }

  const scopedChecked = isScoped || (selectedTenants && selectedTenants.length > 0);
  rows.push(`
    <label class="flex items-center gap-3 p-3 rounded-xl border hover:bg-neutral-50 cursor-pointer transition">
      <input type="radio" name="user-access-type" value="scoped" ${scopedChecked ? 'checked' : ''}
        onchange="toggleAccessType(this.value)"
        class="w-4 h-4 text-indigo-600 border-neutral-300 focus:ring-indigo-500">
      <div>
        <span class="text-sm font-medium text-neutral-800">Specific profiles only</span>
        <span class="block text-xs text-neutral-500">Restrict to selected profiles</span>
      </div>
    </label>
  `);

  // Profile checkboxes — visible when "scoped" is selected.
  const profileOpts = _profiles.map(pid => {
    const available = !isScoped || _ownTenants.includes(pid);
    if (!available) return '';
    const checked = selectedTenants && selectedTenants.includes(pid);
    return `
      <label class="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-indigo-50 cursor-pointer transition text-sm">
        <input type="checkbox" name="user-tenant" value="${esc(pid)}" ${checked ? 'checked' : ''}
          class="w-3.5 h-3.5 text-indigo-600 rounded focus:ring-indigo-500">
        <span class="text-neutral-700">${esc(pid)}</span>
      </label>
    `;
  }).join('');

  rows.push(`
    <div id="user-tenant-checkboxes"
      class="ml-7 mt-1 space-y-1 border-l-2 border-indigo-100 pl-3"
      style="display:${scopedChecked ? '' : 'none'}">
      ${profileOpts || '<span class="text-xs text-neutral-400 pl-2">No profiles available</span>'}
    </div>
  `);

  container.innerHTML = rows.join('');
}

export function openUserModal(userId) {
  _editingId = userId;
  const overlay = document.getElementById('user-modal-overlay');
  const title = document.getElementById('user-modal-title');
  const pwHint = document.getElementById('user-modal-pw-hint');
  const usernameInput = document.getElementById('user-modal-username');
  const passwordInput = document.getElementById('user-modal-password');
  const roleSelect = document.getElementById('user-modal-role');

  if (!overlay) return;

  if (userId === null) {
    // Create mode
    title.textContent = 'Add User';
    pwHint.textContent = '(required)';
    usernameInput.value = '';
    passwordInput.value = '';
    roleSelect.value = 'operator';
    _renderAccessOptions(_isScoped ? _ownTenants.slice(0, 1) : []);
  } else {
    // Edit mode
    const user = _users.find(u => u.id === userId);
    if (!user) return;
    title.textContent = 'Edit User';
    pwHint.textContent = '(leave blank to keep current)';
    usernameInput.value = user.username;
    passwordInput.value = '';
    roleSelect.value = user.role || 'operator';
    _renderAccessOptions(user.allowedTenants || []);
  }

  overlay.classList.remove('hidden');
  overlay.addEventListener('click', _overlayClickHandler);
  usernameInput.focus();
}
window.openUserModal = openUserModal;

function _overlayClickHandler(e) {
  if (e.target.id === 'user-modal-overlay') closeUserModal();
}

export function closeUserModal() {
  const overlay = document.getElementById('user-modal-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.removeEventListener('click', _overlayClickHandler);
  }
  _editingId = null;
}
window.closeUserModal = closeUserModal;

export function toggleAccessType(value) {
  const checkboxes = document.getElementById('user-tenant-checkboxes');
  if (checkboxes) {
    checkboxes.style.display = value === 'scoped' ? '' : 'none';
  }
}
window.toggleAccessType = toggleAccessType;

// ─── Save & Delete ────────────────────────────────────────────────────────────

export async function saveUser() {
  const username = (document.getElementById('user-modal-username')?.value || '').trim();
  const password = (document.getElementById('user-modal-password')?.value || '').trim();
  const role = document.getElementById('user-modal-role')?.value || 'operator';

  if (!username) { toast('Username is required', 'error'); return; }
  if (_editingId === null && !password) { toast('Password is required for new users', 'error'); return; }

  // Determine allowed tenants.
  const accessTypeEl = document.querySelector('input[name="user-access-type"]:checked');
  const accessType = accessTypeEl ? accessTypeEl.value : 'all';

  let allowedTenants = null; // null = unrestricted
  if (accessType === 'scoped') {
    const checked = [...document.querySelectorAll('input[name="user-tenant"]:checked')];
    allowedTenants = checked.map(el => el.value);
    if (allowedTenants.length === 0) {
      toast('Select at least one profile for scoped access', 'error');
      return;
    }
  }

  try {
    if (_editingId === null) {
      // Create
      await api('/admin-users', {
        method: 'POST',
        body: { username, password, role, allowedTenants: allowedTenants || [] }
      });
      toast('User created');
    } else {
      // Update
      const body = { username, role };
      if (password) body.password = password;
      if (allowedTenants !== null) {
        body.allowedTenants = allowedTenants;
      } else {
        body.clearTenants = true;
      }
      await api('/admin-users/' + _editingId, { method: 'PUT', body });
      toast('User updated');
    }
    closeUserModal();
    await _loadUsers();
  } catch (e) {
    toast(e.message || 'Failed to save user', 'error');
  }
}
window.saveUser = saveUser;

export async function deleteUser(userId, username) {
  if (!confirm('Delete user "' + username + '"? This cannot be undone.')) return;
  try {
    await api('/admin-users/' + userId, { method: 'DELETE' });
    toast('User deleted');
    await _loadUsers();
  } catch (e) {
    toast(e.message || 'Failed to delete user', 'error');
  }
}
window.deleteUser = deleteUser;
