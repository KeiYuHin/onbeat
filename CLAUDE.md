# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OnBeat is a PWA for band rehearsal. Each member opens a shared 6-digit room on their own phone and picks a part (guitar1 / guitar2 / bass / drums / keys). Any member can start or stop, and every device shows the same bar and beat, all driven by one shared clock. `SPEC.md` (written in Chinese) is the source of truth for scope, the sync model, the song format and the milestones. Read it before starting a milestone.

Milestones: M1 sync core → M2 score display → M2.5 metronome + drum machine → M3 rehearsal controls → M4 content (editor, ChordPro, alphaTab) → M4.5 scale-degree charts (级数谱, PDF import) → M5 later. Status: M1 is done and has been tested on real devices (RTT is about 7–9ms on LAN). M2 has passed multi-device testing. M2.5 has passed phone testing. Its follow-up is waiting for phone testing: the loop view, 再绕一遍, a portrait fix for the sound settings, and the room drum editor.

## Commands

Node 24+, npm workspaces (`shared`, `server`, `web`). Run everything from the repo root.

- `npm run dev`: server on :8787 (tsx watch) plus Vite on :5173. Vite proxies `/ws` to the server and listens on the LAN.
- `npm run server`: builds `web/dist`, then serves the app and `/ws` on a single port (`PORT`, default 8787). This is the rehearsal-room and deploy mode.
- `npm test`: runs vitest over `shared/src/**/*.test.ts` and `server/src/**/*.test.ts`.
- Single file: `npx vitest run server/src/sync.sim.test.ts`. Single test: `npx vitest run -t "late joiner"`.
- `npm run typecheck`: runs `tsc` over each package. There is no linter.

## Architecture

- `shared` is consumed as raw TypeScript (its `exports` point at `src/index.ts`). There is no build step: Vite, tsx and vitest all compile it. It holds:
  - `protocol.ts`: message types, plus `parseClientMsg`, which validates all untrusted client input.
  - `timeline.ts`: pure functions for position math and state transitions.
  - `clock.ts`: `ClockSync`, which is transport-agnostic. The browser and the server tests use the same class.
  - `song.ts`: `parseSong` validates hand-written JSON and returns a normalized copy (`{ loop, times }` sections expanded to `bars`). `compileSong(song, extraPasses)` unrolls `form` into a flat, beat-indexed timeline of bars and numbered sections ("副歌 2"). Each section gets `loopBars` × `times` from `repeatPeriod` (minimal repeating period) plus live extra passes. `songPosition` maps a beat to section, bar, chord and the next chord change. `applyDrumEdits` overlays a room's unsaved drum patterns.
- **Position is derived, never streamed.** The server broadcasts `PlaybackState` (anchor time and beat, bpm) only when it changes. Each client computes `beatAt(state, clock.serverNow())` every frame. Any new command (seek, setBpm, loop) must be a pure `PlaybackState → PlaybackState` transition in `timeline.ts` that keeps `beatAt` continuous at the switch moment. Per the spec, seeks and BPM changes take effect at the next barline.
- Both sides use `performance.now()` (monotonic). Never use `Date.now()`. A server restart resets its clock: `smoothOffset` jumps instead of blending when the change is >50ms, and clients resync on every reconnect.
- **Start** anchors one count-in bar at `serverNow + 1500ms`, so beats are negative before song start: below −beatsPerBar means waiting, −beatsPerBar to 0 is the count-in.
- `server/src/server.ts` (`startServer`) keeps all room state in memory. Empty rooms linger for 10 minutes so reloading phones can rejoin. A ping heartbeat reaps sleeping phones. The `latencyMs` option injects per-message delay in both directions for the simulation test, kept FIFO per connection.
- `web/src/connection.ts` (`RoomConnection`) owns one socket and reconnects, rejoining by room code. It feeds React through `useSyncExternalStore`. The `Room` component creates it in an effect, so StrictMode double-mounts are safe.
- Songs live in `songs/*.json`. The server loads them at startup (`SONGS_DIR` overrides the location), refuses to start on an invalid file, and sends the whole catalog to each client on join. The web app never bundles songs. Beats per bar is `timeSignature[0]`.
- The protocol goes slightly beyond the spec: `create {part}` (the server generates the code), `cmd selectSong {songId}` (stops and resets to the song's tempo), plus server-to-client `welcome {room, memberId}`, `songs {songs}` and `error {code}`. It also adds:
  - `cmd repeatSection {sectionIndex}` ("再绕一遍"): adds to `PlaybackState.extraPasses`, which is part of the timeline because it moves every later bar. It is refused within `REPEAT_MARGIN_BEATS` of the section's end, and `startPlayback` clears it.
  - `cmd setDrums`: room-level drum edits, broadcast as `edits {songId, drums}` and cleared on song change. Clients compile `applyDrumEdits(song, edits)`.
  - `cmd saveSong`: `startServer`'s `saveSong` hook writes the edits into the song file. `server/src/songs.ts` keeps the raw JSON so `loop` notation and layout survive, writes atomically, and then the server re-broadcasts `songs`.
- `web/src/ScoreView.tsx` re-renders every animation frame and derives everything from the current beat. Keep it free of local counters and timers. Its `LoopView` (the spec's default loop view) shows one pass of the section as bar cards. It computes the pass as `floor(beatInSection / (loopBars * beatsPerBar))` and previews the next section on the last pass.
- Settings and editors open in `Sheet` overlays, never inline, because the room layout fills the screen and inline panels overlap the score in portrait.

## Everything follows the sync clock

Anything that moves in time is a function of `beatAt(state, clock.serverNow())`, never a clock of its own:

- **Audio (M2.5):** sounds are events at beat positions. `shared/src/sound.ts` (`soundEvents`) derives metronome, count-in, drum-pattern and fill events for a beat window as a pure function. `web/src/audio/engine.ts` (`AudioEngine`) wakes every 25ms and schedules the next 100ms on the AudioContext clock, never firing sounds from timers. It maps performance time to audio time at the speaker with `getOutputTimestamp()`, which already includes output latency (the fallback subtracts `outputLatency`). The lookahead window starts at the output latency, so events reach the audio thread about 100ms early. It applies a per-device ±300ms compensation slider for Bluetooth, and drops and reschedules its queue on any playback, song or sound-setting change. Sound settings are per device (localStorage `onbeat.sound`). Drum patterns are `x`/`X`/`.` step strings, `beatsPerBar*4` long, in the `drums` part. The kit WAVs in `web/public/kits/default/` come from `tools/gen-kit.mjs`.
- **alphaTab (M4):** an optional Guitar Pro / MusicXML layer on top of the JSON skeleton, rendering only the user's track. Never use alphaTab's player timing. Set its cursor every frame from our position, and map beat → bar using the playback order with repeats unrolled.
- The JSON skeleton (sections, bars, chords, strums) is the only layer sync depends on.

## Constraints from the spec

- Lyrics are an optional song field (personal project, local use).
- The scale-degree (级数谱) section of the spec is a proposal: **confirm the design with the user before implementing any of it**, including degree-based chord storage, key changes and cues.
- Out of MVP scope: accounts, audio backing tracks, native apps. No DB and no login. Songs are JSON in the repo.
- Record third-party dependency licenses (alphaTab etc.) in `README.md`.
- The UI is in Chinese and uses large type, readable from about 1m. It must work in both portrait and landscape.
- On iOS Safari, audio unlock needs a tap and Wake Lock needs HTTPS. Both must be verified on a real device.
- Work one milestone at a time. At the end of each, stop so the user can test on phones, and update `README.md` with how to run locally and open on a phone.
