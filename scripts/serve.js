/**
 * Mini serveur statique de développement, sans dépendance.
 * Usage : npm start   (ou PORT=8080 HOST=0.0.0.0 npm start)
 *
 * Par défaut, il n'écoute que sur 127.0.0.1. Les modules ES ne se chargent pas
 * en ouvrant index.html directement (file://) : il faut passer par un serveur.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '127.0.0.1';
const ALLOWED = new Set(['.html', '.css', '.js']);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const file = normalize(join(ROOT, relative));
    const ext = extname(file);
    const inRoot = file.startsWith(ROOT + sep);
    const servable = relative === '/index.html' || relative === '/styles.css' || relative.startsWith('/src/');
    if (!inRoot || !servable || !ALLOWED.has(ext) || req.method !== 'GET') {
      res.writeHead(404).end('Introuvable');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[ext], 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Introuvable');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ATLAS-Hydrants : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`);
});
