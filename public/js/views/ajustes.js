import { api } from '../api.js';
import { reloadConfig } from '../config.js';
import { store, html, setHTML, toast } from '../ui.js';

const FIELDS = [
  { key: 'gym_name', label: 'Nombre del gimnasio', type: 'text' },
  { key: 'currency', label: 'Símbolo de moneda', type: 'text' },
  { key: 'capacity', label: 'Capacidad del gimnasio (personas)', type: 'int' },
  { key: 'stay_minutes', label: 'Minutos que entrena alguien en promedio', type: 'int', help: 'Se usa para estimar cuánta gente hay adentro.' },
  { key: 'soon_days', label: 'Avisar "por vencer" con estos días de anticipación', type: 'int' },
  { key: 'grace_days', label: 'Días de gracia después de vencer', type: 'int', help: 'Durante estos días todavía puede entrar.' },
  { key: 'late_window_days', label: 'Plazo para renovar desde el día de corte', type: 'int', help: 'Si renueva dentro de este plazo, el nuevo periodo arranca en su fecha de corte. Después, arranca el día que paga.' },
  { key: 'inactive_days', label: 'Días vencido para pasar a "Inactivo"', type: 'int' },
  { key: 'country_code', label: 'Código de país para WhatsApp', type: 'text', help: 'Venezuela: 58' },
];

const toCents = (v) => Math.round(Number(String(v).replace(',', '.')) * 100);
const fromCents = (c) => (c / 100).toFixed(2);

export async function render(root) {
  const draw = () => {
    const s = store.config.settings;
    setHTML(
      root,
      html`<div class="stack" style="gap: 20px;">
      <h1 class="display h1">Ajustes</h1>
      <section class="card">
        <form class="stack" id="prices-form">
          <div>
            <h2 class="display h2">Precios</h2>
            <p class="subtitle">Cambiar un precio solo aplica a los cobros nuevos: lo que ya se cobró no cambia.</p>
          </div>
          <div class="tiles" style="grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 12px;">
            ${priceField('daypass', 'Pase diario', 'Por cada día', s.daypass_price_cents)}
            ${store.config.plans
              .filter((p) => p.active)
              .map((p) => priceField(`plan-${p.id}`, p.name, p.months === 1 ? 'Mensualidad' : `Cada ${p.months} meses`, p.price_cents))}
          </div>
          <p class="form-error" role="alert" id="prices-error"></p>
          <button type="submit" class="btn primary lg" style="align-self: flex-start;">Guardar precios</button>
        </form>
      </section>
        <section class="card">
          <form class="stack" id="settings-form">
            <h2 class="display h2">Reglas y datos del gimnasio</h2>
            <div class="tiles" style="grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 16px 20px; align-items: start;">
            ${FIELDS.map(
              (f) => html`<div class="field">
                <label for="set-${f.key}">${f.label}</label>
                <input id="set-${f.key}" name="${f.key}" class="input"
                  ${f.type === 'text' ? html`type="text"` : html`type="number" min="0" step="${f.type === 'money' ? '0.01' : '1'}"`}
                  value="${f.type === 'money' ? fromCents(s[f.key]) : s[f.key]}" required>
                ${f.help ? html`<span class="small muted">${f.help}</span>` : ''}
              </div>`
            )}
            </div>
            <p class="form-error" role="alert" id="settings-error"></p>
            <button type="submit" class="btn primary lg" style="align-self: flex-start;">Guardar ajustes</button>
          </form>
        </section>
      </div>`
    );

    root.querySelector('#prices-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      const errorEl = root.querySelector('#prices-error');
      const prices = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toCents(v)]));
      if (Object.values(prices).some((c) => !Number.isInteger(c) || c < 0)) {
        errorEl.textContent = 'Revisa los montos: deben ser números de 0 en adelante';
        return;
      }
      try {
        if (prices.daypass !== s.daypass_price_cents) {
          await api('/settings', { method: 'PUT', body: { daypass_price_cents: prices.daypass } });
        }
        for (const p of store.config.plans) {
          const price = prices[`plan-${p.id}`];
          if (price === undefined || price === p.price_cents) continue;
          await api(`/plans/${p.id}`, {
            method: 'PUT',
            body: { name: p.name, months: p.months, price_cents: price, active: Boolean(p.active) },
          });
        }
        await reloadConfig();
        toast('Precios guardados');
        draw();
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });

    root.querySelector('#settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      const body = {};
      for (const f of FIELDS) {
        body[f.key] = f.type === 'money' ? toCents(data[f.key]) : f.type === 'int' ? Number(data[f.key]) : data[f.key];
      }
      try {
        await api('/settings', { method: 'PUT', body });
        await reloadConfig();
        toast('Ajustes guardados');
        draw();
      } catch (err) {
        root.querySelector('#settings-error').textContent = err.message;
      }
    });

  };

  draw();
}

function priceField(key, label, note, cents) {
  return html`<div class="field" style="background: var(--field); border-radius: 12px; padding: 12px 14px;">
    <label for="price-${key}" style="font-size: 15px; color: var(--text); font-weight: 600;">${label}</label>
    <span class="small muted">${note}</span>
    <div class="row" style="gap: 8px; flex-wrap: nowrap; margin-top: 4px;">
      <span class="display" style="font-size: 26px;">${store.config.settings.currency}</span>
      <input id="price-${key}" name="${key}" class="input" type="number" inputmode="decimal" min="0" step="0.01" value="${fromCents(cents)}" required style="font-size: 20px; font-weight: 600;">
    </div>
  </div>`;
}

