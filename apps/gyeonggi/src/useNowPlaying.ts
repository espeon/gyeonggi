import type { BridgethingClient, MediaItem } from '@bridgething/client';
import { useEffect, useState } from 'react';
import { fixtureCover, MOCK } from './mock';

export type NowPlaying = {
  title: string;
  artist: string | null;
  artUrl: string | null;
};

// the track the phone is playing. artwork arrives as bytes, so it is held as an
// object url and revoked when the track changes rather than leaked per track
export function useNowPlaying(client: BridgethingClient | null): NowPlaying | null {
  const [track, setTrack] = useState<{ title: string; artist: string | null; artId: string | null } | null>(null);
  const [artUrl, setArtUrl] = useState<string | null>(null);

  useEffect(() => {
    // the fixture track keeps the design loop honest in ?mock
    if (MOCK) {
      setTrack({ title: 'Midnight City (Extended Mix)', artist: 'M83', artId: null });
      setArtUrl(fixtureCover('M', 0).url);
      return;
    }
    if (!client) return;
    const take = (t: MediaItem | null) =>
      t?.title ? { title: t.title, artist: t.artist, artId: t.artworkId } : null;
    const off = client.player.onSnapshot(r => setTrack(take(r.state.track)));
    void client.player.stateGet().then(res => {
      if (res.ok) setTrack(take(res.response.state.track));
    });
    return off;
  }, [client]);

  useEffect(() => {
    if (MOCK) return;
    if (!client || !track?.artId) {
      setArtUrl(null);
      return;
    }
    let dead = false;
    let url: string | null = null;
    void client.asset
      .get({ id: track.artId, requestId: crypto.randomUUID() })
      .then(res => {
        if (dead || !res.ok) return;
        const bytes = Uint8Array.from(res.response.bytes as unknown as number[]);
        url = URL.createObjectURL(new Blob([bytes], { type: res.response.mime ?? 'image/jpeg' }));
        setArtUrl(url);
      });
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [client, track?.artId]);

  return track ? { title: track.title, artist: track.artist, artUrl } : null;
}
