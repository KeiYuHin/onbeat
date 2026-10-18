# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OnBeat is a PWA for band rehearsal. Each member opens a shared 6-digit room on their own phone and picks a part (guitar1 / guitar2 / bass / drums / keys). Any member can start or stop, and every device shows the same bar and beat, all driven by one shared clock. `SPEC.md` (written in Chinese) is the source of truth for scope, the sync model, the song format and the milestones. Read it before starting a milestone.

Milestones: M1 sync core → M2 score display → M2.5 metronome + drum machine → M3 rehearsal controls → M4 content (editor, ChordPro, alphaTab) → M5 later. Status: M1 is done and has been tested on real devices. Measured RTT is about 7–9ms on LAN.

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
- **Position is derived, never streamed.** The server broadcasts `PlaybackState` (anchor time and beat, bpm) only when it changes. Each client computes `beatAt(state, clock.serverNow())` every frame. Any new command (seek, setBpm, loop) must be a pure `PlaybackState → PlaybackState` transition in `timeline.ts` that keeps `beatAt` continuous at the switch moment. Per the spec, seeks and BPM changes take effect at the next barline.
- Both sides use `performance.now()` (monotonic). Never use `Date.now()`. A server restart resets its clock: `smoothOffset` jumps instead of blending when the change is >50ms, and clients resync on every reconnect.
- **Start** anchors one count-in bar at `serverNow + 1500ms`, so beats are negative before song start: below −beatsPerBar means waiting, −beatsPerBar to 0 is the count-in.
- `server/src/server.ts` (`startServer`) keeps all room state in memory. Empty rooms linger for 10 minutes so reloading phones can rejoin. A ping heartbeat reaps sleeping phones. The `latencyMs` option injects per-message delay in both directions for the simulation test, kept FIFO per connection.
- `web/src/connection.ts` (`RoomConnection`) owns one socket and reconnects, rejoining by room code. It feeds React through `useSyncExternalStore`. The `Room` component creates it in an effect, so StrictMode double-mounts are safe.
- The protocol goes slightly beyond the spec: `create {part}` (the server generates the code), plus server-to-client `welcome {room, memberId}` and `error {code}`.
- M1 has no songs: `songId` is `null` and beats per bar is fixed at `DEFAULT_BEATS_PER_BAR`. M2 replaces both from the song JSON.

## Everything follows the sync clock

Anything that moves in time is a function of `beatAt(state, clock.serverNow())`, never a clock of its own:

- **Audio (M2.5):** sounds are events at beat positions. Use Web Audio lookahead scheduling: every 25ms, schedule the next 100ms of events on `AudioContext.currentTime`, never `setTimeout`. Map sync time to audio time with `audioContext.getOutputTimestamp()` minus `outputLatency`, plus a per-device ±300ms latency slider (for Bluetooth). Each device has its own sound on/off switch. Drum patterns live in the song JSON's `drums` part as 16-step strings, with CC0 samples in `web/public/kits/`.
- **alphaTab (M4):** an optional Guitar Pro / MusicXML layer on top of the JSON skeleton, rendering only the user's track. Never use alphaTab's player timing. Set its cursor every frame from our position, and map beat → bar using the playback order with repeats unrolled.
- The JSON skeleton (sections, bars, chords, strums) is the only layer sync depends on.

## Constraints from the spec

- Example songs hold chords and structure only. **Never include lyrics.**
- Out of MVP scope: accounts, audio backing tracks, native apps. No DB and no login. Songs are JSON in the repo.
- Record third-party dependency licenses (alphaTab etc.) in `README.md`.
- The UI is in Chinese and uses large type, readable from about 1m. It must work in both portrait and landscape.
- On iOS Safari, audio unlock needs a tap and Wake Lock needs HTTPS. Both must be verified on a real device.
- Work one milestone at a time. At the end of each, stop so the user can test on phones, and update `README.md` with how to run locally and open on a phone.
