// The hand-written song layout, used by every save path so diffs stay small.
const MAX_INLINE = 100;

/** JSON with small objects and arrays kept on one line, the way song files are written by hand. */
export function formatJson(value: unknown, indent = '', keyWidth = 0): string {
  const flat = inline(value);
  if (typeof value !== 'object' || value === null || indent.length + keyWidth + flat.length <= MAX_INLINE) return flat;
  const inner = indent + '  ';
  const items = Array.isArray(value)
    ? value.map((v) => inner + formatJson(v, inner))
    : Object.entries(value).map(([k, v]) => {
        const key = `${JSON.stringify(k)}: `;
        return inner + key + formatJson(v, inner, key.length);
      });
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return `${open}\n${items.join(',\n')}\n${indent}${close}`;
}

function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`);
    return entries.length ? `{ ${entries.join(', ')} }` : '{}';
  }
  return JSON.stringify(value);
}
