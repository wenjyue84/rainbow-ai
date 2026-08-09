/**
 * understanding-chunk.js — Lazy-loaded modules for the Understanding tab
 * Extracted from module-registry.js (Phases 1-partial, 34)
 */

import { loadUnderstanding } from '/public/js/modules/understanding.js';

import {
  loadRegexPatterns,
  renderRegexPatterns,
  addRegexPattern,
  removeRegexPattern,
  saveRegexPatterns,
} from '/public/js/modules/regex-patterns.js';

import {
  loadIntentManagerData,
  toggleTier,
  loadTierStates,
  updateTier4StatusLabel,
  setupTierToggles,
  saveTierState,
  renderIntentList,
  getExampleCount,
  getExamplesList,
  renderExampleIntentList,
  selectIntent,
  selectExampleIntent,
  renderKeywords,
  renderExamples,
  addKeyword,
  removeKeyword,
  addExample,
  removeExample,
  saveKeywords,
  saveExamples,
  loadTierThresholds,
  handleTierThresholdChange,
  resetTierThreshold,
  testIntentManager,
  exportIntentData,
  updateTierUI,
  resetToDefaults,
  toggleHelp,
  renderQuickAddIntentSelect,
  quickAddKeyword,
  quickAddExample
} from '/public/js/modules/intent-manager.js';

// T4 (AI Fallback) settings live in llm-settings.js. Historically only
// settings-chunk registered them, so the Understanding t4 section stayed empty
// unless the Settings tab was visited first — register them here too.
import {
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

window.loadLLMSettings = loadLLMSettings;
window.renderT4ProvidersList = renderT4ProvidersList;
window.toggleT4InactiveProviders = toggleT4InactiveProviders;
window.toggleT4Provider = toggleT4Provider;
window.moveT4Provider = moveT4Provider;
window.autoSaveT4Providers = autoSaveT4Providers;
window.testT4Provider = testT4Provider;
window.saveLLMSettings = saveLLMSettings;

window.loadRegexPatterns = loadRegexPatterns;
window.renderRegexPatterns = renderRegexPatterns;
window.addRegexPattern = addRegexPattern;
window.removeRegexPattern = removeRegexPattern;
window.saveRegexPatterns = saveRegexPatterns;

window.loadUnderstanding = loadUnderstanding;
window.loadIntentManagerData = loadIntentManagerData;
window.toggleTier = toggleTier;
window.loadTierStates = loadTierStates;
window.updateTier4StatusLabel = updateTier4StatusLabel;
window.setupTierToggles = setupTierToggles;
window.saveTierState = saveTierState;
window.renderIntentList = renderIntentList;
window.getExampleCount = getExampleCount;
window.getExamplesList = getExamplesList;
window.renderExampleIntentList = renderExampleIntentList;
window.selectIntent = selectIntent;
window.selectExampleIntent = selectExampleIntent;
window.renderKeywords = renderKeywords;
window.renderExamples = renderExamples;
window.addKeyword = addKeyword;
window.removeKeyword = removeKeyword;
window.addExample = addExample;
window.removeExample = removeExample;
window.saveKeywords = saveKeywords;
window.saveExamples = saveExamples;
window.loadTierThresholds = loadTierThresholds;
window.handleTierThresholdChange = handleTierThresholdChange;
window.resetTierThreshold = resetTierThreshold;
window.testIntentManager = testIntentManager;
window.exportIntentData = exportIntentData;
window.updateTierUI = updateTierUI;
window.resetToDefaults = resetToDefaults;
window.toggleHelp = toggleHelp;
window.renderQuickAddIntentSelect = renderQuickAddIntentSelect;
window.quickAddKeyword = quickAddKeyword;
window.quickAddExample = quickAddExample;

console.log('[LazyChunk] Understanding modules registered');
