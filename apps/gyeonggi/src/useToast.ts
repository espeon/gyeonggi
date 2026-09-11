import { useCallback, useState } from 'react';

const TOAST_MS = 1600;

// an auto-dismissing status line. saying the message already showing restarts its
// dismissal rather than clearing it, so a repeated failure does not blink
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const say = useCallback((msg: string) => {
    setMessage(msg);
    window.setTimeout(() => setMessage(cur => (cur === msg ? null : cur)), TOAST_MS);
  }, []);
  return { message, say };
}
