/**
 * master-chunk.js — Lazy-loaded modules for the ⚙ Master tab (2026-09-08).
 * master.js self-registers its window.* handlers; the Users page and the
 * WhatsApp Logout / QR actions are shared with Settings / Dashboard.
 */

import '/public/js/modules/master.js';

import {
  renderUsersTab,
  openUserModal,
  closeUserModal,
  toggleAccessType,
  saveUser,
  deleteUser
} from '/public/js/modules/settings-users.js';

import {
  refreshWhatsAppList,
  logoutInstance
} from '/public/js/modules/whatsapp-instances.js';

window.renderUsersTab = renderUsersTab;
window.openUserModal = openUserModal;
window.closeUserModal = closeUserModal;
window.toggleAccessType = toggleAccessType;
window.saveUser = saveUser;
window.deleteUser = deleteUser;
if (!window.refreshWhatsAppList) window.refreshWhatsAppList = refreshWhatsAppList;
if (!window.logoutInstance) window.logoutInstance = logoutInstance;

console.log('[LazyChunk] Master modules registered');
