/**
 * setup.js — New-business setup wizard (#setup), 2026-09-23.
 *
 * Full-page, resumable, six steps. Every step is idempotent and re-derives
 * "done" from GET /api/rainbow/setup/status, so a reload (or a wizard opened
 * for an existing profile) lands on the first unfinished step. No new server
 * routes beyond /setup/status and POST /whatsapp/instances — everything else
 * reuses what the Advanced UI already calls:
 *
 *   1 Business   POST /profiles/blank | /profiles/{src}/clone   (active immediately)
 *   2 WhatsApp   POST /whatsapp/instances {profile} → poll GET …/{id}/qr
 *   3 Knowledge  PUT  /kb-files/about.md, /kb-files/faq.md
 *   4 Reply      PUT  /settings/reply-mode {replyMode, introMessage, botName}
 *   5 Test       POST /chat {profile, message, test:true}
 *   6 Login      POST /admin-users {username, password, allowedTenants:[profile]}
 *
 * Deep link: #setup/<profileId> resumes that profile's wizard.
 */

const DRAFT_KEY = 'rainbow-setup-draft';
const STEPS = ['Business', 'WhatsApp', 'Knowledge', 'Reply', 'Test', 'Login'];

const state = {
  step: 1,
  profileId: '',
  name: '',
  status: null,      // last GET /setup/status
  qrTimer: null,
  chat: [],          // step 5 transcript
  createdLogin: null // {username}
};

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function slugify(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/[\s]+/g, '-').replace(/-+/g, '-').slice(0, 40);
}

function isAdvanced() {
  return typeof window.getUiMode === 'function' && window.getUiMode() === 'advanced';
}

function canRun() {
  const s = window.__SESSION__;
  return !(s && Array.isArray(s.tenants) && s.tenants.length > 0);
}

/** api() with an explicit x-profile-id (the wizard's profile, not the switcher's). */
function sapi(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (state.profileId) headers['x-profile-id'] = state.profileId;
  return window.api(path, Object.assign({}, opts, { headers }));
}

function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ profileId: state.profileId, name: state.name, step: state.step })); } catch (_) { /* private mode */ }
}
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (_) { return null; }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* ignore */ }
}

function stopQrPoll() {
  if (state.qrTimer) { clearInterval(state.qrTimer); state.qrTimer = null; }
}

async function refreshStatus() {
  if (!state.profileId) { state.status = null; return null; }
  try {
    state.status = await window.api('/setup/status?profile=' + encodeURIComponent(state.profileId));
  } catch (e) {
    console.warn('[Setup] status failed:', e.message);
    state.status = null;
  }
  return state.status;
}

/** First unfinished step, derived from the server status (resume logic). */
function firstOpenStep(st) {
  if (!st || !st.exists) return 1;
  if (!st.instance) return 2;
  if (!st.kbFiles) return 3;
  return 6;
}

// ─── Entry point (tabs.js → window.loadSetup(sub)) ───────────────────────
export async function loadSetup(subTab) {
  stopQrPoll();
  const root = document.getElementById('setup-root');
  if (!root) return;
  if (!canRun()) {
    root.innerHTML = '<div class="p-8 text-center text-sm text-neutral-500">Only an unrestricted admin can set up a new business.</div>';
    return;
  }
  const draft = loadDraft();
  if (subTab && /^[a-z0-9][a-z0-9-]*$/.test(subTab)) {
    state.profileId = subTab;
    state.step = (draft && draft.profileId === subTab && draft.step) || 0; // 0 = decide from status
    state.name = (draft && draft.profileId === subTab && draft.name) || '';
  } else if (draft && draft.profileId) {
    state.profileId = draft.profileId;
    state.name = draft.name || '';
    state.step = draft.step || 0;
  } else {
    state.profileId = '';
    state.name = '';
    state.step = 1;
  }
  if (state.profileId) {
    await refreshStatus();
    if (!state.status || !state.status.exists) {
      // Draft points at a profile that no longer exists → start over.
      state.profileId = ''; state.step = 1; clearDraft();
    } else {
      if (!state.name) state.name = state.status.businessName || state.profileId;
      if (!state.step) state.step = firstOpenStep(state.status);
    }
  }
  render();
}

