// Entry for the browser test bundle (test-browser.mjs bundles it with esbuild; never part of a game build).
import { makeHarness } from './harness.js';
import { wifiAnswer } from '../../src/net/wifi.js';
import { mountWifiPairing, cameraProbe } from '../../src/net/wifi-ui.js';
import jsQRmod from 'jsqr';

const jsQR = typeof jsQRmod === 'function' ? jsQRmod : jsQRmod.default;
const NT = makeHarness();
const answers = {};

window.NT = NT;
window.NW = {
  cameraProbe,
  offer: (name) => NT.rooms[name].wifi.offer(),
  accept: (name, text) => NT.rooms[name].wifi.accept(text).then(() => true),
  guests: (name) => NT.rooms[name].wifi?.guests ?? null,
  async answer(key, text) {
    const res = await wifiAnswer(text);
    answers[key] = res;
    return { reply: res.reply, code: res.code };
  },
  opened: (key) => answers[key].open.then((code) => code),
  // The pairing screens, mounted into a fresh element.
  mount(role, name, me) {
    const box = document.createElement('div');
    box.id = `wifi-${role}`;
    document.body.append(box);
    window.__ui = { done: null, cancelled: false };
    mountWifiPairing(box, {
      role,
      room: name ? NT.rooms[name] : null,
      me,
      onDone: (r) => {
        if (r && r.code && r.myId) NT.rooms[`ui-${role}`] = r;
        window.__ui.done = r ? { code: r.code, myId: r.myId ?? null } : {};
      },
      onCancel: () => (window.__ui.cancelled = true),
    });
    return true;
  },
  // Reads the QR code drawn on the pairing screen back with jsQR.
  readQr(role) {
    const c = document.querySelector(`#wifi-${role} canvas`);
    if (!c || c.hidden || !c.width) return null;
    const g = c.getContext('2d');
    const img = g.getImageData(0, 0, c.width, c.height);
    return jsQR(img.data, img.width, img.height)?.data ?? null;
  },
};
