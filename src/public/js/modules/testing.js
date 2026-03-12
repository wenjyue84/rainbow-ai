/**
 * @fileoverview Testing module with history persistence and HTML export
 * @module testing
 */

import { escapeHtml, api, toast } from '../core/utils.js';
import { createHistoryStore, downloadHtmlBlob, renderHistoryCards } from '../core/report-utils.js';

/**
 * Global flag to prevent concurrent test runs
 * @type {boolean}
 */
let _testRunning = false;

/** @type {object|null} Last test result for export */
let _lastVitestResult = null;

/** History store backed by localStorage */
const _historyStore = createHistoryStore('rainbow-vitest-history', 20);

// ─── Init: called by tab system when #testing becomes active ────
function initVitestHistory() {
  const history = _historyStore.load();
  const btn = document.getElementById('btn-vitest-history');
  if (btn) {
    if (history.length > 0) {
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  }
}

/** Accumulated results across all suites for combined summary */
let _allSuiteResults = { unit: null, integration: null, semantic: null };

/**
 * Tab loader — called by tabs.js when navigating to #testing.
 * Auto-runs all three test suites in parallel on page load.
 */
export function loadTesting() {
  initVitestHistory();
  runAllSuites();
}

/**
 * Re-run all three test suites (called by button click)
 */
export function rerunAllTests() {
  // Reset indicators
  ['unit', 'integration', 'semantic'].forEach(s => {
    var ind = document.getElementById('suite-' + s + '-indicator');
    if (ind) { ind.className = 'w-3 h-3 rounded-full bg-neutral-300 animate-pulse flex-shrink-0'; }
    var cnt = document.getElementById('suite-' + s + '-count');
    if (cnt) cnt.textContent = 'running...';
    var dur = document.getElementById('suite-' + s + '-duration');
    if (dur) dur.textContent = '';
    var body = document.getElementById('suite-' + s + '-body');
    if (body) body.innerHTML = '';
  });
  // Reset summary
  document.getElementById('test-total').innerHTML = '<div class="inline-block w-5 h-5 border-2 border-neutral-300 border-t-transparent rounded-full animate-spin"></div>';
  document.getElementById('test-passed').textContent = '-';
  document.getElementById('test-failed').textContent = '-';
  document.getElementById('test-duration').textContent = '-';
  document.getElementById('test-status-banner').classList.add('hidden');
  _allSuiteResults = { unit: null, integration: null, semantic: null };
  runAllSuites();
}
window.rerunAllTests = rerunAllTests;

/**
 * Run all three suites in parallel and update the dashboard as each completes.
 */
async function runAllSuites() {
  const suites = ['unit', 'integration', 'semantic'];
  const startTime = performance.now();

  // Run all in parallel
  const promises = suites.map(suite => runSingleSuite(suite));
  await Promise.allSettled(promises);

  // Update combined summary
  const totalDuration = Math.round(performance.now() - startTime);
  updateCombinedSummary(totalDuration);
}

/**
 * Run a single test suite and update its section in the dashboard.
 */
async function runSingleSuite(suite) {
  var indicator = document.getElementById('suite-' + suite + '-indicator');
  var countEl = document.getElementById('suite-' + suite + '-count');
  var durEl = document.getElementById('suite-' + suite + '-duration');
  var bodyEl = document.getElementById('suite-' + suite + '-body');

  try {
    var data = await api('/tests/run', { method: 'POST', body: { project: suite } });
    _allSuiteResults[suite] = data;

    var passed = data.numPassedTests || 0;
    var failed = data.numFailedTests || 0;
    var total = data.numTotalTests || 0;
    var dur = data.duration ? (data.duration / 1000).toFixed(1) + 's' : '';

    // Update indicator
    if (indicator) {
      indicator.classList.remove('animate-pulse', 'bg-neutral-300');
      indicator.classList.add(failed > 0 ? 'bg-red-500' : 'bg-green-500');
    }

    // Update count
    if (countEl) {
      countEl.innerHTML = '<span class="text-green-600">' + passed + ' passed</span>' +
        (failed > 0 ? ' <span class="text-red-500">' + failed + ' failed</span>' : '') +
        ' <span class="text-neutral-400">/ ' + total + '</span>';
    }

    // Update duration
    if (durEl) durEl.textContent = dur;

    // Render test file cards inline
    if (bodyEl && data.testFiles && data.testFiles.length > 0) {
      renderSuiteTests(bodyEl, data.testFiles);
    } else if (bodyEl && data.raw) {
      bodyEl.innerHTML = '<div class="px-4 py-3"><pre class="text-xs text-neutral-600 whitespace-pre-wrap overflow-auto max-h-40">' + escapeHtml(data.raw) + '</pre></div>';
    }
  } catch (e) {
    _allSuiteResults[suite] = { error: e.message };
    if (indicator) {
      indicator.classList.remove('animate-pulse', 'bg-neutral-300');
      indicator.classList.add('bg-red-500');
    }
    if (countEl) countEl.innerHTML = '<span class="text-red-500">Error: ' + escapeHtml(e.message || 'unknown') + '</span>';
  }
}

/**
 * Render individual tests within a suite body element.
 */
function renderSuiteTests(container, testFiles) {
  var html = '';
  for (var f = 0; f < testFiles.length; f++) {
    var file = testFiles[f];
    var filePassed = file.tests.filter(function(t) { return t.status === 'passed'; }).length;
    var fileFailed = file.tests.filter(function(t) { return t.status === 'failed'; }).length;
    var allPassed = fileFailed === 0;
    var fileDur = file.duration ? (file.duration / 1000).toFixed(2) + 's' : '';

    // File header (collapsible)
    html += '<div>';
    html += '<div class="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-neutral-50 transition" onclick="this.nextElementSibling.classList.toggle(\'hidden\')">';
    html += '<div class="flex items-center gap-2">';
    html += allPassed
      ? '<span class="w-2 h-2 rounded-full bg-green-500 flex-shrink-0"></span>'
      : '<span class="w-2 h-2 rounded-full bg-red-500 flex-shrink-0"></span>';
    html += '<span class="text-sm text-neutral-700">' + escapeHtml(file.file) + '</span>';
    html += '</div>';
    html += '<div class="flex items-center gap-2 text-xs">';
    if (fileDur) html += '<span class="text-neutral-400">' + fileDur + '</span>';
    html += '<span class="text-green-600">' + filePassed + '</span>';
    if (fileFailed > 0) html += '<span class="text-red-500">' + fileFailed + '</span>';
    html += '</div></div>';

    // Individual tests (collapsed by default if all passed, expanded if failures)
    html += '<div class="' + (allPassed ? 'hidden' : '') + ' border-t bg-neutral-50/50">';
    for (var t = 0; t < file.tests.length; t++) {
      var test = file.tests[t];
      var isPassed = test.status === 'passed';
      html += '<div class="px-6 py-1.5 flex items-start gap-2 text-xs ' + (isPassed ? '' : 'bg-red-50') + '">';
      html += isPassed
        ? '<span class="text-green-500 mt-0.5">&#10003;</span>'
        : '<span class="text-red-500 mt-0.5">&#10007;</span>';
      html += '<div class="min-w-0 flex-1">';
      html += '<span class="' + (isPassed ? 'text-neutral-600' : 'text-red-700') + '">' + escapeHtml(test.name) + '</span>';
      if (test.duration != null) html += ' <span class="text-neutral-400">' + test.duration + 'ms</span>';
      if (test.failureMessages && test.failureMessages.length > 0) {
        html += '<pre class="mt-1 text-xs text-red-600 whitespace-pre-wrap overflow-auto max-h-32 bg-red-100 rounded p-2">' + escapeHtml(test.failureMessages.join('\n')) + '</pre>';
      }
      html += '</div></div>';
    }
    html += '</div></div>';
  }
  container.innerHTML = html;
}

/**
 * Toggle collapse/expand of a suite's test details.
 */
export function toggleSuiteCollapse(suite) {
  var body = document.getElementById('suite-' + suite + '-body');
  if (body) body.classList.toggle('hidden');
}
window.toggleSuiteCollapse = toggleSuiteCollapse;

/**
 * Update the combined summary cards and status banner.
 */
function updateCombinedSummary(totalDurationMs) {
  var totalTests = 0, totalPassed = 0, totalFailed = 0;
  var allSuccess = true;
  var suiteNames = ['unit', 'integration', 'semantic'];

  for (var i = 0; i < suiteNames.length; i++) {
    var r = _allSuiteResults[suiteNames[i]];
    if (!r || r.error) { allSuccess = false; continue; }
    totalTests += r.numTotalTests || 0;
    totalPassed += r.numPassedTests || 0;
    totalFailed += r.numFailedTests || 0;
    if (!r.success) allSuccess = false;
  }

  var durStr = (totalDurationMs / 1000).toFixed(1) + 's';
  document.getElementById('test-total').textContent = totalTests;
  document.getElementById('test-passed').textContent = totalPassed;
  document.getElementById('test-failed').textContent = totalFailed;
  document.getElementById('test-duration').textContent = durStr;

  // Status banner
  var banner = document.getElementById('test-status-banner');
  banner.classList.remove('hidden');
  var actionsEl = document.getElementById('test-status-actions');

  if (allSuccess && totalFailed === 0) {
    banner.className = 'mb-4 rounded-2xl border border-green-200 bg-green-50 p-4 flex items-center gap-3';
    document.getElementById('test-status-icon').innerHTML = '<svg class="w-7 h-7 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
    document.getElementById('test-status-text').textContent = 'All tests passed';
    document.getElementById('test-status-sub').textContent = totalPassed + ' tests across 3 suites in ' + durStr;
    if (actionsEl) actionsEl.innerHTML = '';
  } else {
    banner.className = 'mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 flex items-center gap-3';
    document.getElementById('test-status-icon').innerHTML = '<svg class="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
    document.getElementById('test-status-text').textContent = totalFailed + ' test' + (totalFailed !== 1 ? 's' : '') + ' failed';
    document.getElementById('test-status-sub').textContent = totalPassed + ' passed, ' + totalFailed + ' failed in ' + durStr;
    if (actionsEl) {
      actionsEl.innerHTML = '<button onclick="generateStoriesFromFailures()" class="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition font-medium">Generate User Stories</button>';
    }
  }

  // Save combined result to history
  var combined = {
    numTotalTests: totalTests,
    numPassedTests: totalPassed,
    numFailedTests: totalFailed,
    duration: totalDurationMs,
    success: allSuccess && totalFailed === 0,
    testFiles: [],
    project: 'all'
  };
  suiteNames.forEach(function(s) {
    var r = _allSuiteResults[s];
    if (r && r.testFiles) combined.testFiles = combined.testFiles.concat(r.testFiles);
  });
  _lastVitestResult = combined;
  saveVitestRun(combined, 'all');
  var exportDropdown = document.getElementById('vitest-export-dropdown');
  if (exportDropdown) exportDropdown.classList.remove('hidden');
}

/**
 * Generate user stories from failed tests using the /testing/run-all endpoint.
 * Then call /testing/generate-stories to get the user stories.
 */
export async function generateStoriesFromFailures() {
  // Collect all failures across suites
  var failures = [];
  ['unit', 'integration', 'semantic'].forEach(function(suite) {
    var r = _allSuiteResults[suite];
    if (!r || !r.testFiles) return;
    r.testFiles.forEach(function(file) {
      file.tests.forEach(function(t) {
        if (t.status === 'failed') {
          failures.push({
            id: suite + '-' + file.file + '-' + t.name,
            name: t.name,
            category: suite,
            suite: suite,
            messages: [{ text: t.name }],
            validate: [],
            file: file.file,
            failureMessages: t.failureMessages || []
          });
        }
      });
    });
  });

  if (failures.length === 0) {
    toast('No failures to generate stories from', 'info');
    return;
  }

  try {
    // Run through programmatic test runner to save results
    await api('/testing/run-all', {
      method: 'POST',
      body: {
        scenarios: failures.map(function(f) {
          return {
            id: f.id,
            name: f.name,
            category: f.category,
            suite: f.suite,
            messages: [{ text: f.name }],
            validate: [{ rules: [{ type: 'not_empty', critical: true }] }]
          };
        }),
        suite: 'vitest-failures'
      }
    });

    // Generate stories from failures
    var stories = await api('/testing/generate-stories?suite=vitest-failures');
    if (stories.stories && stories.stories.length > 0) {
      toast(stories.stories.length + ' user stories generated from ' + failures.length + ' failures', 'success');
      console.log('[Testing] Generated stories:', stories.stories);
    } else {
      toast('No actionable stories generated', 'info');
    }
  } catch (e) {
    toast('Failed to generate stories: ' + (e.message || 'unknown error'), 'error');
  }
}
window.generateStoriesFromFailures = generateStoriesFromFailures;

/**
 * Runs the test suite for the selected project
 *
 * Executes tests via the `/tests/run` API endpoint, displays running state,
 * and renders results or error messages upon completion.
 *
 * @async
 * @returns {Promise<void>}
 */
export async function runTests() {
  if (_testRunning) return;
  _testRunning = true;
  const project = document.getElementById('test-project-select').value;
  const btnRun = document.getElementById('btn-run-tests');
  const btnCov = document.getElementById('btn-run-coverage');
  btnRun.disabled = true;
  btnCov.disabled = true;
  btnRun.textContent = 'Running...';

  // Show running state, hide others
  document.getElementById('test-empty').classList.add('hidden');
  document.getElementById('test-summary').classList.add('hidden');
  document.getElementById('test-status-banner').classList.add('hidden');
  document.getElementById('test-results').innerHTML = '';
  document.getElementById('coverage-results').classList.add('hidden');
  document.getElementById('test-running').classList.remove('hidden');

  try {
    const data = await api('/tests/run', { method: 'POST', body: { project } });
    document.getElementById('test-running').classList.add('hidden');
    renderTestResults(data, project);
  } catch (e) {
    document.getElementById('test-running').classList.add('hidden');
    document.getElementById('test-status-banner').classList.remove('hidden');
    document.getElementById('test-status-banner').className = 'mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 flex items-center gap-3';
    document.getElementById('test-status-icon').textContent = '!';
    document.getElementById('test-status-text').textContent = 'Test run failed';
    document.getElementById('test-status-sub').textContent = e.message;
    toast(e.message, 'error');
  } finally {
    _testRunning = false;
    btnRun.disabled = false;
    btnCov.disabled = false;
    btnRun.textContent = 'Run Tests';
  }
}

/**
 * Runs coverage analysis for all tests
 *
 * @async
 * @returns {Promise<void>}
 */
export async function runCoverage() {
  if (_testRunning) return;
  _testRunning = true;
  const btnRun = document.getElementById('btn-run-tests');
  const btnCov = document.getElementById('btn-run-coverage');
  btnRun.disabled = true;
  btnCov.disabled = true;
  btnCov.textContent = 'Running...';

  document.getElementById('test-empty').classList.add('hidden');
  document.getElementById('test-summary').classList.add('hidden');
  document.getElementById('test-status-banner').classList.add('hidden');
  document.getElementById('test-results').innerHTML = '';
  document.getElementById('coverage-results').classList.add('hidden');
  document.getElementById('test-running').classList.remove('hidden');

  try {
    const data = await api('/tests/coverage', { method: 'POST' });
    document.getElementById('test-running').classList.add('hidden');
    renderCoverageResults(data);
  } catch (e) {
    document.getElementById('test-running').classList.add('hidden');
    toast(e.message, 'error');
  } finally {
    _testRunning = false;
    btnRun.disabled = false;
    btnCov.disabled = false;
    btnCov.textContent = 'Coverage';
  }
}

/**
 * Renders test execution results in the UI and saves to history.
 *
 * @param {Object} data - Test results from the API
 * @param {string} [project] - Project type that was tested
 */
function renderTestResults(data, project) {
  // Summary cards
  const summary = document.getElementById('test-summary');
  summary.classList.remove('hidden');
  document.getElementById('test-total').textContent = data.numTotalTests ?? 0;
  document.getElementById('test-passed').textContent = data.numPassedTests ?? 0;
  document.getElementById('test-failed').textContent = data.numFailedTests ?? 0;
  const dur = data.duration ? (data.duration / 1000).toFixed(1) + 's' : '\u2014';
  document.getElementById('test-duration').textContent = dur;

  // Status banner
  const banner = document.getElementById('test-status-banner');
  banner.classList.remove('hidden');
  const passed = data.numPassedTests ?? 0;
  const failed = data.numFailedTests ?? 0;
  const suites = data.numPassedTestSuites ?? 0;
  if (data.success) {
    banner.className = 'mb-4 rounded-2xl border border-green-200 bg-green-50 p-4 flex items-center gap-3';
    document.getElementById('test-status-icon').innerHTML = '<svg class="w-7 h-7 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
    document.getElementById('test-status-text').textContent = 'All tests passed';
    document.getElementById('test-status-sub').textContent = passed + ' tests across ' + suites + ' files in ' + dur;
  } else {
    banner.className = 'mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 flex items-center gap-3';
    document.getElementById('test-status-icon').innerHTML = '<svg class="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
    document.getElementById('test-status-text').textContent = failed + ' test' + (failed !== 1 ? 's' : '') + ' failed';
    document.getElementById('test-status-sub').textContent = passed + ' passed, ' + failed + ' failed in ' + dur;
  }

  // Test file cards
  const container = document.getElementById('test-results');
  container.innerHTML = '';

  if (!data.testFiles || data.testFiles.length === 0) {
    if (data.raw) {
      container.innerHTML = '<div class="bg-white rounded-2xl border p-4"><pre class="text-xs text-neutral-600 whitespace-pre-wrap overflow-auto max-h-96">' + escapeHtml(data.raw) + '</pre></div>';
    }
  } else {
    renderTestFileCards(container, data.testFiles);
  }

  // Save to history + update state
  _lastVitestResult = data;
  _lastVitestResult._project = project || 'unit';
  saveVitestRun(data, project);

  // Show export dropdown
  const exportDropdown = document.getElementById('vitest-export-dropdown');
  if (exportDropdown) exportDropdown.classList.remove('hidden');
}

/**
 * Render expandable test file cards into a container element.
 * Extracted to reuse for both live results and historical re-rendering.
 *
 * @param {HTMLElement} container
 * @param {Array} testFiles
 */
function renderTestFileCards(container, testFiles) {
  for (const file of testFiles) {
    const filePassed = file.tests.filter(t => t.status === 'passed').length;
    const fileFailed = file.tests.filter(t => t.status === 'failed').length;
    const allPassed = fileFailed === 0;
    const fileDur = file.duration ? (file.duration / 1000).toFixed(2) + 's' : '';

    let html = '<div class="bg-white rounded-2xl border overflow-hidden">';
    html += '<div class="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-neutral-50 transition" onclick="this.nextElementSibling.classList.toggle(\'hidden\')">';
    html += '<div class="flex items-center gap-3">';
    html += allPassed
      ? '<span class="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0"></span>'
      : '<span class="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0"></span>';
    html += '<span class="font-medium text-sm text-neutral-800">' + escapeHtml(file.file) + '</span>';
    html += '</div>';
    html += '<div class="flex items-center gap-3 text-xs">';
    if (fileDur) html += '<span class="text-neutral-400">' + fileDur + '</span>';
    html += '<span class="text-green-600 font-medium">' + filePassed + ' passed</span>';
    if (fileFailed > 0) html += '<span class="text-red-500 font-medium">' + fileFailed + ' failed</span>';
    html += '<svg class="w-4 h-4 text-neutral-400 transform transition" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>';
    html += '</div></div>';

    // Expandable test list
    html += '<div class="hidden border-t divide-y">';
    for (const t of file.tests) {
      const isPassed = t.status === 'passed';
      const icon = isPassed
        ? '<svg class="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>'
        : '<svg class="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
      html += '<div class="px-4 py-2 flex items-start gap-2 text-sm ' + (isPassed ? '' : 'bg-red-50') + '">';
      html += icon;
      html += '<div class="min-w-0">';
      html += '<div class="' + (isPassed ? 'text-neutral-700' : 'text-red-700') + '">' + escapeHtml(t.name) + '</div>';
      if (t.duration != null) html += '<div class="text-xs text-neutral-400">' + t.duration + 'ms</div>';
      if (t.failureMessages && t.failureMessages.length > 0) {
        html += '<pre class="mt-1 text-xs text-red-600 whitespace-pre-wrap overflow-auto max-h-40 bg-red-100 rounded p-2">' + escapeHtml(t.failureMessages.join('\n')) + '</pre>';
      }
      html += '</div></div>';
    }
    html += '</div></div>';
    container.innerHTML += html;
  }
}

/**
 * Save a vitest run to localStorage history
 *
 * @param {Object} data - Test results
 * @param {string} [project] - Project type (unit/semantic/integration)
 */
function saveVitestRun(data, project) {
  const record = {
    id: Date.now(),
    project: project || 'unit',
    timestamp: new Date().toISOString(),
    numTotalTests: data.numTotalTests ?? 0,
    numPassedTests: data.numPassedTests ?? 0,
    numFailedTests: data.numFailedTests ?? 0,
    duration: data.duration ?? 0,
    testFiles: data.testFiles || [],
    success: !!data.success
  };

  _historyStore.save(record);

  // Show history button
  const btn = document.getElementById('btn-vitest-history');
  if (btn) btn.classList.remove('hidden');
}

// ─── History Modal ──────────────────────────────────────────────

/**
 * Show the vitest history modal with past runs
 */
export function showVitestHistory() {
  const modal = document.getElementById('vitest-history-modal');
  const listEl = document.getElementById('vitest-history-list');
  if (!modal || !listEl) return;

  const history = _historyStore.load();

  listEl.innerHTML = renderHistoryCards(history, {
    onClickFn: 'loadHistoricalVitestRun',
    onExportFn: 'exportHistoricalVitestRun',
    statsLine: (report) => {
      const p = report.numPassedTests ?? 0;
      const f = report.numFailedTests ?? 0;
      const dur = report.duration ? (report.duration / 1000).toFixed(1) + 's' : '';
      return '<span class="text-green-600">' + p + ' passed</span>' +
        '<span class="text-red-600">' + f + ' failed</span>' +
        (dur ? '<span class="text-neutral-500">' + dur + '</span>' : '');
    }
  });

  modal.classList.remove('hidden');
}

/**
 * Close vitest history modal
 */
export function closeVitestHistory() {
  const modal = document.getElementById('vitest-history-modal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Load a historical vitest run and re-render it in the results area
 *
 * @param {number} id - Record timestamp ID
 */
export function loadHistoricalVitestRun(id) {
  const history = _historyStore.load();
  const report = history.find(r => r.id === id);
  if (!report) return;

  // Re-render summary
  const summary = document.getElementById('test-summary');
  summary.classList.remove('hidden');
  document.getElementById('test-total').textContent = report.numTotalTests;
  document.getElementById('test-passed').textContent = report.numPassedTests;
  document.getElementById('test-failed').textContent = report.numFailedTests;
  const dur = report.duration ? (report.duration / 1000).toFixed(1) + 's' : '\u2014';
  document.getElementById('test-duration').textContent = dur;

  // Status banner
  const banner = document.getElementById('test-status-banner');
  banner.classList.remove('hidden');
  if (report.success) {
    banner.className = 'mb-4 rounded-2xl border border-green-200 bg-green-50 p-4 flex items-center gap-3';
    document.getElementById('test-status-icon').innerHTML = '<svg class="w-7 h-7 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
    document.getElementById('test-status-text').textContent = 'All tests passed';
    document.getElementById('test-status-sub').textContent = report.numPassedTests + ' tests in ' + dur;
  } else {
    banner.className = 'mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 flex items-center gap-3';
    document.getElementById('test-status-icon').innerHTML = '<svg class="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
    document.getElementById('test-status-text').textContent = report.numFailedTests + ' test' + (report.numFailedTests !== 1 ? 's' : '') + ' failed';
    document.getElementById('test-status-sub').textContent = report.numPassedTests + ' passed, ' + report.numFailedTests + ' failed in ' + dur;
  }

  // Re-render test file cards
  const container = document.getElementById('test-results');
  container.innerHTML = '';
  document.getElementById('test-empty').classList.add('hidden');
  document.getElementById('coverage-results').classList.add('hidden');
  if (report.testFiles && report.testFiles.length > 0) {
    renderTestFileCards(container, report.testFiles);
  }

  // Set as current result for export
  _lastVitestResult = report;
  const exportDropdown = document.getElementById('vitest-export-dropdown');
  if (exportDropdown) exportDropdown.classList.remove('hidden');

  // Close modal
  closeVitestHistory();

  const date = new Date(report.timestamp);
  toast('Loaded ' + report.project + ' run from ' + date.toLocaleDateString() + ' at ' + date.toLocaleTimeString(), 'info');
}

/**
 * Export a historical report by ID
 *
 * @param {number} id - Record timestamp ID
 */
export function exportHistoricalVitestRun(id) {
  const history = _historyStore.load();
  const report = history.find(r => r.id === id);
  if (!report) return;
  generateVitestHtmlReport(report, 'all');
}

/**
 * Clear all vitest history
 */
export function clearVitestHistory() {
  if (!confirm('Clear all test history? This cannot be undone.')) return;
  _historyStore.clear();
  const btn = document.getElementById('btn-vitest-history');
  if (btn) btn.classList.add('hidden');
  closeVitestHistory();
}

// ─── Export ─────────────────────────────────────────────────────

/**
 * Toggle the vitest export dropdown menu
 */
export function toggleVitestExportDropdown() {
  const menu = document.getElementById('vitest-export-menu');
  if (menu) menu.classList.toggle('hidden');
}

// Close vitest export dropdown when clicking outside
document.addEventListener('click', function (event) {
  const dropdown = document.getElementById('vitest-export-dropdown');
  const menu = document.getElementById('vitest-export-menu');
  if (dropdown && menu && !dropdown.contains(event.target)) {
    menu.classList.add('hidden');
  }
});

/**
 * Export the current (or last) vitest result as an HTML report
 *
 * @param {string} [filterType='all'] - 'all' or 'failed'
 */
export function exportVitestReport(filterType = 'all') {
  if (!_lastVitestResult) {
    toast('No test results to export', 'error');
    return;
  }
  generateVitestHtmlReport(_lastVitestResult, filterType);
}

/**
 * Generate and download an HTML report for vitest results.
 *
 * @param {Object} data - Vitest result record
 * @param {string} filterType - 'all' or 'failed'
 */
function generateVitestHtmlReport(data, filterType) {
  const testFiles = data.testFiles || [];
  const totalTests = data.numTotalTests ?? 0;
  const passedTests = data.numPassedTests ?? 0;
  const failedTests = data.numFailedTests ?? 0;
  const duration = data.duration ? (data.duration / 1000).toFixed(1) + 's' : '\u2014';
  const passRate = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : '0.0';
  const timestamp = data.timestamp || new Date().toISOString();
  const project = data.project || data._project || 'unit';

  // Filter test files based on filterType
  let filteredFiles = testFiles;
  let filterLabel = '';
  if (filterType === 'failed') {
    filteredFiles = testFiles
      .map(f => ({
        ...f,
        tests: f.tests.filter(t => t.status === 'failed')
      }))
      .filter(f => f.tests.length > 0);
    filterLabel = ' (Failed Only)';
  }

  // Close dropdown
  const menu = document.getElementById('vitest-export-menu');
  if (menu) menu.classList.add('hidden');

  if (filteredFiles.length === 0) {
    toast('No ' + (filterType === 'failed' ? 'failed' : '') + ' results to export', 'info');
    return;
  }

  // Build test file sections
  let filesHtml = '';
  for (const file of filteredFiles) {
    const fp = file.tests.filter(t => t.status === 'passed').length;
    const ff = file.tests.filter(t => t.status === 'failed').length;
    const allPassed = ff === 0;
    const fileDur = file.duration ? (file.duration / 1000).toFixed(2) + 's' : '';

    let testsHtml = '';
    for (const t of file.tests) {
      const isPassed = t.status === 'passed';
      const icon = isPassed ? '&#10003;' : '&#10007;';
      const color = isPassed ? '#16a34a' : '#dc2626';
      testsHtml += '<div style="padding:4px 0;font-size:13px;color:' + color + '">';
      testsHtml += icon + ' ' + escapeHtml(t.name);
      if (t.duration != null) testsHtml += ' <span style="color:#999">(' + t.duration + 'ms)</span>';
      testsHtml += '</div>';
      if (t.failureMessages && t.failureMessages.length > 0) {
        testsHtml += '<pre style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:8px;font-size:11px;color:#dc2626;white-space:pre-wrap;overflow:auto;max-height:200px;margin:4px 0 8px 0">' + escapeHtml(t.failureMessages.join('\n')) + '</pre>';
      }
    }

    filesHtml += '<div style="border:1px solid #e5e5e5;border-radius:12px;margin-bottom:16px;overflow:hidden">' +
      '<div style="padding:12px 16px;background:' + (allPassed ? '#f0fdf4' : '#fef2f2') + ';display:flex;align-items:center;gap:12px">' +
        '<span style="width:10px;height:10px;border-radius:50%;background:' + (allPassed ? '#22c55e' : '#ef4444') + ';display:inline-block"></span>' +
        '<b style="font-size:14px">' + escapeHtml(file.file) + '</b>' +
        '<span style="font-size:12px;color:#888;margin-left:auto">' + fp + ' passed' + (ff > 0 ? ', ' + ff + ' failed' : '') + (fileDur ? ' | ' + fileDur : '') + '</span>' +
      '</div>' +
      '<div style="padding:12px 16px">' + testsHtml + '</div>' +
    '</div>';
  }

  const html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<title>Rainbow Vitest Report' + filterLabel + '</title>\n' +
    '<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:900px;margin:0 auto;padding:24px;background:#fafafa;color:#333}' +
    '.summary{display:flex;gap:16px;margin:20px 0}.summary-card{flex:1;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:16px;text-align:center}' +
    '.num{font-size:28px;font-weight:700}.label{font-size:12px;color:#888;margin-top:4px}</style>\n' +
    '</head>\n<body>\n' +
    '<h1>Rainbow Vitest Report' + filterLabel + '</h1>\n' +
    '<p style="color:#888;font-size:14px">' + escapeHtml(new Date(timestamp).toLocaleString()) +
    ' | Project: <b>' + escapeHtml(project) + '</b> | Pass rate: <b>' + passRate + '%</b>' +
    ' | Duration: <b>' + duration + '</b></p>\n' +
    '<div class="summary">' +
      '<div class="summary-card"><div class="num" style="color:#333">' + totalTests + '</div><div class="label">Total</div></div>' +
      '<div class="summary-card"><div class="num" style="color:#16a34a">' + passedTests + '</div><div class="label">Passed</div></div>' +
      '<div class="summary-card"><div class="num" style="color:#dc2626">' + failedTests + '</div><div class="label">Failed</div></div>' +
      '<div class="summary-card"><div class="num" style="color:#6366f1">' + duration + '</div><div class="label">Duration</div></div>' +
    '</div>\n' +
    filesHtml + '\n' +
    '<p style="text-align:center;color:#aaa;font-size:12px;margin-top:32px">Generated by Rainbow AI Dashboard</p>\n' +
    '</body>\n</html>';

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const suffix = filterType === 'failed' ? '-failed-only' : '';
  const filename = 'rainbow-vitest-' + project + suffix + '-' + now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + '.html';

  downloadHtmlBlob(html, filename);
}

// ─── Coverage Rendering ─────────────────────────────────────────

/**
 * Renders code coverage results in the UI
 *
 * @param {Object} data - Coverage results from the API
 */
function renderCoverageResults(data) {
  const covDiv = document.getElementById('coverage-results');
  covDiv.classList.remove('hidden');
  const tbody = document.getElementById('coverage-tbody');
  tbody.innerHTML = '';

  if (!data.coverage || data.coverage.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-3 text-center text-neutral-400 text-sm">No coverage data available</td></tr>';
    return;
  }

  for (const row of data.coverage) {
    const isAll = row.file === 'All files';
    const cls = isAll ? 'font-semibold bg-neutral-50' : '';
    tbody.innerHTML += '<tr class="' + cls + ' border-t">' +
      '<td class="px-4 py-2 ' + (isAll ? 'text-neutral-800' : 'text-neutral-600') + '">' + escapeHtml(row.file) + '</td>' +
      '<td class="px-4 py-2 text-right ' + covColor(row.stmts) + '">' + row.stmts + '</td>' +
      '<td class="px-4 py-2 text-right ' + covColor(row.branch) + '">' + row.branch + '</td>' +
      '<td class="px-4 py-2 text-right ' + covColor(row.funcs) + '">' + row.funcs + '</td>' +
      '<td class="px-4 py-2 text-right ' + covColor(row.lines) + '">' + row.lines + '</td>' +
    '</tr>';
  }

  // Show status banner for coverage
  const banner = document.getElementById('test-status-banner');
  banner.classList.remove('hidden');
  if (data.success) {
    banner.className = 'mb-4 rounded-2xl border border-green-200 bg-green-50 p-4 flex items-center gap-3';
    document.getElementById('test-status-icon').innerHTML = '<svg class="w-7 h-7 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
    document.getElementById('test-status-text').textContent = 'Coverage thresholds met';
    document.getElementById('test-status-sub').textContent = 'All coverage thresholds are above minimum requirements';
  } else {
    banner.className = 'mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-center gap-3';
    document.getElementById('test-status-icon').innerHTML = '<svg class="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>';
    document.getElementById('test-status-text').textContent = 'Coverage thresholds not met';
    document.getElementById('test-status-sub').textContent = 'Some files are below minimum coverage requirements';
  }
}

/**
 * Returns CSS class for coverage percentage color coding
 *
 * @param {string} val - Coverage percentage as string
 * @returns {string} Tailwind CSS class for text color
 */
function covColor(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return 'text-neutral-500';
  if (n >= 80) return 'text-green-600 font-medium';
  if (n >= 50) return 'text-amber-600';
  return 'text-red-500';
}
