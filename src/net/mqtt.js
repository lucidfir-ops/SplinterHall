// A minimal MQTT 3.1.1 client over WebSocket: connect, subscribe, publish at QoS 0, keep-alive and a last-will
// message. No dependencies, so it runs in any browser (and Node 22+, which has a global WebSocket) and copies to
// other games. From Hoverline's HLNet, unchanged in behaviour.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function utf8(text) {
  const bytes = encoder.encode(text);
  return [bytes.length >> 8, bytes.length & 255, ...bytes];
}

function remainingLength(n) {
  const out = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 128;
    out.push(byte);
  } while (n > 0);
  return out;
}

function packet(type, body) {
  const head = [type, ...remainingLength(body.length)];
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out;
}

function publishPacket(topic, payload) {
  const t = utf8(topic);
  const p = typeof payload === 'string' ? encoder.encode(payload) : payload;
  const body = new Uint8Array(t.length + p.length);
  body.set(t);
  body.set(p, t.length);
  return packet(0x30, body);
}

// Resolves with a client once the broker accepts the connection; rejects on refusal, socket error or timeout.
// options.onMessage(topic, text), options.onClose().
export function connectMqtt(
  url,
  { clientId, keepAlive = 30, will = null, timeout = 6000, onMessage, onClose } = {},
) {
  return new Promise((resolve, reject) => {
    let socket;
    try {
      socket = new WebSocket(url, 'mqtt');
    } catch (error) {
      reject(error);
      return;
    }
    socket.binaryType = 'arraybuffer';
    let buffer = new Uint8Array(0);
    let ready = false;
    let closed = false;
    let ping = null;
    let packetId = 1;
    const fail = (why) => {
      if (!ready) reject(new Error(why));
      close();
    };
    const timer = setTimeout(() => fail(`${url} timed out`), timeout);
    function close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      clearInterval(ping);
      try {
        if (socket.readyState === 1) socket.send(new Uint8Array([0xe0, 0])); // DISCONNECT
        socket.close();
      } catch {
        /* Already closing. */
      }
      if (ready) onClose?.();
    }
    const send = (bytes) => {
      if (socket.readyState === 1) socket.send(bytes);
    };
    socket.onopen = () => {
      const flags = 0x02 | (will ? 0x04 : 0); // clean session, optional will at QoS 0
      const body = [0, 4, 77, 81, 84, 84, 4, flags, keepAlive >> 8, keepAlive & 255];
      body.push(...utf8(clientId));
      if (will) body.push(...utf8(will.topic), ...utf8(will.payload));
      send(packet(0x10, body));
    };
    socket.onerror = () => fail(`${url} unreachable`);
    socket.onclose = () => fail(`${url} closed`);
    socket.onmessage = ({ data }) => {
      const chunk = new Uint8Array(data);
      const joined = new Uint8Array(buffer.length + chunk.length);
      joined.set(buffer);
      joined.set(chunk, buffer.length);
      buffer = joined;
      // Several packets can share a frame, and one packet can span frames.
      for (;;) {
        if (buffer.length < 2) return;
        let length = 0;
        let multiplier = 1;
        let i = 1;
        let byte;
        do {
          if (i >= buffer.length) return;
          byte = buffer[i++];
          length += (byte & 127) * multiplier;
          multiplier *= 128;
        } while (byte & 128);
        if (buffer.length < i + length) return;
        const first = buffer[0];
        const type = first >> 4;
        const body = buffer.subarray(i, i + length);
        buffer = buffer.slice(i + length);
        if (type === 2) {
          // CONNACK
          if (body[1] !== 0) return fail(`${url} refused (${body[1]})`);
          ready = true;
          clearTimeout(timer);
          ping = setInterval(() => send(new Uint8Array([0xc0, 0])), (keepAlive * 1000) / 2);
          resolve(client);
        } else if (type === 3) {
          // PUBLISH (QoS 0 only: we subscribe at QoS 0). The QoS bits are in this packet's first byte, read
          // before the buffer moves on (Hoverline read them from the next packet's, which only mattered at QoS 1).
          const topicLength = (body[0] << 8) | body[1];
          const topic = decoder.decode(body.subarray(2, 2 + topicLength));
          const qos = (first >> 1) & 3;
          const offset = 2 + topicLength + (qos ? 2 : 0);
          onMessage?.(topic, decoder.decode(body.subarray(offset)));
        }
      }
    };
    const client = {
      url,
      get open() {
        return ready && !closed && socket.readyState === 1;
      },
      // Bytes waiting in the socket: lets a caller skip a snapshot when a link is slow.
      get backlog() {
        return socket.bufferedAmount || 0;
      },
      subscribe(topic) {
        const id = packetId++ & 0xffff || 1;
        send(packet(0x82, [id >> 8, id & 255, ...utf8(topic), 0]));
      },
      unsubscribe(topic) {
        const id = packetId++ & 0xffff || 1;
        send(packet(0xa2, [id >> 8, id & 255, ...utf8(topic)]));
      },
      publish(topic, text) {
        send(publishPacket(topic, text));
      },
      close,
    };
  });
}
