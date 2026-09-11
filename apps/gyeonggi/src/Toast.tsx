// centred on the screen rather than on the flow origin, so it reads as a layer above
// everything else
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md border border-edge bg-screen px-4 py-2 font-mono text-hint text-near">
      {message}
    </div>
  );
}
