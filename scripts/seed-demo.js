// Crea una base de datos de DEMOSTRACIÓN con miembros, pagos y entradas inventados.
// Uso: node scripts/seed-demo.js data/demo.db   (borra y recrea ese archivo)
import fs from 'node:fs';
import path from 'node:path';
import { openDb, saveSettings, tx } from '../src/db.js';
import * as D from '../src/dates.js';

const file = path.resolve(process.argv[2] ?? 'data/demo.db');
if (path.basename(file) === 'gym.db') {
  console.error('Por seguridad, la demo no se puede generar sobre gym.db (tu base real).');
  process.exit(1);
}
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });

// PRNG con semilla para que la demo salga siempre igual.
let seed = 20261003;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const FIRST = ['María', 'José', 'Luis', 'Ana', 'Carlos', 'Valentina', 'Miguel', 'Daniela', 'Andrés', 'Gabriela', 'Pedro', 'Camila', 'Jesús', 'Sofía', 'Rafael', 'Andrea', 'Diego', 'Paola', 'Juan', 'Rosa', 'Alejandro', 'Mariana', 'Ricardo', 'Isabel', 'Fernando', 'Carolina', 'Héctor', 'Lucía', 'Manuel', 'Elena'];
const LAST = ['González', 'Pérez', 'Rodríguez', 'Hernández', 'García', 'Martínez', 'López', 'Suárez', 'Rojas', 'Méndez', 'Herrera', 'Castro', 'Torres', 'Ramos', 'Medina', 'Blanco', 'Ortega', 'Linares', 'Díaz', 'Morales'];
const METHODS = ['Efectivo', 'Pago móvil', 'Pago móvil', 'Punto de venta', 'Divisas'];
const HOURLY = { 6: 9, 7: 14, 8: 12, 9: 6, 10: 5, 11: 5, 12: 4, 13: 3, 14: 5, 15: 4, 16: 7, 17: 12, 18: 17, 19: 19, 20: 13, 21: 7 };
const WEEKDAY = [0.45, 1.15, 1.05, 1.1, 1.0, 0.85, 0.75]; // domingo..sábado

const db = openDb(file);
saveSettings(db, { gym_name: 'Gimnasio Demo' });
const plans = db.prepare('SELECT * FROM plans ORDER BY months').all();
const t = D.today();
const at = (date, h, m = int(0, 59)) => `${date} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}`;

