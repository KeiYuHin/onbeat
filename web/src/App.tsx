import { useState } from 'react';
import { PARTS, PART_LABELS, ROOM_CODE_RE, type Part } from '@onbeat/shared';
import type { RoomTarget } from './connection';
import { Room } from './Room';

const PART_KEY = 'onbeat.part';

function savedPart(): Part {
  try {
    const p = localStorage.getItem(PART_KEY) as Part | null;
    if (p && PARTS.includes(p)) return p;
  } catch {}
  return 'guitar1';
}

function setRoomInUrl(room: string | null) {
  const url = new URL(location.href);
  if (room) url.searchParams.set('room', room);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

export function App() {
  const [target, setTarget] = useState<RoomTarget | null>(null);
  const [part, setPart] = useState<Part>(savedPart);
  const [code, setCode] = useState(() => new URL(location.href).searchParams.get('room') ?? '');

  const remember = (p: Part) => {
    try {
      localStorage.setItem(PART_KEY, p);
    } catch {}
  };

  const enter = (t: RoomTarget) => {
    remember(part);
    setTarget(t);
  };

  const switchPart = (p: Part) => {
    remember(p);
    setPart(p);
  };

  const leave = () => {
    setTarget(null);
    setCode('');
    setRoomInUrl(null);
  };

  if (target) return (
      <Room target={target} part={part} onPartChange={switchPart} onLeave={leave} onRoom={setRoomInUrl} />
    );;

  return (
    <main className="lobby">
      <h1>OnBeat</h1>

      <section>
        <h2>我的声部</h2>
        <div className="parts">
          {PARTS.map((p) => (
            <button key={p} className={p === part ? 'selected' : ''} onClick={() => setPart(p)}>
              {PART_LABELS[p]}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>加入房间</h2>
        <form
          className="join"
          onSubmit={(e) => {
            e.preventDefault();
            if (ROOM_CODE_RE.test(code)) enter({ room: code });
          }}
        >
          <input
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            placeholder="6 位房间码"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <button type="submit" disabled={!ROOM_CODE_RE.test(code)}>
            加入
          </button>
        </form>
      </section>

      <button className="create" onClick={() => enter({ create: true })}>
        创建新房间
      </button>
    </main>
  );
}
