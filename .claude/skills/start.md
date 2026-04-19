# Rainbow AI — Start Local

Starts Rainbow AI dev server on port 3002.

## Trigger
"start rainbow", "start local", "run rainbow ai locally"

## Steps

### 1 — Kill port 3002
```bash
npx kill-port 3002 2>/dev/null || true
```

### 2 — Start dev server (background)
```bash
cd "C:/Users/Jyue/Documents/1-projects/Software Projects/rainbow-ai" && npx tsx watch --import ./src/instrumentation.ts src/index.ts
```
(run in background)

### 3 — Poll /health until 200 (max 90s, every 5s)
```bash
for i in {0..18}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3002/health 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    echo "✓ Rainbow AI ready at http://localhost:3002"
    exit 0
  fi
  sleep 5
done
echo "✗ Server failed to start within 90s"
exit 1
```

### 4 — Report
http://localhost:3002 is ready.
