# OnBeat

Band rehearsal sync: each member sees their own part on their own phone, and everyone moves through the same bar and beat on one shared clock. See `SPEC.md` for the full design.

Current milestone: **M4b lyrics and the full score** (M1–M3.9 done, M4a built). Songs can carry lyrics, shown as a lyric sheet (chords above the words) beside the bar cards and in a full-score view of the whole song. Each device shows the song, section, bar and beat, the current section as a row of bar cards (the loop view), and its own part (strum pattern with the current eighth note highlighted, a text pattern/groove, or the drummer's step grid), plus a section timeline. Chords can be written as letters or scale degrees and shown either way, with a capo; bars can change meter, songs can change key, and parts get cues. Any device can also play a click and/or a drum machine, locked to the same shared clock. Any member can jump to a section or bar, loop a section and change the tempo for the whole room.

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
5. Anyone can tap **开始** (start). After about 1.5s comes a one-bar count-in (预备), then the song plays on every device. Beat dots at the top right flash orange on the downbeat and blue on the other beats.

### Rehearsal controls (whole room)

- **停止 / 开始** picks up where you stopped: the top line says 从 副歌 2 第 3 小节开始, and 开始 counts in one bar and plays from the start of that bar. **⏮ 从头** (next to 开始) goes back to the top. Once the song has ended, 开始 starts from the top.
- **Tap a section in the timeline** at the bottom to jump there. While playing, the jump happens at the next barline (at least 0.3s away, so every phone gets it in time). The top line shows 下一小节 → 主歌 2 第 1 小节 until it happens. While stopped, it just moves the start point.
- **排练** (next to 开始) opens the controls:
  - **速度**: −5 / −1 / +1 / +5, or 70% / 80% / 90% / 原速 of the song's tempo. While playing, the change also waits for the next barline, and the top line shows `96 → 101 BPM`. Picking another song resets the tempo.
  - **跳到这里** jumps to a section. Tap the section name to open its bars, then tap a bar to play **从第 X 小节**.
  - **循环** loops a section (all its passes) until **取消循环**. If you're elsewhere, it jumps there at the next barline. The section shows 🔁 循环中 and has no 最后一遍 or next-section preview. Jumping outside the loop ends it. 再绕一遍 is off while looping.

The metronome and drum machine follow jumps, loops and tempo changes exactly, because they are scheduled from the same timeline.

### Loop view and 再绕一遍

The middle panel shows one pass of the current section as bar cards (for example C Am F G), with the cursor going round them and **第 2 / 4 遍** at the top right. A section written as 8 bars that is really 4 bars twice is detected automatically. On the last pass the counter turns orange (**最后一遍**) and the next section is previewed underneath (下一段：副歌 · F G C Am). The last bar card also splits in two: its own chord on top, and the next section's first chord large underneath (→ 副歌 · F). When that bar is playing, the bottom half turns solid orange. A jump waiting for the barline shows its target the same way on the current card.

If the song has lyrics, the part panel (right in landscape, below in portrait) becomes a **lyric sheet**: chords above the words where they change, the way a ChordPro chart looks, with the playing bar's words highlighted and the sheet scrolling along. Like lyrics in a music player, the section being played and the next one are sharp, the one before and the one after next are blurred, and the rest are hidden. While you scroll it by hand, every section shows, sharp; 4 seconds after you let go it goes back to following the band. Section names are small and grey, and the sheet spells maj7 as M7 (CM7) to save room. Your part's cues stay on top of it. Turn lyrics off under **谱面 → 歌词** to get the part panel back (strum pattern, drum grid, notes).

### Full score

Under **谱面 → 视图**, each phone can switch from 循环 to **全谱**: the whole song in playing order as one lyric sheet, every pass on its own line with its own lyrics, and instrumental bars as rows of chord boxes. The playing bar is highlighted and kept a third of the way down the screen; after you touch or scroll it, it stops following for 4 seconds. **Tapping a bar jumps the whole room there** (at the next barline while playing), and the target gets a dashed outline until it happens. **谱面 → 歌词** hides lyrics on this phone.

**再绕一遍** adds one more pass of the current section for everyone, for when the band decides on the spot to go round again. It is refused in the section's last beat (too late to reach every phone in time). Starting again from the top plays the song as written; restarting from a later bar keeps the extra passes, so the bars stay where they were.

### Drum machine editor (whole room)

Open it from **编辑鼓谱** (drummer's part panel, or the sound settings). Pick 全曲默认 or a section, start from a preset (基本 8beat, 抒情 4beat, 16beat, 摇滚, Disco, 放克, 雷鬼, 华尔兹…), and tap cells to cycle empty → hit → accent. **全曲默认** is the pattern every section uses unless that section has its own (marked 单独 / 跟默认). **所有段落都用这个节奏** makes every section follow the default in one go, and **改回跟全曲默认** does it for one section. Every change syncs to the whole room immediately, so the device on the speaker plays it right away. Changes last as long as the room stays on that song; **保存到歌曲文件** writes them into `songs/<song>.json` on the laptop.

### Sound (per device)

Tap **🔊 声音** in the top bar. Settings are stored on each device and never synced.

- **本机出声**: master switch. Usually only the device on the speaker plays the drum machine; others leave it off or listen to a click in their own headphones.
- **节拍器** with 四分 / 八分 / 十六分 subdivisions (downbeat is higher). **预备拍出声** clicks the count-in bar even when the metronome is off.
- **鼓机** plays the song's `drums` pattern (or a basic beat if the song has none). **段落加花** adds a fill in the last bar of each section and a crash on the next downbeat.
- **根音贝斯** plays the root of each chord (the bass note for slash chords like `G/B`) as a synthesized bass, for practising along. Rhythm: **长音** (one held note per chord), **四分** or **八分**. Tone: **贝斯** (a filtered sawtooth in the real bass range, whose overtones still come through phone speakers) or **正弦** (a pure sine an octave higher; clean in headphones). Scale-degree chords are played in the song's key; anything that isn't a chord (N.C.) is skipped.
- **闪屏** flashes the chord panel on every beat (orange on beat 1), so you can follow without sound.
- **本机延迟补偿** (±300ms): use wired headphones or a speaker if you can. Bluetooth is typically 150–300ms late; if the click sounds later than the screen flash, move the slider right until they line up.

Browsers only start audio from a tap. If sound was on last time, you'll see 点一下屏幕开启声音; tap anywhere. On iPhone, make sure the volume is up (sound plays even with the silent switch on, in iOS 16.4+).

**Screen staying on:** the app keeps the screen awake with the Wake Lock API, but browsers only allow it over HTTPS (or on `localhost`). Over a plain `http://` LAN address you'll see a hint; until there's HTTPS, set the phone's auto-lock to a longer time.

## Adding songs

Put one JSON file per song in `songs/` (format in `SPEC.md`; `songs/example-song.json` is a template). Restart `npm run server` to pick it up (`npm run dev` reloads automatically). A broken file stops the server with a message naming the file and the problem.

A section that repeats can be written as a loop: `"verse": { "loop": [["C"], ["Am"], ["F"], ["G"]], "times": 4 }` is the same as writing the 16 bars out. Saving from the drum editor keeps this notation and the rest of the file's layout.

**Chords** can be letters (`"C"`, `"G/B"`, `"Fmaj7"`) or scale degrees as on 白玉米谱 charts (`"1"`, `"5/7"`, `"6m"`, `"4M7"`, `"b7"`, `"37"` for 3⁷, `"/#5"` to change only the bass). Degrees need the song's `"key"` (a major key: `"Ab"`, `"F#"`; write minor songs in their relative major, like 1=C). Each entry in a bar takes an equal share of it, and `"-"` holds the chord before it, so `["1", "-", "-", "5/7"]` is three beats of 1 and one of 5/7.

A bar that needs more than chords is an object:

```json
{ "chords": ["6m"], "timeSignature": [2, 4], "cues": ["rit.", { "part": "drums", "text": "起鼓" }] }
```

- `timeSignature` changes the meter for that bar only. The song's own `timeSignature` can be compound: `[12, 8]` counts four dotted-quarter beats a bar, `bpm` is per dotted quarter, and drum patterns have one step per eighth note (12 steps).
- `cues` are short notes shown on that part's screen (plain text: everyone's), from one bar ahead.

A **key change** goes in `form`: `["verse", "chorus", { "section": "chorus", "key": "A" }]` plays the last chorus, and everything after it, in A.

**Lyrics** go in the section, one group per pass, each a string per bar of the loop (or of `bars` as written):

```json
"verse": { "loop": [["1"], ["6m"], ["4"], ["5"]], "times": 2,
  "lyrics": [["我最爱去的唱片店 昨天", "是她的最后一天 曾经", "…", "…"], ["第二遍…", "…", "…", "…"]] }
```

Every time the section goes round once, wherever it is in the form (再绕一遍 included), the next group is sung; when they run out, the last one repeats. Words sung before the barline (pickups) belong to the bar before, even across sections; `""` is a bar with nothing sung, and a string starting with a space (`" 我不要"`) is a bar whose words start after the downbeat, so its chord isn't put over the first word. On the sheet, a pickup that leads into the next pass (or out of a bar with nothing on the downbeat) moves to the start of the next line. Lyrics are written so a melody can be added later without touching them: each Chinese character takes one note, English words split at spaces and `-` (`some-one`), `_` holds the previous syllable over one more note, and spaces and punctuation take no note.

Each phone picks how chords are shown under **谱面**: letters, scale degrees, or both, and a guitar capo (letters then show the fingering, e.g. B with capo 2 shows A shapes).

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
npm run worker     # the Cloudflare Worker + Durable Objects, locally via wrangler on :8788 (also LAN-reachable)
npm test           # unit tests + 50–300ms latency simulation
npm run typecheck
```

`npm run worker` runs the same rooms the way they will run on Cloudflare (one Durable Object per room), with no account needed. Saving isn't available there yet.

To try a private library locally:

1. Make a key and put it in `worker/.dev.vars` (git-ignored), naming the library, e.g. `band`:
   ```sh
   node -e "console.log(require('crypto').randomBytes(16).toString('base64url'))"
   # worker/.dev.vars:
   LIBRARY_KEYS={"band":"<the key>"}
   ```
2. Upload the library checkout to the local R2 bucket (from `worker/`): `node scripts/sync-library.mjs ../../onbeat-library band`
3. `npm run worker`, then open `http://<laptop-ip>:8788/#k=<the key>` once on each phone. The key is remembered; the lobby says when a private library is connected. Rooms created after that use the private library, and tapping the room code shows a QR code and link (with the key) for bandmates.

Without a key you only get the public example song.

## Deploy to Cloudflare

Everything runs from `worker/` with the wrangler installed by `npm install`.

1. Log in once: `npx wrangler login`.
2. Create the private bucket: `npx wrangler r2 bucket create onbeat-songs`.
3. First deploy, from the repo root: `npm run deploy`. It prints the `https://onbeat.<your-subdomain>.workers.dev` address. (A new account is asked to pick a workers.dev subdomain first.)
4. Set the library keys. Make a fresh key (not the local one) and keep it somewhere safe; it is what goes into band links:
   ```sh
   node -e "console.log(require('crypto').randomBytes(16).toString('base64url'))"
   echo '{"band":"<the key>"}' | npx wrangler secret put LIBRARY_KEYS
   ```
5. Upload the library: `node scripts/sync-library.mjs ../../onbeat-library band --remote`.
6. Open `https://onbeat.<subdomain>.workers.dev/#k=<the key>` on each phone once.

To let the app save drum edits into the private library (they become commits in the library repo, named after the device that saved), give the Worker a GitHub token that can only write that repo: create a fine-grained token with **Contents: Read and write** on the library repo alone, then

```sh
echo '{"band":{"repo":"<owner>/<library repo>","token":"<the token>"}}' | npx wrangler secret put LIBRARY_GITHUB
```

Without it the private library is read-only in the app.

The library repo has its own Action (`.github/workflows/sync.yml` there) that validates the songs and mirrors them into R2 on every push. It needs the same two secrets as below, `CLOUDFLARE_API_TOKEN` (with R2 edit) and `CLOUDFLARE_ACCOUNT_ID`, set on the library repo. Open rooms pick up the new songs within a minute.

After that, pushes to `main` deploy through `.github/workflows/deploy.yml`, once the repo has two secrets: `CLOUDFLARE_API_TOKEN` (a token from the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID` (`npx wrangler whoami` shows it). Set them with `gh secret set CLOUDFLARE_API_TOKEN` and `gh secret set CLOUDFLARE_ACCOUNT_ID`.

## Licenses

| Component | License |
| --- | --- |
| React, react-dom | MIT |
| ws | MIT |
| sirv | MIT |
| tsx | MIT |
| wrangler, @cloudflare/workers-types (dev only) | MIT OR Apache-2.0 |
| uqr (QR codes) | MIT |
| Default drum kit (`web/public/kits/default/`, generated by `tools/gen-kit.mjs`) | CC0 |
