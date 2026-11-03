// The Wi-Fi pairing screens (carrier 'wifi'), from Hoverline's lanBox.
//
//   mountWifiPairing(container, { role: 'host' | 'guest', room, me, onDone, onCancel }) -> { destroy(), back() }
//
// Host (room = a room made with createRoom({ carrier: 'wifi' })): shows a QR code for the next player and scans
// their reply. Each player who joins gets a fresh code at once; Done (onDone(room)) when everyone is in.
// Guest: scans the host's code, shows a reply for the host to scan, and once the host has scanned it joins the
// room (with `me`) and calls onDone(room). Without `me` it calls onDone({ code }) and the game joins with
// joinRoom(code, { carrier: 'wifi', me }).
//
// Scanning: the camera through getUserMedia, read with BarcodeDetector where the browser has it (Chrome on
// Android, macOS, ChromeOS), otherwise with jsQR (Apache-2.0, bundled): Firefox, Safari, Chrome on Linux and
// Windows, the Steam Deck. Every code can also be copied and pasted as text, for a device with no camera.
//
// Styled only with the game's classes (.sh-panel .sh-title .sh-label .sh-mono .sh-btn .sh-primary .sh-row)
// and colour variables (--ink --bone --accent --dim). No rounded corners anywhere.

import { drawQr } from './qr.js';
import { wifiAnswer, wifiCancel, wifiAvailable, unpack, spaced, CODE_PREFIX } from './wifi.js';
import { joinRoom } from './room.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const button = (label, primary, onClick) => {
  const b = el('button', primary ? 'sh-btn sh-primary' : 'sh-btn', label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};

// The colours the stylesheet gave the variables, for drawing on a canvas.
function colours(container) {
  const cs = getComputedStyle(container);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return { ink: v('--ink', '#0C0C0B'), bone: v('--bone', '#E8E2D4') };
}

// ---------- reading QR codes from the camera ----------
let jsQRPromise = null;
const loadJsQR = () =>
  (jsQRPromise ??= import('jsqr').then((mod) => {
    const f = mod.default || mod;
    return typeof f === 'function' ? f : f.default;
  }));

async function makeDetector() {
  if ('BarcodeDetector' in globalThis) {
    try {
      const formats = await globalThis.BarcodeDetector.getSupportedFormats?.();
      if (!formats || formats.includes('qr_code')) {
        const det = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
        return async (video) => (await det.detect(video)).map((r) => r.rawValue || '');
      }
    } catch {
      /* Fall back to jsQR. */
    }
  }
  const jsQR = await loadJsQR();
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return [];
    // At most 720 px across: plenty for a code that fills a good part of the view, and fast on phones.
    const k = Math.min(1, 720 / Math.max(w, h));
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(h * k);
    g.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    return hit ? [hit.data] : [];
  };
}

// Ask for the camera once and let it go. With the camera allowed the browser puts this device's real Wi-Fi
// address in the codes (otherwise a private name that some networks can't look up), and the host needs the
// camera to scan replies anyway.
export async function cameraProbe() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