export function setupStartNew() {
  stopQrPoll();
  clearDraft();
  state.profileId = ''; state.name = ''; state.step = 1; state.status = null; state.chat = []; state.createdLogin = null;
  history.replaceState(null, '', '#setup');
  render();
}

export function setupGo(step) {
  stopQrPoll();
  if (step < 1 || step > STEPS.length) return;
  if (step > 1 && !state.profileId) { window.toast('Create the business first', 'error'); return; }
  state.step = step;
  saveDraft();
  render();
}

// ─── Rendering ───────────────────────────────────────────────────────────
function render() {
  const root = document.getElementById('setup-root');
  if (!root) return;
  const shown = Math.min(state.step, STEPS.length);
  const pct = Math.round(((shown - 1) / (STEPS.length - 1)) * 100);
  const crumbs = STEPS.map((label, i) => {
    const n = i + 1;
    const cls = n === state.step ? 'text-primary-700 font-semibold' : (n < state.step ? 'text-neutral-500' : 'text-neutral-400');
    const clickable = state.profileId || n === 1;
    return '<button type="button" ' + (clickable ? 'onclick="window.setupGo(' + n + ')"' : 'disabled') + ' class="text-xs ' + cls + ' hover:text-primary-600 disabled:cursor-default">' + n + '. ' + label + '</button>';
  }).join('');
  let body = '';
  switch (state.step) {
    case 1: body = renderBusiness(); break;
    case 2: body = renderWhatsApp(); break;
    case 3: body = renderKnowledge(); break;
    case 4: body = renderReply(); break;
    case 5: body = renderTest(); break;
    case 6: body = renderLogin(); break;
    case 7: body = renderDone(); break;
    default: body = renderBusiness();
  }
  const subtitle = state.profileId
    ? 'Setting up <span class="font-semibold text-neutral-700">' + esc(state.name || state.profileId) + '</span> <span class="font-mono text-xs bg-neutral-100 px-1.5 py-0.5 rounded">' + esc(state.profileId) + '</span>'
    : 'Create a business, connect its WhatsApp number, teach it, test it and hand over a login. No server access needed.';
  root.innerHTML =
    '<div class="max-w-2xl mx-auto">' +
    '<div class="mb-4 flex items-start justify-between gap-4">' +
    '<div><h2 class="text-2xl font-bold text-neutral-800">New business</h2><p class="text-sm text-neutral-500 mt-1">' + subtitle + '</p></div>' +
    (state.profileId ? '<button type="button" onclick="window.setupStartNew()" class="text-xs text-neutral-500 hover:text-neutral-700 whitespace-nowrap">Start another</button>' : '') +
    '</div>' +
    '<div class="mb-2 h-1.5 bg-neutral-200 rounded-full overflow-hidden"><div class="h-full bg-primary-500 transition-all" style="width:' + pct + '%"></div></div>' +
    '<div class="flex justify-between mb-5 px-0.5">' + crumbs + '</div>' +
    '<div class="bg-white border border-neutral-200 rounded-2xl p-6 shadow-soft">' + body + '</div>' +
    '</div>';
  afterRender();
}

function card(title, hint) {
  return '<h3 class="text-lg font-semibold text-neutral-800 mb-1">' + title + '</h3>' + (hint ? '<p class="text-sm text-neutral-500 mb-5">' + hint + '</p>' : '<div class="mb-4"></div>');
}
function primaryBtn(label, onclick, id) {
  return '<button type="button" ' + (id ? 'id="' + id + '" ' : '') + 'onclick="' + onclick + '" class="bg-primary-500 hover:bg-primary-600 text-white px-5 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50">' + label + '</button>';
}
function ghostBtn(label, onclick) {
  return '<button type="button" onclick="' + onclick + '" class="text-neutral-500 hover:text-neutral-700 px-4 py-2 rounded-xl text-sm font-medium transition">' + label + '</button>';
}
function footer(primaryHtml, allowBack, skipHtml) {
  return '<div class="flex items-center justify-between mt-6">' +
    '<div>' + (allowBack ? ghostBtn('← Back', 'window.setupGo(' + (state.step - 1) + ')') : '') + '</div>' +
    '<div class="flex items-center gap-2">' + (skipHtml || '') + primaryHtml + '</div></div>';
}
function errBox(id) {
  return '<p id="' + id + '" class="hidden text-sm text-danger-600 mt-3"></p>';
}
function showErr(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}
function busy(btnId, on, label) {
  const b = document.getElementById(btnId);
  if (!b) return;
  b.disabled = !!on;
  if (label) b.textContent = label;
}

