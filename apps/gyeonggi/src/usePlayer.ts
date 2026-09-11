import type { BridgethingClient, MediaItem } from '@bridgething/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fixtureCover, MOCK } from './mock';

export type NowPlayingTrack = {
  title: string;
  artist: string | null;
  album: string | null;
  artUrl: string | null;
};

export type Player = {
  track: NowPlayingTrack | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  toggle: () => void;
  seekBy: (deltaMs: number) => void;
  seekTo: (ms: number) => void;
  skip: (dir: 1 | -1) => void;
};

// what the daemon last reported, plus when it did, so the playhead can be
// extrapolated between snapshots rather than freezing until the next one
type Snapshot = {
  title: string;
  artist: string | null;
  album: string | null;
  artId: string | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  at: number;
};

type Playback = { state: 'stopped' | 'paused' | 'playing'; positionMs: number };

// how long a replaced artwork blob stays alive after it stops being current
const ARTWORK_LINGER_MS = 700;

const TICK_MS = 250;

// the fixtures run their own transport so the view and its controls can be driven
// with no phone attached. the second title is long enough to exercise the marquee
const MOCK_TRACKS = [
  { title: 'Midnight City (Extended Mix)', artist: 'M83', album: 'Hurry Up, We\u2019re Dreaming', durationMs: 210_000 },
  { title: 'Midnight City (Remastered 2011)', artist: 'M83 and the Neon Orchestra', album: 'Hurry Up, We\u2019re Dreaming', durationMs: 245_000 },
  { title: 'Outro', artist: 'M83', album: 'Hurry Up, We\u2019re Dreaming', durationMs: 190_000 },
];

export function usePlayer(client: BridgethingClient | null): Player {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [artUrl, setArtUrl] = useState<string | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [fixture, setFixture] = useState(0);

  // a superseded artwork is revoked a beat after it is replaced rather than on the spot.
  // revoking it immediately would blank the live image, since artUrl keeps pointing at it
  // until the next one resolves, and the view fades off it. one at a time is enough
  const retired = useRef<{ url: string; timer: number } | null>(null);
  const retire = useCallback((url: string) => {
    if (retired.current) {
      window.clearTimeout(retired.current.timer);
      URL.revokeObjectURL(retired.current.url);
    }
    retired.current = {
      url,
      timer: window.setTimeout(() => {
        retired.current = null;
        URL.revokeObjectURL(url);
      }, ARTWORK_LINGER_MS),
    };
  }, []);
  useEffect(() => () => {
    if (retired.current) URL.revokeObjectURL(retired.current.url);
  }, []);

  useEffect(() => {
    if (!MOCK) return;
    const t = MOCK_TRACKS[fixture];
    setSnap({
      title: t.title,
      artist: t.artist,
      album: t.album,
      artId: null,
      playing: true,
      positionMs: 42_000,
      durationMs: t.durationMs,
      at: Date.now(),
    });
    setArtUrl(fixtureCover(t.title, fixture).url);
  }, [fixture]);

  useEffect(() => {
    if (MOCK || !client) return;
    const apply = (track: MediaItem | null, playback: Playback, at: number) =>
      setSnap(
        track?.title
          ? {
              title: track.title,
              artist: track.artist,
              album: track.album,
              artId: track.artworkId,
              playing: playback.state === 'playing',
              positionMs: playback.positionMs,
              durationMs: track.durationMs ?? 0,
              at,
            }
          : null,
      );
    const off = client.player.onSnapshot(r => apply(r.state.track, r.state.playback, Date.now()));
    void client.player.stateGet().then(res => {
      if (res.ok) apply(res.response.state.track, res.response.state.playback, Date.now());
    });
    return off;
  }, [client]);

  useEffect(() => {
    if (MOCK) return;
    if (!client || !snap?.artId) {
      setArtUrl(null);
      return;
    }
    let dead = false;
    let url: string | null = null;
    void client.asset
      .get({ id: snap.artId, requestId: crypto.randomUUID() })
      .then(res => {
        if (dead || !res.ok) return;
        const bytes = Uint8Array.from(res.response.bytes as unknown as number[]);
        url = URL.createObjectURL(new Blob([bytes], { type: res.response.mime ?? 'image/jpeg' }));
        setArtUrl(url);
      });
    return () => {
      dead = true;
      if (url) retire(url);
    };
  }, [client, snap?.artId]);

  useEffect(() => {
    if (!snap) return;
    const { positionMs: base, at, playing, durationMs: total } = snap;
    const step = () => {
      const raw = base + (playing ? Date.now() - at : 0);
      setPositionMs(total > 0 ? Math.min(raw, total) : raw);
    };
    step();
    if (!playing) return;
    const id = window.setInterval(step, TICK_MS);
    return () => clearInterval(id);
  }, [snap]);

  const toggle = useCallback(() => {
    if (MOCK) {
      setSnap(s => (s ? { ...s, playing: !s.playing, positionMs, at: Date.now() } : s));
      return;
    }
    void (snap?.playing ? client?.player.pause() : client?.player.resume());
  }, [client, snap?.playing, positionMs]);

  const seekBy = useCallback(
    (deltaMs: number) => {
      const total = snap?.durationMs ?? 0;
      const next = Math.max(0, Math.min(total > 0 ? total : Infinity, positionMs + deltaMs));
      if (MOCK) {
        setSnap(s => (s ? { ...s, positionMs: next, at: Date.now() } : s));
        return;
      }
      void client?.player.seekTo({ positionMs: Math.round(next) });
    },
    [client, snap?.durationMs, positionMs],
  );

  // the scrubber already knows where the finger landed, so express the target as a
  // delta and let seekBy own the clamping and the mock path
  const seekTo = useCallback((ms: number) => seekBy(ms - positionMs), [seekBy, positionMs]);

  const skip = useCallback(
    (dir: 1 | -1) => {
      if (MOCK) {
        setFixture(i => (i + dir + MOCK_TRACKS.length) % MOCK_TRACKS.length);
        return;
      }
      void (dir === 1 ? client?.player.skipNext() : client?.player.skipPrev({ allowSeeking: true }));
    },
    [client],
  );

  return {
    track: snap ? { title: snap.title, artist: snap.artist, album: snap.album, artUrl } : null,
    playing: snap?.playing ?? false,
    positionMs,
    durationMs: snap?.durationMs ?? 0,
    toggle,
    seekBy,
    seekTo,
    skip,
  };
}
