import type { BassRhythm, Subdivision } from '@onbeat/shared';
import { LATENCY_RANGE_MS, type BassTone, type SoundSettings } from './audio/settings';

const SUBDIVISIONS: [Subdivision, string][] = [
  [1, '四分'],
  [2, '八分'],
  [4, '十六分'],
];

const BASS_RHYTHMS: [BassRhythm, string][] = [
  [0, '长音'],
  [1, '四分'],
  [2, '八分'],
];

const BASS_TONES: [BassTone, string][] = [
  ['bass', '贝斯'],
  ['sine', '正弦'],
];

type Props = {
  settings: SoundSettings;
  onChange: (patch: Partial<SoundSettings>) => void;
  /** Called from the tap that turns sound on, so the browser lets audio start. */
  onEnable: () => void;
  onEditDrums?: () => void;
};

export function SoundPanel({ settings: s, onChange, onEnable, onEditDrums }: Props) {
  return (
    <div className="sound-panel">
      <Toggle
        label="本机出声"
        on={s.enabled}
        onClick={() => {
          if (!s.enabled) onEnable();
          onChange({ enabled: !s.enabled });
        }}
      />
      <div className="row">
        <Toggle label="节拍器" on={s.metronome} onClick={() => onChange({ metronome: !s.metronome })} />
        <div className="segmented">
          {SUBDIVISIONS.map(([n, label]) => (
            <button
              key={n}
              className={s.subdivision === n ? 'selected' : ''}
              disabled={!s.metronome}
              onClick={() => onChange({ subdivision: n })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <Toggle label="预备拍出声" on={s.countIn} onClick={() => onChange({ countIn: !s.countIn })} />
      <div className="row">
        <Toggle label="鼓机" on={s.drums} onClick={() => onChange({ drums: !s.drums })} />
        <Toggle label="段落加花" on={s.fills} disabled={!s.drums} onClick={() => onChange({ fills: !s.fills })} />
        {onEditDrums && <button onClick={onEditDrums}>编辑鼓谱（全房间）</button>}
      </div>
      <div className="row">
        <Toggle label="根音贝斯" on={s.bass} onClick={() => onChange({ bass: !s.bass })} />
        <div className="segmented">
          {BASS_RHYTHMS.map(([n, label]) => (
            <button
              key={n}
              className={s.bassRhythm === n ? 'selected' : ''}
              disabled={!s.bass}
              onClick={() => onChange({ bassRhythm: n })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="segmented">
          {BASS_TONES.map(([tone, label]) => (
            <button
              key={tone}
              className={s.bassTone === tone ? 'selected' : ''}
              disabled={!s.bass}
              onClick={() => onChange({ bassTone: tone })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <Toggle label="闪屏" on={s.flash} onClick={() => onChange({ flash: !s.flash })} />

      <label className="slider">
        <span>音量 {Math.round(s.volume * 100)}%</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={s.volume}
          onChange={(e) => onChange({ volume: Number(e.target.value) })}
        />
      </label>
      <label className="slider">
        <span>
          本机延迟补偿 {s.latencyMs > 0 ? '+' : ''}
          {s.latencyMs}ms <small>（往右 = 提前出声）</small>
        </span>
        <input
          type="range"
          min={-LATENCY_RANGE_MS}
          max={LATENCY_RANGE_MS}
          step={5}
          value={s.latencyMs}
          onChange={(e) => onChange({ latencyMs: Number(e.target.value) })}
        />
      </label>
      {s.latencyMs !== 0 && (
        <button className="small" onClick={() => onChange({ latencyMs: 0 })}>
          延迟补偿归零
        </button>
      )}
      <p className="muted">
        尽量用有线耳机或音箱。蓝牙耳机通常慢 150–300ms：听到的 click 比屏幕闪烁晚，就把延迟补偿往右调，直到对上。
      </p>
    </div>
  );
}

function Toggle({ label, on, disabled, onClick }: { label: string; on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button className={`toggle${on ? ' on' : ''}`} aria-pressed={on} disabled={disabled} onClick={onClick}>
      {label}：{on ? '开' : '关'}
    </button>
  );
}
