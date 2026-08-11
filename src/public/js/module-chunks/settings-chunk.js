/**
 * settings-chunk.js — Lazy-loaded modules for the Settings tab
 * Extracted from module-registry.js (Phases 16, 23, 28)
 *
 * Note: settings-ai-models.js self-registers on window.* when imported by settings.js
 */

import {
  loadSettings,
  switchSettingsTab,
  renderFailoverTab,
  loadFailoverStatus,
  toggleHandbackGrace,
  saveFailoverSettings,
  failoverPromote,
  failoverDemote,
  applyAppearancePrefs,
  setAppearancePref,
  resetAppearancePrefs
} from '/public/js/modules/settings.js';

import {
  updateSystemAdminPhone,
  updateAdminNotifPrefs,
  renderOperatorsList,
  addOperator,
  removeOperator,
  updateOperatorField
} from '/public/js/modules/admin-notifications.js';

import {
  renderMcpServersTab,
  addMcpConnection,
  saveMcpConnection,
  cancelMcpConnectionForm,
  editMcpConnection,
  removeMcpConnection,
  testMcpConnection,
  toggleMcpConnection,
  saveMcpServerConfig,
  toggleMcpServer
} from '/public/js/modules/settings-mcp.js';

import {
  renderUsersTab,
  openUserModal,
  closeUserModal,
  toggleAccessType,
  saveUser,
  deleteUser
} from '/public/js/modules/settings-users.js';

import {
  updateT4ProviderStatus,
  scrollToElement,
  scrollToProviders,
  loadLLMSettings,
  renderT4ProvidersList,
  toggleT4InactiveProviders,
  toggleT4Provider,
  moveT4Provider,
  autoSaveT4Providers,
  testT4Provider,
  saveLLMSettings
} from '/public/js/modules/llm-settings.js';

// ─── Window globals ──────────────────────────────────────────────

window.loadSettings = loadSettings;
window.switchSettingsTab = switchSettingsTab;
window.renderFailoverTab = renderFailoverTab;
window.loadFailoverStatus = loadFailoverStatus;
window.toggleHandbackGrace = toggleHandbackGrace;
window.saveFailoverSettings = saveFailoverSettings;
window.failoverPromote = failoverPromote;
window.failoverDemote = failoverDemote;
window.applyAppearancePrefs = applyAppearancePrefs;
window.setAppearancePref = setAppearancePref;
window.resetAppearancePrefs = resetAppearancePrefs;
window.updateSystemAdminPhone = updateSystemAdminPhone;
window.updateAdminNotifPrefs = updateAdminNotifPrefs;
window.renderOperatorsList = renderOperatorsList;
window.addOperator = addOperator;
window.removeOperator = removeOperator;
window.updateOperatorField = updateOperatorField;
window.updateT4ProviderStatus = updateT4ProviderStatus;
window.scrollToElement = scrollToElement;
window.scrollToProviders = scrollToProviders;
window.loadLLMSettings = loadLLMSettings;
window.renderT4ProvidersList = renderT4ProvidersList;
window.toggleT4InactiveProviders = toggleT4InactiveProviders;
window.toggleT4Provider = toggleT4Provider;
window.moveT4Provider = moveT4Provider;
window.autoSaveT4Providers = autoSaveT4Providers;
window.testT4Provider = testT4Provider;
window.saveLLMSettings = saveLLMSettings;
window.renderMcpServersTab = renderMcpServersTab;
window.addMcpConnection = addMcpConnection;
window.saveMcpConnection = saveMcpConnection;
window.cancelMcpConnectionForm = cancelMcpConnectionForm;
window.editMcpConnection = editMcpConnection;
window.removeMcpConnection = removeMcpConnection;
window.testMcpConnection = testMcpConnection;
window.toggleMcpConnection = toggleMcpConnection;
window.saveMcpServerConfig = saveMcpServerConfig;
window.toggleMcpServer = toggleMcpServer;
window.renderUsersTab = renderUsersTab;
window.openUserModal = openUserModal;
window.closeUserModal = closeUserModal;
window.toggleAccessType = toggleAccessType;
window.saveUser = saveUser;
window.deleteUser = deleteUser;

console.log('[LazyChunk] Settings modules registered');
