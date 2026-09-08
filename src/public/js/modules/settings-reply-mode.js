/**
 * settings-reply-mode.js — "Reply Mode" tab for the Settings page (2026-09-08).
 *
 * Per-profile switch: should this bot answer with AI, greet a new contact once,
 * or stay silent (inbound still lands in Live Chat, no LLM call, no outbound)?
 * Backed by GET|PUT /api/rainbow/settings/reply-mode → {replyMode, introMessage}
 * which stores reply_mode / intro_message in the profile's settings file and
 * hot-applies to the running engine.
 *
 * Why: Ramli (senai-app), Rachel (southern) and Jayson (jayson-pa) are driven by
 * humans / Claude sessions through the bridge; only Rainbow (pelangi) auto-replies.
 */
import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml as esc } from '../core/utils.js';

const MODES = [
  { id: 'inherit', label: 'Inherit from ⚙ Master', icon: '🧩', desc: 'No value of its own — follows the Master default (Master → Global Defaults).' },
  { id: 'normal', label: 'AI replies', icon: '🤖', desc: 'Normal pipeline — classify, workflows, LLM reply. Use for Rainbow (Pelangi).' },
  { id: 'intro-once', label: 'Greet once, then silent', icon: '👋', desc: 'Sends the intro message on a contact\'s first message, then nothing. A human replies from Live Chat.' },
  { id: 'silent', label: 'Silent (inbox only)', icon: '🔇', desc: 'No AI, no LLM tokens, no outbound. Every inbound is still stored and visible in Live Chat; Jay / Jesi / a Claude session replies through this number by hand.' },
];

let _state = { replyMode: '', introMessage: '', hotApply: true };

export async function renderReplyModeTab(container) {
  container.innerHTML = `
    <div class="bg-white border rounded-2xl p-6">
      <div class="flex items-start justify-between mb-6">
        <div>
          <h3 class="font-semibold text-lg flex items-center gap-2">🔇 Reply Mode</h3>
          <p class="text-sm text-neutral-500 mt-1 font-medium">
            Decide whether this bot auto-replies with AI, greets once, or stays silent. Per business profile — switch the profile at the top to change another bot.
          </p>
        </div>
        <button id="reply-mode-save" onclick="saveReplyMode()"
          class="px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition text-sm font-bold shadow-medium disabled:opacity-40 disabled:cursor-not-allowed" disabled>
          Save
        </button>
      </div>

      <div id="reply-mode-options" class="space-y-2 mb-6">
        ${MODES.map(m => `
          <label class="flex items-start gap-3 p-4 border rounded-xl cursor-pointer hover:bg-neutral-50 transition reply-mode-opt" data-mode="${esc(m.id)}">
            <input type="radio" name="reply-mode" value="${esc(m.id)}" class="mt-1" onchange="onReplyModeChange()" />
            <div>
              <div class="font-semibold text-sm">${m.icon} ${esc(m.label)}</div>
              <div class="text-xs text-neutral-500 mt-0.5">${esc(m.desc)}</div>
            </div>
          </label>`).join('')}
      </div>

      <div id="reply-mode-intro-wrap" class="mb-6 hidden">
        <label class="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-1">Intro message (sent once per new contact)</label>
        <textarea id="reply-mode-intro" rows="3" maxlength="1000" oninput="onReplyModeChange()"
          class="w-full px-3 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"></textarea>
      </div>

      <div class="p-5 bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl border border-amber-100 text-xs text-amber-800 leading-relaxed font-medium space-y-1">
        <p><strong>Silent still records everything.</strong> Messages arrive in Live Chat and the database; the bot just never answers. Bridge sends from a Claude session (e.g. <code>Send-RamliMessage</code>) are unaffected.</p>
        <p><strong>Applies immediately</strong><span id="reply-mode-hot"></span>. This setting is per profile; other bots are unaffected.</p>
      </div>
    </div>
  `;

  let res = null;
  try {
    res = await api('/settings/reply-mode');
    _state = { replyMode: res.replyMode || 'inherit', introMessage: res.introMessage || '', hotApply: res.hotApply !== false };
  } catch (e) {
    toast('Failed to load reply mode: ' + e.message, 'error');
  }
  // Inherit option shows what Master currently provides.
  const inheritOpt = container.querySelector('.reply-mode-opt[data-mode="inherit"] .text-xs');
  if (inheritOpt && res && res.master) {
    const mm = res.master.replyMode ? (MODES.find(m => m.id === res.master.replyMode) || {}).label || res.master.replyMode : 'not set';
    inheritOpt.textContent = 'No value of its own — follows the Master default (currently: ' + mm + '). Edit under ⚙ Master → Global Defaults.';
  }
  if (res && res.inherited) {
    container.insertAdjacentHTML('afterbegin',
      '<div class="mb-3 px-4 py-3 rounded-2xl border border-indigo-200 bg-indigo-50 text-xs text-indigo-900">' +
      '<span class="font-bold">🧩 Inherited from ⚙ Master</span> — effective mode: <span class="font-mono bg-white/70 px-1 rounded">' + esc((res.effective || {}).replyMode || '') + '</span>. Pick a mode below and Save to override for this profile.</div>');
  }
  const radio = container.querySelector(`input[name="reply-mode"][value="${_state.replyMode}"]`) || container.querySelector('input[name="reply-mode"]');
  if (radio) radio.checked = true;
  document.getElementById('reply-mode-intro').value = _state.introMessage;
  document.getElementById('reply-mode-hot').textContent = _state.hotApply ? ' — no restart needed' : ' after the next core restart';
  onReplyModeChange(true);
}

function currentSelection() {
  const r = document.querySelector('input[name="reply-mode"]:checked');
  return {
    replyMode: r ? r.value : 'inherit',
    introMessage: (document.getElementById('reply-mode-intro') || { value: '' }).value.trim(),
  };
}

export function onReplyModeChange(initial) {
  const sel = currentSelection();
  document.querySelectorAll('.reply-mode-opt').forEach(el => {
    const active = el.dataset.mode === sel.replyMode;
    el.classList.toggle('border-indigo-400', active);
    el.classList.toggle('bg-indigo-50', active);
  });
  document.getElementById('reply-mode-intro-wrap').classList.toggle('hidden', sel.replyMode !== 'intro-once');
  const dirty = sel.replyMode !== _state.replyMode || sel.introMessage !== _state.introMessage;
  document.getElementById('reply-mode-save').disabled = initial === true ? true : !dirty;
}

export async function saveReplyMode() {
  const sel = currentSelection();
  const btn = document.getElementById('reply-mode-save');
  btn.disabled = true;
  try {
    const res = await api('/settings/reply-mode', { method: 'PUT', body: sel });
    _state = { replyMode: res.replyMode || 'inherit', introMessage: res.introMessage || '', hotApply: _state.hotApply };
    const label = (MODES.find(m => m.id === _state.replyMode) || MODES[0]).label;
    toast('Reply mode: ' + label + (res.applied ? ' (live)' : ' (saved; applies after restart)'));
    // Re-render so the inherited banner / Master hint reflect the new state.
    const container = document.getElementById('settings-tab-content');
    if (container && window.activeSettingsTab === 'reply-mode') { renderReplyModeTab(container); return; }
    onReplyModeChange(true);
  } catch (e) {
    toast('Failed to save: ' + e.message, 'error');
    btn.disabled = false;
  }
}

window.onReplyModeChange = onReplyModeChange;
window.saveReplyMode = saveReplyMode;
