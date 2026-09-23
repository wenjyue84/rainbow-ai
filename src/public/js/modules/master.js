/**
 * master.js — "⚙ Master · All businesses" pages (2026-09-08).
 *
 * Master is not a business profile. It holds the things that affect every
 * profile and used to be repeated on each business dashboard:
 *   numbers     — every WhatsApp number (bridge state, Logout / QR) + last health check
 *   assistants  — the bot team cards (moved from the dashboard)
 *   defaults    — settings-master.json: AI providers, bot avatar, reply mode, staff name
 *                 (profiles without their own value inherit these; "Apply to all" copies
 *                 the value into every profile file so it becomes explicit there)
 *   users       — admin dashboard logins (moved out of Settings)
 *
 * API: GET /master/overview, GET|PUT /master/settings, POST /master/settings/apply-all,
 * POST /master/check-numbers — all refuse tenant-scoped sessions (403).
 */
import { api, toast, escapeHtml as esc } from '../core/utils.js';
import { renderUsersTab } from './settings-users.js';

const TABS = ['numbers', 'assistants', 'defaults', 'users'];
let _overview = null;
let _master = null;
let _profiles = [];

function isScopedSession() {
  const s = window.__SESSION__;
  return !!(s && Array.isArray(s.tenants) && s.tenants.length > 0);
}

/** Entry point — called by tabs.js loadTab('master', sub). */
export async function loadMaster(sub) {
  const container = document.getElementById('master-tab-content');
  if (!container) return;
  if (isScopedSession()) {
    container.innerHTML = '<div class="p-8 text-center text-sm text-neutral-500">Master is available to unrestricted admins only.</div>';
    return;
  }
  const tab = TABS.includes(sub) ? sub : (window.activeMasterTab && TABS.includes(window.activeMasterTab) ? window.activeMasterTab : 'numbers');
  switchMasterTab(tab, !sub);
}

export function switchMasterTab(tabId, updateHash = true) {
  if (!TABS.includes(tabId)) tabId = 'numbers';
  window.activeMasterTab = tabId;
  if (updateHash) {
    const newHash = 'master/' + tabId;
    if (window.location.hash.slice(1) !== newHash) history.replaceState(null, '', '#' + newHash);
  }
  document.querySelectorAll('.master-tab-btn').forEach(btn => {
    const on = btn.dataset.masterTab === tabId;
    btn.classList.toggle('bg-indigo-50', on);
    btn.classList.toggle('text-indigo-700', on);
    btn.classList.toggle('font-medium', on);
    btn.classList.toggle('text-neutral-600', !on);
    btn.classList.toggle('hover:bg-neutral-100', !on);
  });
  const container = document.getElementById('master-tab-content');
  if (!container) return;
  container.innerHTML = '<div class="p-8 text-center"><div class="spinner mx-auto"></div></div>';
  if (tabId === 'numbers') renderNumbers(container);
  else if (tabId === 'assistants') renderAssistants(container);
  else if (tabId === 'defaults') renderDefaults(container);
  else if (tabId === 'users') renderUsersTab(container);
}

async function fetchOverview() {
  _overview = await api('/master/overview');
  _profiles = _overview.profiles || [];
  return _overview;
}

// ─── Numbers ─────────────────────────────────────────────────────────────────

async function renderNumbers(container) {
  try {
    const ov = await fetchOverview();
    const instances = ov.instances || [];
    const stats = ov.messageStats || {};
    container.innerHTML = `
      <div class="space-y-4">
        <div class="bg-white rounded-2xl border p-5">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2"><span class="text-xl">💬</span><h3 class="font-semibold text-neutral-700">WhatsApp Numbers</h3>
              <span class="text-xs text-neutral-400">${instances.filter(i => i.state === 'open').length}/${instances.length} connected</span></div>
            <button type="button" onclick="loadMasterNumbers()" class="text-xs text-primary-500 hover:text-primary-600 font-medium">Refresh</button>
          </div>
          <div id="master-wa-list" class="space-y-1">
            ${instances.length ? instances.map(inst => renderInstanceCard(inst, instances.length, stats[inst.profile])).join('')
              : '<div class="text-center py-4 text-sm text-neutral-400">No WhatsApp numbers registered</div>'}
          </div>
          <p class="text-xs text-neutral-400 mt-3">A number is its own bridge process — add one on the server with <code>new-bridge.sh</code>, then restart the core.</p>
        </div>
        ${renderMessageVolume(stats)}
        ${renderLastCheck(ov.lastCheck, ov.checkScript, ov.source, ov.engine)}
      </div>`;
  } catch (e) {
    container.innerHTML = `<div class="p-8 text-center text-sm text-danger-600">Failed to load numbers: ${esc(e.message)}</div>`;
  }
}