// ---------- the screens ----------
export function mountWifiPairing(container, { role = 'guest', room = null, me = null, onDone, onCancel } = {}) {
  let alive = true;
  let stream = null;
  let scanning = false;
  let shownCode = null;
  let unlisten = null;
  let offerGen = 0;

  const panel = el('div', 'sh-panel');
  const title = el('div', 'sh-title');
  const steps = el('div', 'sh-label');
  const view = el('div', 'sh-row');
  const qr = el('canvas');
  qr.setAttribute('aria-label', 'Pairing code as a QR code');
  qr.hidden = true;
  const video = el('video');
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.hidden = true;
  video.style.cssText = 'width:min(300px,70vw);max-height:60vh;background:var(--ink);border:2px solid var(--bone);object-fit:cover';
  view.append(qr, video);
  const codeText = el('div', 'sh-mono');
  codeText.style.cssText = 'word-break:break-all;user-select:all;color:var(--bone);max-width:min(560px,92vw)';
  const status = el('div', 'sh-label');
  status.setAttribute('role', 'status');
  status.style.color = 'var(--accent)';
  const count = el('div', 'sh-label');
  const pasteLabel = el('label', 'sh-label', 'Or paste a code');
  const paste = el('textarea', 'sh-mono');
  paste.rows = 2;
  paste.spellcheck = false;
  paste.autocomplete = 'off';
  paste.placeholder = `${CODE_PREFIX}…`;
  paste.style.cssText =
    'width:min(560px,92vw);background:var(--ink);color:var(--bone);border:2px solid var(--dim);border-radius:0;resize:vertical';
  const pid = `sh-wifi-paste-${Math.random().toString(36).slice(2, 8)}`;
  paste.id = pid;
  pasteLabel.htmlFor = pid;

  const buttons = el('div', 'sh-row');
  const scanBtn = button('Scan a code', true, () => toggleScan());
  const copyBtn = button('Copy code', false, () => copy());
  copyBtn.hidden = true;
  const useBtn = button('Use code', false, () => use(paste.value));
  const nextBtn = button('New code', false, () => hostNext());
  const doneBtn = button('Done', false, () => finish());
  const cancelBtn = button('Cancel', false, () => back());
  panel.append(title, steps, view, codeText, count, buttons, pasteLabel, paste, status);
  container.append(panel);

  const say = (text) => {
    status.textContent = text || '';
  };

  function showCode(code) {
    shownCode = code;
    codeText.textContent = code ? `CODE · ${spaced(code)}` : '';
    copyBtn.hidden = !code;
    qr.hidden = !code || scanning;
    if (code) {
      const { ink, bone } = colours(container);
      const size = Math.min(320, Math.floor((globalThis.innerWidth || 360) * 0.7), Math.floor((globalThis.innerHeight || 640) * 0.55));
      // Ink modules on bone with a four-module quiet zone: every phone camera reads that way round.
      drawQr(qr, code, { dark: ink, light: bone, quiet: 4, cssSize: Math.max(160, size) });
      qr.style.border = '2px solid var(--bone)';
    }
  }

  async function copy() {
    if (!shownCode) return;
    try {
      await navigator.clipboard.writeText(shownCode);
      say('Copied.');
    } catch {
      say('Select the code above and copy it.');
    }
  }

  function cameraOff() {
    scanning = false;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    video.hidden = true;
    video.srcObject = null;
    qr.hidden = !shownCode;
    scanBtn.textContent = role === 'host' ? 'Scan a reply' : 'Scan a code';
  }

  async function toggleScan() {
    if (scanning) {
      cameraOff();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      say('No camera here: paste the code instead.');
      return;
    }
    let detect;
    try {
      detect = await makeDetector();
    } catch {
      say("This browser can't read QR codes: paste the code instead.");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch {
      say('No camera here (or it was not allowed): paste the code instead.');
      return;
    }
    if (!alive) return cameraOff();
    video.srcObject = stream;
    qr.hidden = true;
    video.hidden = false;
    try {
      await video.play();
    } catch {
      /* Some browsers start it anyway. */
    }
    scanning = true;
    scanBtn.textContent = 'Stop camera';
    say('Point the camera at the code…');
    while (scanning && alive) {
      try {
        const found = (await detect(video)).find((t) => t.toUpperCase().startsWith(CODE_PREFIX));
        if (found && scanning) {
          cameraOff();
          say('');
          use(found);
          return;
        }
      } catch {
        /* A frame that wasn't ready. */
      }
      await new Promise((resolve) => setTimeout(resolve, 160));
    }
  }

  async function use(text) {
    text = String(text || '').trim();
    if (!text) return;
    paste.value = '';
    const o = unpack(text);
    if (!o) {
      say("That isn't a Splinterhall Wi-Fi code.");
      return;
    }
    try {
      if (role === 'host') {
        say('Connecting the fighter…');
        await room.wifi.accept(text);
        setTimeout(() => {
          if (alive && status.textContent === 'Connecting the fighter…')
            say('Still connecting… check the fighter is on this Wi-Fi.');
        }, 8000);
      } else {
        say('Making your reply…');
        const res = await wifiAnswer(text);
        if (!alive) return;
        title.textContent = 'Show this to the host';
        steps.textContent =
          'The host taps Scan a reply and points their camera at this (or pastes the code). You join as soon as they have.';
        scanBtn.hidden = useBtn.hidden = pasteLabel.hidden = paste.hidden = true;
        showCode(res.reply);
        say('Waiting for the host…');
        let code;
        try {
          code = await res.open;
        } catch (error) {
          if (!alive) return;
          guestStart();
          say(String(error.message || error));
          return;
        }
        if (!alive) return;
        say('Connected · joining the room…');
        if (!me) {
          finishWith({ code });
          return;
        }
        try {
          const joined = await joinRoom(code, { carrier: 'wifi', me });
          if (!alive) {
            joined.leave();
            return;
          }
          finishWith(joined);
        } catch (error) {
          say(String(error.message || error));
        }
      }
    } catch (error) {
      say(String(error?.message || error));
    }
  }

  async function hostNext() {
    const gen = ++offerGen;
    showCode(null);
    try {
      const code = await room.wifi.offer();
      if (alive && gen === offerGen) showCode(code);
    } catch (error) {
      if (alive) say(`Could not make a code: ${error?.message || error}`);
    }
  }

  function updateCount() {
    if (role !== 'host' || !room?.wifi) return;
    const n = room.wifi.guests;
    count.textContent = `${n} fighter${n === 1 ? '' : 's'} connected · up to ${7 - Math.min(7, n)} more`;
  }

  function finishWith(result) {
    if (!alive) return;
    teardown();
    onDone?.(result);
  }
  function finish() {
    finishWith(room);
  }
  function back() {
    if (!alive) return;
    if (role === 'guest') wifiCancel();
    teardown();
    if (role === 'host') onDone?.(room);
    else onCancel?.();
  }

  function teardown() {
    alive = false;
    cameraOff();
    unlisten?.();
    panel.remove();
  }

  // Escape (or the pad's B, if the game maps it to Escape) is Back.
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      back();
    }
  });
  paste.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      use(paste.value);
    }
  });

  if (!wifiAvailable()) {
    title.textContent = 'Wi-Fi rooms';
    steps.textContent = "This browser can't do Wi-Fi rooms (no WebRTC).";
    buttons.append(cancelBtn);
    pasteLabel.hidden = paste.hidden = true;
    return { destroy: teardown, back };
  }

  if (role === 'host') {
    if (!room?.wifi) throw new Error('mountWifiPairing: the host needs a room made with carrier "wifi".');
    title.textContent = 'Add fighters';
    steps.textContent =
      'Each fighter taps Join a host and scans this code, then shows you a reply: tap Scan a reply and scan it. Repeat for every fighter. Keep this device in the room: it relays the fight.';
    scanBtn.textContent = 'Scan a reply';
    buttons.append(scanBtn, copyBtn, useBtn, nextBtn, doneBtn);
    unlisten = room.wifi.onChange((what) => {
      if (!alive) return;
      updateCount();
      if (what === 'joined') {
        say('A fighter joined.');
        if (room.wifi.guests < 7) hostNext();
        else {
          showCode(null);
          say('The room is full.');
        }
      } else if (what === 'left') say('A fighter left.');
    });
    updateCount();
    say('Making a code…');
    // The camera first (see cameraProbe), then the code.
    cameraProbe().then(() => {
      if (!alive) return;
      say('');
      hostNext();
    });
  } else {
    buttons.append(scanBtn, copyBtn, useBtn, cancelBtn);
    guestStart();
  }
  function guestStart() {
    title.textContent = 'Join a Wi-Fi room';
    steps.textContent = "Scan the code on the host's screen, or paste it below.";
    scanBtn.hidden = useBtn.hidden = pasteLabel.hidden = paste.hidden = false;
    showCode(null);
  }
  return { destroy: teardown, back };
}
