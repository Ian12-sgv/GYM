import { tx, getSettings, saveSettings, DEFAULT_SETTINGS, PAYMENT_METHODS } from './schema.js';
import * as D from './dates.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const STATUS_LABELS = {
  ok: 'Al día',
  soon: 'Por vencer',
  grace: 'En gracia',
  late: 'Vencida',
  inactive: 'Inactivo',
};
const STATUS_ORDER = { late: 0, grace: 1, soon: 2, ok: 3, inactive: 4 };
export const ACTION_STATUSES = ['soon', 'grace', 'late'];

const DUPLICATE_SCAN_MINUTES = 5;

const clean = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const digits = (v) => String(v ?? '').replace(/\D/g, '');

// ---------- Reglas de membresía ----------

// due_date es el día de corte: ese día todavía entra ("vence hoy").
export function membershipStatus(dueDate, todayStr, s) {
  const daysLeft = D.daysBetween(todayStr, dueDate);
  let key;
  if (daysLeft > s.soon_days) key = 'ok';
  else if (daysLeft >= 0) key = 'soon';
  else if (daysLeft >= -s.grace_days) key = 'grace';
  else if (daysLeft >= -s.inactive_days) key = 'late';
  else key = 'inactive';
  return {
    key,
    label: STATUS_LABELS[key],
    allowed: key === 'ok' || key === 'soon' || key === 'grace',
    days_left: daysLeft,
  };
}

// Si renueva a tiempo o con poco atraso, el nuevo periodo arranca en su día de
// corte (no gana días por pagar tarde). Si volvió después de mucho tiempo, arranca hoy.
export function renewalStart(dueDate, todayStr, s) {
  return D.daysBetween(dueDate, todayStr) <= s.late_window_days ? dueDate : todayStr;
}

// ---------- Helpers ----------

function requireMethod(method) {
  if (!PAYMENT_METHODS.includes(method)) throw new HttpError(400, 'Elige un método de pago válido');
  return method;
}

function getPlan(db, id, { activeOnly = true } = {}) {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(Number(id));
  if (!plan || (activeOnly && !plan.active)) throw new HttpError(400, 'Elige un plan válido');
  return plan;
}

const MEMBER_SELECT = `
  SELECT m.*, p.name AS plan_name, p.months AS plan_months, p.price_cents AS plan_price_cents
  FROM members m JOIN plans p ON p.id = m.plan_id`;

function getMemberRow(db, id) {
  const m = db.prepare(`${MEMBER_SELECT} WHERE m.id = ?`).get(Number(id));
  if (!m) throw new HttpError(404, 'Miembro no encontrado');
  return m;
}

function memberView(m, s, todayStr) {
  return {
    kind: 'member',
    id: m.id,
    code: m.code,
    name: m.name,
    cedula: m.cedula,
    phone: m.phone,
    plan_id: m.plan_id,
    plan_name: m.plan_name,
    plan_months: m.plan_months,
    plan_price_cents: m.plan_price_cents,
    start_date: m.start_date,
    due_date: m.due_date,
    last_reminder_at: m.last_reminder_at,
    status: membershipStatus(m.due_date, todayStr, s),
  };
}

function visitsSince(db, memberId, from) {
  return db.prepare('SELECT COUNT(*) AS n FROM checkins WHERE member_id = ? AND created_at >= ?').get(memberId, from).n;
}

function recentCheckin(db, memberId) {
  const since = D.toDateTimeStr(new Date(Date.now() - DUPLICATE_SCAN_MINUTES * 60000));
  return db.prepare('SELECT id FROM checkins WHERE member_id = ? AND created_at >= ?').get(memberId, since);
}

function insertMemberCheckin(db, member, ts) {
  db.prepare("INSERT INTO checkins (kind, member_id, name, created_at) VALUES ('member', ?, ?, ?)").run(
    member.id,
    member.name,
    ts
  );
}

// ---------- Configuración ----------

export function getConfig(db) {
  return {
    settings: getSettings(db),
    plans: db.prepare('SELECT * FROM plans ORDER BY months, id').all(),
    methods: PAYMENT_METHODS,
  };
}

const NUMBER_LIMITS = {
  daypass_price_cents: [0, 1_000_000],
  soon_days: [0, 60],
  grace_days: [0, 60],
  late_window_days: [0, 365],
  inactive_days: [1, 3650],
  capacity: [1, 10_000],
  stay_minutes: [10, 600],
};

