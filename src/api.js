import express from 'express';
import QRCode from 'qrcode';
import * as svc from './service.js';
import { createRoutes } from './routes.js';

async function qrFile(code, ext) {
  const opts = { margin: ext === 'png' ? 2 : 1, errorCorrectionLevel: 'M' };
  return ext === 'png'
    ? { type: 'image/png', body: await QRCode.toBuffer(code, { ...opts, type: 'png', width: 480 }) }
    : { type: 'image/svg+xml', body: await QRCode.toString(code, { ...opts, type: 'svg' }) };
}

export function createApi(db) {
  const r = express.Router();

  for (const [method, path, handler] of createRoutes({ qrFile })) {
    r[method.toLowerCase()](path, async (req, res, next) => {
      try {
        const out = await handler(db, { params: req.params, query: req.query, body: req.body ?? {} });
        if (out?.file) res.type(out.file.type).send(out.file.body);
        else res.json(out);
      } catch (err) {
        next(err);
      }
    });
  }

  r.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
  r.use((err, req, res, _next) => {
    if (err instanceof svc.HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Datos mal formados' });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return r;
}
