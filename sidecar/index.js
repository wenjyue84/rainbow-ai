/**
 * Rainbow ML Sidecar — the ONLY process that loads @xenova/transformers.
 *
 * Isolating the ONNX models (all-MiniLM-L6-v2 embeddings) in this tiny service is
 * what lets the Go core stay lean: the >150 MB of model weights that bloated the
 * Node monolith's heap live here instead, behind a stable HTTP boundary.
 *
 * Endpoints:
 *   POST /semantic  {text}            → {intent, score, example}  (T3 classification)
 *   POST /embed     {text}            → {vector:[...]}            (raw embedding)
 *   GET  /health
 *
 * Intent example embeddings (from intent-examples.json) are precomputed at startup.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from '@xenova/transformers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.SIDECAR_PORT || '8791', 10);
const DATA_DIR = process.env.RAINBOW_DATA_DIR || path.join(__dirname, '..', 'src', 'assistant', 'data');
const MODEL = process.env.EMBED_MODEL || 'Xenova/all-MiniLM-L6-v2';

let embedder = null;
let examples = []; // [{intent, text, vec:Float32Array}]
let ready = false;

function cosine(a, b) {
  // vectors are L2-normalized → cosine == dot product
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function embed(text) {
  const out = await embedder(text, { pooling: 'mean', normalize: true });
  return out.data; // Float32Array
}

async function init() {
  console.log(`[sidecar] loading model ${MODEL} ...`);
  embedder = await pipeline('feature-extraction', MODEL);
  console.log('[sidecar] model loaded; precomputing intent example embeddings...');

  const file = path.join(DATA_DIR, 'intent-examples.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf-8'));
  let count = 0;
  for (const it of doc.intents || []) {
    for (const exs of Object.values(it.examples || {})) {
      for (const ex of exs) {
        const vec = await embed(ex);
        examples.push({ intent: it.intent, text: ex, vec });
        count++;
      }
    }
  }
  ready = true;
  console.log(`[sidecar] ready — ${count} example embeddings across ${(doc.intents || []).length} intents`);
}

async function semantic(text) {
  const q = await embed(text);
  let best = { intent: '', score: -1, example: '' };
  for (const e of examples) {
    const score = cosine(q, e.vec);
    if (score > best.score) best = { intent: e.intent, score, example: e.text };
  }
  return best;
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}

const server = http.createServer(async (req, res) => {
  const json = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return json(200, { status: ready ? 'ok' : 'loading', service: 'rainbow-ml-sidecar', examples: examples.length });
    }
    if (!ready) return json(503, { error: 'model still loading' });

    if (req.method === 'POST' && req.url === '/semantic') {
      const { text } = JSON.parse((await readBody(req)) || '{}');
      if (!text) return json(400, { error: 'text required' });
      return json(200, await semantic(text));
    }
    if (req.method === 'POST' && req.url === '/embed') {
      const { text } = JSON.parse((await readBody(req)) || '{}');
      if (!text) return json(400, { error: 'text required' });
      const vec = await embed(text);
      return json(200, { vector: Array.from(vec) });
    }
    return json(404, { error: 'not found' });
  } catch (err) {
    return json(500, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`[sidecar] listening on :${PORT} (data=${DATA_DIR})`));
init().catch((err) => {
  console.error('[sidecar] init failed:', err);
  process.exit(1);
});
