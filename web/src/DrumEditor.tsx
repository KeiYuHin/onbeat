import { useEffect, useState } from 'react';
import {
  defaultDrumPattern,
  drumPresets,
  DRUMS,
  hasDrumEdits,
  partDetail,
  sectionName,
  stepsPerBar,
  type CompiledSong,
  type Drum,
  type DrumEdits,
  type DrumPattern,
  type Part,
  type SectionDrumEdit,
} from '@onbeat/shared';
import { useDeviceName } from './deviceName';

const DRUM_LABELS: Record<Drum, string> = {
  kick: '底鼓',
  snare: '军鼓',
  hat: '踩镲',
  crash: '吊镲',
  ride: '叮叮',
  tom: '通鼓',
};
const NEXT_HIT: Record<string, string> = { '.': 'x', x: 'X', X: '.' };
/** On narrow screens a bar is split into rows of this many beats, so cells stay big enough to tap. */
const NARROW_BEATS = 2;
const WIDE_QUERY = '(min-width: 700px)';

function useWide() {
  const [wide, setWide] = useState(() => matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(WIDE_QUERY);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return wide;
}

type Props = {
  /** The song with the room's edits already applied. */
  compiled: CompiledSong;
  edits: DrumEdits;
  initialSectionId: string | null;
  onSet: (sectionId: string | null, pattern: SectionDrumEdit | null) => void;
  onSetAll: (pattern: DrumPattern) => void;
  /** `device` is this device's name, recorded with the save. */
  onSave: (device: string | undefined) => void;
  /** This device's part, for the default device name. */
  part: Part;
};

/**
 * Edits the drum machine patterns: one for the whole song (全曲默认), which every section uses
 * unless it has a pattern of its own. Every change syncs to the room.
 */
export function DrumEditor({ compiled, edits, initialSectionId, onSet, onSetAll, onSave, part }: Props) {
  const { song, meter } = compiled;
  const spb = meter.stepsPerBeat;
  const [device, setDevice] = useDeviceName(part);
  const steps = stepsPerBar(meter);
  const chunkSteps = useWide() ? steps : NARROW_BEATS * spb;
  const sectionIds = [...new Set(song.form)];
  const [target, setTarget] = useState<string | null>(initialSectionId);

  const own = (id: string | null): DrumPattern | null => {
    const p = id === null ? song.parts.drums?.default.pattern : song.parts.drums?.sections?.[id]?.pattern;
    return p && typeof p === 'object' ? p : null;
  };
  const songDefault = own(null) ?? defaultDrumPattern(meter);
  const pattern = (target !== null && own(target)) || songDefault;
  const edited = target === null ? !!edits.default : !!edits.sections?.[target];
  const withOwn = sectionIds.filter((id) => own(id));

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
            <small>{own(id) ? '（单独）' : '（跟默认）'}</small>
          </button>
        ))}
      </div>

      {target === null ? (
        <p className="muted">
          全曲默认：没有单独节奏型的段落都用这个。
          {withOwn.length > 0 && <> 现在单独设置的：{withOwn.map((id) => sectionName(song, id)).join('、')}。</>}
        </p>
      ) : (
        <p className="muted">
          {own(target) ? `${sectionName(song, target)}用自己的节奏型。` : `${sectionName(song, target)}现在跟全曲默认；一改就变成单独的。`}
        </p>
      )}

      <div className="presets">
        {drumPresets(meter).map((p) => (
          <button key={p.name} onClick={() => onSet(target, p.pattern)}>
            {p.name}
          </button>
        ))}
      </div>

      <div className="editor-grid">
        {Array.from({ length: Math.ceil(steps / chunkSteps) }, (_, chunk) => {
          const first = chunk * chunkSteps;
          const count = Math.min(chunkSteps, steps - first);
          return (
            <div key={chunk} className="chunk">
              <div className="drum-row beats">
                <span className="drum-name" />
                {Array.from({ length: count }, (_, i) => (
                  <span key={i} className={`beat-number${(first + i) % spb === 0 ? ' beat' : ''}`}>
                    {(first + i) % spb === 0 ? (first + i) / spb + 1 : ''}
                  </span>
                ))}
              </div>
              {DRUMS.map((drum) => (
                <div key={drum} className="drum-row">
                  <span className="drum-name">{DRUM_LABELS[drum]}</span>
                  {Array.from({ length: count }, (_, i) => {
                    const step = first + i;
                    const hit = pattern[drum]?.[step] ?? '.';
                    return (
                      <button
                        key={step}
                        aria-label={`${DRUM_LABELS[drum]} 第 ${step + 1} 步`}
                        className={`cell${hit === 'X' ? ' hit accent' : hit === 'x' ? ' hit' : ''}${step % spb === 0 ? ' beat' : ''}`}
                        onClick={() => toggle(drum, step)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <p className="muted">点格子：空 → 敲 → 重音 → 空。改动马上同步给房间里所有人。</p>

      <div className="editor-actions">
        {target === null && withOwn.length > 0 && (
          <button className="apply-all" onClick={() => onSetAll(songDefault)}>
            所有段落都用这个节奏
          </button>
        )}
        {target !== null && own(target) && <button onClick={() => onSet(target, 'default')}>改回跟全曲默认</button>}
        {edited && <button onClick={() => onSet(target, null)}>撤销这里的改动</button>}
        <button className="save" disabled={!hasDrumEdits(edits)} onClick={() => onSave(device.trim() || undefined)}>
          保存到歌曲文件
        </button>
      </div>
      <label className="device-name">
        本机名称（记在保存记录里）
        <input value={device} maxLength={40} onChange={(e) => setDevice(e.target.value)} />
      </label>
      <p className="muted">
        {hasDrumEdits(edits)
          ? '有未保存的改动：房间解散或换歌后就没了。保存后写进曲库（私有曲库会提交到 GitHub，记下本机名称）。'
          : '没有未保存的改动。'}
      </p>
    </div>
  );
}
