// Tiny static server for local play and headless tests. No dependencies.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav',
};

// Only what the browser needs is public: never .git, node_modules or server code.
const PUBLIC = ['/index.html', '/src/client/', '/src/shared/', '/vendor/'];

export async function staticHandler(req, res) {
  try {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path === '/') path = '/index.html';
    if (!PUBLIC.some((p) => path === p || (p.endsWith('/') && path.startsWith(p)))) return res.writeHead(404).end('not found');
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(404).end('not found');
  }
}

export function serve(port = 0, host = '127.0.0.1') {
  const server = http.createServer(staticHandler);
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await serve(Number(process.env.PORT) || 8080);
  console.log(`flood on http://127.0.0.1:${s.address().port}/`);
}
