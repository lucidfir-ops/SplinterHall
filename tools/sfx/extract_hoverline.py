"""Extract Hoverline's embedded sound effects (base64 MP3) to files.

Hoverline (Eric's previous game) embeds 34 CC0 effects in src/hoverline.html as
a JSON object assigned to `SL.SFX` ({name: base64 mp3}). This writes each one to
<out dir>/<name>.mp3 so tools/sfx/build_sfx.py can reuse them.

    python3 -I tools/sfx/extract_hoverline.py <path/to/hoverline.html> <out dir>
"""
import base64
import json
import os
import re
import sys


def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    html = open(src, encoding='utf-8').read()
    m = re.search(r'SL\.SFX=(\{.*?\});', html, re.S)
    if not m:
        sys.exit('SL.SFX table not found in ' + src)
    table = json.loads(m.group(1))
    for name, b64 in table.items():
        with open(os.path.join(out, name + '.mp3'), 'wb') as f:
            f.write(base64.b64decode(b64))
    print('%d effects -> %s' % (len(table), out))


if __name__ == '__main__':
    main()
