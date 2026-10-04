// Certificado HTTPS propio para la red del gimnasio.
// Los celulares y tablets solo permiten usar la cámara en páginas HTTPS.
import fs from 'node:fs';
import path from 'node:path';
import selfsigned from 'selfsigned';

const YEARS = 10;

export async function loadOrCreateCert(dir, ips) {
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  const metaFile = path.join(dir, 'ips.json');

  // Se reutiliza mientras cubra las IP actuales; si el equipo cambió de IP se rehace.
  if (fs.existsSync(keyFile) && fs.existsSync(certFile) && fs.existsSync(metaFile)) {
    const covered = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    if (ips.every((ip) => covered.includes(ip))) {
      return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), created: false };
    }
  }

  const now = new Date();
  const until = new Date(now);
  until.setFullYear(now.getFullYear() + YEARS);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Recepcion Gimnasio' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate: now,
    notAfterDate: until,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          ...ips.map((ip) => ({ type: 7, ip })),
        ],
      },
    ],
  });

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, pems.private);
  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(metaFile, JSON.stringify(ips));
  return { key: pems.private, cert: pems.cert, created: true };
}
