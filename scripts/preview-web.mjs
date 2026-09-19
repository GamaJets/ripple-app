import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
const port = Number.parseInt(process.env.REPPLE_WEB_PORT || '4317', 10);
const host = process.env.REPPLE_WEB_HOST || '127.0.0.1';

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function localFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  const clean = normalize(decoded).replace(/^[/\\]+/, '');
  if (clean.startsWith('..')) return null;
  if (!clean) return join(webRoot, 'index.html');
  return join(webRoot, extname(clean) ? clean : `${clean}.html`);
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed');
    return;
  }

  const url = new URL(request.url || '/', `http://${request.headers.host || host}`);
  const file = localFile(url.pathname);
  if (!file) {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': info.size,
      'Content-Type': contentTypes[extname(file).toLowerCase()] || 'application/octet-stream',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(port, host, () => {
  console.log(`Repple website preview: http://${host}:${port}/`);
});
