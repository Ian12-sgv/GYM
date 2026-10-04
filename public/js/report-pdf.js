// Genera y descarga un PDF con los datos del momento: resumen, hoy, ingresos, afluencia,
// mensualidades y listas para actuar. Usa jsPDF (se carga solo al pedir el PDF).
import { api } from './api.js';
import { store, money, fmtDay, fmtMonth, fmtMonthLong, dueText, todayStr } from './ui.js';

const INK = '#15171C';
const MUTED = '#5B606B';
const LINE = '#E2E0DA';
const BLUE = '#2B4FC7';
const ORANGE = '#F08A24';
const LIME = '#C8F04A';
const HEAT = ['#EEF1F8', '#C9D3F0', '#93A7E3', '#5875CF', '#2B4FC7', '#1A2F80'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LETTER = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const PAGE_W = 210;
const PAGE_H = 297;
const M = 15; // margen
const W = PAGE_W - M * 2;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('No se pudo cargar el generador de PDF'));
    document.head.append(s);
  });
}

async function loadJsPdf() {
  if (!window.jspdf) await loadScript('/vendor/jspdf.umd.min.js');
  if (!window.autoTable) await loadScript('/vendor/jspdf.plugin.autotable.min.js');
  return { jsPDF: window.jspdf.jsPDF, autoTable: window.autoTable };
}

const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const pct = (part, total) => (total ? Math.round((part / total) * 100) : 0);

