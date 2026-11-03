#!/bin/bash
# Splinterhall Wi-Fi host (Steam Deck, Linux, Mac): serves the game and the multiplayer relay to phones and tablets on this Wi-Fi.
cd -- "$(dirname -- "${BASH_SOURCE[0]:-$0}")" || exit 1
export SPLINTERHALL_PORT="${SPLINTERHALL_PORT:-5199}"
command -v python3 >/dev/null 2>&1 || { echo 'Python 3 was not found.'; exit 1; }
mkdir -p .runtime
python3 wifi-host.py > .runtime/wifi-host.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM
for _ in $(seq 40); do grep -q 'Keep this window' .runtime/wifi-host.log 2>/dev/null && break; sleep 0.25; done
cat .runtime/wifi-host.log
kill -0 $SERVER 2>/dev/null || exit 1
URL="http://127.0.0.1:$SPLINTERHALL_PORT/"
if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then open "$URL"; fi
# Started from a file manager there is no terminal: a dialog shows the address and stopping it stops the host.
if [ ! -t 1 ] && command -v kdialog >/dev/null 2>&1; then
  kdialog --title 'Splinterhall Wi-Fi host' --msgbox "$(grep -v 'Ctrl+C' .runtime/wifi-host.log)

Press OK to stop hosting."
else
  wait $SERVER
fi