// ─── Step 1: Business ────────────────────────────────────────────────────
function renderBusiness() {
  const advanced = isAdvanced();
  const profiles = (window.profileSwitcher && window.profileSwitcher.listProfiles) ? window.profileSwitcher.listProfiles() : [];
  const tmpl = advanced
    ? '<div class="mt-4"><label class="block text-xs font-medium text-neutral-600 mb-1">Start from</label>' +
      '<select id="setup-source" class="w-full border border-neutral-300 rounded-xl px-3 py-2 text-sm bg-white">' +
      '<option value="">Blank (recommended)</option>' +
      profiles.map(p => '<option value="' + esc(p.id) + '">Copy settings from ' + esc(p.name) + '</option>').join('') +
      '</select><p class="text-xs text-neutral-400 mt-1">A copy takes the source\'s intents, replies and settings — never its WhatsApp number.</p></div>'
    : '';
  return card('What is the business called?', 'The assistant introduces itself with this name. You can change it later in Settings.') +
    '<label class="block text-xs font-medium text-neutral-600 mb-1">Business name</label>' +
    '<input id="setup-name" type="text" value="' + esc(state.name) + '" placeholder="e.g. Sunrise Dental Clinic" class="w-full border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300" oninput="window.setupNameInput(this)">' +
    '<p class="text-xs text-neutral-400 mt-1">ID: <span id="setup-id-preview" class="font-mono">' + esc(state.profileId || slugify(state.name) || '—') + '</span></p>' +
    tmpl + errBox('setup-err-1') +
    footer(primaryBtn('Create business →', 'window.setupCreateBusiness()', 'setup-btn-1'), false);
}

export function setupNameInput(el) {
  state.name = el.value;
  const prev = document.getElementById('setup-id-preview');
  if (prev) prev.textContent = slugify(el.value) || '—';
}

export async function setupCreateBusiness() {
  const name = (document.getElementById('setup-name') || {}).value || '';
  const id = slugify(name);
  if (!name.trim()) { showErr('setup-err-1', 'Business name is required'); return; }
  if (!id || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(id)) { showErr('setup-err-1', 'Name must contain at least one letter or number'); return; }
  const srcEl = document.getElementById('setup-source');
  const source = srcEl ? srcEl.value : '';
  busy('setup-btn-1', true, 'Creating…');
  try {
    const path = source ? '/profiles/' + encodeURIComponent(source) + '/clone' : '/profiles/blank';
    let res;
    try {
      res = await window.api(path, { method: 'POST', body: { newProfileId: id, displayName: name.trim() } });
    } catch (e) {
      // Already exists → resume it instead of failing (idempotent step).
      if (/already exists/i.test(e.message || '')) res = { profileId: id, active: true, resumed: true };
      else throw e;
    }
    state.profileId = res.profileId || id;
    state.name = name.trim();
    if (res.active === false) {
      window.toast(res.message || 'Profile created; restart needed to activate', 'warning');
    }
    saveDraft();
    // Make the switcher know the new profile so the rest of the dashboard
    // (Chats, Knowledge, Settings) opens on it after the wizard.
    if (window.profileSwitcher && typeof window.profileSwitcher.reload === 'function') {
      try { await window.profileSwitcher.reload(); } catch (_) { /* non-fatal */ }
      if (typeof window.profileSwitcher.setActiveQuiet === 'function') window.profileSwitcher.setActiveQuiet(state.profileId);
    }
    history.replaceState(null, '', '#setup/' + state.profileId);
    await refreshStatus();
    state.step = 2;
    saveDraft();
    render();
  } catch (e) {
    showErr('setup-err-1', e.message || 'Failed to create business');
    busy('setup-btn-1', false, 'Create business →');
  }
}

