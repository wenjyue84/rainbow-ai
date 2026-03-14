#!/bin/bash
# spiral.config.sh — Rainbow AI SPIRAL configuration
# Focus: FnB AI Waiter Enhancement (makan-moments profile + /api/fnb/chat + MCP client tools)

# ── Python interpreter ───────────────────────────────────────────────
SPIRAL_PYTHON="python"

# ── Validation command (Phase V) ─────────────────────────────────────
SPIRAL_VALIDATE_CMD="npm run build 2>&1 | tail -20 && npm run test:run 2>&1 | tail -40"

# ── Test reports directory ───────────────────────────────────────────
SPIRAL_REPORTS_DIR="test-reports"

# ── Story ID prefix ─────────────────────────────────────────────────
SPIRAL_STORY_PREFIX="US"

# ── Test synthesis: convert failing tests to fix-stories ─────────────
SPIRAL_SKIP_TEST_SYNTHESIS=0

# ── Max pending stories (focused run) ────────────────────────────────
SPIRAL_MAX_PENDING=10

# ── Model routing ────────────────────────────────────────────────────
SPIRAL_MODEL_ROUTING="auto"

# ── Research model ───────────────────────────────────────────────────
SPIRAL_RESEARCH_MODEL="sonnet"

# ── Dashboard ────────────────────────────────────────────────────────
SPIRAL_OPEN_DASHBOARD=1

# ── Focus theme ──────────────────────────────────────────────────────
SPIRAL_FOCUS="FnB AI Waiter widget UX improvement: wire tool-calling loop into chat engine, add FnB intents, smooth pre-ordering flow (phone collection + order confirmation), Vitest tests for registry filtering and tool handlers"
