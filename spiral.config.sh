#!/usr/bin/env bash
# spiral.config.sh — Rainbow AI Spiral configuration

# Test command
SPIRAL_VALIDATE_CMD="npm run test:run"

# Reports directory
SPIRAL_REPORTS_DIR="test-reports"

# Story prefix
SPIRAL_STORY_PREFIX="US"

# Gate mode — proceed automatically (no human checkpoints)
SPIRAL_GATE_MODE="proceed"

# Workers
SPIRAL_RALPH_WORKERS=1

# Auto-stash uncommitted changes before Phase I
SPIRAL_AUTO_STASH=true

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
