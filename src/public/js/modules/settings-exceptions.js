/**
 * settings-exceptions.js — "AI Exceptions" tab for the Settings page.
 *
 * Per-profile list of phone numbers the bot must NEVER auto-reply to
 * (staff messaging the bot from personal numbers). Backed by
 *   GET|PUT /api/rainbow/settings/ignored-numbers   → {ignoredNumbers:[{phone,label}]}
 * which stores the list under "ignoredNumbers" in the profile's settings file
 * and hot-applies it to the running engine.
 */
import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml as esc } from '../core/utils.js';

let _list = [];   // working copy: [{phone, label}]
let _dirty = false;

export async function renderExceptionsTab(container) {
  container.innerHTML = `
    <div class="bg-white border rounded-2xl p-6">
      <div class="flex items-start justify-between mb-6">
        <div>
          <h3 class="font-semibold text-lg flex items-center gap-2">
            <svg class="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            AI Exceptions
          </h3>
          <p class="text-sm text-neutral-500 mt-1 font-medium">
            Numbers the bot must never auto-reply to — staff using their personal phones, test devices.
            Messages from these numbers still appear in Live Chat but trigger no AI, no workflow, no escalation.
          </p>
        </div>
        <button id="ai-exceptions-save" onclick="saveAiExceptions()"
          class="px-4 py-2 bg-rose-600 text-white rounded-xl hover:bg-rose-700 transition text-sm font-bold flex items-center gap-2 shadow-medium disabled:opacity-40 disabled:cursor-not-allowed" disabled>
          Save
        </button>
      </div>

      <div class="grid grid-cols-12 gap-2 px-4 py-2 bg-neutral-100 rounded-t-xl text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
        <div class="col-span-1">#</div>
        <div class="col-span-4">Label</div>
        <div class="col-span-5">WhatsApp Phone</div>
        <div class="col-span-2 text-right">Action</div>
      </div>
      <div id="ai-exceptions-list" class="space-y-px border-x border-b rounded-b-xl overflow-hidden mb-4">
        <div class="p-6 text-center text-sm text-neutral-400">Loading…</div>
      </div>

      <div class="grid grid-cols-12 gap-2 items-center p-3 bg-neutral-50 border rounded-xl mb-6">
        <div class="col-span-1 text-xs text-neutral-400 font-bold text-center">+</div>
        <div class="col-span-4">
          <input type="text" id="ai-exc-new-label" placeholder="e.g. Maya" maxlength="40"
            class="w-full px-3 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition" />
        </div>
        <div class="col-span-5">
          <input type="tel" id="ai-exc-new-phone" placeholder="60176701102 (country code, no +)"
            onkeydown="if(event.key==='Enter'){addAiException();}"
            class="w-full px-3 py-2 border rounded-xl text-sm font-mono focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition" />
        </div>
        <div class="col-span-2 text-right">
          <button onclick="addAiException()" class="px-3 py-2 bg-white border rounded-xl text-sm font-medium hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 transition">Add</button>
        </div>
      </div>

      <div class="p-5 bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl border border-amber-100 flex gap-4">
        <div class="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 text-amber-600">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        </div>
        <div class="text-xs text-amber-800 leading-relaxed font-medium space-y-1">
          <p><strong>How it works:</strong> matching is by phone digits. Enter the full international number without "+" (e.g. <code>60176701102</code>). Changes apply immediately, no restart.</p>
          <p><strong>Limitation — hidden numbers (@lid):</strong> WhatsApp sometimes delivers a sender as an anonymous LID instead of a phone number. Those cannot be matched by phone; for them the bot falls back to matching the sender's WhatsApp display name against the <em>Label</em> here (case-insensitive). Set the label to the exact display name for staff whose messages arrive that way.</p>
          <p>This list is per business profile. Other profiles are unaffected.</p>
        </div>
      </div>
    </div>
  `;

  try {
    const res = await api('/settings/ignored-numbers');
    _list = Array.isArray(res.ignoredNumbers) ? res.ignoredNumbers.map(n => ({ phone: String(n.phone || ''), label: String(n.label || '') })) : [];
    _dirty = false;
    renderAiExceptionsList();
  } catch (e) {
    const el = document.getElementById('ai-exceptions-list');
    if (el) {
      el.innerHTML = '<div class="p-6 text-center text-sm text-danger-600">Failed to load: ' + esc(e.message || String(e)) +
        ' <button onclick="window.switchSettingsTab(\'ai-exceptions\', false)" class="ml-2 underline">Retry</button></div>';
    }
  }
}