export function updateSettings(db, body = {}) {
  const values = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!(key in body)) continue;
    if (key in NUMBER_LIMITS) {
      const n = Number(body[key]);
      const [min, max] = NUMBER_LIMITS[key];
      if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `Valor inválido para ${key}`);
      values[key] = n;
    } else {
      const v = clean(body[key], 60);
      if (key === 'gym_name' && !v) throw new HttpError(400, 'El nombre del gimnasio no puede quedar vacío');
      if (key === 'country_code' && !/^\d{1,4}$/.test(v)) throw new HttpError(400, 'Código de país inválido');
      values[key] = v;
    }
  }
  const merged = { ...getSettings(db), ...values };
  if (merged.inactive_days <= merged.grace_days) {
    throw new HttpError(400, 'Los días para considerar inactivo deben ser más que los días de gracia');
  }
  saveSettings(db, values);
  return getConfig(db);
}

function planFields(body) {
  const name = clean(body.name, 40);
  const months = Number(body.months);
  const price = Number(body.price_cents);
  if (!name) throw new HttpError(400, 'El plan necesita un nombre');
  if (!Number.isInteger(months) || months < 1 || months > 60) throw new HttpError(400, 'Duración inválida (meses)');
  if (!Number.isInteger(price) || price < 0) throw new HttpError(400, 'Precio inválido');
  return { name, months, price };
}

export function createPlan(db, body = {}) {
  const { name, months, price } = planFields(body);
  db.prepare('INSERT INTO plans (name, months, price_cents) VALUES (?, ?, ?)').run(name, months, price);
  return getConfig(db);
}

export function updatePlan(db, id, body = {}) {
  getPlan(db, id, { activeOnly: false });
  const { name, months, price } = planFields(body);
  db.prepare('UPDATE plans SET name = ?, months = ?, price_cents = ?, active = ? WHERE id = ?').run(
    name,
    months,
    price,
    body.active === false ? 0 : 1,
    Number(id)
  );
  return getConfig(db);
}

// ---------- Entrada ----------

export function findMember(db, query) {
  const code = clean(query, 40).toUpperCase();
  const ced = digits(query);
  if (!code) throw new HttpError(400, 'Escribe una cédula o un código de miembro');
  return db.prepare(`${MEMBER_SELECT} WHERE m.code = ? OR (? <> '' AND m.cedula_digits = ?)`).get(code, ced, ced);
}

export function checkIn(db, query) {
  const s = getSettings(db);
  const t = D.today();
  const m = findMember(db, query);
  if (!m) {
    const w = findWalkin(db, query);
    return w ? { result: 'walkin', walkin: walkinView(db, w, t) } : { result: 'not_found' };
  }
  const member = memberView(m, s, t);
  if (!member.status.allowed) return { result: 'denied', member };

  const duplicate = Boolean(recentCheckin(db, m.id));
  if (!duplicate) insertMemberCheckin(db, m, D.now());
  return {
    result: 'allowed',
    duplicate,
    member: { ...member, visits_this_month: visitsSince(db, m.id, D.monthStart(t)) },
  };
}

export function dayPassHistory(db, phone) {
  const ph = digits(phone);
  if (ph.length < 7) return { visits: 0, total_cents: 0 };
  const row = db
    .prepare(
      `SELECT COUNT(*) AS visits, COALESCE(SUM(amount_cents), 0) AS total_cents
       FROM payments WHERE kind = 'daypass' AND payer_phone = ? AND created_at >= ?`
    )
    .get(ph, D.monthStart(D.today()));
  return { visits: row.visits, total_cents: row.total_cents };
}

