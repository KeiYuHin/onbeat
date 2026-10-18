import { capoKey, type Key } from '@onbeat/shared';
import { MAX_CAPO, type ChordNames, type DisplaySettings } from './display';

const CHORD_NAMES: [ChordNames, string][] = [
  ['letter', '字母'],
  ['degree', '级数'],
  ['both', '都显示'],
];

type Props = {
  settings: DisplaySettings;
  onChange: (patch: Partial<DisplaySettings>) => void;
  /** The song's key, or null when it doesn't name one (then there are no degrees). */
  songKey: Key | null;
};

/** How this device shows the chart: chord names and capo. */
export function DisplayPanel({ settings: d, onChange, songKey }: Props) {
  return (
    <div className="sound-panel">
      <h3>和弦</h3>
      <div className="segmented">
        {CHORD_NAMES.map(([value, label]) => (
          <button
            key={value}
            className={d.chords === value ? 'selected' : ''}
            disabled={!songKey && value !== 'letter'}
            onClick={() => onChange({ chords: value })}
          >
            {label}
          </button>
        ))}
      </div>
      {!songKey && <p className="muted">这首歌没有写调（key），只能显示字母和弦。</p>}

      <h3>变调夹</h3>
      <div className="row capo">
        <button disabled={d.capo <= 0} onClick={() => onChange({ capo: d.capo - 1 })} aria-label="变调夹降一品">
          −
        </button>
        <span className="capo-value">{d.capo ? `${d.capo} 品` : '不夹'}</span>
        <button disabled={d.capo >= MAX_CAPO} onClick={() => onChange({ capo: d.capo + 1 })} aria-label="变调夹升一品">
          +
        </button>
      </div>
      <p className="muted">
        {d.capo
          ? `字母和弦按指法显示${songKey ? `：${songKey.name}调夹 ${d.capo} 品，按 ${capoKey(songKey, d.capo).name}调弹` : ''}。级数不变。`
          : '夹了变调夹就设在这里，字母和弦会按指法显示。'}
      </p>
    </div>
  );
}
