Splinterhall · same-Wi-Fi host

Use this when there is no internet, or to keep a brawl on your own network.
1. On the Steam Deck (desktop mode), a Linux PC or a Mac: run "Host for Phone or Tablet.sh"
   (or: python3 wifi-host.py). It prints an address like http://192.168.1.20:5199/
2. On every phone and tablet on the same Wi-Fi, open that address in the browser.
3. Multiplayer -> Create room on one device, everyone else joins with the code.

Notes
- Python 3.8 or newer, standard library only. Windows: install Python, then run: python wifi-host.py
- Everyone in a room must open the game from this address. Without this pack, any copy of the game (itch.io too)
  can fight on one Wi-Fi with no internet: Multiplayer -> Wi-Fi, no internet, then swap QR codes.
- Up to 8 fighters per room. Keep the host window open while playing.
