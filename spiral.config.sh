#!/bin/bash
# spiral.config.sh — Rainbow AI SPIRAL configuration
# Focus: FnB AI Waiter Enhancement (makan-moments profile + /api/fnb/chat + MCP client tools)

# ── Python interpreter ───────────────────────────────────────────────
SPIRAL_PYTHON="python"

# ── Validation command (Phase V) — includes browser smoke tests ───────
SPIRAL_VALIDATE_CMD="npm run build 2>&1 | tail -20 && npm run test:run 2>&1 | tail -40"

# ── Test reports directory ───────────────────────────────────────────
SPIRAL_REPORTS_DIR="test-reports"

# ── Story ID prefix ─────────────────────────────────────────────────
SPIRAL_STORY_PREFIX="US"

# ── Test synthesis: convert failing tests to fix-stories ─────────────
SPIRAL_SKIP_TEST_SYNTHESIS=0
SPIRAL_SYNTHESIZE_TESTS_FOR_NEW=1

# ── Max pending stories (focused run) ────────────────────────────────
SPIRAL_MAX_PENDING=10

# ── Model routing ────────────────────────────────────────────────────
SPIRAL_MODEL_ROUTING="auto"

# ── Research model ───────────────────────────────────────────────────
SPIRAL_RESEARCH_MODEL="sonnet"

# ── Dashboard ────────────────────────────────────────────────────────
SPIRAL_OPEN_DASHBOARD=1

# ── Focus theme ──────────────────────────────────────────────────────
SPIRAL_FOCUS="Improve the core preordering process via AI waiter: enhance the conversational ordering flow so guests can browse menu, ask about items, and place orders naturally through the AI waiter. Focus on intent detection accuracy for order-taking, multi-item cart handling, order confirmation UX, kitchen notification flow, and integration with the FnB MCP tools. Research modern conversational commerce patterns, cart state management in chat, and order disambiguation techniques."

# ── Firecrawl MCP for web research ─────────────────────────────────
SPIRAL_FIRECRAWL_ENABLED=1

# ── Parallel worker settings ─────────────────────────────────────────
SPIRAL_PATCH_DIRS="src/"
