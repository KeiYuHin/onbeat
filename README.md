# OnBeat

Band rehearsal sync: each member sees their own part on their own phone, and everyone moves through the same bar and beat on one shared clock. See `SPEC.md` for the full design.

Current milestone: **M2.5 metronome + drum machine**. Each device shows the song, section, bar and beat, the current section as a row of bar cards (the loop view), and its own part (strum pattern with the current eighth note highlighted, a text pattern/groove, or the drummer's step grid), plus a section timeline. Any device can also play a click and/or a 16-step drum machine, locked to the same shared clock.

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
4. On the other devices, pick a part, enter the code, and tap **加入** (join). To change part later, tap your part next to the room code; there's no need to leave.
5. Anyone can tap **开始** (start). After about 1.5s comes a one-bar count-in (预备), then the song plays from the top on every device. Beat dots at the top right flash orange on the downbeat and blue on the other beats.

### Loop view and 再绕一遍

The middle panel shows one pass of the current section as bar cards (for example C Am F G), with the cursor going round them and **第 2 / 4 遍** at the top right. A section written as 8 bars that is really 4 bars twice is detected automatically. On the last pass the counter turns orange (**最后一遍**) and the next section is previewed underneath (下一段：副歌 · F G C Am).

**再绕一遍** adds one more pass of the current section for everyone, for when the band decides on the spot to go round again. It is refused in the section's last beat (too late to reach every phone in time). A fresh 开始 plays the song as written again.

### Drum machine editor (whole room)

Open it from **编辑鼓谱** (drummer's part panel, or the sound settings). Pick 全曲默认 or a section, start from a preset (基本 8beat, 抒情 4beat, 16beat, 摇滚, Disco, 放克, 雷鬼, 华尔兹…), and tap cells to cycle empty → hit → accent. **全曲默认** is the pattern every section uses unless that section has its own (marked 单独 / 跟默认). **所有段落都用这个节奏** makes every section follow the default in one go, and **改回跟全曲默认** does it for one section. Every change syncs to the whole room immediately, so the device on the speaker plays it right away. Changes last as long as the room stays on that song; **保存到歌曲文件** writes them into `songs/<song>.json` on the laptop.

### Sound (per device)

Tap **🔊 声音** in the top bar. Settings are stored on each device and never synced.

- **本机出声**: master switch. Usually only the device on the speaker plays the drum machine; others leave it off or listen to a click in their own headphones.
- **节拍器** with 四分 / 八分 / 十六分 subdivisions (downbeat is higher). **预备拍出声** clicks the count-in bar even when the metronome is off.
- **鼓机** plays the song's `drums` pattern (or a basic beat if the song has none). **段落加花** adds a fill in the last bar of each section and a crash on the next downbeat.
- **闪屏** flashes the chord panel on every beat (orange on beat 1), so you can follow without sound.
- **本机延迟补偿** (±300ms): use wired headphones or a speaker if you can. Bluetooth is typically 150–300ms late; if the click sounds later than the screen flash, move the slider right until they line up.

Browsers only start audio from a tap. If sound was on last time, you'll see 点一下屏幕开启声音; tap anywhere. On iPhone, make sure the volume is up (sound plays even with the silent switch on, in iOS 16.4+).

**Screen staying on:** the app keeps the screen awake with the Wake Lock API, but browsers only allow it over HTTPS (or on `localhost`). Over a plain `http://` LAN address you'll see a hint; until there's HTTPS, set the phone's auto-lock to a longer time.

## Adding songs

Put one JSON file per song in `songs/` (format in `SPEC.md`; `songs/example-song.json` is a template). Restart `npm run server` to pick it up (`npm run dev` reloads automatically). A broken file stops the server with a message naming the file and the problem.

A section that repeats can be written as a loop: `"verse": { "loop": [["C"], ["Am"], ["F"], ["G"]], "times": 4 }` is the same as writing the 16 bars out. Saving from the drum editor keeps this notation and the rest of the file's layout.

Drum machine patterns go in the `drums` part, one step per sixteenth note (16 steps in 4/4, 12 in 3/4); `x` hit, `X` accent, `.` rest. Instruments: `kick snare hat crash ride tom`. Put a different `pattern` under `sections` for e.g. the chorus:

```json
"drums": { "label": "鼓", "default": { "groove": "基本 8beat",
  "pattern": { "kick": "x.......x.x.....", "snare": "....x.......x...", "hat": "x.x.x.x.x.x.x.x." } } }
```

The default kit in `web/public/kits/default/` is synthesized by `node tools/gen-kit.mjs` and released under CC0. Replace any WAV with a real CC0 sample of the same name if you prefer.

If phones can't connect: Windows Firewall may block Node the first time it runs. Allow it on **private networks** when prompted, or add an inbound rule for TCP 8787.

## Development

```sh
npm run dev        # server :8787 + Vite :5173 (also LAN-reachable, open http://<laptop-ip>:5173)
npm test           # unit tests + 50–300ms latency simulation
npm run typecheck
```

## Licenses

| Component | License |
| --- | --- |
| React, react-dom | MIT |
| ws | MIT |
| sirv | MIT |
| tsx | MIT |
| Default drum kit (`web/public/kits/default/`, generated by `tools/gen-kit.mjs`) | CC0 |