// ─── Step 2: WhatsApp ────────────────────────────────────────────────────
function renderWhatsApp() {
  const st = state.status || {};
  const inst = st.instance;
  let body;
  if (inst && (inst.state === 'open' || inst.user)) {
    body = '<div class="rounded-xl border border-success-200 bg-success-50 p-4 text-sm">' +
      '<div class="font-semibold text-success-700">✓ WhatsApp connected</div>' +
      '<div class="text-neutral-600 mt-1">Number <span class="font-mono">+' + esc(inst.user || '?') + '</span> answers for this business (instance <span class="font-mono">' + esc(inst.id) + '</span>).</div></div>';
    return card('Connect a WhatsApp number', '') + body + footer(primaryBtn('Next →', 'window.setupGo(3)'), true);
  }
  if (inst) {
    // Bridge exists but not paired yet → show QR and poll.
    body = '<div id="setup-qr" class="text-center py-2"><div class="spinner mx-auto"></div><p class="text-xs text-neutral-500 mt-2">Loading QR…</p></div>' +
      '<p class="text-xs text-neutral-500 text-center mt-3">On the phone that owns the number: WhatsApp → Linked Devices → Link a Device → scan. The QR refreshes every ~20 s.</p>' +
      (inst.canManage ? '' : '<p class="text-xs text-danger-600 text-center mt-2">This bridge has no QR token; pair it from WA Hub instead.</p>');
    return card('Scan to pair', 'Instance <span class="font-mono">' + esc(inst.id) + '</span> is running and waiting for a phone.') + body + errBox('setup-err-2') +
      footer(primaryBtn('I\'ll connect later →', 'window.setupGo(3)'), true);
  }
  if (st.hubConfigured === false) {
    body = '<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">This server has no WA Hub link (WA_HUB_URL), so a number cannot be created from here. Add it in WA Hub, then come back — or skip for now.</div>';
    return card('Connect a WhatsApp number', '') + body + footer(primaryBtn('Skip →', 'window.setupGo(3)'), true);
  }
  body = '<div class="rounded-xl border border-neutral-200 p-4 text-sm text-neutral-600">' +
    '<p>You need a SIM in a phone with WhatsApp installed. Clicking <b>Connect a number</b> starts a bridge for this business and shows a QR code to scan.</p></div>' + errBox('setup-err-2');
  return card('Connect a WhatsApp number', 'Guests message this number; the assistant replies from it.') + body +
    footer(primaryBtn('Connect a number', 'window.setupConnectNumber()', 'setup-btn-2'), true, ghostBtn('Connect later', 'window.setupGo(3)'));
}

export async function setupConnectNumber() {
  busy('setup-btn-2', true, 'Starting bridge…');
  try {
    await window.api('/whatsapp/instances', { method: 'POST', body: { profile: state.profileId }, timeout: 70000 });
  } catch (e) {
    if (!/already exists/i.test(e.message || '')) {
      showErr('setup-err-2', e.message || 'Could not create the number');
      busy('setup-btn-2', false, 'Connect a number');
      return;
    }
  }
  await refreshStatus();
  render();
}

function startQrPoll(instanceId) {
  stopQrPoll();
  const tick = async () => {
    const el = document.getElementById('setup-qr');
    if (!el) { stopQrPoll(); return; }
    try {
      const d = await window.api('/whatsapp/instances/' + encodeURIComponent(instanceId) + '/qr');
      if (d.state === 'open' || d.user) {
        stopQrPoll();
        await refreshStatus();
        window.toast('WhatsApp paired ✓');
        render();
        return;
      }
      if (d.qr || d.qrDataUrl) {
        el.innerHTML = '<img src="' + (d.qr || d.qrDataUrl) + '" class="w-64 h-64 mx-auto rounded-lg border" alt="WhatsApp QR">' +
          '<p class="text-xs text-neutral-500 mt-2">Waiting for scan… (' + esc(d.state || 'connecting') + ')</p>';
      } else {
        el.innerHTML = '<div class="spinner mx-auto"></div><p class="text-xs text-neutral-500 mt-2">Waiting for QR… (bridge: ' + esc(d.state || 'starting') + ')</p>';
      }
    } catch (e) {
      el.innerHTML = '<p class="text-sm text-danger-600">' + esc(e.message) + '</p><p class="text-xs text-neutral-500 mt-1">Retrying…</p>';
    }
  };
  tick();
  state.qrTimer = setInterval(tick, 3000);
}

