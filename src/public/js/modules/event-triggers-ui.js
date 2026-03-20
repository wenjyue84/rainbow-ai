/**
 * event-triggers-ui.js — Event Triggers management UI
 * Renders inside the Settings tab as a sub-tab.
 */
import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml as esc } from '../core/utils.js';

let triggers = [];
let customFields = [];

// Core date fields always available
const CORE_DATE_FIELDS = [
  { name: 'checkIn', label: 'Check-In Date' },
  { name: 'checkOut', label: 'Check-Out Date' },
];

const CORE_FIELDS = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'email', label: 'Email', type: 'text' },
  { name: 'country', label: 'Country', type: 'text' },
  { name: 'language', label: 'Language', type: 'text' },
  { name: 'unit', label: 'Unit', type: 'text' },
  { name: 'contactStatus', label: 'Contact Status', type: 'text' },
  { name: 'paymentStatus', label: 'Payment Status', type: 'text' },
  { name: 'checkIn', label: 'Check-In', type: 'date' },
  { name: 'checkOut', label: 'Check-Out', type: 'date' },
  { name: 'depositPaid', label: 'Deposit Paid', type: 'boolean' },
  { name: 'depositAmount', label: 'Deposit Amount', type: 'text' },
];

const OPERATORS = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

async function loadData() {
  try {
    const [t, cf] = await Promise.all([
      api('/event-triggers'),
      api('/custom-fields'),
    ]);
    triggers = Array.isArray(t) ? t : [];
    customFields = Array.isArray(cf) ? cf : [];
  } catch (e) {
    console.error('[EventTriggers] Load failed:', e);
  }
}

function getAllFields() {
  return [...CORE_FIELDS, ...customFields.map(f => ({ name: f.name, label: f.label, type: f.type }))];
}

function getDateFields() {
  const all = getAllFields();
  return [...CORE_DATE_FIELDS, ...all.filter(f => f.type === 'date' && !CORE_DATE_FIELDS.find(d => d.name === f.name))];
}

function renderTriggerCard(trigger) {
  const dateFields = getDateFields();
  const dateFieldLabel = dateFields.find(f => f.name === trigger.timeTrigger.fieldName)?.label || trigger.timeTrigger.fieldName;
  const filterSummary = trigger.filters.length === 0
    ? 'No additional filters'
    : trigger.filters.map(f => {
      const fl = getAllFields().find(af => af.name === f.fieldName)?.label || f.fieldName;
      if (f.operator === 'is_empty' || f.operator === 'is_not_empty') return `${fl} ${f.operator.replace('_', ' ')}`;
      return `${fl} ${f.operator.replace('_', ' ')} "${f.value || ''}"`;
    }).join(' AND ');

  return `
    <div class="bg-white border rounded-xl p-4 shadow-soft">
      <div class="flex items-start justify-between mb-2">
        <div>
          <h4 class="font-semibold text-sm">${esc(trigger.name)}</h4>
          <p class="text-xs text-neutral-500 mt-1">
            ${trigger.timeTrigger.offsetAmount} ${trigger.timeTrigger.offsetUnit} ${trigger.timeTrigger.offsetDirection} <strong>${esc(dateFieldLabel)}</strong>
          </p>
          <p class="text-xs text-neutral-400 mt-0.5">${esc(filterSummary)}</p>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="toggleEventTrigger('${esc(trigger.id)}', ${!trigger.enabled})"
            class="px-2 py-1 text-xs rounded-lg ${trigger.enabled ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-500'}">
            ${trigger.enabled ? 'Enabled' : 'Disabled'}
          </button>
          <button onclick="editEventTrigger('${esc(trigger.id)}')" class="p-1 text-neutral-400 hover:text-primary-600 rounded">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
          </button>
          <button onclick="deleteEventTriggerUI('${esc(trigger.id)}')" class="p-1 text-red-400 hover:text-red-600 rounded">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
      <div class="bg-neutral-50 rounded-lg p-2 mt-2">
        <p class="text-xs text-neutral-600 font-mono">${esc(trigger.messageTemplate.substring(0, 120))}${trigger.messageTemplate.length > 120 ? '...' : ''}</p>
      </div>
    </div>`;
}

