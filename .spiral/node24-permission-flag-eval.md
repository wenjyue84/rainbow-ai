# Node.js 24 --permission Flag Evaluation

**Date:** 2026-03-14
**Story:** US-496

## Decision: Do NOT enable --permission flag in production (yet)

### What is it?
Node.js 24 stabilized the `--permission` flag (previously `--experimental-permission`).
It restricts file system access, child process spawning, and worker thread creation
at the runtime level.

### Why not now?

1. **Baileys auth state**: Writes to `whatsapp-auth/` and `whatsapp-auth-southern/` directories.
   The permission model requires explicit `--allow-fs-read` and `--allow-fs-write` for each path.

2. **Knowledge base**: Reads `.rainbow-kb/`, `.rainbow-kb-southern/`, `.rainbow-kb-makan/` at runtime.

3. **BullMQ workers**: Spawns worker threads internally — `--allow-worker` would be needed.

4. **Dynamic imports**: Several health check and pipeline modules use `await import()` which
   requires `--allow-fs-read` for the module paths.

5. **Config files**: `src/assistant/data/` JSON files are read at runtime.

6. **Complexity**: The number of `--allow-*` flags needed makes the PM2 config fragile.
   Any new file path would require a deploy config change.

### Recommendation
Revisit when:
- Baileys auth state is fully DB-backed (US-480 completed — most auth is in DB now, but LID mapper cache still uses disk)
- A comprehensive `--allow-fs-read` whitelist can be audited
- PM2 supports permission model configuration natively

### OpenSSL 3.5 Security Level 2
This is automatically enforced by Node.js 24 — no flag needed.
- RSA/DSA/DH keys < 2048 bits are rejected
- RC4 cipher suites are disabled
- All upstream services (Neon PostgreSQL, OpenRouter, NVIDIA NIM) use modern TLS — no issues expected
