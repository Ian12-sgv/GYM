// Solo se carga en la demo publicada (window.GYM_DEMO): activa el service worker que hace
// de servidor dentro del navegador y muestra la franja "Demo".
import { api } from './api.js';

export async function startDemo(view) {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Este navegador no puede abrir la demo. Prueba con Chrome, Edge, Firefox o Safari actualizados');
  }
  view.textContent = 'Preparando la demo con datos de ejemplo…';
  await navigator.serviceWorker.register('/demo-sw.js');
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  }
  addBanner();
}

function addBanner() {
  const bar = document.createElement('div');
  bar.className = 'demo-bar';
  bar.innerHTML = `<span><strong>Demo</strong> con datos de ejemplo · lo que hagas se guarda solo en este navegador</span>
    <button type="button" class="btn sm">Reiniciar demo</button>`;
  bar.querySelector('button').addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Reiniciando…';
    await api('/demo/reset', { method: 'POST' });
    location.hash = '#/entrada';
    location.reload();
  });
  document.body.prepend(bar);
}
