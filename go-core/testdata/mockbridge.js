// Minimal mock of the Node bridge for core smoke tests: logs /send ops, returns ok.
import http from 'node:http';
const port = parseInt(process.env.PORT || '8788', 10);
http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); res.end('{"status":"ok"}'); return; }
  if (req.url === '/send') {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try { const op = JSON.parse(b); console.log(`[mockbridge] ${op.op} phone=${op.phone} text=${JSON.stringify((op.text||'').slice(0,60))}`); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true,"sent":true}');
    });
    return;
  }
  res.writeHead(404); res.end();
}).listen(port, () => console.log(`[mockbridge] listening on :${port}`));
