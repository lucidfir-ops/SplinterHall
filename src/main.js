// Boot: load physics, start the app.
import RAPIER from '@dimforge/rapier2d-compat';
import { App } from './game/app.js';

async function boot() {
  await RAPIER.init();
  const app = new App(RAPIER, document.getElementById('game'), document.getElementById('ui'));
  await app.start();
  const boot = document.getElementById('boot');
  if (boot) boot.remove();
  window.__splinterhall = app.testHook ? app : undefined;
}
boot().catch((e) => {
  console.error(e);
  const b = document.getElementById('boot');
  if (b) b.textContent = 'FAILED TO START · ' + (e && e.message ? e.message : e);
});
