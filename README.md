# OnBeat

Band rehearsal sync: each member sees their own part on their own phone, and everyone moves through the same bar and beat on one shared clock. See `SPEC.md` for the full design.

Current milestone: **M1 sync core**. This covers rooms, clock sync, start/stop and a beat flash. There are no songs yet.

## Run locally (rehearsal-room laptop)

Requires Node.js 24+.

```sh
npm install
npm run server
```

On startup the server prints its addresses, for example:

```
OnBeat server listening on port 8787
  this computer: http://localhost:8787
  phones on the same Wi-Fi: http://10.0.0.159:8787
```

## Open on phones

1. Connect the phones to the **same Wi-Fi** as the laptop.
2. Open the "phones on the same Wi-Fi" address in the phone's browser.
3. On one device, pick a part and tap **创建新房间** (create a new room). The room code appears at the top, and the address bar now contains `?room=xxxxxx`, so you can share that link directly.
4. On the other devices, pick a part, enter the code, and tap **加入** (join).
5. Anyone can tap **开始** (start). After about 1.5s comes a one-bar count-in (预备拍), then playback begins. Every device should flash in sync, with orange on the downbeat and blue on the other beats.

If phones can't connect: Windows Firewall may block Node the first time it runs. Allow it on **private networks** when prompted, or add an inbound rule for TCP 8787.

## Development

```sh
npm run dev        # server :8787 + Vite :5173 (also LAN-reachable, open http://<laptop-ip>:5173)
npm test           # unit tests + 50–300ms latency simulation
npm run typecheck
```
