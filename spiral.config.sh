#!/usr/bin/env bash
# spiral.config.sh — Rainbow AI Spiral configuration

# Test command
SPIRAL_VALIDATE_CMD="bash spiral-validate.sh"

# Reports directory
SPIRAL_REPORTS_DIR="test-reports"

# Story prefix
SPIRAL_STORY_PREFIX="US"

# Gate mode — proceed automatically (no human checkpoints)
SPIRAL_GATE_MODE="proceed"

# Workers
SPIRAL_RALPH_WORKERS=1

# Auto-stash disabled — was causing stash_pop_failed every iteration (prd.json
# modified inside Phase I conflicts with stash restore). Commit prd.json before
# Phase I instead (SPIRAL's checkpoint commits handle this).
SPIRAL_AUTO_STASH=false

# Max iterations
MAX_SPIRAL_ITERS=20

# Ralph iterations per Phase I
SPIRAL_RALPH_ITERS=120

# Model routing
SPIRAL_MODEL_ROUTING="auto"

# Capacity limit — skip research when pending > N
SPIRAL_CAPACITY_LIMIT=50

# Patch directories — limit diffs to src/ and shared/ to reduce conflicts
SPIRAL_PATCH_DIRS="src/ shared/"

# No deploy command
# SPIRAL_DEPLOY_CMD=""

# No GitNexus
# SPIRAL_GITNEXUS_REPO=""

# Time limit (12 hours default)
TIME_LIMIT_MINS=720

# Open dashboard after each iteration
SPIRAL_OPEN_DASHBOARD=1

# Memory settings
SPIRAL_WORKER_MEMORY_LIMIT=1024
SPIRAL_LOW_POWER_MODE=1

# Permanently skip stories that repeatedly timeout (CLI/validator builders ~10+ min each)
# US-387: Turn-by-Turn Profile Context Validator Middleware (timed out 3x)
SPIRAL_SKIP_STORY_IDS="US-387"

# Raise story timeouts — defaults (small=300s, medium=600s) too short for this project
# The test suite alone takes ~2 min; implementation needs room on top of that
SPIRAL_STORY_TIMEOUT_SMALL=900
SPIRAL_STORY_TIMEOUT_MEDIUM=1800
SPIRAL_STORY_TIMEOUT_LARGE=2400