export function renderAiExceptionsList() {
  const el = document.getElementById('ai-exceptions-list');
  if (!el) return;
  const saveBtn = document.getElementById('ai-exceptions-save');
  if (saveBtn) saveBtn.disabled = !_dirty;

  if (_list.length === 0) {
    el.innerHTML = '<div class="text-center text-neutral-400 py-10 text-sm bg-white">No exceptions yet. Every sender is answered by the bot. Add a staff number below.</div>';
    return;
  }
  el.innerHTML = _list.map((n, i) => `
    <div class="bg-white px-4 py-3 grid grid-cols-12 gap-2 items-center group hover:bg-neutral-50 transition-colors">
      <div class="col-span-1 text-xs font-bold text-neutral-400">#${i + 1}</div>
      <div class="col-span-4">
        <input type="text" value="${esc(n.label)}" maxlength="40" placeholder="Label"
          onchange="updateAiException(${i}, 'label', this.value)"
          class="w-full px-3 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition" />
      </div>
      <div class="col-span-5">
        <input type="tel" value="${esc(n.phone)}" placeholder="60123456789"
          onchange="updateAiException(${i}, 'phone', this.value)"
          class="w-full px-3 py-2 border rounded-xl text-sm font-mono focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition" />
      </div>
      <div class="col-span-2 text-right">
        <button onclick="removeAiException(${i})" title="Remove"
          class="p-2 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  `).join('');
}

function digits(s) { return String(s || '').split('@')[0].replace(/\D+/g, ''); }

export function addAiException() {
  const labelEl = document.getElementById('ai-exc-new-label');
  const phoneEl = document.getElementById('ai-exc-new-phone');
  const phone = digits(phoneEl && phoneEl.value);
  const label = (labelEl && labelEl.value.trim()) || '';
  if (phone.length < 8 || phone.length > 15) {
    toast('Phone must be 8–15 digits with country code, e.g. 60176701102', 'error');
    return;
  }
  if (_list.some(n => digits(n.phone) === phone)) {
    toast('That number is already in the list', 'warning');
    return;
  }
  _list.push({ phone, label });
  _dirty = true;
  if (labelEl) labelEl.value = '';
  if (phoneEl) phoneEl.value = '';
  renderAiExceptionsList();
}

export function updateAiException(i, field, value) {
  if (!_list[i]) return;
  _list[i][field] = field === 'phone' ? digits(value) : String(value).trim();
  _dirty = true;
  renderAiExceptionsList();
}

export function removeAiException(i) {
  if (!_list[i]) return;
  _list.splice(i, 1);
  _dirty = true;
  renderAiExceptionsList();
}

export async function saveAiExceptions() {
  const bad = _list.find(n => digits(n.phone).length < 8 || digits(n.phone).length > 15);
  if (bad) {
    toast('Fix the invalid phone "' + bad.phone + '" before saving (8–15 digits)', 'error');
    return;
  }
  const btn = document.getElementById('ai-exceptions-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const res = await api('/settings/ignored-numbers', {
      method: 'PUT',
      body: { ignoredNumbers: _list.map(n => ({ phone: digits(n.phone), label: n.label })) }
    });
    _list = Array.isArray(res.ignoredNumbers) ? res.ignoredNumbers : _list;
    _dirty = false;
    renderAiExceptionsList();
    toast(res.applied === false
      ? 'Saved (takes effect after the next restart — no live engine for this profile)'
      : 'AI exceptions saved and applied', res.applied === false ? 'warning' : 'success');
  } catch (e) {
    toast(e.message || 'Save failed', 'error');
    _dirty = true;
    renderAiExceptionsList();
  } finally {
    if (btn) btn.textContent = 'Save';
  }
}

window.renderExceptionsTab = renderExceptionsTab;
window.renderAiExceptionsList = renderAiExceptionsList;
window.addAiException = addAiException;
window.updateAiException = updateAiException;
window.removeAiException = removeAiException;
window.saveAiExceptions = saveAiExceptions;