// ─── Step 3: Knowledge ───────────────────────────────────────────────────
function renderKnowledge() {
  return card('Teach the assistant', 'Plain text is fine. The assistant answers guests from this — the more specific, the better.') +
    '<label class="block text-xs font-medium text-neutral-600 mb-1">About your business</label>' +
    '<textarea id="setup-about" rows="6" placeholder="Where you are, opening hours, what you offer, prices, how to book or pay…" class="w-full border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"></textarea>' +
    '<label class="block text-xs font-medium text-neutral-600 mb-1 mt-4">Common questions &amp; answers</label>' +
    '<textarea id="setup-faq" rows="6" placeholder="Q: Do you have parking?&#10;A: Yes, free parking behind the building.&#10;&#10;Q: …" class="w-full border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"></textarea>' +
    '<p id="setup-kb-loading" class="text-xs text-neutral-400 mt-1">Loading existing content…</p>' + errBox('setup-err-3') +
    footer(primaryBtn('Save & continue →', 'window.setupSaveKnowledge()', 'setup-btn-3'), true, ghostBtn('Skip for now', 'window.setupGo(4)'));
}

async function prefillKnowledge() {
  const about = document.getElementById('setup-about');
  const faq = document.getElementById('setup-faq');
  const note = document.getElementById('setup-kb-loading');
  for (const [el, file] of [[about, 'about.md'], [faq, 'faq.md']]) {
    if (!el) continue;
    try {
      const d = await sapi('/kb-files/' + file);
      if (d && typeof d.content === 'string') el.value = stripFrontMatter(d.content);
    } catch (_) { /* 404 = nothing yet */ }
  }
  if (note) note.remove();
}

