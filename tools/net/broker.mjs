// A local MQTT-over-WebSocket broker for the tests (aedes + ws), standing in for the public brokers via
// ?broker=ws://127.0.0.1:PORT/mqtt. Its packages are not game dependencies: install them outside the repo,
//   mkdir /tmp/netdeps && cd /tmp/netdeps && npm init -y && npm i aedes ws
// and point NET_TEST_DEPS at that folder.
//   NET_TEST_DEPS=/tmp/netdeps node tools/net/broker.mjs [port]      (runs until stopped)
// or import { startBroker } from './broker.mjs'.
//
// Options: delayMs adds a one-way delay to every message the broker forwards (to imitate a public broker
// that is far away); dropEvery drops every nth publish (to imitate a rate-limiting broker).

import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function deps() {
  const dir = process.env.NET_TEST_DEPS;
  if (!dir) throw new Error('Set NET_TEST_DEPS to a folder where `npm i aedes ws` was run (outside the repo).');
  const mod = (p) => import(pathToFileURL(path.join(dir, 'node_modules', p)).href);
  const { Aedes } = await mod('aedes/aedes.js');
  const ws = await mod('ws/wrapper.mjs');
  return { Aedes, ws };
}

export async function startBroker({ port = 0, delayMs = 0, dropEvery = 0 } = {}) {
  const { Aedes, ws } = await deps();
  const broker = await Aedes.createBroker();
  let publishes = 0;
  let bytes = 0;
  if (dropEvery || delayMs) {
    broker.authorizePublish = (client, packet, done) => {
      publishes++;
      if (dropEvery && client && publishes % dropEvery === 0) return done(new Error('dropped'));
      done(null);
    };
  }
  // Publishes per client, to check the room's rate cap (one publish per broker every 125 ms).
  const perClient = new Map();
  broker.on('publish', (packet, client) => {
    if (!client) return;
    bytes += packet.payload?.length || 0;
    const list = perClient.get(client.id) || [];
    list.push(Date.now());
    perClient.set(client.id, list);
  });
  const server = http.createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });
  const wss = new ws.WebSocketServer({ server, path: '/mqtt' });
  wss.on('connection', (socket) => {
    const stream = ws.createWebSocketStream(socket);
    stream.on('error', () => {});
    if (delayMs) {
      // Delay what the broker writes back to this client.
      const write = stream._write.bind(stream);
      stream._write = (chunk, enc, cb) => setTimeout(() => write(chunk, enc, cb), delayMs);
    }
    broker.handle(stream);
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = server.address().port;
  return {
    url: `ws://127.0.0.1:${actual}/mqtt`,
    port: actual,
    stats: () => ({ publishes, bytes, clients: wss.clients.size }),
    // The most publishes any one client made in any one second, between t0 and t1 (ms since epoch).
    peakRate(t0, t1, match = () => true) {
      let peak = 0;
      let who = null;
      for (const [id, list] of perClient) {
        if (!match(id)) continue;
        const xs = list.filter((t) => t >= t0 && t <= t1);
        for (let i = 0, j = 0; i < xs.length; i++) {
          while (xs[i] - xs[j] >= 1000) j++;
          if (i - j + 1 > peak) {
            peak = i - j + 1;
            who = id;
          }
        }
      }
      return { peak, who };
    },
    // The smallest gap between two publishes of any one client (ms), between t0 and t1.
    minGap(t0, t1, match = () => true) {
      let gap = Infinity;
      for (const [id, list] of perClient) {
        if (!match(id)) continue;
        const xs = list.filter((t) => t >= t0 && t <= t1);
        for (let i = 1; i < xs.length; i++) gap = Math.min(gap, xs[i] - xs[i - 1]);
      }
      return gap;
    },
    async close() {
      for (const c of wss.clients) c.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => server.close(resolve));
      await new Promise((resolve) => broker.close(resolve));
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const b = await startBroker({ port: Number(process.argv[2]) || 0 });
  console.log(`test broker at ${b.url}`);
}
