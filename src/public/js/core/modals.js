/**
 * Modal Helper Functions
 * Generic modal management utilities
 */

// Global QR refresh interval tracking
let qrRefreshInterval = null;

/**
 * Close a modal by ID
 * @param {string} id - Modal element ID
 */
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

/**
 * Open a modal by ID
 * @param {string} id - Modal element ID
 */
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

/**
 * Show QR code modal for WhatsApp instance pairing
 * @param {string} id - Instance ID
 * @param {string} label - Instance display label
 */
function showInstanceQR(id, label) {
  document.getElementById('qr-modal-label').textContent = label;
  document.getElementById('qr-modal-content').innerHTML = '<div class="spinner mx-auto"></div>';
  document.getElementById('qr-modal').classList.remove('hidden');
  if (qrRefreshInterval) clearInterval(qrRefreshInterval);

  let _qrTimeoutId = null;

  async function fetchQR() {
    try {
      const d = await api('/whatsapp/instances/' + encodeURIComponent(id) + '/qr');
      const el = document.getElementById('qr-modal-content');
      if (!el) return;
      if (d.state === 'open') {
        clearInterval(qrRefreshInterval);
        if (_qrTimeoutId) { clearTimeout(_qrTimeoutId); _qrTimeoutId = null; }
        el.innerHTML = '<p class="text-success-600 font-medium py-4">Connected!</p>';
        if (typeof window.refreshWhatsAppList === 'function') window.refreshWhatsAppList();
        else if (typeof loadStatus === 'function') loadStatus();
      } else if (d.qrDataUrl) {
        el.innerHTML = `<img src="${d.qrDataUrl}" class="w-64 h-64 mx-auto" />`;
      } else {
        el.innerHTML = '<p class="text-neutral-500 text-sm py-4">Waiting for QR code...</p>';
      }
    } catch (e) {
      // Transient error — show warning but keep polling (do not stop the interval)
      const el = document.getElementById('qr-modal-content');
      if (el) el.innerHTML = `<p class="text-warning-500 text-sm py-2">Retrying\u2026 (${e.message})</p>`;
    }
  }

  fetchQR();
  qrRefreshInterval = setInterval(fetchQR, 2000);

  // 90-second hard timeout with retry button
  _qrTimeoutId = setTimeout(() => {
    clearInterval(qrRefreshInterval);
    qrRefreshInterval = null;
    _qrTimeoutId = null;
    const el = document.getElementById('qr-modal-content');
    if (el) el.innerHTML =
      '<p class="text-danger-500 text-sm mb-3">QR timed out. The instance may still be starting.</p>' +
      `<button onclick="showInstanceQR(${JSON.stringify(id)}, ${JSON.stringify(label)})" class="text-xs bg-primary-500 hover:bg-primary-600 text-white px-3 py-1.5 rounded-lg">Retry</button>`;
  }, 90_000);

  // Patch closeQRModal to also clear the timeout for this session
  const _prevClose = window.closeQRModal;
  window.closeQRModal = function () {
    if (_qrTimeoutId) { clearTimeout(_qrTimeoutId); _qrTimeoutId = null; }
    window.closeQRModal = _prevClose;
    _prevClose();
  };
}

/**
 * Close QR code modal and stop refresh interval
 */
function closeQRModal() {
  document.getElementById('qr-modal').classList.add('hidden');
  if (qrRefreshInterval) {
    clearInterval(qrRefreshInterval);
    qrRefreshInterval = null;
  }
}

/**
 * Show save template modal
 */
function showSaveTemplateModal() {
  document.getElementById('save-template-modal').classList.remove('hidden');
  document.getElementById('save-template-name').value = '';
  document.getElementById('save-template-name').focus();
}

/**
 * Toggle dropdown visibility by ID
 * @param {string} id - Dropdown element ID
 */
function toggleDropdown(id) {
  const dropdown = document.getElementById(id);
  if (dropdown) {
    dropdown.classList.toggle('hidden');
  }
}

/**
 * Close all dropdown menus
 */
function closeAllDropdowns() {
  document.querySelectorAll('[id$="-dropdown"]').forEach(dropdown => {
    dropdown.classList.add('hidden');
  });
  document.getElementById('run-all-dropdown-menu')?.classList.add('hidden');
}

// Export functions to global scope (for HTML onclick handlers)
window.closeModal = closeModal;
window.openModal = openModal;
window.showInstanceQR = showInstanceQR;
window.closeQRModal = closeQRModal;
window.showSaveTemplateModal = showSaveTemplateModal;
window.toggleDropdown = toggleDropdown;
window.closeAllDropdowns = closeAllDropdowns;