function stripFrontMatter(s) {
  return String(s || '').replace(/^---[\s\S]*?---\n?/, '').replace(/^# [^\n]*\n+/, '');
}

function kbDoc(title, body) {
  const today = new Date().toISOString().slice(0, 10);
  return '---\ntitle: ' + title + '\nas_of: ' + today + '\n---\n\n# ' + title + '\n\n' + String(body || '').trim() + '\n';
}

export async function setupSaveKnowledge() {
  const about = (document.getElementById('setup-about') || {}).value || '';
  const faq = (document.getElementById('setup-faq') || {}).value || '';
  if (!about.trim() && !faq.trim()) { setupGo(4); return; }
  busy('setup-btn-3', true, 'Saving…');
  try {
    if (about.trim()) await sapi('/kb-files/about.md', { method: 'PUT', body: { content: kbDoc('About ' + (state.name || state.profileId), about) } });
    if (faq.trim()) await sapi('/kb-files/faq.md', { method: 'PUT', body: { content: kbDoc('Frequently asked questions', faq) } });
    window.toast('Knowledge saved');
    await refreshStatus();
    state.step = 4; saveDraft(); render();
  } catch (e) {
    showErr('setup-err-3', e.message || 'Save failed');
    busy('setup-btn-3', false, 'Save & continue →');
  }
}

// ─── Step 4: Reply behaviour ─────────────────────────────────────────────
const MODES = [
  { id: 'normal', title: 'Auto-reply', desc: 'The assistant answers every guest message itself. Staff can still jump in from Chats.' },
  { id: 'intro-once', title: 'Introduce once, then a human', desc: 'Greets new guests with one message, then stays quiet so your team replies.' },
  { id: 'silent', title: 'Silent inbox', desc: 'Never replies. Messages just land in Chats for your team.' }
];

function renderReply() {
  const st = state.status || {};
  const cur = st.replyMode || 'normal';
  const bot = st.botName || (state.name ? state.name.split(/\s+/)[0] : '') || 'Rainbow';
  state.introDefault = defaultIntro(bot);
  const cards = MODES.map(m =>
    '<label class="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ' + (m.id === cur ? 'border-primary-400 bg-primary-50' : 'border-neutral-200 hover:border-neutral-300') + '">' +
    '<input type="radio" name="setup-mode" value="' + m.id + '"' + (m.id === cur ? ' checked' : '') + ' class="mt-1 text-primary-500" onchange="window.setupModeChanged()">' +
    '<div><div class="text-sm font-medium text-neutral-800">' + m.title + '</div><div class="text-xs text-neutral-500">' + m.desc + '</div></div></label>').join('');
  return card('How should it reply?', 'You can change this any time in Settings → Reply Mode.') +
    '<div class="space-y-2">' + cards + '</div>' +
    '<div class="mt-4"><label class="block text-xs font-medium text-neutral-600 mb-1">Assistant\'s name</label>' +
    '<input id="setup-botname" type="text" value="' + esc(bot) + '" maxlength="60" oninput="window.setupBotNameInput(this)" class="w-full border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300">' +
    '<p class="text-xs text-neutral-400 mt-1">Used when it introduces itself, e.g. "Hi, I\'m ' + esc(bot) + '".</p></div>' +
    '<div id="setup-intro-wrap" class="mt-4 ' + (cur === 'intro-once' ? '' : 'hidden') + '"><label class="block text-xs font-medium text-neutral-600 mb-1">Intro message</label>' +
    '<textarea id="setup-intro" rows="3" class="w-full border border-neutral-300 rounded-xl px-3 py-2 text-sm">' + esc(defaultIntro(bot)) + '</textarea></div>' +
    errBox('setup-err-4') +
    footer(primaryBtn('Save & continue →', 'window.setupSaveReply()', 'setup-btn-4'), true);
}

function defaultIntro(bot) {
  return 'Hi! I\'m ' + bot + ', the assistant for ' + (state.name || 'our team') + '. Thanks for your message — a team member will reply shortly.';
}

/** Keep the suggested intro in sync with the bot name until the user edits it. */
export function setupBotNameInput(el) {
  const intro = document.getElementById('setup-intro');
  if (!intro) return;
  const prev = state.introDefault || '';
  if (intro.value.trim() === prev.trim() || !intro.value.trim()) {
    state.introDefault = defaultIntro((el.value || '').trim() || 'the assistant');
    intro.value = state.introDefault;
  }
}

export function setupModeChanged() {
  const sel = document.querySelector('input[name="setup-mode"]:checked');
  const wrap = document.getElementById('setup-intro-wrap');
  if (wrap) wrap.classList.toggle('hidden', !(sel && sel.value === 'intro-once'));
  document.querySelectorAll('input[name="setup-mode"]').forEach(r => {
    const lab = r.closest('label');
    if (!lab) return;
    lab.classList.toggle('border-primary-400', r.checked);
    lab.classList.toggle('bg-primary-50', r.checked);
    lab.classList.toggle('border-neutral-200', !r.checked);
  });
}

export async function setupSaveReply() {
  const sel = document.querySelector('input[name="setup-mode"]:checked');
  const mode = sel ? sel.value : 'normal';
  const botName = ((document.getElementById('setup-botname') || {}).value || '').trim();
  const intro = ((document.getElementById('setup-intro') || {}).value || '').trim();
  const body = { replyMode: mode };
  if (botName) body.botName = botName;
  if (mode === 'intro-once') body.introMessage = intro || defaultIntro(botName || 'the assistant');
  busy('setup-btn-4', true, 'Saving…');
  try {
    await sapi('/settings/reply-mode', { method: 'PUT', body });
    window.toast('Reply behaviour saved');
    await refreshStatus();
    state.step = 5; saveDraft(); render();
  } catch (e) {
    showErr('setup-err-4', e.message || 'Save failed');
    busy('setup-btn-4', false, 'Save & continue →');
  }
}

// ─── Step 5: Test ────────────────────────────────────────────────────────
function chatBubbles() {
  return state.chat.map(m => '<div class="flex ' + (m.role === 'user' ? 'justify-end' : 'justify-start') + '"><div class="max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ' + (m.role === 'user' ? 'bg-primary-500 text-white' : 'bg-neutral-100 text-neutral-800') + '">' + esc(m.text) + '</div></div>').join('');
}

function renderTest() {
  const st = state.status || {};
  const silent = st.replyMode === 'silent';
  const log = state.chat.length ? chatBubbles() : '<p class="text-xs text-neutral-400 text-center py-6">Ask something a guest would ask.</p>';
  const waHint = st.instance && st.instance.user
    ? '<p class="text-xs text-neutral-500 mt-3">Or send a real WhatsApp message to <span class="font-mono">+' + esc(st.instance.user) + '</span> from another phone and watch it in <a href="#live-chat/' + esc(state.profileId) + '" class="text-primary-600 hover:underline">Chats</a>.</p>'
    : '';
  return card('Try it', silent ? 'Reply mode is Silent, so the assistant will not answer guests — this box still shows what it would say.' : 'This talks to the same engine that answers WhatsApp, using the knowledge you just saved.') +
    '<div id="setup-chat-log" class="space-y-2 max-h-72 overflow-y-auto border border-neutral-200 rounded-xl p-3 bg-white">' + log + '</div>' +
    '<form onsubmit="window.setupSendTest(event)" class="flex gap-2 mt-3">' +
    '<input id="setup-chat-input" type="text" placeholder="e.g. What time do you open?" autocomplete="off" class="flex-1 border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300">' +
    '<button type="submit" id="setup-btn-5" class="bg-primary-500 hover:bg-primary-600 text-white px-4 py-2 rounded-xl text-sm font-semibold">Send</button></form>' +
    waHint + errBox('setup-err-5') +
    footer(primaryBtn('Next →', 'window.setupGo(6)'), true);
}

export async function setupSendTest(ev) {
  if (ev) ev.preventDefault();
  const input = document.getElementById('setup-chat-input');
  const text = (input ? input.value : '').trim();
  if (!text) return;
  input.value = '';
  state.chat.push({ role: 'user', text });
  renderChatLog();
  busy('setup-btn-5', true, '…');
  try {
    const res = await fetch('/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId: 'test-setup-' + state.profileId, profile: state.profileId, test: true })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    state.chat.push({ role: 'bot', text: d.reply || '(no reply — ' + (d.action || 'skipped') + ')' });
  } catch (e) {
    state.chat.push({ role: 'bot', text: '⚠ ' + (e.message || 'request failed') });
  }
  busy('setup-btn-5', false, 'Send');
  renderChatLog();
}

function renderChatLog() {
  const el = document.getElementById('setup-chat-log');
  if (!el) return;
  el.innerHTML = chatBubbles();
  el.scrollTop = el.scrollHeight;
}

// ─── Step 6: Team login ──────────────────────────────────────────────────
function renderLogin() {
  const st = state.status || {};
  const loginUrl = location.origin + '/';
  if (st.hasLogin || state.createdLogin) {
    return card('Team login', '') +
      '<div class="rounded-xl border border-success-200 bg-success-50 p-4 text-sm">' +
      '<div class="font-semibold text-success-700">✓ A login exists for this business</div>' +
      (state.createdLogin ? '<div class="text-neutral-600 mt-1">Username <span class="font-mono">' + esc(state.createdLogin.username) + '</span></div>' : '') +
      '<div class="text-neutral-600 mt-1">Sign in at <a href="' + esc(loginUrl) + '" class="font-mono text-primary-600 hover:underline" target="_blank" rel="noopener">' + esc(loginUrl) + '</a> — they only see this business.</div></div>' +
      '<p class="text-xs text-neutral-500 mt-3">Manage users under ⚙ Master → Users.</p>' +
      footer(primaryBtn('Finish ✓', 'window.setupFinish()'), true, ghostBtn('Add another user', 'window.setupShowLoginForm()'));
  }
  return card('Hand over a login', 'Your client (or their staff) signs in with this and sees only their own business — Chats, Knowledge, Test and Settings.') +
    renderLoginForm() +
    footer(primaryBtn('Create login & finish', 'window.setupCreateLogin()', 'setup-btn-6'), true, ghostBtn('Skip', 'window.setupFinish()'));
}

function renderLoginForm() {
  const suggested = (state.profileId || '').replace(/-/g, '') + '-admin';
  return '<div id="setup-login-form"><label class="block text-xs font-medium text-neutral-600 mb-1">Username</label>' +
    '<input id="setup-username" type="text" value="' + esc(suggested) + '" autocomplete="off" class="w-full border border-neutral-300 rounded-xl px-3 py-2 text-sm">' +
    '<label class="block text-xs font-medium text-neutral-600 mb-1 mt-3">Password</label>' +
    '<div class="flex gap-2"><input id="setup-password" type="text" autocomplete="new-password" class="flex-1 border border-neutral-300 rounded-xl px-3 py-2 text-sm font-mono">' +
    '<button type="button" onclick="window.setupRandomPass()" class="text-xs border border-neutral-300 rounded-xl px-3 hover:bg-neutral-50">Generate</button></div>' +
    '<p class="text-xs text-neutral-400 mt-1">Write it down now — it is not shown again.</p>' + errBox('setup-err-6') + '</div>';
}

export function setupShowLoginForm() {
  state.createdLogin = null;
  if (state.status) state.status.hasLogin = false;
  render();
}

export function setupRandomPass() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint32Array(14);
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buf);
  else for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 1e9);
  let out = '';
  for (let i = 0; i < buf.length; i++) out += chars[buf[i] % chars.length];
  const el = document.getElementById('setup-password');
  if (el) el.value = out;
}

