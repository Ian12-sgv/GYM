import { api } from '../api.js';
import { html, setHTML, money, fmtMonth, fmtMonthLong, icon, toast } from '../ui.js';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LETTER = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const HEAT_RAMP = ['#1F232B', '#22305A', '#2F4A9A', '#4A6BD8', '#7C9BFF', '#C9D5FF'];
const hh = (h) => `${String(h).padStart(2, '0')}:00`;

export async function render(root) {
  const r = await api('/reports');
  const cur = r.current;
  const monthTotal = cur.membership_cents + cur.daypass_cents;
  const pct = (part) => (monthTotal ? Math.round((part / monthTotal) * 100) : 0);

  const maxMonth = Math.max(1, ...r.months.map((m) => m.membership_cents + m.daypass_cents));
  const hours = [];
  for (let h = r.hours.first; h <= r.hours.last; h++) hours.push(h);
  const maxHour = Math.max(1e-9, ...hours.map((h) => r.hours.avg[h]));
  const maxHeat = Math.max(1e-9, ...r.heat.flat());
  const heatColor = (v) => HEAT_RAMP[v <= 0 ? 0 : Math.min(5, 1 + Math.floor((v / maxHeat) * 4.999))];
  const noData = r.days_with_data === 0;

  setHTML(
    root,
    html`<div class="stack" style="gap: 20px;">
      <div class="spread" style="align-items: flex-end;">
        <div>
          <h1 class="display h1">Reportes</h1>
          <p class="subtitle">Ingresos por tipo de cliente y horas de más tráfico</p>
        </div>
        <button type="button" class="btn primary lg" id="pdf-btn">${icon('download', 20, 2)} Descargar PDF</button>
      </div>

      <div class="tiles">
        <section class="card tight">
          <div class="card-label">Ingresos de ${fmtMonthLong(cur.ym)}</div>
          <div class="display big">${money(monthTotal)}</div>
          <div class="small muted">Membresías + pases diarios</div>
        </section>
        <section class="card tight">
          <div class="card-label">Membresías</div>
          <div class="display big">${money(cur.membership_cents)} <span class="muted" style="font-size: 20px;">${pct(cur.membership_cents)}%</span></div>
          <div class="small muted">${cur.membership_count} pagos (inscripciones y renovaciones)</div>
        </section>
        <section class="card tight">
          <div class="card-label">Pases diarios</div>
          <div class="display big">${money(cur.daypass_cents)} <span class="muted" style="font-size: 20px;">${pct(cur.daypass_cents)}%</span></div>
          <div class="small muted">${cur.daypass_count} visitas</div>
        </section>
        <section class="card tight">
          <div class="card-label">Entradas este mes</div>
          <div class="display big">${r.entries_this_month}</div>
          <div class="small muted">${r.active_members} miembros activos</div>
        </section>
      </div>

      <section class="card stack">
        <div class="spread">
          <h2 style="margin: 0; font-size: 18px;">Ingresos por tipo de cliente · últimos 6 meses</h2>
          <div class="legend">
            <span><i class="swatch" style="background: var(--blue);"></i>Membresía</span>
            <span><i class="swatch" style="background: var(--orange);"></i>Pase diario</span>
          </div>
        </div>
        <div>
          <div class="bars">
            ${r.months.map((m) => {
              const total = m.membership_cents + m.daypass_cents;
              return html`<div class="bar-col" title="${fmtMonthLong(m.ym)}: membresías ${money(m.membership_cents)}, pases ${money(m.daypass_cents)}">
                <span class="bar-value">${total ? money(total) : ''}</span>
                <div class="bar-stack">
                  <div style="height: ${Math.round((m.daypass_cents / maxMonth) * 200)}px; background: var(--orange);"></div>
                  <div style="height: ${Math.round((m.membership_cents / maxMonth) * 200)}px; background: var(--blue);"></div>
                </div>
              </div>`;
            })}
          </div>
          <div class="bar-axis">${r.months.map((m) => html`<span>${fmtMonth(m.ym)}</span>`)}</div>
        </div>
      </section>

      <div class="grid-2">
        <section class="card stack">
          <div>
            <h2 style="margin: 0; font-size: 18px;">Afluencia por hora</h2>
            <div class="small muted" style="margin-top: 4px;">Promedio de entradas por día · últimos 30 días</div>
          </div>
          ${noData
            ? html`<div class="empty">Aún no hay entradas registradas para calcular las horas pico.</div>`
            : html`<div class="row">
                  ${r.peak ? html`<span class="chip" style="background: var(--text); color: var(--bg); font-size: 13px; padding: 6px 12px;">Hora pico ${hh(r.peak.hour)} · ~${Math.round(r.peak.avg)} entradas</span>` : ''}
                  ${r.quiet ? html`<span class="chip plain" style="padding: 6px 12px;">Más tranquila ${hh(r.quiet.hour)} · ~${Math.round(r.quiet.avg)}</span>` : ''}
                </div>
                <div>
                  <div class="bars hbars">
                    ${hours.map((h) => {
                      const v = r.hours.avg[h];
                      const isPeak = v / maxHour >= 0.8;
                      return html`<div class="bar-col" title="${hh(h)} · ${v.toFixed(1)} entradas promedio">
                        <span class="bar-value">${v >= 0.5 ? Math.round(v) : ''}</span>
                        <div class="bar-stack"><div style="height: ${Math.round((v / maxHour) * 160)}px; background: ${isPeak ? 'var(--accent)' : '#5A6170'}; border-radius: 4px 4px 0 0;"></div></div>
                      </div>`;
                    })}
                  </div>
                  <div class="bar-axis">${hours.map((h) => html`<span>${h % 2 === 0 ? h : ''}</span>`)}</div>
                </div>`}
        </section>

        <section class="card stack">
          <div>
            <h2 style="margin: 0; font-size: 18px;">Mapa de calor</h2>
            <div class="small muted" style="margin-top: 4px;">Entradas promedio por día de la semana y hora</div>
          </div>
          ${noData
            ? html`<div class="empty">Sin datos todavía.</div>`
            : html`<div class="heat" style="grid-template-columns: 44px repeat(7, minmax(0, 1fr));">
                  <span></span>
                  ${DAY_ORDER.map((d) => html`<span class="heat-day">${DAY_LETTER[d]}</span>`)}
                  ${hours.map(
                    (h) => html`<span class="tnum">${hh(h)}</span>
                      ${DAY_ORDER.map(
                        (d) => html`<div class="heat-cell" style="background: ${heatColor(r.heat[d][h])};" title="${DAY_LETTER[d]} ${hh(h)} · ~${r.heat[d][h].toFixed(1)} entradas"></div>`
                      )}`
                  )}
                </div>
                <div class="row small muted" style="justify-content: flex-end; gap: 4px;">
                  <span style="margin-right: 4px;">Menos</span>
                  ${HEAT_RAMP.map((c) => html`<i class="swatch" style="background: ${c}; width: 16px;"></i>`)}
                  <span style="margin-left: 4px;">Más</span>
                </div>`}
        </section>
      </div>
    </div>`
  );

  const pdfBtn = root.querySelector('#pdf-btn');
  pdfBtn.addEventListener('click', async () => {
    pdfBtn.disabled = true;
    const label = pdfBtn.innerHTML;
    pdfBtn.textContent = 'Generando PDF…';
    try {
      const { downloadReportPdf } = await import('../report-pdf.js');
      const file = await downloadReportPdf();
      toast(`Reporte descargado: ${file}`);
    } catch (err) {
      toast(err.message || 'No se pudo generar el PDF', 'error');
    } finally {
      pdfBtn.innerHTML = label;
      pdfBtn.disabled = false;
    }
  });
}
