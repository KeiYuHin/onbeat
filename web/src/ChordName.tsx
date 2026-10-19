import type { ChordSlot, Key } from '@onbeat/shared';
import type { ChordLabel } from './display';

export type ChordNamer = (slot: ChordSlot, key: Key) => ChordLabel;

/** A chord name, with the scale degree in small type beside it when showing both. */
export function ChordName({ label, className }: { label: ChordLabel; className?: string }) {
  return (
    <span className={className}>
      {label.main}
      {label.alt && <small className="chord-alt">{label.alt}</small>}
    </span>
  );
}