// Cobra el pase del día. Puede ser:
//  - un cliente de pase diario ya registrado (walkin_id): no se piden datos;
//  - alguien nuevo con save=true: se guardan sus datos y recibe su QR;
//  - alguien de paso (save=false) o un miembro vencido (member_id).
export function sellDayPass(db, body = {}) {
  const s = getSettings(db);
  const method = requireMethod(body.method);
  const memberId = body.member_id ? getMemberRow(db, body.member_id).id : null;
  let walkinId = null;
  let fields = null;
  let name;
  let phone;
  if (body.walkin_id) {
    const w = getWalkinRow(db, body.walkin_id);
    walkinId = w.id;
    name = w.name;
    phone = w.phone_digits ?? '';
  } else {
    name = clean(body.name);
    if (!name) throw new HttpError(400, 'Escribe el nombre del cliente');
    phone = digits(body.phone).slice(0, 20);
    if (body.save && !memberId) fields = walkinFields(db, body);
  }
  const ts = D.now();

  const paymentId = tx(db, () => {
    if (fields) walkinId = insertWalkin(db, fields, ts);
    const pay = db
      .prepare(
        `INSERT INTO payments (kind, member_id, walkin_id, amount_cents, method, payer_name, payer_phone, created_at)
         VALUES ('daypass', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(memberId, walkinId, s.daypass_price_cents, method, name, phone, ts);
    const id = Number(pay.lastInsertRowid);
    db.prepare(
      "INSERT INTO checkins (kind, member_id, walkin_id, payment_id, name, created_at) VALUES ('daypass', ?, ?, ?, ?, ?)"
    ).run(memberId, walkinId, id, name, ts);
    return id;
  });

  const walkin = walkinId ? walkinView(db, getWalkinRow(db, walkinId), D.today()) : null;
  return {
    payment_id: paymentId,
    amount_cents: s.daypass_price_cents,
    walkin,
    history: walkin
      ? { visits: walkin.visits_this_month, total_cents: walkin.spent_this_month_cents }
      : dayPassHistory(db, phone),
  };
}

// ---------- Clientes de pase diario ----------

function getWalkinRow(db, id) {
  const w = db.prepare('SELECT * FROM walkins WHERE id = ?').get(Number(id));
  if (!w) throw new HttpError(404, 'Cliente no encontrado');
  return w;
}

// Por código (D00001), cédula o teléfono. Los que ya se hicieron miembros no cuentan.
export function findWalkin(db, query) {
  const code = clean(query, 40).toUpperCase();
  const d = digits(query);
  const ced = d.length >= 5 && d.length <= 9 ? d : '';
  const phone = d.length >= 10 ? d : '';
  return db
    .prepare(
      `SELECT * FROM walkins WHERE member_id IS NULL
       AND (code = ? OR (? <> '' AND cedula_digits = ?) OR (? <> '' AND phone_digits = ?))
       ORDER BY id DESC`
    )
    .get(code, ced, ced, phone, phone);
}

function walkinView(db, w, todayStr) {
  const month = db
    .prepare(
      `SELECT COUNT(*) AS visits, COALESCE(SUM(amount_cents), 0) AS total
       FROM payments WHERE walkin_id = ? AND kind = 'daypass' AND created_at >= ?`
    )
    .get(w.id, D.monthStart(todayStr));
  const paidToday = db
    .prepare("SELECT MAX(created_at) AS at FROM payments WHERE walkin_id = ? AND kind = 'daypass' AND created_at >= ?")
    .get(w.id, todayStr).at;
  const lastVisit = db.prepare('SELECT MAX(created_at) AS at FROM checkins WHERE walkin_id = ?').get(w.id).at;
  return {
    kind: 'walkin',
    id: w.id,
    code: w.code,
    name: w.name,
    cedula: w.cedula,
    phone: w.phone,
    member_id: w.member_id,
    visits_this_month: month.visits,
    spent_this_month_cents: month.total,
    paid_today_at: paidToday,
    last_visit: lastVisit,
    created_at: w.created_at,
  };
}

function walkinFields(db, body, currentId = null) {
  const name = clean(body.name);
  if (!name) throw new HttpError(400, 'Escribe el nombre del cliente');
  const cedula = clean(body.cedula, 30);
  const ced = digits(cedula);
  if (cedula && ced.length < 5) throw new HttpError(400, 'La cédula no es válida');
  const phone = clean(body.phone, 30);
  if (ced) {
    const member = db.prepare('SELECT name FROM members WHERE cedula_digits = ?').get(ced);
    if (member) throw new HttpError(409, `Esa cédula es de un miembro con membresía: ${member.name}`);
    const other = db.prepare('SELECT id, name, code FROM walkins WHERE cedula_digits = ?').get(ced);
    if (other && other.id !== currentId) {
      throw new HttpError(409, `Ya está registrado como ${other.name} (${other.code})`);
    }
  }
  return { name, cedula, ced: ced || null, phone, phoneDigits: digits(phone) || null };
}

function insertWalkin(db, f, ts) {
  const r = db
    .prepare(
      `INSERT INTO walkins (name, cedula, cedula_digits, phone, phone_digits, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(f.name, f.cedula, f.ced, f.phone, f.phoneDigits, ts);
  const id = Number(r.lastInsertRowid);
  db.prepare('UPDATE walkins SET code = ? WHERE id = ?').run('D' + String(id).padStart(5, '0'), id);
  return id;
}

export function getWalkin(db, id) {
  const t = D.today();
  const w = getWalkinRow(db, id);
  const lastMonth = db
    .prepare("SELECT COUNT(*) AS n FROM payments WHERE walkin_id = ? AND kind = 'daypass' AND created_at >= ? AND created_at < ?")
    .get(w.id, D.addMonths(D.monthStart(t), -1), D.monthStart(t)).n;
  const payments = db
    .prepare(
      `SELECT id, kind, amount_cents, method, created_at FROM payments
       WHERE walkin_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`
    )
    .all(w.id);
  return { ...walkinView(db, w, t), visits_last_month: lastMonth, payments };
}

export function listWalkins(db, { q = '' } = {}) {
  const t = D.today();
  const query = clean(q, 60).toLowerCase();
  const qDigits = digits(q);
  return db
    .prepare('SELECT * FROM walkins WHERE member_id IS NULL')
    .all()
    .map((w) => walkinView(db, w, t))
    .filter(
      (w) =>
        !query ||
        w.name.toLowerCase().includes(query) ||
        w.code.toLowerCase().includes(query) ||
        (qDigits.length >= 3 && (digits(w.cedula).includes(qDigits) || digits(w.phone).includes(qDigits)))
    )
    .sort(
      (a, b) =>
        b.visits_this_month - a.visits_this_month ||
        (b.last_visit ?? '').localeCompare(a.last_visit ?? '') ||
        a.name.localeCompare(b.name)
    );
}

export function updateWalkin(db, id, body = {}) {
  const w = getWalkinRow(db, id);
  const f = walkinFields(db, body, w.id);
  db.prepare('UPDATE walkins SET name = ?, cedula = ?, cedula_digits = ?, phone = ?, phone_digits = ? WHERE id = ?').run(
    f.name,
    f.cedula,
    f.ced,
    f.phone,
    f.phoneDigits,
    w.id
  );
  return getWalkin(db, w.id);
}

// Volvió el mismo día: ya pagó su pase, entra sin cobrar.
export function walkinReentry(db, id) {
  const t = D.today();
  const w = getWalkinRow(db, id);
  const view = walkinView(db, w, t);
  if (!view.paid_today_at) throw new HttpError(400, 'Este cliente no ha pagado su pase de hoy');
  const payment = db
    .prepare("SELECT id FROM payments WHERE walkin_id = ? AND kind = 'daypass' AND created_at >= ? ORDER BY created_at DESC")
    .get(w.id, t);
  db.prepare(
    "INSERT INTO checkins (kind, walkin_id, payment_id, name, created_at) VALUES ('daypass', ?, ?, ?, ?)"
  ).run(w.id, payment.id, w.name, D.now());
  return walkinView(db, w, t);
}

// Busca sin registrar nada: para avisar en el formulario si ya existe.
export function lookup(db, query) {
  if (!clean(query)) return { type: null };
  const s = getSettings(db);
  const t = D.today();
  const m = findMember(db, query);
  if (m) return { type: 'member', member: memberView(m, s, t) };
  const w = findWalkin(db, query);
  if (w) return { type: 'walkin', walkin: walkinView(db, w, t) };
  return { type: null };
}

// ---------- Miembros ----------

export function getMember(db, id) {
  const s = getSettings(db);
  const t = D.today();
  const m = getMemberRow(db, id);
  const payments = db
    .prepare(
      `SELECT p.id, p.kind, p.amount_cents, p.method, p.period_start, p.period_end, p.created_at, pl.name AS plan_name
       FROM payments p LEFT JOIN plans pl ON pl.id = p.plan_id
       WHERE p.member_id = ? ORDER BY p.created_at DESC, p.id DESC LIMIT 12`
    )
    .all(m.id);
  const memberships = payments.filter((p) => p.kind === 'membership');
  const onTime = memberships.filter(
    (p) => p.created_at.slice(0, 10) <= D.addDays(p.period_start, s.grace_days)
  ).length;
  const lastMonthStart = D.addMonths(D.monthStart(t), -1);
  return {
    ...memberView(m, s, t),
    visits_this_month: visitsSince(db, m.id, D.monthStart(t)),
    visits_last_month:
      visitsSince(db, m.id, lastMonthStart) - visitsSince(db, m.id, D.monthStart(t)),
    payments_on_time: onTime,
    payments_total: memberships.length,
    payments,
  };
}

export function listMembers(db, { status = 'all', q = '' } = {}) {
  const s = getSettings(db);
  const t = D.today();
  const query = clean(q, 60).toLowerCase();
  const qDigits = digits(q);
  return db
    .prepare(MEMBER_SELECT)
    .all()
    .map((m) => memberView(m, s, t))
    .filter((m) => {
      if (status === 'action') return ACTION_STATUSES.includes(m.status.key);
      if (status in STATUS_LABELS) return m.status.key === status;
      return m.status.key !== 'inactive';
    })
    .filter((m) => {
      if (!query) return true;
      return (
        m.name.toLowerCase().includes(query) ||
        (m.code ?? '').toLowerCase().includes(query) ||
        (qDigits.length >= 3 && digits(m.cedula).includes(qDigits))
      );
    })
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status.key] - STATUS_ORDER[b.status.key] ||
        a.due_date.localeCompare(b.due_date) ||
        a.name.localeCompare(b.name)
    );
}

function memberIdentity(db, body, currentId = null) {
  const name = clean(body.name);
  const cedula = clean(body.cedula, 30);
  const ced = digits(cedula);
  const phone = clean(body.phone, 30);
  if (!name) throw new HttpError(400, 'Escribe el nombre del miembro');
  if (ced.length < 5) throw new HttpError(400, 'Escribe una cédula válida');
  const existing = db.prepare('SELECT id, name FROM members WHERE cedula_digits = ?').get(ced);
  if (existing && existing.id !== currentId) {
    throw new HttpError(409, `Ya hay un miembro con esa cédula: ${existing.name}`);
  }
  return { name, cedula, ced, phone };
}

export function createMember(db, body = {}) {
  const t = D.today();
  const { name, cedula, ced, phone } = memberIdentity(db, body);
  const plan = getPlan(db, body.plan_id);
  const method = requireMethod(body.method);
  const start = body.start_date || t;
  if (!D.isDateStr(start)) throw new HttpError(400, 'Fecha de inicio inválida');
  const due = D.addMonths(start, plan.months);
  const ts = D.now();

  const id = tx(db, () => {
    const r = db
      .prepare(
        `INSERT INTO members (name, cedula, cedula_digits, phone, plan_id, start_date, due_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(name, cedula, ced, phone, plan.id, start, due, ts);
    const memberId = Number(r.lastInsertRowid);
    db.prepare('UPDATE members SET code = ? WHERE id = ?').run('M' + String(memberId).padStart(5, '0'), memberId);
    db.prepare(
      `INSERT INTO payments (kind, member_id, plan_id, amount_cents, method, period_start, period_end, payer_name, created_at)
       VALUES ('membership', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(memberId, plan.id, plan.price_cents, method, start, due, name, ts);
    if (body.checkin) insertMemberCheckin(db, { id: memberId, name }, ts);
    // Si era cliente de pase diario, queda convertido (su QR "D" deja de usarse).
    db.prepare('UPDATE walkins SET member_id = ? WHERE member_id IS NULL AND (id = ? OR cedula_digits = ?)').run(
      memberId,
      Number(body.walkin_id) || 0,
      ced
    );
    return memberId;
  });
  return getMember(db, id);
}

export function updateMember(db, id, body = {}) {
  const m = getMemberRow(db, id);
  const { name, cedula, ced, phone } = memberIdentity(db, body, m.id);
  db.prepare('UPDATE members SET name = ?, cedula = ?, cedula_digits = ?, phone = ? WHERE id = ?').run(
    name,
    cedula,
    ced,
    phone,
    m.id
  );
  return getMember(db, m.id);
}

export function renewalPreview(db, id, planId) {
  const s = getSettings(db);
  const m = getMemberRow(db, id);
  const plan = getPlan(db, planId);
  const start = renewalStart(m.due_date, D.today(), s);
  return {
    plan_id: plan.id,
    start,
    end: D.addMonths(start, plan.months),
    amount_cents: plan.price_cents,
    from_due: start === m.due_date,
  };
}

export function renew(db, id, body = {}) {
  const method = requireMethod(body.method);
  const preview = renewalPreview(db, id, body.plan_id);
  const m = getMemberRow(db, id);
  const ts = D.now();
  tx(db, () => {
    db.prepare('UPDATE members SET plan_id = ?, due_date = ? WHERE id = ?').run(preview.plan_id, preview.end, m.id);
    db.prepare(
      `INSERT INTO payments (kind, member_id, plan_id, amount_cents, method, period_start, period_end, payer_name, created_at)
       VALUES ('membership', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(m.id, preview.plan_id, preview.amount_cents, method, preview.start, preview.end, m.name, ts);
    if (body.checkin && !recentCheckin(db, m.id)) insertMemberCheckin(db, m, ts);
  });
  return { member: getMember(db, m.id), period: preview };
}

export function markReminded(db, id) {
  const m = getMemberRow(db, id);
  db.prepare('UPDATE members SET last_reminder_at = ? WHERE id = ?').run(D.now(), m.id);
  return memberView(getMemberRow(db, m.id), getSettings(db), D.today());
}

// ---------- Resúmenes ----------

export function billingSummary(db) {
  const s = getSettings(db);
  const t = D.today();
  const members = db.prepare(MEMBER_SELECT).all().map((m) => memberView(m, s, t));
  const counts = { ok: 0, soon: 0, grace: 0, late: 0, inactive: 0 };
  for (const m of members) counts[m.status.key]++;

  const from = D.monthStart(t);
  const collected = db
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS total FROM payments WHERE kind = 'membership' AND created_at >= ?"
    )
    .get(from);
  const end = D.monthEnd(t);
  const pending = members.filter((m) => m.status.key !== 'inactive' && m.due_date <= end);
  const pendingCents = pending.reduce((sum, m) => sum + m.plan_price_cents, 0);

  return {
    counts,
    all: members.length - counts.inactive,
    action: counts.soon + counts.grace + counts.late,
    collected_cents: collected.total,
    collected_count: collected.n,
    expected_cents: collected.total + pendingCents,
    pending_count: pending.length,
  };
}

// Promedio de entradas por hora del día, usando solo días que tuvieron movimiento.
function hourlyAverages(db, from, to) {
  const days = db
    .prepare('SELECT COUNT(DISTINCT substr(created_at, 1, 10)) AS n FROM checkins WHERE created_at >= ? AND created_at < ?')
    .get(from, to).n;
  const avg = new Array(24).fill(0);
  if (!days) return { avg, days };
  const rows = db
    .prepare(
      `SELECT CAST(substr(created_at, 12, 2) AS INTEGER) AS h, COUNT(*) AS n
       FROM checkins WHERE created_at >= ? AND created_at < ? GROUP BY h`
    )
    .all(from, to);
  for (const r of rows) avg[r.h] = r.n / days;
  return { avg, days };
}

function trafficLevel(value, max) {
  const r = max ? value / max : 0;
  if (r >= 0.8) return 'Pico';
  if (r >= 0.5) return 'Alta';
  if (r >= 0.25) return 'Media';
  return 'Baja';
}

export function todaySummary(db) {
  const s = getSettings(db);
  const nowDate = new Date();
  const t = D.toDateStr(nowDate);
  const since = D.toDateTimeStr(new Date(nowDate.getTime() - s.stay_minutes * 60000));

  const insideNow = db.prepare('SELECT COUNT(*) AS n FROM checkins WHERE created_at >= ?').get(since).n;
  const entries = { member: 0, daypass: 0 };
  for (const r of db.prepare('SELECT kind, COUNT(*) AS n FROM checkins WHERE created_at >= ? GROUP BY kind').all(t)) {
    entries[r.kind] = r.n;
  }

  const daypass = { count: 0, total_cents: 0, by_method: [] };
  const membership = { count: 0, total_cents: 0 };
  const payRows = db
    .prepare(
      `SELECT kind, method, COUNT(*) AS n, SUM(amount_cents) AS total
       FROM payments WHERE created_at >= ? GROUP BY kind, method ORDER BY total DESC`
    )
    .all(t);
  for (const r of payRows) {
    const bucket = r.kind === 'daypass' ? daypass : membership;
    bucket.count += r.n;
    bucket.total_cents += r.total;
    if (r.kind === 'daypass') daypass.by_method.push({ method: r.method, total_cents: r.total });
  }

  const { avg, days } = hourlyAverages(db, D.addDays(t, -28), t);
  const max = Math.max(...avg);
  const forecast = [];
  for (let h = nowDate.getHours() + 1; h <= Math.min(23, nowDate.getHours() + 3); h++) {
    forecast.push({ hour: h, avg: Math.round(avg[h]), ratio: max ? avg[h] / max : 0, level: trafficLevel(avg[h], max) });
  }

  const recent = db
    .prepare(
      `SELECT id, kind, member_id, name, created_at FROM checkins
       WHERE created_at >= ? ORDER BY created_at DESC, id DESC LIMIT 8`
    )
    .all(t);

  return {
    inside_now: insideNow,
    capacity: s.capacity,
    entries: { ...entries, total: entries.member + entries.daypass },
    daypass,
    membership,
    forecast,
    has_history: days > 0,
    recent,
  };
}

export function reports(db) {
  const t = D.today();
  const firstMonth = D.addMonths(D.monthStart(t), -5);
  const months = [];
  for (let i = 0; i < 6; i++) {
    months.push({ ym: D.addMonths(firstMonth, i).slice(0, 7), membership_cents: 0, daypass_cents: 0, membership_count: 0, daypass_count: 0 });
  }
  const byYm = Object.fromEntries(months.map((m) => [m.ym, m]));
  const rows = db
    .prepare(
      `SELECT substr(created_at, 1, 7) AS ym, kind, COUNT(*) AS n, SUM(amount_cents) AS total
       FROM payments WHERE created_at >= ? GROUP BY ym, kind`
    )
    .all(firstMonth);
  for (const r of rows) {
    const m = byYm[r.ym];
    if (!m) continue;
    m[`${r.kind}_cents`] = r.total;
    m[`${r.kind}_count`] = r.n;
  }

  // Mapa de calor de los últimos 30 días (sin contar hoy, que va a medias).
  const from = D.addDays(t, -30);
  const dayRows = db
    .prepare('SELECT DISTINCT substr(created_at, 1, 10) AS d FROM checkins WHERE created_at >= ? AND created_at < ?')
    .all(from, t);
  const weekdayDays = new Array(7).fill(0);
  for (const r of dayRows) weekdayDays[D.parseDate(r.d).getDay()]++;
  const cells = db
    .prepare(
      `SELECT CAST(strftime('%w', created_at) AS INTEGER) AS wd, CAST(substr(created_at, 12, 2) AS INTEGER) AS h, COUNT(*) AS n
       FROM checkins WHERE created_at >= ? AND created_at < ? GROUP BY wd, h`
    )
    .all(from, t);
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const c of cells) heat[c.wd][c.h] = weekdayDays[c.wd] ? c.n / weekdayDays[c.wd] : 0;

  const { avg, days } = hourlyAverages(db, from, t);
  const usedHours = avg.map((v, h) => (v > 0 ? h : -1)).filter((h) => h >= 0);
  const firstHour = usedHours.length ? usedHours[0] : 6;
  const lastHour = usedHours.length ? usedHours[usedHours.length - 1] : 21;
  let peak = null;
  let quiet = null;
  for (const h of usedHours) {
    if (!peak || avg[h] > avg[peak.hour]) peak = { hour: h, avg: avg[h] };
    if (!quiet || avg[h] < avg[quiet.hour]) quiet = { hour: h, avg: avg[h] };
  }

  const ms = D.monthStart(t);
  const entriesMonth = db.prepare('SELECT COUNT(*) AS n FROM checkins WHERE created_at >= ?').get(ms).n;
  const billing = billingSummary(db);

  return {
    months,
    current: months[months.length - 1],
    entries_this_month: entriesMonth,
    active_members: billing.counts.ok + billing.counts.soon + billing.counts.grace,
    days_with_data: days,
    hours: { first: firstHour, last: lastHour, avg },
    peak,
    quiet,
    heat, // heat[díaDeLaSemana 0=domingo][hora]
  };
}
