import express from 'express';
import QRCode from 'qrcode';
import * as svc from './service.js';

export function createApi(db) {
  const r = express.Router();

  // Envuelve un handler síncrono: lo que devuelve se manda como JSON.
  const json = (fn) => (req, res, next) => {
    try {
      res.json(fn(req));
    } catch (err) {
      next(err);
    }
  };

  r.get('/config', json(() => svc.getConfig(db)));
  r.put('/settings', json((req) => svc.updateSettings(db, req.body)));
  r.post('/plans', json((req) => svc.createPlan(db, req.body)));
  r.put('/plans/:id', json((req) => svc.updatePlan(db, req.params.id, req.body)));

  r.post('/checkin', json((req) => svc.checkIn(db, req.body?.query)));
  r.post('/daypass', json((req) => svc.sellDayPass(db, req.body)));
  r.get('/daypass/history', json((req) => svc.dayPassHistory(db, req.query.phone)));

  r.get('/members', json((req) => svc.listMembers(db, req.query)));
  r.post('/members', json((req) => svc.createMember(db, req.body)));
  r.get('/members/:id', json((req) => svc.getMember(db, req.params.id)));
  r.put('/members/:id', json((req) => svc.updateMember(db, req.params.id, req.body)));
  r.get('/members/:id/renewal', json((req) => svc.renewalPreview(db, req.params.id, req.query.plan_id)));
  r.post('/members/:id/renew', json((req) => svc.renew(db, req.params.id, req.body)));
  r.post('/members/:id/remind', json((req) => svc.markReminded(db, req.params.id)));
  r.get('/lookup', json((req) => svc.lookup(db, req.query.q)));
  r.get('/walkins', json((req) => svc.listWalkins(db, req.query)));
  r.get('/walkins/:id', json((req) => svc.getWalkin(db, req.params.id)));
  r.put('/walkins/:id', json((req) => svc.updateWalkin(db, req.params.id, req.body)));
  r.post('/walkins/:id/reentry', json((req) => svc.walkinReentry(db, req.params.id)));

  // QR de miembros (M00001) y de clientes de pase diario (D00001).
  const qrRoutes = { members: svc.getMember, walkins: svc.getWalkin };
  for (const [kind, get] of Object.entries(qrRoutes)) {
    r.get(`/${kind}/:id/qr.svg`, async (req, res, next) => {
      try {
        const svg = await QRCode.toString(get(db, req.params.id).code, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
        res.type('image/svg+xml').send(svg);
      } catch (err) {
        next(err);
      }
    });
    r.get(`/${kind}/:id/qr.png`, async (req, res, next) => {
      try {
        const png = await QRCode.toBuffer(get(db, req.params.id).code, { type: 'png', width: 480, margin: 2, errorCorrectionLevel: 'M' });
        res.type('image/png').send(png);
      } catch (err) {
        next(err);
      }
    });
  }

  r.get('/today', json(() => svc.todaySummary(db)));
  r.get('/billing', json(() => svc.billingSummary(db)));
  r.get('/reports', json(() => svc.reports(db)));

  r.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
  r.use((err, req, res, _next) => {
    if (err instanceof svc.HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Datos mal formados' });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return r;
}
