# OnBeat

Band rehearsal sync: each member sees their own part on their own phone, and everyone moves through the same bar and beat on one shared clock. See `SPEC.md` for the full design.

Current milestone: **M2 score display**. Each device shows the song, section, bar and beat, the current and next chord, and its own part (strum pattern with the current eighth note highlighted, or a text pattern/groove), plus a section timeline.

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
5. Anyone can tap **开始** (start). After about 1.5s comes a one-bar count-in (预备), then the song plays from the top on every device. Beat dots at the top right flash orange on the downbeat and blue on the other beats.

**Screen staying on:** the app keeps the screen awake with the Wake Lock API, but browsers only allow it over HTTPS (or on `localhost`). Over a plain `http://` LAN address you'll see a hint; until there's HTTPS, set the phone's auto-lock to a longer time.

## Adding songs

Put one JSON file per song in `songs/` (format in `SPEC.md`; `songs/example-song.json` is a template). Restart `npm run server` to pick it up (`npm run dev` reloads automatically). A broken file stops the server with a message naming the file and the problem. Chords and structure only: never add lyrics.

If phones can't connect: Windows Firewall may block Node the first time it runs. Allow it on **private networks** when prompted, or add an inbound rule for TCP 8787.

## Development

```sh
npm run dev        # server :8787 + Vite :5173 (also LAN-reachable, open http://<laptop-ip>:5173)
npm test           # unit tests + 50–300ms latency simulation
npm run typecheck
```