function renderForm(trigger) {
  const dateFields = getDateFields();
  const allFields = getAllFields();
  const isEdit = !!trigger.id;
  const t = trigger.timeTrigger || { fieldName: 'checkOut', offsetDirection: 'before', offsetAmount: 4, offsetUnit: 'hours' };
  const filters = trigger.filters || [];

  let filtersHtml = '';
  filters.forEach((f, idx) => {
    filtersHtml += renderFilterRow(f, idx, allFields);
  });

  return `
    <div class="bg-white border rounded-xl p-6 shadow-soft" id="evt-form">
      <h3 class="font-semibold text-lg mb-4">${isEdit ? 'Edit' : 'Create'} Event Trigger</h3>

      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-neutral-700 mb-1">Trigger Name</label>
          <input type="text" id="evt-name" value="${esc(trigger.name || '')}" placeholder="e.g., Checkout Reminder"
            class="w-full px-3 py-2 border rounded-lg text-sm" />
        </div>

        <div class="bg-blue-50 rounded-lg p-4 border border-blue-100">
          <label class="block text-sm font-bold text-neutral-800 mb-2">Time Condition</label>
          <div class="flex items-center gap-2 flex-wrap">
            <input type="number" id="evt-offset-amount" value="${t.offsetAmount}" min="0" class="w-20 px-2 py-1.5 border rounded-lg text-sm" />
            <select id="evt-offset-unit" class="px-2 py-1.5 border rounded-lg text-sm bg-white">
              <option value="minutes" ${t.offsetUnit === 'minutes' ? 'selected' : ''}>minutes</option>
              <option value="hours" ${t.offsetUnit === 'hours' ? 'selected' : ''}>hours</option>
              <option value="days" ${t.offsetUnit === 'days' ? 'selected' : ''}>days</option>
            </select>
            <select id="evt-offset-dir" class="px-2 py-1.5 border rounded-lg text-sm bg-white">
              <option value="before" ${t.offsetDirection === 'before' ? 'selected' : ''}>before</option>
              <option value="after" ${t.offsetDirection === 'after' ? 'selected' : ''}>after</option>
            </select>
            <select id="evt-date-field" class="px-2 py-1.5 border rounded-lg text-sm bg-white">
              ${dateFields.map(f => `<option value="${f.name}" ${t.fieldName === f.name ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="bg-amber-50 rounded-lg p-4 border border-amber-100">
          <div class="flex items-center justify-between mb-2">
            <label class="block text-sm font-bold text-neutral-800">Filter Conditions (AND)</label>
            <button onclick="addEventFilterRow()" class="text-xs px-2 py-1 bg-amber-200 hover:bg-amber-300 rounded-lg transition">+ Add Filter</button>
          </div>
          <div id="evt-filters-list" class="space-y-2">
            ${filtersHtml || '<p class="text-xs text-neutral-400">No filters — triggers for all contacts matching the time condition.</p>'}
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-neutral-700 mb-1">Message Template</label>
          <textarea id="evt-message" rows="3" placeholder="Hi {{contact.name}}, reminder: your checkout is {{contact.checkOut}}..."
            class="w-full px-3 py-2 border rounded-lg text-sm font-mono">${esc(trigger.messageTemplate || '')}</textarea>
          <p class="text-xs text-neutral-400 mt-1">Use {{contact.fieldName}} for dynamic values. E.g., {{contact.name}}, {{contact.checkOut}}, {{contact.unit}}</p>
        </div>

        <div class="flex items-center gap-2">
          <input type="checkbox" id="evt-enabled" ${trigger.enabled !== false ? 'checked' : ''} class="rounded" />
          <label for="evt-enabled" class="text-sm text-neutral-700">Enabled</label>
        </div>

        <div class="flex gap-2 justify-end">
          <button onclick="cancelEventForm()" class="px-4 py-2 border rounded-lg text-sm hover:bg-neutral-50 transition">Cancel</button>
          <button onclick="saveEventTrigger('${esc(trigger.id || '')}')" class="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-bold hover:bg-primary-700 transition">
            ${isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>`;
}

function renderFilterRow(filter, idx, allFields) {
  const needsValue = filter.operator !== 'is_empty' && filter.operator !== 'is_not_empty';
  return `
    <div class="flex items-center gap-2 flex-wrap" data-filter-idx="${idx}">
      <select class="evt-filter-field px-2 py-1.5 border rounded-lg text-sm bg-white" data-idx="${idx}">
        ${allFields.map(f => `<option value="${f.name}" ${filter.fieldName === f.name ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
      </select>
      <select class="evt-filter-op px-2 py-1.5 border rounded-lg text-sm bg-white" data-idx="${idx}" onchange="toggleFilterValue(${idx})">
        ${OPERATORS.map(o => `<option value="${o.value}" ${filter.operator === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>
      <input type="text" class="evt-filter-value px-2 py-1.5 border rounded-lg text-sm flex-1" data-idx="${idx}"
        value="${esc(filter.value || '')}" placeholder="value" style="${needsValue ? '' : 'display:none'}" />
      <button onclick="removeEventFilterRow(${idx})" class="p-1 text-red-400 hover:text-red-600">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>`;
}

// State for form editing
let _editingTrigger = null;
let _filterRows = [];

export async function renderEventTriggersTab(container) {
  await loadData();
  _editingTrigger = null;

  container.innerHTML = `
    <div class="bg-white border rounded-2xl p-6">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h3 class="font-semibold text-lg">Event Triggers</h3>
          <p class="text-sm text-neutral-500 mt-1">Trigger automated messages based on date fields and contact conditions.</p>
        </div>
        <button onclick="newEventTrigger()" class="px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition shadow-medium font-bold text-sm flex items-center gap-1.5">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
          New Trigger
        </button>
      </div>
      <div id="evt-list" class="space-y-3">
        ${triggers.length === 0
          ? '<p class="text-sm text-neutral-400 text-center py-8">No event triggers defined yet.</p>'
          : triggers.map(t => renderTriggerCard(t)).join('')}
      </div>
      <div id="evt-form-container"></div>
    </div>`;
}

export function newEventTrigger() {
  _editingTrigger = { name: '', timeTrigger: { fieldName: 'checkOut', offsetDirection: 'before', offsetAmount: 4, offsetUnit: 'hours' }, filters: [], messageTemplate: '', enabled: true };
  _filterRows = [];
  var formContainer = document.getElementById('evt-form-container');
  if (formContainer) formContainer.innerHTML = renderForm(_editingTrigger);
}
window.newEventTrigger = newEventTrigger;

export function editEventTrigger(id) {
  const trigger = triggers.find(t => t.id === id);
  if (!trigger) return;
  _editingTrigger = JSON.parse(JSON.stringify(trigger));
  _filterRows = [..._editingTrigger.filters];
  var formContainer = document.getElementById('evt-form-container');
  if (formContainer) formContainer.innerHTML = renderForm(_editingTrigger);
}
window.editEventTrigger = editEventTrigger;

export function cancelEventForm() {
  _editingTrigger = null;
  var formContainer = document.getElementById('evt-form-container');
  if (formContainer) formContainer.innerHTML = '';
}
window.cancelEventForm = cancelEventForm;

export function addEventFilterRow() {
  var list = document.getElementById('evt-filters-list');
  if (!list) return;
  var allFields = getAllFields();
  var idx = list.querySelectorAll('[data-filter-idx]').length;
  var newFilter = { fieldName: allFields[0]?.name || 'contactStatus', operator: 'equals', value: '' };
  var emptyMsg = list.querySelector('p');
  if (emptyMsg) emptyMsg.remove();
  list.insertAdjacentHTML('beforeend', renderFilterRow(newFilter, idx, allFields));
}
window.addEventFilterRow = addEventFilterRow;

export function removeEventFilterRow(idx) {
  var row = document.querySelector(`[data-filter-idx="${idx}"]`);
  if (row) row.remove();
}
window.removeEventFilterRow = removeEventFilterRow;

export function toggleFilterValue(idx) {
  var opEl = document.querySelector(`.evt-filter-op[data-idx="${idx}"]`);
  var valEl = document.querySelector(`.evt-filter-value[data-idx="${idx}"]`);
  if (!opEl || !valEl) return;
  var needsValue = opEl.value !== 'is_empty' && opEl.value !== 'is_not_empty';
  valEl.style.display = needsValue ? '' : 'none';
}
window.toggleFilterValue = toggleFilterValue;

function collectFormData(existingId) {
  var name = document.getElementById('evt-name')?.value?.trim();
  var message = document.getElementById('evt-message')?.value?.trim();
  var enabled = document.getElementById('evt-enabled')?.checked;
  var offsetAmount = parseInt(document.getElementById('evt-offset-amount')?.value || '0');
  var offsetUnit = document.getElementById('evt-offset-unit')?.value;
  var offsetDirection = document.getElementById('evt-offset-dir')?.value;
  var fieldName = document.getElementById('evt-date-field')?.value;

  if (!name) { toast('Name is required', 'error'); return null; }
  if (!message) { toast('Message template is required', 'error'); return null; }

  // Collect filters
  var filters = [];
  document.querySelectorAll('#evt-filters-list [data-filter-idx]').forEach(row => {
    var idx = row.dataset.filterIdx;
    var fField = row.querySelector(`.evt-filter-field[data-idx="${idx}"]`)?.value;
    var fOp = row.querySelector(`.evt-filter-op[data-idx="${idx}"]`)?.value;
    var fVal = row.querySelector(`.evt-filter-value[data-idx="${idx}"]`)?.value || '';
    if (fField && fOp) {
      var f = { fieldName: fField, operator: fOp };
      if (fOp !== 'is_empty' && fOp !== 'is_not_empty') f.value = fVal;
      filters.push(f);
    }
  });

  return {
    name,
    timeTrigger: { fieldName, offsetDirection, offsetAmount, offsetUnit },
    filters,
    messageTemplate: message,
    enabled: !!enabled,
    createdBy: 'admin',
  };
}

export async function saveEventTrigger(existingId) {
  var data = collectFormData(existingId);
  if (!data) return;
  try {
    if (existingId) {
      await api('/event-triggers/' + existingId, { method: 'PUT', body: data });
      toast('Trigger updated');
    } else {
      await api('/event-triggers', { method: 'POST', body: data });
      toast('Trigger created');
    }
    var container = document.getElementById('settings-tab-content');
    if (container) renderEventTriggersTab(container);
  } catch (e) {
    toast(e.message || 'Failed to save', 'error');
  }
}
window.saveEventTrigger = saveEventTrigger;

export async function toggleEventTrigger(id, enabled) {
  try {
    await api('/event-triggers/' + id, { method: 'PUT', body: { enabled } });
    toast(enabled ? 'Trigger enabled' : 'Trigger disabled');
    var container = document.getElementById('settings-tab-content');
    if (container) renderEventTriggersTab(container);
  } catch (e) {
    toast(e.message || 'Failed', 'error');
  }
}
window.toggleEventTrigger = toggleEventTrigger;

export async function deleteEventTriggerUI(id) {
  if (!confirm('Delete this event trigger?')) return;
  try {
    await api('/event-triggers/' + id, { method: 'DELETE' });
    toast('Trigger deleted');
    var container = document.getElementById('settings-tab-content');
    if (container) renderEventTriggersTab(container);
  } catch (e) {
    toast(e.message || 'Failed', 'error');
  }
}
window.deleteEventTriggerUI = deleteEventTriggerUI;