/** Message-volume-per-number card (rainbow_messages counts, all-time). */
function renderMessageVolume(stats) {
  const profiles = Object.keys(stats).sort((a, b) => (stats[b].total || 0) - (stats[a].total || 0));
  const grandTotal = profiles.reduce((sum, p) => sum + (stats[p].total || 0), 0);
  return `
    <div class="bg-white rounded-2xl border p-5">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2"><span class="text-xl">📊</span><h3 class="font-semibold text-neutral-700">Message volume</h3>
          <span class="text-xs text-neutral-400">${grandTotal.toLocaleString()} messages all-time</span></div>
      </div>
      ${profiles.length ? `
        <table class="text-xs w-full">
          <thead><tr class="text-neutral-500 text-left"><th class="px-2 py-1">Profile</th><th class="px-2 py-1 text-right">Guest (in)</th><th class="px-2 py-1 text-right">Assistant (out)</th><th class="px-2 py-1 text-right">Staff</th><th class="px-2 py-1 text-right">Total</th></tr></thead>
          <tbody>
            ${profiles.map(p => {
              const s = stats[p];
              return `<tr class="border-t hover:bg-neutral-50 cursor-pointer" onclick="openNumberChat('${esc(p)}')" title="Open ${esc(p)}'s conversations in Live Chat">
                <td class="px-2 py-1.5 font-mono text-indigo-600">${esc(p)}</td>
                <td class="px-2 py-1.5 text-right">${(s.user || 0).toLocaleString()}</td>
                <td class="px-2 py-1.5 text-right">${(s.assistant || 0).toLocaleString()}</td>
                <td class="px-2 py-1.5 text-right">${(s.staff || 0).toLocaleString()}</td>
                <td class="px-2 py-1.5 text-right font-semibold">${(s.total || 0).toLocaleString()}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <p class="text-xs text-neutral-400 mt-3">All-time counts from <code>rainbow_messages</code>, grouped by profile (= the WhatsApp number that profile answers on).</p>`
        : '<div class="text-center py-4 text-sm text-neutral-400">No message history yet</div>'}
    </div>`;
}

function renderLastCheck(lc, script, source, engine) {
  const canRun = script && script.available;
  const fromEngine = source === 'wa-hub' || source === 'baileys-engine';
  const engineUrl = (engine && engine.url) ? String(engine.url).replace(/^http:\/\/127\.0\.0\.1:8800$/, 'https://wahub.wenjyue.com') : '';
  const srcBadge = fromEngine
    ? `<a href="${esc(engineUrl || '#')}" target="_blank" rel="noopener" class="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100" title="Source of truth for every number: WA Hub (wahub.wenjyue.com)">source: wa-hub ↗</a>`
    : `<span class="text-xs text-neutral-400">hourly cron · after each core restart · on Claude session start</span>`;
  const head = `
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2"><span class="text-xl">🩺</span><h3 class="font-semibold text-neutral-700">Last health check</h3>
        ${srcBadge}</div>
      <button type="button" id="master-check-btn" onclick="runNumberCheck()" ${canRun ? '' : 'disabled title="check-numbers.sh not found on this host"'}
        class="text-xs bg-primary-500 hover:bg-primary-600 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition">Run check now</button>
    </div>`;
  if (!lc) {
    return `<div class="bg-white rounded-2xl border p-5">${head}<div class="text-sm text-neutral-400">No check result yet.</div></div>`;
  }
  const ts = lc.ts ? new Date(lc.ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const nums = lc.numbers || [];
  const problems = lc.problems || [];
  return `
    <div class="bg-white rounded-2xl border p-5">${head}
      <div class="flex items-center gap-3 mb-3 text-sm">
        <span class="px-2 py-0.5 rounded-full text-xs font-medium ${lc.ok ? 'bg-success-100 text-success-700' : 'bg-danger-100 text-danger-700'}">${lc.ok ? '✓ ALL OK' : '✗ ' + problems.length + ' problem' + (problems.length === 1 ? '' : 's')}</span>
        <span class="text-neutral-500">${esc(ts)}</span>
        <span class="text-xs text-neutral-400">core pm2=${esc(String((lc.core || {}).pm2 || '?'))} · http=${esc(String((lc.core || {}).http || '?'))}</span>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        ${nums.map(n => {
          const ok = n.state === 'open' && n.pm2 === 'online';
          return `<div class="border rounded-xl px-3 py-2 text-xs ${ok ? 'border-success-200 bg-success-50/40' : 'border-orange-200 bg-orange-50/40'}">
            <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full ${ok ? 'bg-success-400' : 'bg-orange-400'}"></span><span class="font-semibold text-neutral-800">${esc(n.instance || '')}</span><span class="text-neutral-400">:${esc(String(n.port || ''))}</span></div>
            <div class="text-neutral-500 mt-0.5">${esc(n.profile || '')}</div>
            <div class="font-mono text-neutral-600">${esc(n.user ? '+' + n.user : '—')}</div>
            <div class="text-neutral-400">pm2=${esc(String(n.pm2 || '?'))} wa=${esc(String(n.state || '?'))}${n.inboundFail ? ` · inbound fail=${esc(String(n.inboundFail))}` : ''}</div>
          </div>`;
        }).join('')}
      </div>
      ${problems.length ? `<ul class="mt-3 text-xs text-danger-700 space-y-1">${problems.map(p => `<li>• ${esc(String(p))}</li>`).join('')}</ul>` : ''}
      <div id="master-check-output" class="hidden mt-3 text-xs font-mono whitespace-pre-wrap bg-neutral-50 border rounded-xl p-3 text-neutral-600"></div>
    </div>`;
}

export async function runNumberCheck() {
  const btn = document.getElementById('master-check-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try {
    const res = await api('/master/check-numbers', { method: 'POST' });
    toast(res.ok ? 'Check finished: ' + ((res.result && res.result.ok) ? 'ALL OK' : 'problems found') : 'Check script failed', res.ok ? 'success' : 'error');
    await renderNumbers(document.getElementById('master-tab-content'));
    const out = document.getElementById('master-check-output');
    if (out && res.output) { out.textContent = res.output; out.classList.remove('hidden'); }
  } catch (e) {
    toast('Check failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Run check now'; }
  }
}

/** Refresh hook used by whatsapp-instances.js / modals.js after Logout / QR. */
export function loadMasterNumbers() {
  const c = document.getElementById('master-tab-content');
  if (!c) return;
  if (window.activeMasterTab === 'assistants') renderAssistants(c);
  else renderNumbers(c);
}

/** Render one WhatsApp number row (moved from dashboard.js). */
export function renderInstanceCard(inst, totalCount, msgStats) {
  const phone = (inst.user && inst.user.phone) || inst.id || '';
  const formattedPhone = phone ? '+' + phone.replace(/(\d{2})(\d{2})(\d{3,4})(\d{4})/, '$1 $2-$3 $4') : 'Not linked';
  const online = inst.state === 'open';
  const statusDot = online ? 'bg-success-400' : inst.unlinkedFromWhatsApp ? 'bg-orange-500' : 'bg-neutral-300';
  const statusText = online ? 'Connected' : inst.unlinkedFromWhatsApp ? 'Unlinked' : (inst.state === 'offline' ? 'Bridge offline' : 'Disconnected');
  const statusColor = online ? 'text-success-600' : inst.unlinkedFromWhatsApp ? 'text-orange-600' : 'text-neutral-500';
  const msgBadge = msgStats && msgStats.total
    ? `<span class="text-xs text-neutral-400" title="Messages exchanged via Rainbow (all-time)">💬 ${msgStats.total.toLocaleString()}</span>`
    : '';
  const chatBtn = inst.profile
    ? `<button type="button" onclick="openNumberChat('${esc(inst.profile)}')" class="text-xs bg-indigo-500 hover:bg-indigo-600 text-white px-2 py-1 rounded transition" title="Open this number's conversations in Live Chat">Chats</button>`
    : '';
  return `
    <div class="flex items-center justify-between py-2.5 border-b last:border-0">
      <div class="flex items-center gap-3">
        <span class="w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusDot}"></span>
        <div>
          <div class="flex items-center gap-2">
            <span class="font-medium text-neutral-800 text-sm">${esc(inst.label || inst.id)}</span>
            <span class="text-xs ${statusColor}">${statusText}</span>
          </div>
          <div class="text-xs text-neutral-500">${esc(formattedPhone)}${inst.user && inst.user.name ? ' — ' + esc(inst.user.name) : ''}</div>
          <div class="text-xs text-neutral-400">instance <span class="font-mono">${esc(inst.id)}</span> · profile <span class="font-mono">${esc(inst.profile || '')}</span></div>
        </div>
      </div>
      <div class="flex items-center gap-2 flex-shrink-0">
        ${msgBadge}
        <div class="flex gap-1">
          ${chatBtn}
          ${!online ? `<button type="button" onclick="showInstanceQR('${esc(inst.id)}', '${esc(inst.label || inst.id)}')" class="text-xs bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded transition">QR</button>` : ''}
          ${online ? `<button type="button" onclick="logoutInstance('${esc(inst.id)}')" class="text-xs bg-orange-500 hover:bg-orange-600 text-white px-2 py-1 rounded transition">Logout</button>` : ''}
        </div>
      </div>
    </div>`;
}

/**
 * Switch the active profile and jump straight to its Live Chat inbox —
 * the "click this number, see its conversations" affordance (like WA Hub's
 * per-JID chat view, but Rainbow shows the whole inbox for that number
 * since one business number talks to many guest phones, not one JID).
 * profileSwitcher.switchTo() always lands on Dashboard when leaving Master
 * (see profile-switcher.js), so we override the hash right after.
 */
export function openNumberChat(profileId) {
  if (!profileId) return;
  if (window.profileSwitcher && typeof window.profileSwitcher.switchTo === 'function') {
    window.profileSwitcher.switchTo(profileId);
  }
  history.replaceState(null, '', '#live-chat');
  if (typeof window.loadTab === 'function') window.loadTab('live-chat', null);
}

// ─── Assistants ──────────────────────────────────────────────────────────────

async function renderAssistants(container) {
  container.innerHTML = `
    <div class="bg-white rounded-2xl border p-5" id="bot-team-card">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2"><span class="text-xl">🧑‍💼</span><h3 class="font-semibold text-neutral-700">Meet the Assistants</h3></div>
        <span class="text-xs text-neutral-400">One WhatsApp number per business</span>
      </div>
      <div id="bot-team-list" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <div class="col-span-full text-center py-4"><div class="spinner mx-auto"></div></div>
      </div>
    </div>`;
  await loadBotTeam();
}

/**
 * Load the AI assistant team (GET /bots) — name, role, business, number and
 * live WhatsApp state. Global: not scoped to the active profile. Kept on
 * window.loadBotTeam so the Logout / Re-pair buttons can refresh the cards.
 */
export async function loadBotTeam() {
  const el = document.getElementById('bot-team-list');
  if (!el) return;
  try {
    const data = await api('/bots');
    const bots = (data && data.bots) || [];
    el.innerHTML = bots.length ? bots.map(renderBotCard).join('')
      : '<div class="col-span-full text-center py-4 text-sm text-neutral-400">No assistants configured</div>';
  } catch (e) {
    el.innerHTML = '<div class="col-span-full text-center py-4 text-sm text-neutral-400">Assistant team unavailable</div>';
  }
}

function formatBotPhone(phone) {
  if (!phone) return '';
  const p = String(phone).replace(/\D/g, '');
  const m = p.match(/^(60)(\d{1,2})(\d{3,4})(\d{4})$/);
  return m ? `+${m[1]} ${m[2]}-${m[3]} ${m[4]}` : '+' + p;
}

function renderBotCard(bot) {
  const online = bot.state === 'open';
  const notSet = !bot.configured || bot.state === 'not_set';
  const dot = online ? 'bg-success-400' : notSet ? 'bg-neutral-300' : 'bg-orange-400';
  const statusText = online ? 'Online' : notSet ? 'Number not set yet' : (bot.state === 'offline' ? 'Bridge offline' : 'Disconnected');
  const statusColor = online ? 'text-success-600' : notSet ? 'text-neutral-400' : 'text-orange-600';
  const phone = bot.phone ? formatBotPhone(bot.phone) : (notSet ? 'No WhatsApp number yet' : 'Number unknown');
  return `
    <div class="border rounded-xl p-4 flex flex-col gap-2 ${notSet ? 'bg-neutral-50 border-dashed' : 'bg-white'}">
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 rounded-full bg-primary-50 flex items-center justify-center text-2xl flex-shrink-0">${esc(bot.emoji || '🤖')}</div>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-semibold text-neutral-800">${esc(bot.name)}</span>
            <span class="flex items-center gap-1 text-xs ${statusColor}"><span class="w-2 h-2 rounded-full ${dot}"></span>${statusText}</span>
          </div>
          <div class="text-xs text-neutral-500 truncate">${esc(bot.business)}</div>
        </div>
      </div>
      <p class="text-xs text-neutral-600 leading-relaxed">${esc(bot.role)}</p>
      <div class="mt-auto pt-2 border-t flex items-center justify-between gap-2 text-xs">
        <span class="font-mono ${bot.phone ? 'text-neutral-700' : 'text-neutral-400 italic'}">${esc(phone)}</span>
        <a href="#dashboard/${esc(bot.profile)}" class="text-neutral-400 hover:text-primary-600">profile: ${esc(bot.profile)} →</a>
      </div>
      ${bot.instanceId ? `<div class="flex gap-1 justify-end">
        ${online ? `<button type="button" onclick="logoutInstance('${esc(bot.instanceId)}')" class="text-xs bg-orange-500 hover:bg-orange-600 text-white px-2 py-1 rounded transition" title="Unlink this number from WhatsApp (re-pair with QR afterwards)">Logout</button>`
                 : `<button type="button" onclick="showInstanceQR('${esc(bot.instanceId)}', '${esc(bot.name)} · ${esc(bot.phone || bot.instanceId)}')" class="text-xs bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded transition">Re-pair (QR)</button>`}
      </div>` : ''}
    </div>`;
}

// ─── Global defaults ─────────────────────────────────────────────────────────

const REPLY_MODES = [
  { id: 'normal', label: 'AI replies', icon: '🤖', desc: 'Normal pipeline — classify, workflows, LLM reply.' },
  { id: 'intro-once', label: 'Greet once, then silent', icon: '👋', desc: 'Send the intro message on a contact\'s first message, then nothing. {bot_name} is replaced by each profile\'s bot name.' },
  { id: 'silent', label: 'Silent (inbox only)', icon: '🔇', desc: 'No AI, no LLM tokens, no outbound. Inbound is stored and shown in Live Chat.' },
];

const PROVIDER_FIELDS = [
  ['id', 'ID', 'text', 'w-28'], ['name', 'Name', 'text', 'w-32'], ['type', 'Type', 'text', 'w-24'],
  ['model', 'Model', 'text', 'w-40'], ['api_key_env', 'API key env', 'text', 'w-36'], ['base_url', 'Base URL', 'text', 'w-44'],
  ['priority', 'Prio', 'number', 'w-14'], ['timeout_ms', 'Timeout ms', 'number', 'w-20'],
];

function inheritedByFor(key) {
  return _profiles.filter(p => (p.inherited || []).includes(key)).map(p => p.id);
}

function inheritNote(key) {
  const list = inheritedByFor(key);
  if (!list.length) return '<span class="text-xs text-neutral-400">Every profile has its own value.</span>';
  return `<span class="text-xs text-neutral-500">Inherited by: ${list.map(id => `<span class="font-mono bg-neutral-100 px-1 rounded">${esc(id)}</span>`).join(' ')}</span>`;
}

function applyAllButton(key, label) {
  return `<button type="button" onclick="masterApplyAll('${key}', '${esc(label)}')" class="text-xs px-3 py-1.5 rounded-lg border border-neutral-300 hover:bg-neutral-50 text-neutral-700 transition" title="Copy the Master value into every profile's own settings file">Apply to all profiles</button>`;
}

async function renderDefaults(container) {
  try {
    const [ms] = await Promise.all([api('/master/settings'), fetchOverview()]);
    _master = ms.settings || {};
  } catch (e) {
    container.innerHTML = `<div class="p-8 text-center text-sm text-danger-600">Failed to load Master settings: ${esc(e.message)}</div>`;
    return;
  }
  const m = _master;
  const providers = ((m.ai && m.ai.providers) || []).slice().sort((a, b) => (a.priority || 0) - (b.priority || 0));
  const mode = m.reply_mode || 'intro-once';
  container.innerHTML = `
    <div class="space-y-4">
      <div class="p-4 bg-gradient-to-br from-indigo-50 to-blue-50 rounded-2xl border border-indigo-100 text-xs text-indigo-900 leading-relaxed">
        <strong>How defaults work.</strong> A profile that has not set a value uses the Master value (its Settings page shows an “Inherited from Master” badge). A profile that set its own value wins. “Apply to all profiles” writes the Master value into every profile so it becomes explicit there.
      </div>

      <!-- Reply mode -->
      <div class="bg-white rounded-2xl border p-5">
        <div class="flex items-start justify-between mb-3">
          <div><h3 class="font-semibold text-neutral-700">🔇 Default reply mode</h3>${inheritNote('reply_mode')}</div>
          <div class="flex gap-2">${applyAllButton('reply_mode', 'reply mode + intro message')}
            <button type="button" onclick="masterSaveReplyMode()" class="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition">Save</button></div>
        </div>
        <div class="space-y-2 mb-3">
          ${REPLY_MODES.map(r => `
            <label class="flex items-start gap-3 p-3 border rounded-xl cursor-pointer hover:bg-neutral-50 transition">
              <input type="radio" name="master-reply-mode" value="${r.id}" ${mode === r.id ? 'checked' : ''} class="mt-1" onchange="masterReplyModeChanged()" />
              <div><div class="font-semibold text-sm">${r.icon} ${esc(r.label)}</div><div class="text-xs text-neutral-500 mt-0.5">${esc(r.desc)}</div></div>
            </label>`).join('')}
        </div>
        <div id="master-intro-wrap" class="${mode === 'intro-once' ? '' : 'hidden'}">
          <label class="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-1">Intro message (use {bot_name})</label>
          <textarea id="master-intro" rows="3" maxlength="1000" class="w-full px-3 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none">${esc(m.intro_message || "Hi, I'm {bot_name}, an AI assistant. A team member will reply to you shortly.")}</textarea>
          <label class="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-1 mt-3">Intro for bots without a name (use {business})</label>
          <textarea id="master-intro-unnamed" rows="3" maxlength="1000" class="w-full px-3 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none">${esc(m.intro_message_unnamed || "Hi, I'm the AI assistant of {business}. A team member will reply to you shortly.")}</textarea>
          <p class="text-[11px] text-neutral-400 mt-1">Used when a profile's Settings has no bot name. {business} = the profile's business name (profiles.json / BUSINESS_DISPLAY_NAME_&lt;PROFILE&gt;).</p>
        </div>
      </div>

      <!-- Bot avatar + staff name -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="bg-white rounded-2xl border p-5">
          <div class="flex items-start justify-between mb-3">
            <div><h3 class="font-semibold text-neutral-700">🤖 Default bot avatar</h3>${inheritNote('botAvatar')}</div>
            ${applyAllButton('botAvatar', 'bot avatar')}
          </div>
          <div class="flex items-center gap-3">
            <span id="master-avatar-preview" class="text-4xl">${esc(m.botAvatar || '🤖')}</span>
            <input type="text" id="master-avatar" value="${esc(m.botAvatar || '')}" maxlength="4" placeholder="🌈" oninput="document.getElementById('master-avatar-preview').textContent=this.value||'🤖'"
              class="w-28 px-3 py-2 border rounded-xl text-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
            <div class="flex flex-wrap gap-1">${['🌈', '🤖', '🏡', '🏠', '🧑‍💼', '🦷', '❄️', '💬'].map(e => `<button type="button" onclick="document.getElementById('master-avatar').value='${e}';document.getElementById('master-avatar-preview').textContent='${e}'" class="text-xl px-1 hover:bg-neutral-100 rounded">${e}</button>`).join('')}</div>
            <button type="button" onclick="masterSaveField('botAvatar','master-avatar')" class="ml-auto text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition">Save</button>
          </div>
        </div>
        <div class="bg-white rounded-2xl border p-5">
          <div class="flex items-start justify-between mb-3">
            <div><h3 class="font-semibold text-neutral-700">🧑 Default staff name</h3>${inheritNote('staffName')}</div>
            ${applyAllButton('staffName', 'staff name')}
          </div>
          <div class="flex items-center gap-3">
            <input type="text" id="master-staff-name" value="${esc(m.staffName || '')}" maxlength="40" placeholder="Staff"
              class="flex-1 px-3 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            <button type="button" onclick="masterSaveField('staffName','master-staff-name')" class="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition">Save</button>
          </div>
          <p class="text-xs text-neutral-400 mt-2">Shown as the sender name on manual staff replies when a profile sets none.</p>
        </div>
      </div>

      <!-- AI providers -->
      <div class="bg-white rounded-2xl border p-5">
        <div class="flex items-start justify-between mb-3">
          <div><h3 class="font-semibold text-neutral-700">🧠 Default AI providers / models</h3>${inheritNote('ai.providers')}
            <div class="text-xs text-neutral-400 mt-0.5">Fallback chain in priority order. Changing providers needs a core restart to take effect on running engines.</div></div>
          <div class="flex gap-2">${applyAllButton('ai.providers', 'AI providers')}
            <button type="button" onclick="masterAddProvider()" class="text-xs px-3 py-1.5 rounded-lg border border-neutral-300 hover:bg-neutral-50 text-neutral-700 transition">+ Add</button>
            <button type="button" onclick="masterSaveProviders()" class="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition">Save</button></div>
        </div>
        <div class="overflow-x-auto">
          <table class="text-xs w-full" id="master-providers">
            <thead><tr class="text-neutral-500 text-left"><th class="px-1 py-1">On</th>${PROVIDER_FIELDS.map(f => `<th class="px-1 py-1">${f[1]}</th>`).join('')}<th></th></tr></thead>
            <tbody>${providers.map(providerRow).join('')}</tbody>
          </table>
          ${providers.length ? '' : '<div class="text-center py-4 text-sm text-neutral-400" id="master-providers-empty">No default providers yet — click + Add.</div>'}
        </div>
      </div>

      ${renderModelUsage(_overview && _overview.modelUsage)}
    </div>`;
}

/** How often each configured model has actually been used (llm_cost_daily). */
function renderModelUsage(usage) {
  const list = (usage && usage.providers) || [];
  const total = list.reduce((sum, p) => sum + (p.requestCount || 0), 0);
  return `
    <div class="bg-white rounded-2xl border p-5">
      <div class="flex items-start justify-between mb-3">
        <div><h3 class="font-semibold text-neutral-700">📈 Model usage frequency</h3>
          <div class="text-xs text-neutral-400 mt-0.5">Requests per provider, all-time (llm_cost_daily). Not live-updating — reflects the last overview load.</div></div>
      </div>
      ${list.length ? `
        <table class="text-xs w-full">
          <thead><tr class="text-neutral-500 text-left"><th class="px-2 py-1">Provider</th><th class="px-2 py-1 text-right">Requests</th><th class="px-2 py-1 text-right">Share</th><th class="px-2 py-1 text-right">Est. cost (USD)</th></tr></thead>
          <tbody>
            ${list.map(p => {
              const pct = total ? Math.round((p.requestCount / total) * 100) : 0;
              return `<tr class="border-t">
                <td class="px-2 py-1.5 font-mono">${esc(p.provider)}</td>
                <td class="px-2 py-1.5 text-right">${(p.requestCount || 0).toLocaleString()}</td>
                <td class="px-2 py-1.5 text-right">
                  <div class="flex items-center gap-2 justify-end">
                    <div class="w-16 h-1.5 bg-neutral-100 rounded-full overflow-hidden"><div class="h-full bg-indigo-400" style="width:${pct}%"></div></div>
                    <span class="text-neutral-500 w-8 text-right">${pct}%</span>
                  </div>
                </td>
                <td class="px-2 py-1.5 text-right">$${(p.costUsd || 0).toFixed(4)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        ${usage.note ? `<p class="text-xs text-orange-600 mt-3">⚠️ ${esc(usage.note)}</p>` : ''}`
        : '<div class="text-center py-4 text-sm text-neutral-400">No usage recorded yet</div>'}
    </div>`;
}

function providerRow(p) {
  return `<tr class="border-t master-provider-row">
    <td class="px-1 py-1"><input type="checkbox" data-f="enabled" ${p.enabled ? 'checked' : ''} /></td>
    ${PROVIDER_FIELDS.map(f => `<td class="px-1 py-1"><input type="${f[2]}" data-f="${f[0]}" value="${esc(p[f[0]] == null ? '' : String(p[f[0]]))}" class="${f[3]} px-2 py-1 border rounded-lg font-mono focus:ring-1 focus:ring-indigo-400 outline-none" /></td>`).join('')}
    <td class="px-1 py-1"><button type="button" onclick="this.closest('tr').remove()" class="text-danger-500 hover:text-danger-700" title="Remove">✕</button></td>
  </tr>`;
}

export function masterAddProvider() {
  const tb = document.querySelector('#master-providers tbody');
  if (!tb) return;
  const empty = document.getElementById('master-providers-empty');
  if (empty) empty.remove();
  tb.insertAdjacentHTML('beforeend', providerRow({ id: '', name: '', type: 'openai', model: '', api_key_env: '', base_url: '', priority: tb.children.length + 1, timeout_ms: 30000, enabled: true }));
}

function collectProviders() {
  const rows = Array.from(document.querySelectorAll('#master-providers tbody tr.master-provider-row'));
  return rows.map(tr => {
    const p = {};
    tr.querySelectorAll('input[data-f]').forEach(inp => {
      const k = inp.dataset.f;
      if (inp.type === 'checkbox') p[k] = inp.checked;
      else if (inp.type === 'number') p[k] = inp.value === '' ? 0 : Number(inp.value);
      else p[k] = inp.value.trim();
    });
    return p;
  }).filter(p => p.id);
}

async function putMaster(body, okMsg) {
  const res = await api('/master/settings', { method: 'PUT', body });
  _master = res.settings || _master;
  let msg = okMsg;
  if (res.applied && res.applied.length) msg += ' · live on ' + res.applied.join(', ');
  if (res.restartRequired) msg += ' · restart the core to apply providers to running engines';
  toast(msg);
  return res;
}

export function masterReplyModeChanged() {
  const r = document.querySelector('input[name="master-reply-mode"]:checked');
  document.getElementById('master-intro-wrap').classList.toggle('hidden', !(r && r.value === 'intro-once'));
}

export async function masterSaveReplyMode() {
  const r = document.querySelector('input[name="master-reply-mode"]:checked');
  const intro = (document.getElementById('master-intro') || { value: '' }).value.trim();
  const introUnnamed = (document.getElementById('master-intro-unnamed') || { value: '' }).value.trim();
  if (!r) return;
  try {
    await putMaster({ reply_mode: r.value, intro_message: intro, intro_message_unnamed: introUnnamed }, 'Default reply mode saved');
    await fetchOverview();
  } catch (e) { toast('Save failed: ' + e.message, 'error'); }
}

export async function masterSaveField(key, inputId) {
  const v = (document.getElementById(inputId) || { value: '' }).value.trim();
  try {
    await putMaster({ [key]: v }, 'Default ' + key + ' saved');
    await fetchOverview();
  } catch (e) { toast('Save failed: ' + e.message, 'error'); }
}

export async function masterSaveProviders() {
  const list = collectProviders();
  try {
    await putMaster({ ai: { providers: list } }, 'Default providers saved (' + list.length + ')');
    await fetchOverview();
  } catch (e) { toast('Save failed: ' + e.message, 'error'); }
}

export async function masterApplyAll(key, label) {
  const names = _profiles.map(p => p.name + ' (' + p.id + ')');
  const msg = 'Copy the Master ' + label + ' into EVERY profile?\n\n' + names.join('\n')
    + '\n\nEach profile then has its own explicit value (no longer inherits). Profiles that already set their own value are overwritten.';
  if (!confirm(msg)) return;
  try {
    const res = await api('/master/settings/apply-all', { method: 'POST', body: { keys: [key] } });
    const okN = (res.results || []).filter(r => r.ok).length;
    toast('Applied ' + label + ' to ' + okN + '/' + (res.results || []).length + ' profiles');
    await fetchOverview();
    renderDefaults(document.getElementById('master-tab-content'));
  } catch (e) { toast('Apply failed: ' + e.message, 'error'); }
}

// ─── Globals (inline onclick handlers) ────────────────────────────────────────
window.loadMaster = loadMaster;
window.switchMasterTab = switchMasterTab;
window.loadMasterNumbers = loadMasterNumbers;
window.openNumberChat = openNumberChat;
window.loadBotTeam = loadBotTeam;
window.runNumberCheck = runNumberCheck;
window.masterAddProvider = masterAddProvider;
window.masterReplyModeChanged = masterReplyModeChanged;
window.masterSaveReplyMode = masterSaveReplyMode;
window.masterSaveField = masterSaveField;
window.masterSaveProviders = masterSaveProviders;
window.masterApplyAll = masterApplyAll;
