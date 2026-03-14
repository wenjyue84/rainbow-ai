#!/bin/bash
# spiral.config.sh — Rainbow AI SPIRAL configuration
# Focus: FnB AI Waiter Enhancement (makan-moments profile + /api/fnb/chat + MCP client tools)

# ── Python interpreter ───────────────────────────────────────────────
SPIRAL_PYTHON="python"

# ── Validation command (Phase V) ─────────────────────────────────────
SPIRAL_VALIDATE_CMD="npm run check 2>&1 | tail -30 && echo 'TypeScript check passed'"

# ── Test reports directory ───────────────────────────────────────────
SPIRAL_REPORTS_DIR="test-reports"

# ── Story ID prefix ─────────────────────────────────────────────────
SPIRAL_STORY_PREFIX="US"

# ── Skip test synthesis (no timestamped test reports to scan) ────────
SPIRAL_SKIP_TEST_SYNTHESIS=1

# ── Max pending stories (focused run) ────────────────────────────────
SPIRAL_MAX_PENDING=10

# ── Model routing ────────────────────────────────────────────────────
SPIRAL_MODEL_ROUTING="auto"

# ── Research model ───────────────────────────────────────────────────
SPIRAL_RESEARCH_MODEL="sonnet"

# ── Dashboard ────────────────────────────────────────────────────────
SPIRAL_OPEN_DASHBOARD=1

# ── Focus theme ──────────────────────────────────────────────────────
SPIRAL_FOCUS="FnB AI Waiter: rainbow-ai /api/fnb/chat SSE endpoint + FnB MCP client tools for makan-moments profile"
