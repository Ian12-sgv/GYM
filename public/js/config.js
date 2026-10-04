import { api } from './api.js';
import { store } from './ui.js';

export async function reloadConfig() {
  store.config = await api('/config');
  const name = store.config.settings.gym_name;
  document.getElementById('gym-name').textContent = name;
  document.title = `Recepción · ${name}`;
}
