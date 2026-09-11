// the app-less placeholder. the daemon wait is deliberately not this: it clears on
// its own, so it stays a single quiet line rather than a titled panel
export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="text-center">
        <div className="font-display text-title text-soft">{title}</div>
        {detail && <div className="mt-2 text-body text-dim">{detail}</div>}
      </div>
    </div>
  );
}
