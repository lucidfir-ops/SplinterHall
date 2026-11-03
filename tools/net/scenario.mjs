// The room checks every carrier must pass, run through an adapter so the same steps drive rooms in Node
// (test-node.mjs) and in browser pages (test-browser.mjs).
//
// adapter: {
//   create(name, opts) join(name, code, opts) state(name) events(name, type) clear(name)
//   call(name, method, args) spam(name, n, opts) burst(name, opts) freeze(name)
// } — every method async, returning plain JSON.

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(fn, { timeout = 10000, every = 100, what = 'condition' } = {}) {
  const t0 = Date.now();
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}

export function makeReport(prefix = '') {
  const results = [];
  return {
    results,
    async check(name, fn) {
      const t0 = Date.now();
      try {
        const detail = await fn();
        results.push({ name: prefix + name, ok: true, ms: Date.now() - t0, detail: detail ?? '' });
        console.log(`  ok   ${prefix}${name}${detail ? ` · ${detail}` : ''} (${Date.now() - t0} ms)`);
      } catch (error) {
        results.push({ name: prefix + name, ok: false, ms: Date.now() - t0, detail: String(error?.stack || error) });
        console.log(`  FAIL ${prefix}${name} · ${error?.message || error}`);
      }
    },
  };
}

const ids = (st) => st.roster.map((e) => `${e.id}:${e.slot}`).join(',');

export async function rosterAgrees(A, names, n) {
  const sts = await Promise.all(names.map((x) => A.state(x)));
  if (sts.some((s) => !s || s.roster.length !== n)) return false;
  const first = ids(sts[0]);
  if (!sts.every((s) => ids(s) === first)) return false;
  if (!sts.every((s) => s.hostId === sts[0].hostId)) return false;
  return sts;
}

