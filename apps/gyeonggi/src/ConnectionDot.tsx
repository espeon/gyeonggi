import type { ConnectionState } from '@bridgething/client';

// the daemon link indicator; the state name only shows while the link is not open
export function ConnectionDot({ conn, className = '' }: { conn: ConnectionState; className?: string }) {
  const tone = conn === 'open' ? 'bg-ok' : conn === 'connecting' ? 'bg-warn' : 'bg-err';
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {conn !== 'open' && <span className="font-mono text-hint text-dim">{conn}</span>}
      <span className={`h-2 w-2 rounded-full ${tone}`} />
    </div>
  );
}
