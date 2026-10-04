// Esquema, ajustes y transacciones. No depende de Node: lo usan el servidor (node:sqlite)
// y la demo del navegador (sql.js), que reciben un objeto con exec() y prepare().

export const PAYMENT_METHODS = ['Efectivo', 'Pago móvil', 'Punto de venta', 'Divisas'];

// Valores por defecto; se pueden cambiar desde Ajustes.
export const DEFAULT_SETTINGS = {
  gym_name: 'Mi Gimnasio',
  currency: '$',
  daypass_price_cents: 500,
  soon_days: 5, // "Por vencer": faltan estos días o menos
  grace_days: 3, // "En gracia": vencida hace estos días o menos, aún entra
  late_window_days: 15, // si renueva dentro de este plazo, el periodo cuenta desde el vencimiento
  inactive_days: 30, // vencida hace más de esto: se considera ex-miembro
  capacity: 60,
  stay_minutes: 90, // tiempo promedio que alguien se queda entrenando
  country_code: '58', // para los enlaces de WhatsApp
};

const DEFAULT_PLANS = [
  { name: 'Mensual', months: 1, price_cents: 2500 },
  { name: 'Trimestral', months: 3, price_cents: 6500 },
  { name: 'Anual', months: 12, price_cents: 24000 },
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  months INTEGER NOT NULL CHECK (months > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  cedula TEXT NOT NULL,
  cedula_digits TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  start_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  last_reminder_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('membership', 'daypass')),
  member_id INTEGER REFERENCES members(id),
  plan_id INTEGER REFERENCES plans(id),
  amount_cents INTEGER NOT NULL,
  method TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  payer_name TEXT,
  payer_phone TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('member', 'daypass')),
  member_id INTEGER REFERENCES members(id),
  payment_id INTEGER REFERENCES payments(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS walkins (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  cedula TEXT NOT NULL DEFAULT '',
  cedula_digits TEXT UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  phone_digits TEXT,
  member_id INTEGER REFERENCES members(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_walkins_phone ON walkins(phone_digits);
CREATE INDEX IF NOT EXISTS idx_checkins_created ON checkins(created_at);
CREATE INDEX IF NOT EXISTS idx_checkins_member ON checkins(member_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_phone ON payments(payer_phone, created_at);
`;

export function initDb(db) {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  if (db.prepare('SELECT COUNT(*) AS n FROM plans').get().n === 0) {
    const insert = db.prepare('INSERT INTO plans (name, months, price_cents) VALUES (?, ?, ?)');
    for (const p of DEFAULT_PLANS) insert.run(p.name, p.months, p.price_cents);
  }
  return db;
}

// Cambios sobre bases creadas con versiones anteriores.
function migrate(db) {
  const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  for (const table of ['payments', 'checkins']) {
    if (!hasColumn(table, 'walkin_id')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN walkin_id INTEGER REFERENCES walkins(id)`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_walkin ON ${table}(walkin_id, created_at)`);
  }
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSettings(db) {
  const s = { ...DEFAULT_SETTINGS };
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    s[key] = typeof DEFAULT_SETTINGS[key] === 'number' ? Number(value) : value;
  }
  return s;
}

export function saveSettings(db, values) {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  tx(db, () => {
    for (const [key, value] of Object.entries(values)) upsert.run(key, String(value));
  });
}
