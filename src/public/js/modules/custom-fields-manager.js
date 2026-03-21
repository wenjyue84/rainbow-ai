/**
 * custom-fields-manager.js — Custom Fields CRUD management UI
 * Renders inside the Settings tab as a sub-tab.
 */
import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml as esc } from '../core/utils.js';

const FIELD_TYPES = ['text', 'number', 'date', 'select', 'boolean'];

let fields = [];

async function loadFields() {
  try {
    fields = await api('/custom-fields');
  } catch (e) {
    fields = [];
    console.error('[CustomFields] Failed to load:', e);
  }
}

async function saveFields() {
  try {
    await api('/custom-fields', { method: 'PUT', body: fields });
    toast('Custom fields saved');
  } catch (e) {
    toast(e.message || 'Failed to save', 'error');
  }
}

function renderFieldRow(field, idx) {
  const optionsHtml = field.type === 'select'
    ? `<div class="mt-2">
        <label class="text-xs font-medium text-neutral-600">Options (comma-separated)</label>
        <input type="text" data-idx="${idx}" data-prop="options"
          value="${esc((field.options || []).join(', '))}"
          class="cf-input w-full px-3 py-1.5 border rounded-lg text-sm mt-1" placeholder="option1, option2, option3" />
       </div>`
    : '';

  return `
    <div class="flex flex-col gap-2 p-4 bg-white border rounded-xl shadow-soft" data-field-idx="${idx}">
      <div class="flex items-start gap-3">
        <div class="flex-1 grid grid-cols-3 gap-3">
          <div>
            <label class="text-xs font-medium text-neutral-600">Field Key</label>
            <input type="text" data-idx="${idx}" data-prop="name"
              value="${esc(field.name)}" placeholder="field_key"
              class="cf-input w-full px-3 py-1.5 border rounded-lg text-sm mt-1 font-mono" />
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-600">Display Label</label>
            <input type="text" data-idx="${idx}" data-prop="label"
              value="${esc(field.label)}" placeholder="Display Name"
              class="cf-input w-full px-3 py-1.5 border rounded-lg text-sm mt-1" />
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-600">Type</label>
            <select data-idx="${idx}" data-prop="type"
              class="cf-input w-full px-3 py-1.5 border rounded-lg text-sm mt-1 bg-white">
              ${FIELD_TYPES.map(t => `<option value="${t}" ${t === field.type ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
        </div>
        <button onclick="removeCustomField(${idx})" class="mt-5 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition" title="Delete field">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
      ${optionsHtml}
      <div class="flex items-center gap-6 mt-1">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" data-idx="${idx}" data-prop="required" ${field.required ? 'checked' : ''} class="cf-check rounded" />
          <span class="text-neutral-700">Required</span>
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" data-idx="${idx}" data-prop="aiWritable" ${field.aiWritable ? 'checked' : ''} class="cf-check rounded" />
          <span class="text-neutral-700">AI Writable</span>
        </label>
      </div>
    </div>`;
}

export async function renderCustomFieldsTab(container, skipLoad) {
  if (!skipLoad) await loadFields();

  container.innerHTML = `
    <div class="bg-white border rounded-2xl p-6">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h3 class="font-semibold text-lg">Custom Contact Fields</h3>
          <p class="text-sm text-neutral-500 mt-1">Define additional fields for guest contacts. These appear in the contact panel and can be used by workflows and event triggers.</p>
        </div>
        <button onclick="addCustomField()" class="px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition shadow-medium font-bold text-sm flex items-center gap-1.5">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
          Add Field
        </button>
      </div>

      <div id="custom-fields-list" class="space-y-3">
        ${fields.length === 0
          ? '<p class="text-sm text-neutral-400 text-center py-8">No custom fields defined yet. Click "Add Field" to create one.</p>'
          : fields.map((f, i) => renderFieldRow(f, i)).join('')}
      </div>

      ${fields.length > 0 ? `
      <div class="mt-6 flex justify-end">
        <button onclick="saveCustomFields()" class="px-6 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition shadow-medium font-bold text-sm">
          Save All Fields
        </button>
      </div>` : ''}
    </div>`;

  // Wire up input listeners to sync back to fields array
  container.querySelectorAll('.cf-input').forEach(el => {
    el.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      const prop = e.target.dataset.prop;
      if (prop === 'options') {
        fields[idx].options = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        fields[idx][prop] = e.target.value;
      }
      // Re-render if type changed (to show/hide options)
      if (prop === 'type') {
        renderCustomFieldsTab(container, true);
      }
    });
  });
  container.querySelectorAll('.cf-check').forEach(el => {
    el.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      const prop = e.target.dataset.prop;
      fields[idx][prop] = e.target.checked;
    });
  });
}

export function addCustomField() {
  fields.push({
    name: '',
    label: '',
    type: 'text',
    required: false,
    aiWritable: true,
  });
  const container = document.getElementById('settings-tab-content');
  if (container) {
    renderCustomFieldsTab(container, true).then(() => {
      const newField = container.querySelector(`[data-field-idx="${fields.length - 1}"]`);
      if (newField) newField.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
}
window.addCustomField = addCustomField;

export function removeCustomField(idx) {
  fields.splice(idx, 1);
  const container = document.getElementById('settings-tab-content');
  if (container) renderCustomFieldsTab(container, true);
}
window.removeCustomField = removeCustomField;

export async function saveCustomFields() {
  // Validate before saving
  for (const f of fields) {
    if (!f.name || !f.label) {
      toast('All fields must have a key and label', 'error');
      return;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(f.name)) {
      toast(`Field key "${f.name}" must be lowercase alphanumeric with underscores, starting with a letter`, 'error');
      return;
    }
    if (f.type === 'select' && (!f.options || f.options.length === 0)) {
      toast(`Select field "${f.name}" must have at least one option`, 'error');
      return;
    }
  }
  // Check duplicates
  const names = fields.map(f => f.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length > 0) {
    toast(`Duplicate field keys: ${dupes.join(', ')}`, 'error');
    return;
  }
  await saveFields();
}
window.saveCustomFields = saveCustomFields;
