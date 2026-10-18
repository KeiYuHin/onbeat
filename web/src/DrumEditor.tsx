import { useState } from 'react';
import {
  defaultDrumPattern,
  drumPresets,
  DRUMS,
  hasDrumEdits,
  partDetail,
  sectionName,
  type CompiledSong,
  type Drum,
  type DrumEdits,
  type DrumPattern,
} from '@onbeat/shared';

const DRUM_LABELS: Record<Drum, string> = {
  kick: '底鼓',
  snare: '军鼓',
  hat: '踩镲',
  crash: '吊镲',
  ride: '叮叮',
  tom: '通鼓',
};
const NEXT_HIT: Record<string, string> = { '.': 'x', x: 'X', X: '.' };
const STEPS_PER_CHUNK = 8; // two beats per row, so the grid stays tappable on a phone

type Props = {
  /** The song with the room's edits already applied. */
  compiled: CompiledSong;
  edits: DrumEdits;
  initialSectionId: string | null;
  onSet: (sectionId: string | null, pattern: DrumPattern | null) => void;
  onSave: () => void;
};

/** Edits the drum machine pattern of the whole song or of one section; every change syncs to the room. */
export function DrumEditor({ compiled, edits, initialSectionId, onSet, onSave }: Props) {
  const { song, beatsPerBar } = compiled;
  const steps = beatsPerBar * 4;
  const sectionIds = [...new Set(song.form)];
  const [target, setTarget] = useState<string | null>(initialSectionId);

  const own = (id: string | null): DrumPattern | null => {
    const p = id === null ? song.parts.drums?.default.pattern : song.parts.drums?.sections?.[id]?.pattern;
    return typeof p === 'object' ? p : null;
  };
  const songDefault = own(null) ?? defaultDrumPattern(beatsPerBar);
  const effective = (id: string | null) => {
    const p = id === null ? null : partDetail(song, 'drums', id)?.pattern;
    return p && typeof p === 'object' ? p : songDefault;
  };
  const pattern = effective(target);
  const edited = target === null ? !!edits.default : !!edits.sections?.[target];

  const toggle = (drum: Drum, step: number) => {
    const row = (pattern[drum] ?? '.'.repeat(steps)).split('');
    row[step] = NEXT_HIT[row[step]] ?? 'x';
    const next: DrumPattern = { ...pattern, [drum]: row.join('') };
    // Leave out silent rows so saved files stay short.
    for (const d of DRUMS) if (!next[d]?.includes('x') && !next[d]?.includes('X')) delete next[d];
    onSet(target, next);
  };

  return (
    <div className="drum-editor">
      <div className="targets">
        <button className={target === null ? 'selected' : ''} onClick={() => setTarget(null)}>
          全曲默认
        </button>
        {sectionIds.map((id) => (
          <button key={id} className={target === id ? 'selected' : ''} onClick={() => setTarget(id)}>
            {sectionName(song, id)}
            {!own(id) && <small>（跟默认）</small>}
          </button>
        ))}
      </div>

      <div className="presets">
        {drumPresets(beatsPerBar).map((p) => (
          <button key={p.name} onClick={() => onSet(target, p.pattern)}>
            {p.name}
          </button>
        ))}
      </div>

      <p className="muted">点格子：空 → 敲 → 重音 → 空。改动马上同步给房间里所有人。</p>

      <div className="editor-grid">
        {Array.from({ length: Math.ceil(steps / STEPS_PER_CHUNK) }, (_, chunk) => (
          <div key={chunk} className="chunk">
            {DRUMS.map((drum) => (
              <div key={drum} className="drum-row">
                <span className="drum-name">{DRUM_LABELS[drum]}</span>
                {Array.from({ length: Math.min(STEPS_PER_CHUNK, steps - chunk * STEPS_PER_CHUNK) }, (_, i) => {
                  const step = chunk * STEPS_PER_CHUNK + i;
                  const hit = pattern[drum]?.[step] ?? '.';
                  return (
                    <button
                      key={step}
                      aria-label={`${DRUM_LABELS[drum]} 第 ${step + 1} 步`}
                      className={`cell${hit === 'X' ? ' hit accent' : hit === 'x' ? ' hit' : ''}${step % 4 === 0 ? ' beat' : ''}`}
                      onClick={() => toggle(drum, step)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="editor-actions">
        {edited && (
          <button onClick={() => onSet(target, null)}>撤销这里的改动</button>
        )}
        <button className="save" disabled={!hasDrumEdits(edits)} onClick={onSave}>
          保存到歌曲文件
        </button>
      </div>
      <p className="muted">
        {hasDrumEdits(edits) ? '有未保存的改动：房间解散或换歌后就没了，保存后写进服务器上的歌曲文件。' : '没有未保存的改动。'}
      </p>
    </div>
  );
}