export async function setupCreateLogin() {
  const username = ((document.getElementById('setup-username') || {}).value || '').trim();
  const password = (document.getElementById('setup-password') || {}).value || '';
  if (!username) { showErr('setup-err-6', 'Username is required'); return; }
  if (password.length < 8) { showErr('setup-err-6', 'Password must be at least 8 characters'); return; }
  busy('setup-btn-6', true, 'Creating…');
  try {
    await window.api('/admin-users', { method: 'POST', body: { username, password, role: 'operator', allowedTenants: [state.profileId] } });
    state.createdLogin = { username };
    await refreshStatus();
    window.toast('Login created');
    state.step = 7; saveDraft(); render();
  } catch (e) {
    showErr('setup-err-6', e.message || 'Could not create the login');
    busy('setup-btn-6', false, 'Create login & finish');
  }
}

export function setupFinish() {
  state.step = 7; saveDraft(); render();
}

// ─── Done ────────────────────────────────────────────────────────────────
function renderDone() {
  const st = state.status || {};
  const hasLogin = !!(st.hasLogin || state.createdLogin);
  const rows = [
    ['Business', true, esc(state.name || state.profileId)],
    ['WhatsApp', !!(st.instance && st.instance.user), st.instance && st.instance.user ? '+' + esc(st.instance.user) : 'not connected — Settings → WhatsApp Number'],
    ['Knowledge', !!st.kbFiles, st.kbFiles ? st.kbFiles + ' file(s)' : 'empty — add it under Knowledge'],
    ['Reply mode', true, esc(st.replyMode || 'normal')],
    ['Team login', hasLogin, hasLogin ? (state.createdLogin ? esc(state.createdLogin.username) : 'exists') : 'none yet — ⚙ Master → Users']
  ].map(([k, ok, v]) => '<div class="flex items-center gap-3 text-sm py-1.5 border-b border-neutral-100 last:border-0"><span class="' + (ok ? 'text-success-600' : 'text-neutral-400') + '">' + (ok ? '✓' : '○') + '</span><span class="w-28 text-neutral-500">' + k + '</span><span class="text-neutral-800">' + v + '</span></div>').join('');
  return '<div class="text-center mb-4"><div class="text-4xl mb-2">🎉</div><h3 class="text-lg font-semibold text-neutral-800">' + esc(state.name || state.profileId) + ' is live</h3></div>' +
    '<div class="rounded-xl border border-neutral-200 p-4">' + rows + '</div>' +
    '<div class="flex justify-center gap-2 mt-6">' + primaryBtn('Go to Home →', 'window.setupGoHome()') + '</div>';
}

export function setupGoHome() {
  const pid = state.profileId;
  clearDraft();
  stopQrPoll();
  window.location.hash = 'dashboard/' + pid; // handleNavigation switches the profile
}

// ─── Post-render hooks ───────────────────────────────────────────────────
function afterRender() {
  if (state.step === 2 && state.status && state.status.instance && !(state.status.instance.state === 'open' || state.status.instance.user)) {
    startQrPoll(state.status.instance.id);
  }
  if (state.step === 3) prefillKnowledge();
  if (state.step === 6 && !(state.status && state.status.hasLogin) && !state.createdLogin) setupRandomPass();
  if (state.step === 5) {
    const inp = document.getElementById('setup-chat-input');
    if (inp) inp.focus();
  }
}

export function cleanupSetup() { stopQrPoll(); }
