#!/usr/bin/env python3
"""Same-Wi-Fi host with no Node.js: serves the game and the multiplayer relay.

Python 3.8+ standard library only (Steam Deck, Linux and older Macs have it).
It speaks the same protocol as scripts/mp-relay.js: GET /mp/ping,
GET /mp/<ROOM>/events?id=<id> (Server-Sent Events down) and
POST /mp/<ROOM>/send?id=<id> (JSON up). Up to eight players per room.
Usage: python3 wifi-host.py [--port 5199]   (serves the folder this file is in)
"""
import argparse, json, mimetypes, os, re, select, socket, sys, threading, queue
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

ROOM = re.compile(r'^/mp/([A-Z0-9]{3,8})/(events|send)$')
CLIENT = re.compile(r'^[a-z0-9]{6,24}$')
PLAYERS, BODY_BYTES, ROOMS = 8, 65536, 64
TYPES = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8',
         '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
         '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff',
         '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8'}

rooms = {}  # room -> {client id: queue.Queue of SSE text}
lock = threading.Lock()


def lan_addresses(port):
    found = set()
    try:
        # The route a packet to the internet would take names the Wi-Fi address,
        # without sending anything.
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('192.0.2.1', 9))
        found.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.add(info[4][0])
    except OSError:
        pass
    return [f'{a}:{port}' for a in sorted(found) if not a.startswith('127.')]


def deliver(room, sender, text):
    with lock:
        members = list(rooms.get(room, {}).items())
    for cid, q in members:
        if cid != sender:
            q.put(text)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    root = 'dist'
    lan = []

    def log_message(self, *args):
        pass

    def send_plain(self, code, body=b'', ctype='text/plain'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if body and self.command != 'HEAD':
            self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/mp/ping':
            body = json.dumps({'relay': os.environ.get('GAME_RELAY_NAME', 'splinterhall'), 'lan': self.lan}).encode()
            return self.send_plain(200, body, 'application/json')
        match = ROOM.match(url.path)
        if match and match.group(2) == 'events':
            return self.events(match.group(1), parse_qs(url.query).get('id', [''])[0])
        if url.path.startswith('/mp/'):
            return self.send_plain(404)
        self.static(url.path)

    do_HEAD = do_GET

    def do_POST(self):
        url = urlparse(self.path)
        match = ROOM.match(url.path)
        if not match or match.group(2) != 'send':
            return self.send_plain(404)
        room, cid = match.group(1), parse_qs(url.query).get('id', [''])[0]
        length = int(self.headers.get('Content-Length') or 0)
        if length > BODY_BYTES:
            return self.send_plain(413)
        text = self.rfile.read(length).decode('utf-8', 'replace')
        with lock:
            member = cid in rooms.get(room, {})
        if not member:
            return self.send_plain(404)
        try:
            json.loads(text)
        except ValueError:
            return self.send_plain(400)
        # Every delivery names its sender, so eight fighters can tell each other apart.
        deliver(room, cid, '{"t":"_m","from":"%s","m":%s}' % (cid, text.replace('\n', ' ')))
        self.send_response(204)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def events(self, room, cid):
        if not CLIENT.match(cid):
            return self.send_plain(400)
        with lock:
            members = rooms.get(room)
            if members is None:
                if len(rooms) >= ROOMS:
                    return self.send_plain(503)
                members = rooms[room] = {}
            if cid not in members and len(members) >= PLAYERS:
                return self.send_plain(409, b'{"error":"Room full"}', 'application/json')
            old = members.get(cid)
            if old:
                old.put(None)
            peers = [p for p in members if p != cid]
            q = queue.Queue()
            members[cid] = q
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()
        self.close_connection = True
        try:
            self.wfile.write(('data: %s\n\n' % json.dumps({'t': '_hello', 'peers': peers})).encode())
            self.wfile.flush()
            deliver(room, cid, json.dumps({'t': '_join', 'id': cid}))
            idle = 0
            while True:
                try:
                    text = q.get(timeout=1)
                    idle = 0
                except queue.Empty:
                    # A closed browser tab shows as a readable socket at end of
                    # file: notice it within a second, not at the next keep-alive.
                    readable, _, _ = select.select([self.connection], [], [], 0)
                    if readable and not self.connection.recv(1, socket.MSG_PEEK):
                        break
                    idle += 1
                    if idle < 15:
                        continue
                    idle, text = 0, ''
                if text is None:
                    break
                self.wfile.write((':\n\n' if text == '' else 'data: %s\n\n' % text).encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with lock:
                members = rooms.get(room, {})
                if members.get(cid) is q:
                    del members[cid]
                    gone = True
                else:
                    gone = False
                if not members:
                    rooms.pop(room, None)
            if gone:
                deliver(room, cid, json.dumps({'t': '_leave', 'id': cid}))

    def static(self, path):
        rel = unquote(path).lstrip('/') or 'index.html'
        full = os.path.realpath(os.path.join(self.root, rel))
        base = os.path.realpath(self.root)
        if not (full == base or full.startswith(base + os.sep)):
            return self.send_plain(403)
        if os.path.isdir(full):
            full = os.path.join(full, 'index.html')
        if not os.path.isfile(full):
            return self.send_plain(404, b'Not found')
        ext = os.path.splitext(full)[1].lower()
        ctype = TYPES.get(ext) or mimetypes.guess_type(full)[0] or 'application/octet-stream'
        size = os.path.getsize(full)
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(size))
        self.send_header('Cache-Control', 'no-cache' if ext == '.html' else 'public, max-age=3600')
        self.end_headers()
        if self.command == 'HEAD':
            return
        with open(full, 'rb') as f:
            while chunk := f.read(1 << 16):
                self.wfile.write(chunk)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--port', type=int, default=int(os.environ.get('SPLINTERHALL_PORT', 5199)))
    parser.add_argument('--root', default=here)
    parser.add_argument('--local', action='store_true', help='this device only (no Wi-Fi access)')
    parser.add_argument('--lan', action='append', help='address to announce (tests); repeatable')
    args = parser.parse_args()
    if not os.path.isfile(os.path.join(args.root, 'index.html')):
        sys.exit('index.html missing next to wifi-host.py. Extract the complete archive again.')
    Handler.root = args.root
    Handler.lan = args.lan or ([] if args.local else lan_addresses(args.port))
    server = ThreadingHTTPServer(('127.0.0.1' if args.local else '0.0.0.0', args.port), Handler)
    server.daemon_threads = True
    print(f'Game and Wi-Fi relay running · http://127.0.0.1:{args.port}/')
    for address in Handler.lan:
        print(f'On phones and tablets on this Wi-Fi open: http://{address}/')
    print('Keep this window open while playing. Press Ctrl+C to stop.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
