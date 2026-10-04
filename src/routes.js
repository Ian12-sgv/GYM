// Rutas de la API, compartidas por el servidor (Express) y la demo del navegador (service worker).
// Cada handler recibe (db, { params, query, body }) y devuelve un objeto que se manda como JSON,
// o un archivo { file: { type, body } } (las imágenes QR).
import * as svc from './service.js';

// qrFile(code, ext) => Promise<{ type, body }>: cada entorno genera el QR a su manera.
export function createRoutes({ qrFile }) {
  const routes = [
    ['GET', '/config', (db) => svc.getConfig(db)],
    ['PUT', '/settings', (db, r) => svc.updateSettings(db, r.body)],
    ['POST', '/plans', (db, r) => svc.createPlan(db, r.body)],
    ['PUT', '/plans/:id', (db, r) => svc.updatePlan(db, r.params.id, r.body)],

    ['POST', '/checkin', (db, r) => svc.checkIn(db, r.body?.query)],
    ['POST', '/daypass', (db, r) => svc.sellDayPass(db, r.body)],
    ['GET', '/daypass/history', (db, r) => svc.dayPassHistory(db, r.query.phone)],
    ['GET', '/lookup', (db, r) => svc.lookup(db, r.query.q)],

    ['GET', '/members', (db, r) => svc.listMembers(db, r.query)],
    ['POST', '/members', (db, r) => svc.createMember(db, r.body)],
    ['GET', '/members/:id', (db, r) => svc.getMember(db, r.params.id)],
    ['PUT', '/members/:id', (db, r) => svc.updateMember(db, r.params.id, r.body)],
    ['GET', '/members/:id/renewal', (db, r) => svc.renewalPreview(db, r.params.id, r.query.plan_id)],
    ['POST', '/members/:id/renew', (db, r) => svc.renew(db, r.params.id, r.body)],
    ['POST', '/members/:id/remind', (db, r) => svc.markReminded(db, r.params.id)],

    ['GET', '/walkins', (db, r) => svc.listWalkins(db, r.query)],
    ['GET', '/walkins/:id', (db, r) => svc.getWalkin(db, r.params.id)],
    ['PUT', '/walkins/:id', (db, r) => svc.updateWalkin(db, r.params.id, r.body)],
    ['POST', '/walkins/:id/reentry', (db, r) => svc.walkinReentry(db, r.params.id)],

    ['GET', '/today', (db) => svc.todaySummary(db)],
    ['GET', '/billing', (db) => svc.billingSummary(db)],
    ['GET', '/reports', (db) => svc.reports(db)],
  ];

  // QR de miembros (M00001) y de clientes de pase diario (D00001).
  for (const [kind, get] of [['members', svc.getMember], ['walkins', svc.getWalkin]]) {
    for (const ext of ['svg', 'png']) {
      routes.push(['GET', `/${kind}/:id/qr.${ext}`, async (db, r) => ({ file: await qrFile(get(db, r.params.id).code, ext) })]);
    }
  }
  return routes;
}

// Convierte '/members/:id/qr.svg' en una expresión regular con grupos por parámetro.
export function compileRoutes(routes) {
  return routes.map(([method, path, handler]) => {
    const keys = [];
    const pattern = path.replace(/[.]/g, '\\.').replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'));
    return { method, path, handler, keys, regex: new RegExp(`^${pattern}$`) };
  });
}

export function matchRoute(compiled, method, path) {
  for (const route of compiled) {
    if (route.method !== method) continue;
    const m = route.regex.exec(path);
    if (m) return { route, params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}
