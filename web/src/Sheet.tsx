import type { ReactNode } from 'react';

/** Full-height overlay for settings and editors, so opening one never squeezes the score. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button onClick={onClose}>完成</button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}
