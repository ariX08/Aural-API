/**
 * Recommendation Engine
 * Hybrid candidate generation for personal radio / For You / auto-play.
 * Combines YT Music radio, related, and Last.fm similar tracks.
 */

import { YTMusic } from "./ytmusic.ts";
import { LastFM } from "./lastfm.ts";
import type { YouTubeSearch } from "./youtube-search.ts";

export type RecommendSeed = {
  videoId?: string;
  title?: string;
  artist?: string;
};

export type RecommendOptions = {
  seeds?: RecommendSeed[];
  limit?: number;
  excludeIds?: string[];
  country?: string;
};

function normalizeTrack(t: any, source: string): any | null {
  if (!t) return null;
  const videoId = t.videoId || t.id || t.fallbackVideoId;
  if (!videoId) return null;
  const title = t.title || t.name || t.track || "Unknown";
  const artist =
    (Array.isArray(t.artists) ? t.artists.map((a: any) => a.name).filter(Boolean).join(", ") : null) ||
    t.artist ||
    t.author ||
    t.channel ||
    "";
  const thumbnail =
    t.thumbnail ||
    t.thumbnails?.[0]?.url ||
    t.thumbnails?.[t.thumbnails?.length - 1]?.url ||
    (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : "");
  return {
    videoId: String(videoId),
    title: String(title),
    artist: String(artist),
    thumbnail,
    duration: t.duration || t.lengthSeconds || null,
    source,
  };
}

export async function getRecommendations(
  opts: RecommendOptions,
  ytmusic: YTMusic,
  youtubeSearch: YouTubeSearch,
) {
  const limit = Math.min(Math.max(opts.limit ?? 40, 10), 80);
  const exclude = new Set((opts.excludeIds || []).map(String));
  const seeds = (opts.seeds || []).filter((s) => s.videoId || (s.title && s.artist));

  if (seeds.length === 0) {
    // Fallback: trending-ish
    try {
      const radio = await ytmusic.getWatchPlaylist(undefined, undefined, true, false, limit);
      const tracks = (radio.tracks || [])
        .map((t: any) => normalizeTrack(t, "radio"))
        .filter(Boolean)
        .filter((t: any) => !exclude.has(t.videoId))
        .slice(0, limit);
      return { success: true, tracks, strategy: "fallback-radio" };
    } catch {
      return { success: false, error: "No seeds and fallback failed", tracks: [] };
    }
  }

  const candidates: any[] = [];
  const seen = new Set<string>(exclude);

  const add = (list: any[], source: string, weight = 1) => {
    for (const raw of list) {
      const t = normalizeTrack(raw, source);
      if (!t || seen.has(t.videoId)) continue;
      seen.add(t.videoId);
      candidates.push({ ...t, _weight: weight });
    }
  };

  // 1. Primary: radio from strongest seed (first videoId)
  const primaryVideo = seeds.find((s) => s.videoId)?.videoId;
  if (primaryVideo) {
    try {
      const radio = await ytmusic.getWatchPlaylist(primaryVideo, undefined, true, false, 50);
      add(radio.tracks || [], "radio", 1.2);
    } catch (e) {
      console.warn("radio failed", e);
    }
  }

  // 2. Related for top seeds
  const relatedSeeds = seeds.filter((s) => s.videoId).slice(0, 3);
  await Promise.all(
    relatedSeeds.map(async (s) => {
      try {
        const related = await ytmusic.getRelated(s.videoId!);
        add(related || [], "related", 1.0);
      } catch {
        /* ignore */
      }
    }),
  );

  // 3. Last.fm similar for title+artist seeds
  const similarSeeds = seeds.filter((s) => s.title && s.artist).slice(0, 4);
  await Promise.all(
    similarSeeds.map(async (s) => {
      try {
        const similar = await LastFM.getSimilarTracks(s.title!, s.artist!, "8");
        if (Array.isArray(similar) && !(similar as any).error) {
          // Resolve to YT
          const resolved = await Promise.all(
            (similar as any[]).slice(0, 6).map(async (t: any) => {
              try {
                const r = await youtubeSearch.searchVideos(`${t.title} ${t.artist}`);
                return r.results?.[0] || null;
              } catch {
                return null;
              }
            }),
          );
          add(resolved.filter(Boolean), "lastfm-similar", 0.9);
        }
      } catch {
        /* ignore */
      }
    }),
  );

  // 4. Extra radio from secondary seeds if still short
  if (candidates.length < limit) {
    const extra = seeds.filter((s) => s.videoId && s.videoId !== primaryVideo).slice(0, 2);
    for (const s of extra) {
      try {
        const radio = await ytmusic.getWatchPlaylist(s.videoId, undefined, true, false, 25);
        add(radio.tracks || [], "radio-secondary", 0.85);
      } catch {
        /* ignore */
      }
      if (candidates.length >= limit * 1.5) break;
    }
  }

  // Rank: weight + slight preference for earlier sources, light shuffle for diversity
  candidates.sort((a, b) => (b._weight || 1) - (a._weight || 1));

  // Light diversity: avoid too many consecutive same artist
  const final: any[] = [];
  const artistCount = new Map<string, number>();
  for (const t of candidates) {
    if (final.length >= limit) break;
    const key = (t.artist || "").toLowerCase().slice(0, 40);
    const count = artistCount.get(key) || 0;
    if (count >= 3) continue; // max 3 per artist in one batch
    artistCount.set(key, count + 1);
    const { _weight, ...clean } = t;
    final.push(clean);
  }

  // If still short, fill from remaining
  if (final.length < Math.min(15, limit)) {
    for (const t of candidates) {
      if (final.length >= limit) break;
      if (final.some((f) => f.videoId === t.videoId)) continue;
      const { _weight, ...clean } = t;
      final.push(clean);
    }
  }

  return {
    success: true,
    tracks: final.slice(0, limit),
    strategy: primaryVideo ? "hybrid-seed" : "hybrid",
    seedCount: seeds.length,
  };
}
