// Panel "Renovar membresía": se usa en Entrada y en Mensualidades.
import { api } from './api.js';
import {
  store, html, setHTML, money, fmtDay, icon, optionGroup, methodButtons, activePlans, planNote, statusChip, dueText,
} from './ui.js';

export function mountRenewPanel(el, member, { onDone, onDayPass, onCancel, askCheckin = false, title = 'Renovar membresía' } = {}) {
  const plans = activePlans();
  const startPlan = plans.some((p) => p.id === member.plan_id) ? member.plan_id : plans[0]?.id;

  setHTML(
    el,
    html`<div class="stack">
      ${title ? html`<h2 class="display h2">${title}</h2>` : ''}
      <div class="row small soft">
        <strong>${member.name}</strong>
        <span>${member.plan_name} · ${dueText(member.status)}</span>
        ${statusChip(member.status)}
      </div>
      <div class="opts plans" role="group" aria-label="Plan" data-group="plan">
        ${plans.map(
          (p) => html`<button type="button" class="opt" data-value="${p.id}" aria-pressed="${String(p.id === startPlan)}">
            <span class="plan-name">${p.name}</span>
            <span class="plan-price">${money(p.price_cents)}</span>
            <span class="plan-note">${planNote(p)}</span>
          </button>`
        )}
      </div>
      <div class="hint neutral" data-period></div>
      <div class="opts" role="group" aria-label="Método de pago" data-group="method">${methodButtons()}</div>
      ${askCheckin
        ? html`<label class="check"><input type="checkbox" data-checkin> Registrar su entrada ahora</label>`
        : ''}
      <p class="form-error" role="alert" data-error></p>
      <div class="pay-row">
        <div>
          <div class="small muted">Total</div>
          <div class="display total" data-total>—</div>
        </div>
        <div class="row">
          ${onDayPass
            ? html`<button type="button" class="btn lg" data-daypass style="font-weight: 400;">Solo hoy: pase diario ${money(store.config.settings.daypass_price_cents)}</button>`
            : ''}
          ${onCancel ? html`<button type="button" class="btn lg" data-cancel style="font-weight: 400;">Cancelar</button>` : ''}
          <button type="button" class="btn primary lg" data-charge>${askCheckin ? 'Cobrar renovación' : 'Cobrar y registrar entrada'}</button>
        </div>
      </div>
    </div>`
  );

  const periodEl = el.querySelector('[data-period]');
  const totalEl = el.querySelector('[data-total]');
  const errorEl = el.querySelector('[data-error]');
  const chargeBtn = el.querySelector('[data-charge]');
  const checkinBox = el.querySelector('[data-checkin]');
  let previewSeq = 0;

  async function loadPreview(planId) {
    const seq = ++previewSeq;
    try {
      const p = await api(`/members/${member.id}/renewal?plan_id=${planId}`);
      if (seq !== previewSeq) return;
      totalEl.textContent = money(p.amount_cents, { decimals: true });
      setHTML(
        periodEl,
        html`${icon('calendar', 18, 1.8)}
          <span>Nuevo periodo: <strong>${fmtDay(p.start)} → ${fmtDay(p.end)}</strong>
          <span class="muted"> · ${p.from_due
            ? 'cuenta desde su día de corte, así no pierde ni gana días'
            : 'empieza hoy porque pasó mucho tiempo desde que venció'}</span></span>`
      );
    } catch (err) {
      errorEl.textContent = err.message;
    }
  }

  const plan = optionGroup(el.querySelector('[data-group="plan"]'), loadPreview);
  const method = optionGroup(el.querySelector('[data-group="method"]'), () => (errorEl.textContent = ''));
  if (startPlan) loadPreview(startPlan);
  else errorEl.textContent = 'No hay planes activos. Créalos en Ajustes.';

  el.querySelector('[data-daypass]')?.addEventListener('click', () => onDayPass());
  el.querySelector('[data-cancel]')?.addEventListener('click', () => onCancel());
  chargeBtn.addEventListener('click', async () => {
    if (!method.value) {
      errorEl.textContent = 'Elige el método de pago';
      return;
    }
    chargeBtn.disabled = true;
    try {
      const result = await api(`/members/${member.id}/renew`, {
        method: 'POST',
        body: { plan_id: Number(plan.value), method: method.value, checkin: checkinBox ? checkinBox.checked : true },
      });
      onDone?.(result);
    } catch (err) {
      errorEl.textContent = err.message;
      chargeBtn.disabled = false;
    }
  });
}
