// Crea una base de datos de DEMOSTRACIÓN con miembros, pagos y entradas inventados.
// Uso: node scripts/seed-demo.js data/demo.db   (borra y recrea ese archivo)
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { seedDemo } from '../src/demo-seed.js';

const file = path.resolve(process.argv[2] ?? 'data/demo.db');
if (path.basename(file) === 'gym.db') {
  console.error('Por seguridad, la demo no se puede generar sobre gym.db (tu base real).');
  process.exit(1);
}
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });

const db = openDb(file);
seedDemo(db);

const count = (sql) => db.prepare(sql).get().n;
console.log(`Demo creada en ${file}`);
console.log(`  ${count('SELECT COUNT(*) AS n FROM members')} miembros, ${count('SELECT COUNT(*) AS n FROM payments')} pagos, ${count('SELECT COUNT(*) AS n FROM checkins')} entradas`);
db.close();