// The four-player room scenario. opts: { carrier, timing: { settle, startRepeatMs, fastWindow } }
export async function runScenario(A, R, { carrier, names = ['A', 'B', 'C', 'D'], timeout = 15000, extraOpts = {} } = {}) {
  const [h, b, c, d] = names;
  const colors = [0, 1, 2, 3];
  let code = null;
  const me = (i) => ({ name: `Fighter ${names[i]}`, color: colors[i] });

  await R.check('create + 3 joins: roster and slots agree everywhere', async () => {
    const st = await A.create(h, { carrier, me: me(0), ...extraOpts });
    if (!st || st.error) throw new Error(`create failed: ${st?.error}`);
    if (!st.isHost) throw new Error('creator is not host');
    code = st.code;
    if (!/^[A-HJ-NP-Z2-9]{5}$/.test(code)) throw new Error(`bad room code ${code}`);
    for (let i = 1; i < 4; i++) {
      const j = await A.join(names[i], code, { carrier, me: me(i), ...extraOpts });
      if (j.error) throw new Error(`${names[i]} join failed: ${j.error}`);
    }
    const sts = await waitFor(() => rosterAgrees(A, names, 4), { timeout, what: '4-player roster' });
    const slots = sts[0].roster.map((e) => e.slot).join(',');
    if (slots !== '0,1,2,3') throw new Error(`slots ${slots}`);
    const order = sts[0].roster.map((e) => e.name).join(',');
    if (order !== names.map((x) => `Fighter ${x}`).join(',')) throw new Error(`join order ${order}`);
    if (!sts[0].roster[0].host || sts.some((s) => s.hostId !== sts[0].myId)) throw new Error('host flag');
    if (sts.slice(1).some((s) => s.isHost)) throw new Error('a guest thinks it is host');
    return `room ${code}`;
  });

  await R.check('ready flags propagate (and Ready nudges the others)', async () => {
    for (const x of names) await A.clear(x);
    await A.call(b, 'setMe', [{ ready: true }]);
    await waitFor(
      async () => (await Promise.all(names.map((x) => A.state(x)))).every((s) => s.roster[1].ready && !s.roster[2].ready),
      { timeout, what: "B's ready flag" },
    );
    await waitFor(async () => (await A.events(c, 'nudge')).length >= 1, { timeout, what: 'nudge at C' });
    for (const x of [h, c, d]) await A.call(x, 'setMe', [{ ready: true }]);
    await waitFor(
      async () => (await Promise.all(names.map((x) => A.state(x)))).every((s) => s.roster.every((e) => e.ready)),
      { timeout, what: 'all ready' },
    );
    const nudgesAtB = (await A.events(b, 'nudge')).length;
    if (nudgesAtB) throw new Error('B was nudged although ready');
  });

  await R.check('info propagates', async () => {
    const info = { opts: { roundsToWin: 5, bots: 2 }, playlist: ['F7K2Q9XM', 'B1234567'] };
    await A.call(h, 'setInfo', [info]);
    const want = JSON.stringify(info);
    await waitFor(
      async () => (await Promise.all(names.map((x) => A.state(x)))).every((s) => JSON.stringify(s.info) === want),
      { timeout, what: 'info everywhere' },
    );
    for (const x of [b, c, d]) {
      const ev = await A.events(x, 'info');
      if (!ev.length || JSON.stringify(ev[ev.length - 1].args[0]) !== want) throw new Error(`${x}: no info event`);
    }
    const r = await A.call(b, 'setInfo', [{ hacked: 1 }]);
    if (r !== false) throw new Error('a guest could set info');
  });

  await R.check('start fires once on every device, despite repeats', async () => {
    for (const x of names) await A.clear(x);
    const payload = { seed: 'k3x9', fighters: names.map((x, i) => ({ slot: i, name: x })) };
    await A.call(h, 'start', [payload]);
    await waitFor(async () => (await Promise.all(names.map((x) => A.events(x, 'start')))).every((e) => e.length >= 1), {
      timeout,
      what: 'start everywhere',
    });
    await sleep(4200); // past every repeat (0.5, 1.5, 3.5 s)
    const counts = await Promise.all(names.map((x) => A.events(x, 'start')));
    if (!counts.every((e) => e.length === 1)) throw new Error(`start counts ${counts.map((e) => e.length)}`);
    if (!counts.every((e) => JSON.stringify(e[0].args[0]) === JSON.stringify(payload))) throw new Error('payload differs');
    const sts = await Promise.all(names.map((x) => A.state(x)));
    if (!sts.every((s) => s.phase === 'match' && s.match === 1)) throw new Error('phase/match');
    const spread = Math.max(...counts.map((e) => e[0].at)) - Math.min(...counts.map((e) => e[0].at));
    return `spread ${spread.toFixed(0)} ms`;
  });

  await R.check('reliable messages arrive once, in order (with messages to one player interleaved)', async () => {
    for (const x of names) await A.clear(x);
    const C = await A.state(c);
    await A.spam(b, 300, { toEvery: 3, to: C.myId });
    const expectAll = 300;
    const expectBroadcast = 300 - 100;
    await waitFor(
      async () =>
        (await A.events(h, 'message')).length >= expectBroadcast &&
        (await A.events(d, 'message')).length >= expectBroadcast &&
        (await A.events(c, 'message')).length >= expectAll,
      { timeout: timeout + 10000, what: 'all spam delivered' },
    );
    await sleep(800);
    for (const x of [h, c, d]) {
      const got = (await A.events(x, 'message')).map((e) => e.args[0]);
      const want = x === c ? expectAll : expectBroadcast;
      if (got.length !== want) throw new Error(`${x} got ${got.length}, want ${want}`);
      for (let k = 1; k < got.length; k++) if (!(got[k].i > got[k - 1].i)) throw new Error(`${x} out of order at ${k}`);
      if (x !== c && got.some((m) => m.to)) throw new Error(`${x} got a message meant for ${c}`);
    }
    const st = await A.state(h);
    return `skipped gaps at host: ${st.stats?.skipped ?? '?'}`;
  });

  await R.check('sendFast is newest-wins (never older after newer)', async () => {
    for (const x of names) await A.clear(x);
    await A.burst(b, { kind: 'in', n: 60, rate: 60 });
    await waitFor(async () => (await A.events(h, 'fast')).some((e) => e.args[0] === 'in' && e.args[1].i === 60), {
      timeout,
      what: 'last input at host',
    });
    await sleep(500);
    const out = [];
    for (const x of [h, c, d]) {
      const got = (await A.events(x, 'fast')).filter((e) => e.args[0] === 'in').map((e) => e.args[1].i);
      for (let k = 1; k < got.length; k++) if (!(got[k] > got[k - 1])) throw new Error(`${x}: ${got[k]} after ${got[k - 1]}`);
      if (got[got.length - 1] !== 60) throw new Error(`${x}: last ${got[got.length - 1]}`);
      out.push(`${x} ${got.length}/60`);
    }
    return out.join(', ');
  });

  await R.check('backToLobby: everyone returns, ready flags cleared', async () => {
    for (const x of names) await A.clear(x);
    await A.call(h, 'backToLobby', []);
    await waitFor(async () => (await Promise.all(names.map((x) => A.events(x, 'lobby')))).every((e) => e.length >= 1), {
      timeout,
      what: 'lobby everywhere',
    });
    await waitFor(
      async () =>
        (await Promise.all(names.map((x) => A.state(x)))).every(
          (s) => s.phase === 'lobby' && s.roster.every((e) => !e.ready),
        ),
      { timeout, what: 'ready cleared' },
    );
    await sleep(4000);
    const counts = (await Promise.all(names.map((x) => A.events(x, 'lobby')))).map((e) => e.length);
    if (!counts.every((n) => n === 1)) throw new Error(`lobby counts ${counts}`);
  });

  await R.check('a client leaves and rejoins into the same slot', async () => {
    for (const x of names) await A.clear(x);
    const D0 = await A.state(d);
    await A.call(d, 'leave', []);
    await waitFor(
      async () => (await Promise.all([h, b, c].map((x) => A.state(x)))).every((s) => s.roster.length === 3),
      { timeout, what: 'D gone' },
    );
    for (const x of [h, b, c]) {
      const ev = await A.events(x, 'peerLeft');
      if (!ev.some((e) => e.args[0] === D0.myId)) throw new Error(`${x}: no peerLeft`);
    }
    const j = await A.join(d, code, { carrier, me: me(3), ...extraOpts });
    if (j.error) throw new Error(`rejoin failed: ${j.error}`);
    const sts = await waitFor(() => rosterAgrees(A, names, 4), { timeout, what: 'D back' });
    const e = sts[0].roster.find((x) => x.name === `Fighter ${d}`);
    if (e.id !== D0.myId || e.slot !== 3) throw new Error(`D came back as ${e.id} slot ${e.slot}`);
    return `slot ${e.slot}`;
  });

  await R.check('reconnect() keeps the slot and messages still flow', async () => {
    for (const x of names) await A.clear(x);
    const C0 = await A.state(c);
    await A.call(c, 'reconnect', []);
    await sleep(300);
    await A.spam(c, 5, {});
    await waitFor(async () => (await A.events(h, 'message')).length >= 5, { timeout, what: 'messages after reconnect' });
    const sts = await waitFor(() => rosterAgrees(A, names, 4), { timeout, what: 'roster after reconnect' });
    const e = sts[0].roster.find((x) => x.id === C0.myId);
    if (!e || e.slot !== 2) throw new Error('C lost its slot');
    const left = await A.events(h, 'peerLeft');
    if (left.length) throw new Error('reconnect showed as a player leaving');
  });

  await R.check('the host leaves: the lowest slot becomes host on every client, room stays alive', async () => {
    for (const x of names) await A.clear(x);
    const B0 = await A.state(b);
    await A.call(h, 'leave', []);
    const rest = [b, c, d];
    await waitFor(
      async () => {
        const sts = await Promise.all(rest.map((x) => A.state(x)));
        return sts.every((s) => s.hostId === B0.myId && s.roster.length === 3) && sts[0].isHost;
      },
      { timeout: timeout + 5000, what: 'B as host everywhere' },
    );
    const hostEv = await A.events(b, 'host');
    if (!hostEv.some((e) => e.args[0] === true)) throw new Error("B got no 'host' (true) event");
    for (const x of [c, d]) {
      if ((await A.state(x)).isHost) throw new Error(`${x} also thinks it is host`);
      if (!(await A.events(x, 'host')).length) throw new Error(`${x}: no 'host' event`);
    }
    await A.call(b, 'setInfo', [{ after: 'host change' }]);
    await waitFor(
      async () => (await Promise.all([c, d].map((x) => A.state(x)))).every((s) => s.info?.after === 'host change'),
      { timeout, what: 'info from the new host' },
    );
    await A.call(b, 'start', [{ seed: 'round2' }]);
    await waitFor(async () => (await Promise.all(rest.map((x) => A.events(x, 'start')))).every((e) => e.length === 1), {
      timeout,
      what: 'start from new host',
    });
    const s = await A.state(c);
    return `new host slot ${s.roster.find((e) => e.host).slot}`;
  });

  return { code };
}