export async function downloadReportPdf() {
  const [{ jsPDF, autoTable }, r, today, billing, action, walkins] = await Promise.all([
    loadJsPdf(),
    api('/reports'),
    api('/today'),
    api('/billing'),
    api('/members?status=action'),
    api('/walkins'),
  ]);
  const s = store.config.settings;
  const now = new Date();
  const stamp = `${DAYS[now.getDay()]} ${fmtDay(todayStr())} ${now.getFullYear()} · ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 0;

  const text = (str, x, yy, { size = 10, bold = false, fill = INK, align = 'left' } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(fill);
    doc.text(String(str), x, yy, { align });
  };
  const ensure = (needed) => {
    if (y + needed > PAGE_H - 18) {
      doc.addPage();
      y = 18;
    }
  };
  const section = (title, subtitle, needed = 0) => {
    ensure(22 + needed);
    y += 4;
    text(title, M, y, { size: 13, bold: true });
    if (subtitle) text(subtitle, M, y + 5, { size: 8.5, fill: MUTED });
    y += subtitle ? 10 : 6;
  };
  const kpis = (items) => {
    const gap = 4;
    const bw = (W - gap * (items.length - 1)) / items.length;
    ensure(29);
    items.forEach(([label, value, sub], i) => {
      const x = M + i * (bw + gap);
      doc.setDrawColor(LINE);
      doc.setFillColor('#FFFFFF');
      doc.roundedRect(x, y, bw, 25, 2, 2, 'FD');
      text(label, x + 3.5, y + 6, { size: 8, fill: MUTED });
      text(value, x + 3.5, y + 13.5, { size: 15, bold: true });
      if (sub) {
        doc.setFontSize(7.5);
        doc.splitTextToSize(sub, bw - 7).slice(0, 2).forEach((line, j) => text(line, x + 3.5, y + 18.5 + j * 3.3, { size: 7.5, fill: MUTED }));
      }
    });
    y += 29;
  };

  // ---------- Encabezado ----------
  doc.setFillColor(INK);
  doc.rect(0, 0, PAGE_W, 30, 'F');
  doc.setFillColor(LIME);
  doc.rect(0, 30, PAGE_W, 1.2, 'F');
  text(s.gym_name, M, 14, { size: 20, bold: true, fill: '#FFFFFF' });
  text('Reporte del gimnasio', M, 22, { size: 10, fill: LIME });
  text('Generado el', PAGE_W - M, 14, { size: 8, fill: '#B9BDC6', align: 'right' });
  text(stamp, PAGE_W - M, 20, { size: 10, bold: true, fill: '#FFFFFF', align: 'right' });
  y = 40;

  // ---------- Resumen del mes ----------
  const cur = r.current;
  const monthTotal = cur.membership_cents + cur.daypass_cents;
  section(`Resumen de ${fmtMonthLong(cur.ym)}`, '', 29);
  kpis([
    ['Ingresos del mes', money(monthTotal), 'Membresías + pases diarios'],
    ['Membresías', money(cur.membership_cents), `${pct(cur.membership_cents, monthTotal)}% · ${cur.membership_count} pagos`],
    ['Pases diarios', money(cur.daypass_cents), `${pct(cur.daypass_cents, monthTotal)}% · ${cur.daypass_count} visitas`],
    ['Entradas del mes', String(r.entries_this_month), `${r.active_members} miembros activos`],
  ]);

  // ---------- Hoy ----------
  section('Hoy', 'Datos al momento de generar el reporte', 29);
  kpis([
    ['Entradas hoy', String(today.entries.total), `${today.entries.member} membresía · ${today.entries.daypass} pase diario`],
    ['Cobrado hoy', money(today.daypass.total_cents + today.membership.total_cents), `Pases ${money(today.daypass.total_cents)} · Mensualidades ${money(today.membership.total_cents)}`],
    ['En el gym ahora', `${today.inside_now} / ${today.capacity}`, `Entradas de los últimos ${s.stay_minutes} min`],
  ]);

  // ---------- Ingresos 6 meses ----------
  section('Ingresos por tipo de cliente', 'Últimos 6 meses', 72);
  const chartH = 50;
  const maxMonth = Math.max(1, ...r.months.map((m) => m.membership_cents + m.daypass_cents));
  const slot = W / r.months.length;
  const bw = Math.min(16, slot * 0.55);
  const base = y + chartH + 6;
  doc.setDrawColor(LINE);
  doc.line(M, base, M + W, base);
  r.months.forEach((m, i) => {
    const total = m.membership_cents + m.daypass_cents;
    const x = M + i * slot + (slot - bw) / 2;
    const hm = (m.membership_cents / maxMonth) * chartH;
    const hd = (m.daypass_cents / maxMonth) * chartH;
    doc.setFillColor(BLUE);
    if (hm) doc.rect(x, base - hm, bw, hm, 'F');
    doc.setFillColor(ORANGE);
    if (hd) doc.rect(x, base - hm - hd, bw, hd, 'F');
    if (total) text(money(total), x + bw / 2, base - hm - hd - 2, { size: 7.5, fill: MUTED, align: 'center' });
    text(fmtMonth(m.ym), x + bw / 2, base + 5, { size: 8.5, fill: MUTED, align: 'center' });
  });
  // leyenda
  doc.setFillColor(BLUE);
  doc.rect(M + W - 62, y - 2.5, 3, 3, 'F');
  text('Membresía', M + W - 57.5, y, { size: 8, fill: MUTED });
  doc.setFillColor(ORANGE);
  doc.rect(M + W - 30, y - 2.5, 3, 3, 'F');
  text('Pase diario', M + W - 25.5, y, { size: 8, fill: MUTED });
  y = base + 10;

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Mes', 'Membresías', 'Pases diarios', 'Total', '% membresías']],
    body: r.months.map((m) => {
      const total = m.membership_cents + m.daypass_cents;
      return [fmtMonthLong(m.ym), money(m.membership_cents), money(m.daypass_cents), money(total), `${pct(m.membership_cents, total)}%`];
    }),
    styles: { fontSize: 8.5, cellPadding: 1.8, textColor: INK },
    headStyles: { fillColor: INK, textColor: '#FFFFFF' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right', fontStyle: 'bold' }, 4: { halign: 'right' } },
    alternateRowStyles: { fillColor: '#F6F5F1' },
  });
  y = doc.lastAutoTable.finalY + 6;

  // ---------- Afluencia ----------
  section('Afluencia por hora', 'Promedio de entradas por día · últimos 30 días', 52);
  if (r.days_with_data === 0) {
    text('Aún no hay entradas registradas para calcular las horas pico.', M, y + 2, { size: 9, fill: MUTED });
    y += 8;
  } else {
    if (r.peak) {
      text(`Hora pico: ${hh(r.peak.hour)} (~${Math.round(r.peak.avg)} entradas)    Más tranquila: ${hh(r.quiet.hour)} (~${Math.round(r.quiet.avg)})`, M, y, { size: 9, bold: true });
      y += 4;
    }
    const hours = [];
    for (let h = r.hours.first; h <= r.hours.last; h++) hours.push(h);
    const maxH = Math.max(1e-9, ...hours.map((h) => r.hours.avg[h]));
    const hSlot = W / hours.length;
    const hBw = hSlot * 0.7;
    const hBase = y + 38;
    doc.setDrawColor(LINE);
    doc.line(M, hBase, M + W, hBase);
    hours.forEach((h, i) => {
      const v = r.hours.avg[h];
      const bh = (v / maxH) * 32;
      const x = M + i * hSlot + (hSlot - hBw) / 2;
      doc.setFillColor(v / maxH >= 0.8 ? '#7FA30F' : '#9AA1B0');
      if (bh) doc.rect(x, hBase - bh, hBw, bh, 'F');
      if (v >= 0.5) text(String(Math.round(v)), x + hBw / 2, hBase - bh - 1.5, { size: 7, fill: MUTED, align: 'center' });
      text(String(h), x + hBw / 2, hBase + 4.5, { size: 7.5, fill: MUTED, align: 'center' });
    });
    y = hBase + 10;

    // Mapa de calor
    const cellH = 4.2;
    section('Mapa de calor', 'Entradas promedio por día de la semana y hora', hours.length * (cellH + 0.8) + 6);
    const labelW = 14;
    const cellW = Math.min(18, (W - labelW) / 7 - 1);
    DAY_ORDER.forEach((d, i) => text(DAY_LETTER[d], M + labelW + i * (cellW + 1) + cellW / 2, y, { size: 8, bold: true, fill: MUTED, align: 'center' }));
    y += 2;
    const maxHeat = Math.max(1e-9, ...r.heat.flat());
    hours.forEach((h) => {
      text(hh(h), M, y + cellH - 0.8, { size: 7, fill: MUTED });
      DAY_ORDER.forEach((d, i) => {
        const v = r.heat[d][h];
        doc.setFillColor(HEAT[v <= 0 ? 0 : Math.min(5, 1 + Math.floor((v / maxHeat) * 4.999))]);
        doc.roundedRect(M + labelW + i * (cellW + 1), y, cellW, cellH, 0.8, 0.8, 'F');
      });
      y += cellH + 0.8;
    });
    y += 4;
  }

  // ---------- Mensualidades ----------
  section('Mensualidades', `Cobrado en ${fmtMonthLong(cur.ym)}: ${money(billing.collected_cents)} de ${money(billing.expected_cents)} esperados (${pct(billing.collected_cents, billing.expected_cents)}%)`, 29);
  kpis([
    ['Al día', String(billing.counts.ok), 'Pueden entrar'],
    ['Por vencer', String(billing.counts.soon), `En ${s.soon_days} días o menos`],
    ['En gracia', String(billing.counts.grace), 'Vencidas, aún entran'],
    ['Vencidas', String(billing.counts.late), 'No entran hasta renovar'],
    ['Inactivos', String(billing.counts.inactive), `Más de ${s.inactive_days} días`],
  ]);

  // ---------- Listas para actuar ----------
  section(`Miembros que requieren acción (${action.length})`, 'Por vencer, en gracia o vencidas: a quienes hay que recordarles o cobrarles', 24);
  if (action.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [['Miembro', 'Código', 'Plan', 'Vence', 'Estado', 'Teléfono']],
      body: action.map((m) => [m.name, m.code, m.plan_name, `${fmtDay(m.due_date)} (${dueText(m.status)})`, m.status.label, m.phone || '-']),
      styles: { fontSize: 8, cellPadding: 1.6, textColor: INK },
      headStyles: { fillColor: INK, textColor: '#FFFFFF' },
      alternateRowStyles: { fillColor: '#F6F5F1' },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 4) {
          data.cell.styles.textColor = { Vencida: '#B42318', 'En gracia': '#B54708', 'Por vencer': '#8A6100' }[data.cell.raw] ?? INK;
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
    y = doc.lastAutoTable.finalY + 6;
  } else {
    text('Nadie requiere acción: todos los miembros están al día.', M, y + 2, { size: 9, fill: MUTED });
    y += 8;
  }

  const monthly = store.config.plans.find((p) => p.active && p.months === 1);
  // Hasta 12 clientes, sin dejar filas sueltas en otra página.
  const ROW_H = 6.3;
  section('Clientes de pase diario más frecuentes', monthly ? `Este mes · la mensualidad cuesta ${money(monthly.price_cents)}` : 'Este mes', 8 + 5 * ROW_H);
  const fit = Math.floor((PAGE_H - 18 - y - 8) / ROW_H);
  const frequent = walkins.filter((w) => w.visits_this_month > 0).slice(0, Math.min(12, Math.max(5, fit)));
  if (frequent.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [['Cliente', 'Código', 'Visitas', 'Pagado', 'Sugerencia']],
      body: frequent.map((w) => [
        w.name,
        w.code,
        String(w.visits_this_month),
        money(w.spent_this_month_cents),
        monthly && w.spent_this_month_cents >= monthly.price_cents ? 'Le conviene la mensualidad' : '',
      ]),
      styles: { fontSize: 8, cellPadding: 1.6, textColor: INK },
      headStyles: { fillColor: INK, textColor: '#FFFFFF' },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { textColor: '#B54708', fontStyle: 'bold' } },
      alternateRowStyles: { fillColor: '#F6F5F1' },
    });
  } else {
    text('Todavía no hay clientes de pase diario registrados este mes.', M, y + 2, { size: 9, fill: MUTED });
  }

  // ---------- Pie de página ----------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(LINE);
    doc.line(M, PAGE_H - 12, PAGE_W - M, PAGE_H - 12);
    text(`${s.gym_name} · Reporte generado el ${stamp}`, M, PAGE_H - 7, { size: 7.5, fill: MUTED });
    text(`Página ${p} de ${pages}`, PAGE_W - M, PAGE_H - 7, { size: 7.5, fill: MUTED, align: 'right' });
  }

  const filename = `reporte-${s.gym_name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'gimnasio'}-${todayStr()}.pdf`;
  doc.save(filename);
  return filename;
}
