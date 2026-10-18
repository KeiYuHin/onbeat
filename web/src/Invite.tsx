import { useMemo, useState } from 'react';
import { renderSVG } from 'uqr';
import { inviteUrl } from './libraryKey';

/** The room link as a QR code to scan across the rehearsal room, plus copy/share for the group chat. */
export function Invite({ room, libraryKey }: { room: string; libraryKey: string | null }) {
  const url = inviteUrl(room, libraryKey);
  // The SVG is generated here from our own URL, so injecting it is safe.
  const qr = useMemo(() => renderSVG(url, { pixelSize: 8 }), [url]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="invite">
      <p className="invite-code">{room}</p>
      <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />
      <p className="invite-url">{url}</p>
      <div className="invite-actions">
        <button onClick={copy}>{copied ? '已复制' : '复制链接'}</button>
        {'share' in navigator && <button onClick={() => navigator.share({ title: 'OnBeat 排练房间', url }).catch(() => {})}>分享</button>}
      </div>
      {libraryKey && <p className="hint">链接里带着曲库密钥，只发给乐队成员。</p>}
    </div>
  );
}
