import express from 'express';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { openDb } from './src/db.js';
import { createApi } from './src/api.js';
import { loadOrCreateCert } from './src/cert.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const dbFile = path.resolve(root, argValue('--db') ?? process.env.GYM_DB ?? 'data/gym.db');
const port = Number(argValue('--port') ?? process.env.PORT ?? 3100);
const httpsPort = Number(argValue('--https-port') ?? process.env.HTTPS_PORT ?? port + 343);

const lanIps = Object.values(os.networkInterfaces())
  .flat()
  .filter((net) => net && net.family === 'IPv4' && !net.internal)
  .map((net) => net.address);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const db = openDb(dbFile);
const app = express();

// Desde otro equipo de la red se pasa a HTTPS: sin él, el celular o la tablet no dejan usar la cámara.
app.use((req, res, next) => {
  if (req.secure || LOCAL_HOSTS.has(req.hostname) || req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.redirect(`https://${req.hostname}:${httpsPort}${req.originalUrl}`);
});

app.use(express.json());
app.use('/api', createApi(db));

const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));
app.use('/vendor/fonts/barlow-condensed', express.static(pkgDir('@fontsource/barlow-condensed')));
app.use('/vendor/fonts/ibm-plex-sans', express.static(pkgDir('@fontsource/ibm-plex-sans')));
app.get('/vendor/html5-qrcode.min.js', (req, res) =>
  res.sendFile(path.join(pkgDir('html5-qrcode'), 'html5-qrcode.min.js'))
);
app.use(express.static(path.join(root, 'public')));

function listen(server, p) {
  return new Promise((resolve) => {
    server.once('error', (err) => {
      console.error(
        err.code === 'EADDRINUSE'
          ? `\nEl puerto ${p} ya lo está usando otro programa. Prueba con otro: npm start -- --port 3200\n`
          : `\nNo se pudo iniciar el servidor: ${err.message}\n`
      );
      process.exit(1);
    });
    server.listen(p, '0.0.0.0', resolve);
  });
}

const tls = await loadOrCreateCert(path.join(path.dirname(dbFile), 'cert'), lanIps);
await listen(http.createServer(app), port);
await listen(https.createServer({ key: tls.key, cert: tls.cert }, app), httpsPort);

console.log(`\nRecepción del gimnasio funcionando`);
console.log(`  Base de datos: ${dbFile}`);
console.log(`  En este equipo:          http://localhost:${port}`);
for (const ip of lanIps) console.log(`  En la tablet o celular:  https://${ip}:${httpsPort}`);
console.log(`\n  La primera vez, el celular mostrará "La conexión no es privada".`);
console.log(`  Es normal (el certificado es del propio gimnasio): toca "Configuración avanzada" y luego "Acceder".`);
if (tls.created) console.log(`  (Se creó un certificado nuevo: si ya lo habías aceptado antes, tendrás que aceptarlo otra vez.)`);
console.log('');
