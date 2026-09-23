/**
 * setup-chunk.js — Lazy-loaded module for the New-business setup wizard
 * (#setup, 2026-09-23). Registers the window.* handlers the template's
 * inline onclick attributes call.
 */

import {
  loadSetup,
  setupStartNew,
  setupGo,
  setupNameInput,
  setupCreateBusiness,
  setupConnectNumber,
  setupSaveKnowledge,
  setupModeChanged,
  setupBotNameInput,
  setupSaveReply,
  setupSendTest,
  setupShowLoginForm,
  setupRandomPass,
  setupCreateLogin,
  setupFinish,
  setupGoHome,
  cleanupSetup
} from '/public/js/modules/setup.js';

window.loadSetup = loadSetup;
window.setupStartNew = setupStartNew;
window.setupGo = setupGo;
window.setupNameInput = setupNameInput;
window.setupCreateBusiness = setupCreateBusiness;
window.setupConnectNumber = setupConnectNumber;
window.setupSaveKnowledge = setupSaveKnowledge;
window.setupModeChanged = setupModeChanged;
window.setupBotNameInput = setupBotNameInput;
window.setupSaveReply = setupSaveReply;
window.setupSendTest = setupSendTest;
window.setupShowLoginForm = setupShowLoginForm;
window.setupRandomPass = setupRandomPass;
window.setupCreateLogin = setupCreateLogin;
window.setupFinish = setupFinish;
window.setupGoHome = setupGoHome;
window.cleanupSetup = cleanupSetup;

console.log('[LazyChunk] Setup wizard modules registered');
