import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getSettings } from '../src/db.js';
import * as svc from '../src/service.js';
import * as D from '../src/dates.js';

const S = { soon_days: 5, grace_days: 3, inactive_days: 30, late_window_days: 15 };
const T = '2026-10-03';

function freshDb() {
  return openDb(':memory:');
}

function newMember(db, overrides = {}) {
  return svc.createMember(db, {
    name: 'Luis Pérez',
    cedula: 'V-18.442.901',
    phone: '0414-555-0192',
    plan_id: 1,
    method: 'Pago móvil',
    ...overrides,
  });
}

function setDue(db, id, due) {
  db.prepare('UPDATE members SET due_date = ? WHERE id = ?').run(due, id);
}

test('addMonths respeta fin de mes', () => {
  assert.equal(D.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(D.addMonths('2026-09-29', 1), '2026-10-29');
  assert.equal(D.addMonths('2026-11-15', 3), '2027-02-15');
});

test('estados de membresía según días al corte', () => {
  const st = (due) => svc.membershipStatus(due, T, S);
  assert.equal(st('2026-10-20').key, 'ok');
  assert.equal(st('2026-10-08').key, 'soon');
  assert.equal(st('2026-10-03').key, 'soon'); // vence hoy, todavía entra
  assert.equal(st('2026-09-30').key, 'grace');
  assert.equal(st('2026-09-30').allowed, true);
  assert.equal(st('2026-09-29').key, 'late'); // el caso de Luis: 4 días tarde
  assert.equal(st('2026-09-29').allowed, false);
  assert.equal(st('2026-08-01').key, 'inactive');
});

test('la renovación arranca en el día de corte si renueva a tiempo', () => {
  assert.equal(svc.renewalStart('2026-09-29', T, S), '2026-09-29');
  assert.equal(svc.renewalStart('2026-10-20', T, S), '2026-10-20'); // renovación adelantada
  assert.equal(svc.renewalStart('2026-08-01', T, S), T); // volvió después de mucho: arranca hoy
});

test('inscribir genera código, pago y entrada', () => {
  const db = freshDb();
  const m = newMember(db, { checkin: true });
  assert.equal(m.code, 'M00001');
  assert.equal(m.payments.length, 1);
  assert.equal(m.payments[0].amount_cents, 2500);
  assert.equal(m.visits_this_month, 1);
  assert.equal(m.due_date, D.addMonths(D.today(), 1));
});

test('no permite cédulas repetidas', () => {
  const db = freshDb();
  newMember(db);
  assert.throws(() => newMember(db, { cedula: '18442901' }), { status: 409 });
});

test('entrada por cédula o código, con y sin membresía vigente', () => {
  const db = freshDb();
  const m = newMember(db);
  assert.equal(svc.checkIn(db, '18.442.901').result, 'allowed');
  assert.equal(svc.checkIn(db, 'm00001').duplicate, true); // escaneo repetido no duplica

  setDue(db, m.id, D.addDays(D.today(), -10));
  const denied = svc.checkIn(db, 'M00001');
  assert.equal(denied.result, 'denied');
  assert.equal(denied.member.status.key, 'late');

  assert.equal(svc.checkIn(db, '99999999').result, 'not_found');
});

test('renovar vencida extiende desde el corte y registra la entrada', () => {
  const db = freshDb();
  const m = newMember(db);
  const due = D.addDays(D.today(), -4);
  setDue(db, m.id, due);
  const r = svc.renew(db, m.id, { plan_id: 1, method: 'Efectivo', checkin: true });
  assert.equal(r.period.start, due);
  assert.equal(r.member.due_date, D.addMonths(due, 1));
  assert.equal(r.member.status.allowed, true);
  assert.equal(r.member.visits_this_month, 1);
});

test('pase diario cobra el precio configurado y cuenta visitas por teléfono', () => {
  const db = freshDb();
  svc.sellDayPass(db, { name: 'Ana Rojas', phone: '0412-555-0147', method: 'Divisas' });
  const r = svc.sellDayPass(db, { name: 'Ana Rojas', phone: '04125550147', method: 'Efectivo' });
  assert.equal(r.amount_cents, getSettings(db).daypass_price_cents);
  assert.deepEqual(r.history, { visits: 2, total_cents: 1000 });
  assert.throws(() => svc.sellDayPass(db, { name: 'X', method: 'Bitcoin' }), { status: 400 });
});

test('cliente de pase diario: se registra una vez y luego se cobra con su código', () => {
  const db = freshDb();
  const first = svc.sellDayPass(db, { name: 'Ana Rojas', cedula: 'V-28.310.775', phone: '0412-555-0147', method: 'Efectivo', save: true });
  assert.equal(first.walkin.code, 'D00001');

  // La próxima vez se encuentra por código, cédula o teléfono, sin pedir datos
  for (const q of ['d00001', '28310775', '0412-555-0147']) {
    const r = svc.checkIn(db, q);
    assert.equal(r.result, 'walkin', q);
    assert.equal(r.walkin.name, 'Ana Rojas');
  }
  assert.ok(svc.checkIn(db, 'D00001').walkin.paid_today_at);

  // Volvió el mismo día: entra sin cobrar
  const again = svc.walkinReentry(db, first.walkin.id);
  assert.equal(again.visits_this_month, 1);
  assert.equal(svc.todaySummary(db).entries.daypass, 2);
  assert.equal(svc.todaySummary(db).daypass.count, 1);

  const second = svc.sellDayPass(db, { walkin_id: first.walkin.id, method: 'Divisas' });
  assert.deepEqual(second.history, { visits: 2, total_cents: 1000 });
});

test('cliente de pase diario: no se duplica y se convierte en miembro', () => {
  const db = freshDb();
  const { walkin } = svc.sellDayPass(db, { name: 'Ana Rojas', cedula: '28310775', method: 'Efectivo', save: true });
  assert.throws(
    () => svc.sellDayPass(db, { name: 'Otra', cedula: 'V-28.310.775', method: 'Efectivo', save: true }),
    { status: 409 }
  );
  assert.throws(() => svc.walkinReentry(db, 999), { status: 404 });

  const m = newMember(db, { name: 'Ana Rojas', cedula: '28310775' });
  assert.equal(svc.checkIn(db, '28310775').result, 'allowed'); // ahora entra como miembro
  assert.equal(svc.checkIn(db, walkin.code).result, 'not_found'); // su QR viejo ya no se usa
  assert.equal(svc.listWalkins(db).length, 0);
  assert.equal(m.code, 'M00001');
  assert.throws(
    () => svc.sellDayPass(db, { name: 'Ana', cedula: '28310775', method: 'Efectivo', save: true }),
    /miembro/
  );
});

test('resumen de cobranza y del día', () => {
  const db = freshDb();
  newMember(db, { checkin: true });
  svc.sellDayPass(db, { name: 'Ana', method: 'Efectivo' });
  const b = svc.billingSummary(db);
  assert.equal(b.collected_cents, 2500);
  const today = svc.todaySummary(db);
  assert.equal(today.entries.total, 2);
  assert.equal(today.inside_now, 2);
  assert.equal(today.daypass.total_cents + today.membership.total_cents, 3000);
});

test('ajustes validan valores', () => {
  const db = freshDb();
  assert.throws(() => svc.updateSettings(db, { grace_days: -1 }), { status: 400 });
  assert.throws(() => svc.updateSettings(db, { grace_days: 40, inactive_days: 30 }), { status: 400 });
  svc.updateSettings(db, { daypass_price_cents: 700, gym_name: 'Titán Gym' });
  assert.equal(getSettings(db).daypass_price_cents, 700);
  assert.equal(getSettings(db).gym_name, 'Titán Gym');
});
