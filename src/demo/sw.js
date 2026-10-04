// Service worker de la DEMO: atiende /api/* dentro del navegador con las mismas reglas
// del sistema (service.js) sobre SQLite compilado para la web (sql.js).
// Cada visitante tiene su propia copia con datos de ejemplo, guardada en su navegador.
import initSqlJs from 'sql.js';
import QRCode from 'qrcode';
import { initDb } from '../schema.js';
import { seedDemo } from '../demo-seed.js';
import { HttpError } from '../service.js';
import { createRoutes, compileRoutes, matchRoute } from '../routes.js';
import { SqlJsDatabase } from './sqljs-adapter.js';
import * as store from './idb.js';

const DB_KEY = 'db-v1';
let dbPromise = null;

async function openDemoDb({ fresh }) {
  const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
  const saved = fresh ? null : await store.get(DB_KEY);
  const db = new SqlJsDatabase(saved ? new SQL.Database(saved) : new SQL.Database());
  initDb(db);
  if (!saved) {
    seedDemo(db);
    await store.set(DB_KEY, db.export());
  }
  return db;
}

const getDb = () => (dbPromise ??= openDemoDb({ fresh: false }));

// En el navegador el QR se genera como SVG (con tamaño, para poder dibujarlo en el carnet).
const routes = compileRoutes(
  createRoutes({
    qrFile: async (code) => ({
      type: 'image/svg+xml',
      body: await QRCode.toString(code, { type: 'svg', margin: 2, width: 480, errorCorrectionLevel: 'M' }),
    }),
  })
);

const json = (status, data) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

async function handle(request, url) {
  const path = url.pathname.slice('/api'.length);
  try {
    if (request.method === 'POST' && path === '/demo/reset') {
      dbPromise = openDemoDb({ fresh: true });
      await dbPromise;
      return json(200, { ok: true });
    }
    const db = await getDb();
    const found = matchRoute(routes, request.method, path);
    if (!found) return json(404, { error: 'Ruta no encontrada' });
    const body = request.method === 'GET' ? {} : await request.json().catch(() => ({}));
    const out = await found.route.handler(db, { params: found.params, query: Object.fromEntries(url.searchParams), body });
    if (request.method !== 'GET') await store.set(DB_KEY, db.export());
    if (out?.file) return new Response(out.file.body, { headers: { 'Content-Type': out.file.type } });
    return json(200, out);
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message });
    console.error(err);
    return json(500, { error: 'Error interno de la demo' });
  }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/api/')) return;
  event.respondWith(handle(event.request, url));
});
