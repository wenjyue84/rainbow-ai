#!/bin/bash
# spiral.config.sh — Rainbow AI SPIRAL configuration
# Iterative improvement cycle for multi-profile WhatsApp AI assistant

# ── Python interpreter ───────────────────────────────────────────────
SPIRAL_PYTHON="python"

# ── Validation command (Phase V) ─────────────────────────────────────
SPIRAL_VALIDATE_CMD="NODE_OPTIONS='--max-old-space-size=4096' npx vitest run 2>&1"

# ── Test reports directory ───────────────────────────────────────────
SPIRAL_REPORTS_DIR="test-reports"

# ── Story ID prefix ─────────────────────────────────────────────────
SPIRAL_STORY_PREFIX="US"

# ── Max pending stories (keep focused) ───────────────────────────────
SPIRAL_MAX_PENDING=10

# ── Model routing ────────────────────────────────────────────────────
SPIRAL_MODEL_ROUTING="auto"

# ── Research model ───────────────────────────────────────────────────
SPIRAL_RESEARCH_MODEL="sonnet"

# ── Focus theme ──────────────────────────────────────────────────────
# Multi-profile system just shipped — focus on hardening and completeness
SPIRAL_FOCUS="conversation pipeline and all pending stories"
SPIRAL_GEMINI_PROMPT="Focus on: conversation pipeline and all pending stories. Research the latest best practices, patterns, and implementation approaches for WhatsApp AI conversation pipeline architecture — including message processing, intent classification, state management, response generation, and multi-profile routing. Provide actionable context for the implementation agent."
