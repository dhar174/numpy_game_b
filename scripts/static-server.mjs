import {createServer} from 'node:http';
import {createGzip} from 'node:zlib';
import {pipeline} from 'node:stream';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {extname, isAbsolute, relative, resolve, sep} from 'node:path';

const types = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2',
  '.webp': 'image/webp', '.png': 'image/png'};

export async function serveBuild(port = 0) {
  const root = fileURLToPath(new URL('../dist/', import.meta.url));
  const prefix = '/numpy_game_b/';
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (!pathname.startsWith(prefix)) {
        response.writeHead(404).end();
        return;
      }
      const filename = resolve(root, pathname.slice(prefix.length) || 'index.html');
      const location = relative(root, filename);
      if (isAbsolute(location) || location === '..' || location.startsWith('..' + sep)) {
        response.writeHead(404).end();
        return;
      }
      const info = await stat(filename);
      if (!info.isFile()) {
        response.writeHead(404).end();
        return;
      }
      const type = types[extname(filename)] ?? 'application/octet-stream';
      const compressible = /^(text\/|application\/json)/.test(type) && info.size > 1024;
      const gzip = compressible && /(?:^|,)\s*gzip\s*(?:,|$)/.test(request.headers['accept-encoding'] ?? '');
      response.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=3600',
        ...(compressible ? {'Vary': 'Accept-Encoding'} : {}),
        ...(gzip ? {'Content-Encoding': 'gzip'} : {'Content-Length': info.size}),
      });
      const body = createReadStream(filename);
      if (gzip) pipeline(body, createGzip(), response, () => {});
      else pipeline(body, response, () => {});
    } catch {
      if (!response.headersSent) response.writeHead(404);
      response.end();
    }
  });
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', ok);
  });
  return {
    url: 'http://127.0.0.1:' + server.address().port + prefix,
    close: () => new Promise((ok, fail) => server.close(error => error ? fail(error) : ok())),
  };
}