const insMember = db.prepare(
  `INSERT INTO members (code, name, cedula, cedula_digits, phone, plan_id, start_date, due_date, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insPayment = db.prepare(
  `INSERT INTO payments (kind, member_id, plan_id, amount_cents, method, period_start, period_end, payer_name, payer_phone, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insCheckin = db.prepare('INSERT INTO checkins (kind, member_id, payment_id, name, created_at, walkin_id) VALUES (?, ?, ?, ?, ?, ?)');
const insWalkin = db.prepare(
  `INSERT INTO walkins (code, name, cedula, cedula_digits, phone, phone_digits, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const setPaymentWalkin = db.prepare('UPDATE payments SET walkin_id = ? WHERE id = ?');

const members = [];
const usedCedulas = new Set();

tx(db, () => {
  for (let i = 1; i <= 160; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    let ced;
    do ced = int(12_000_000, 30_999_999);
    while (usedCedulas.has(ced));
    usedCedulas.add(ced);
    const cedula = `V-${ced.toLocaleString('de-DE')}`;
    const phone = `04${pick(['12', '14', '16', '24', '26'])}-${int(100, 999)}-${String(int(0, 9999)).padStart(4, '0')}`;
    const r = rand();
    const plan = r < 0.72 ? plans[0] : r < 0.92 ? plans[1] : plans[2];

    // Reparte estados: mayoría al día, algunos por vencer, en gracia, vencidos e inactivos.
    const s = rand();
    const daysLeft =
      s < 0.78 ? int(6, plan.months * 30 - 1)
      : s < 0.86 ? int(0, 5)
      : s < 0.9 ? int(-3, -1)
      : s < 0.96 ? int(-30, -4)
      : int(-120, -31);
    const due = D.addDays(t, daysLeft);
    const periods = int(1, 8);
    const start = D.addMonths(due, -plan.months * periods);
    const code = 'M' + String(i).padStart(5, '0');
    const id = Number(insMember.run(code, name, cedula, String(ced), phone, plan.id, start, due, at(start, int(7, 20))).lastInsertRowid);

    for (let k = 0; k < periods; k++) {
      const ps = D.addMonths(start, plan.months * k);
      const pe = D.addMonths(start, plan.months * (k + 1));
      const paidOn = D.addDays(ps, rand() < 0.8 ? 0 : int(1, 5));
      if (paidOn > t) continue;
      insPayment.run('membership', id, plan.id, plan.price_cents, pick(METHODS), ps, pe, name, null, at(paidOn, int(7, 20)));
    }
    members.push({ id, name, start, due });
  }

  // Clientes de pase diario (algunos muy frecuentes).
  const walkIns = Array.from({ length: 45 }, (_, i) => ({
    name: `${pick(FIRST)} ${pick(LAST)}`,
    phone: rand() < 0.7 ? `04${pick(['12', '14', '24'])}${int(1000000, 9999999)}` : '',
    weight: i < 8 ? 6 : 1,
  }));
  // La mayoría ya tiene su QR de pase diario (D00001…).
  let wk = 0;
  for (const w of walkIns) {
    if (rand() < 0.35) continue;
    let ced;
    do ced = int(12_000_000, 30_999_999);
    while (usedCedulas.has(ced));
    usedCedulas.add(ced);
    wk++;
    w.id = Number(insWalkin.run('D' + String(wk).padStart(5, '0'), w.name, `V-${ced.toLocaleString('de-DE')}`, String(ced), w.phone, w.phone || null, at(D.addDays(t, -int(20, 90)), int(7, 20))).lastInsertRowid);
  }
  const walkInPool = walkIns.flatMap((w) => Array(w.weight).fill(w));

  const now = new Date();
  for (let back = 60; back >= 0; back--) {
    const date = D.addDays(t, -back);
    const factor = WEEKDAY[D.parseDate(date).getDay()];
    for (const [hStr, base] of Object.entries(HOURLY)) {
      const h = Number(hStr);
      if (back === 0 && h > now.getHours()) break;
      let n = Math.round(base * factor * (0.7 + rand() * 0.6));
      if (back === 0 && h === now.getHours()) n = Math.round((n * now.getMinutes()) / 60);
      for (let j = 0; j < n; j++) {
        const maxMin = back === 0 && h === now.getHours() ? Math.max(0, now.getMinutes() - 1) : 59;
        const ts = at(date, h, int(0, maxMin));
        if (rand() < 0.16) {
          const w = pick(walkInPool);
          const price = 500;
          const pid = Number(insPayment.run('daypass', null, null, price, pick(METHODS), null, null, w.name, w.phone, ts).lastInsertRowid);
          if (w.id) setPaymentWalkin.run(w.id, pid);
          insCheckin.run('daypass', null, pid, w.name, ts, w.id ?? null);
        } else {
          const eligible = members.filter((m) => m.start <= date && D.daysBetween(m.due, date) <= 3);
          if (!eligible.length) continue;
          const m = pick(eligible);
          insCheckin.run('member', m.id, null, m.name, ts, null);
        }
      }
    }
  }
});

const count = (sql) => db.prepare(sql).get().n;
console.log(`Demo creada en ${file}`);
console.log(`  ${count('SELECT COUNT(*) AS n FROM members')} miembros, ${count('SELECT COUNT(*) AS n FROM payments')} pagos, ${count('SELECT COUNT(*) AS n FROM checkins')} entradas`);
db.close();
