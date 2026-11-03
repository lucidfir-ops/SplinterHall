// Node has no location: give the kit one, so ?broker= works in Node tests too (NET_BROKER=ws://host:port/mqtt).
if (!globalThis.location) {
  const q = new URLSearchParams();
  if (process.env.NET_BROKER) q.set('broker', process.env.NET_BROKER);
  globalThis.location = { search: `?${q}`, protocol: 'node:' };
}
