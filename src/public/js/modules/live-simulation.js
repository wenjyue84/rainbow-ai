// ═══════════════════════════════════════════════════════════════════
// Live Simulation — entry shim
// ═══════════════════════════════════════════════════════════════════
//
// Self-registers the four window.* functions that the Chat
// Simulator helpers and template onclick handlers call into.

import { loadLiveSimulation, cleanupLiveSimulation, setLsChannelFilter, setLsFilter } from './live-simulation-core.js';
import { openTraceDrawer, closeTraceDrawer } from './live-simulation-trace-drawer.js';
import {
  openReplayModal, closeReplayModal, runReplay, copyAsCurl, copyAsJson,
} from './live-simulation-replay.js';

window.loadLiveSimulation = loadLiveSimulation;
window.cleanupLiveSimulation = cleanupLiveSimulation;
window.lsSetChannelFilter = setLsChannelFilter;
window.lsSetFilter = setLsFilter;
window.openTraceDrawer = openTraceDrawer;
window.closeTraceDrawer = closeTraceDrawer;

window.openLiveSimReplay = openReplayModal;
window.closeLiveSimReplay = closeReplayModal;
window.runLiveSimReplay = runReplay;
window.copyLiveSimReplayCurl = copyAsCurl;
window.copyLiveSimReplayJson = copyAsJson;
