# Ralph Autonomous Agent - Rainbow AI Standalone

You are running as part of Ralph, an autonomous agent loop. Your job is to implement **ONE SINGLE USER STORY** from the PRD, then exit.

## Critical Rules

1. **ONE STORY ONLY**: Pick the highest priority story where `passes: false` and implement ONLY that story
2. **Small, focused changes**: Each story should be completable in this context window
3. **Quality checks**: Run typechecking and build before marking complete
4. **Update prd.json**: Mark story as `passes: true` only if all checks pass
5. **Document learnings**: Append discoveries to `progress.txt` for future iterations
6. **Commit frequently**: Commit working changes to build git history
7. **3-RETRY SKIP RULE**: The outer loop tracks retries. If you cannot complete a story, leave `passes: false` and EXIT cleanly.

## Your Workflow

### 1. Read Context Files
```bash
head -30 progress.txt
cat prd.json | jq '.userStories[] | select(.passes == false) | {id, title, priority}' | head -20
cat progress.txt
```

### 2. Pick Next Story
- Choose the highest priority incomplete story
- Read its requirements and acceptance criteria carefully

### 3. Implement the Story
- Make focused changes for THIS STORY ONLY
- Follow existing code patterns

### 4. Run Quality Checks
```bash
# Build (uses esbuild, not tsc — pre-existing type errors are expected)
npm run build

# Server startup test
MCP_SERVER_PORT=3002 timeout 10 npx tsx src/index.ts 2>&1 | head -20
```

**IMPORTANT**: PRD file is `prd.json` at project root.

### 5. Update prd.json
If ALL checks pass:
```bash
jq '(.userStories[] | select(.id == "STORY_ID") | .passes) = true' prd.json > prd.json.tmp
mv prd.json.tmp prd.json
```

### 6. Document Learnings
Append to `progress.txt`:
```markdown
## Iteration [N] - Story: [STORY_TITLE]
### What was implemented
### Patterns discovered
### Gotchas
```

### 7. Commit Changes
```bash
git add -A
git commit -m "feat: [story title]

Story ID: [STORY_ID]

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

## Project Context

### Rainbow AI Standalone Architecture
- **Single module**: `src/` (Express + WhatsApp AI + MCP tools), `shared/` (Drizzle schema)
- **Database**: PostgreSQL (Neon) + Drizzle ORM for managed tables, raw pg for config tables
- **Build**: esbuild (NOT tsc — tsc has pre-existing type errors from digiman era)
- **Port**: 3002 (MCP_SERVER_PORT env var)
- **AI**: NVIDIA Kimi K2.5 + Ollama + OpenRouter
- **WhatsApp**: Baileys (direct connection)

### Key Directories
| Path | Purpose |
|------|---------|
| `src/assistant/` | Rainbow AI engine |
| `src/routes/admin/` | Admin API (~30 sub-routers) |
| `src/lib/` | DB, config, baileys client |
| `src/tools/` | MCP tool implementations |
| `shared/` | Drizzle schema tables |
| `.rainbow-kb/` | Knowledge base markdown files |
| `src/assistant/data/` | Config JSON files |

### Key Data Files
| File | Purpose |
|------|---------|
| `src/assistant/data/routing.json` | Intent -> action mapping |
| `src/assistant/data/workflows.json` | Workflow step definitions |
| `src/assistant/data/knowledge.json` | Static reply templates |
| `src/assistant/data/intent-keywords.json` | T2 fuzzy match keywords |
| `src/assistant/data/settings.json` | Provider and feature settings |

## Stop Conditions

**Exit when:**
1. Story implemented and all checks pass -> Mark `passes: true`, commit, EXIT
2. Checks fail after attempts -> Leave `passes: false`, document failure, EXIT

Now, read `prd.json` and `progress.txt`, pick the next story, and implement it!
