/**
 * Streaming Service
 * Fetches playable audio (or muxed) URLs from Piped / Invidious
 * YouTube aggressively blocks datacenter IPs — we try many instances in parallel.
 */

const FETCH_TIMEOUT_MS = 8_000;

const PIPED_INSTANCES = [
  "https://pipedapi.ducks.party",
  "https://api.piped.private.coffee",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.darkness.services",
  "https://api.piped.yt",
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.r4fo.com",
  "https://pipedapi.leptons.xyz",
  "https://pipedapi.syncpundit.io",
  "https://pipedapi.reallyautistics.rocks",
  "https://piped-api.privacy.com.de",
];

const INVIDIOUS_INSTANCES = [
  "https://invidious.projectsegfau.lt",
  "https://inv.nadeko.net",
  "https://yewtu.be",
  "https://invidious.nerdvpn.de",
  "https://iv.ggtyler.dev",
  "https://invidious.jing.rocks",
  "https://vid.puffyan.us",
];

let instancesCache: { piped: string[]; invidious: string[] } | null = null;
let instancesCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

async function fetchJson(url: string, init?: RequestInit): Promise<any | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "application/json",
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function getDynamicInstances() {
  const now = Date.now();
  if (instancesCache && now - instancesCacheTime < CACHE_DURATION) {
    return instancesCache;
  }
  try {
    const data = await fetchJson(
      "https://raw.githubusercontent.com/n-ce/Uma/main/dynamic_instances.json",
    );
    const piped = [
      ...PIPED_INSTANCES,
      ...((data?.piped as string[]) || []),
    ];
    const invidious = [
      ...INVIDIOUS_INSTANCES,
      ...((data?.invidious as string[]) || []),
    ];
    instancesCache = {
      piped: [...new Set(piped.map((u) => u.replace(/\/$/, "")))],
      invidious: [...new Set(invidious.map((u) => u.replace(/\/$/, "")))],
    };
    instancesCacheTime = now;
    return instancesCache;
  } catch {
    instancesCache = { piped: PIPED_INSTANCES, invidious: INVIDIOUS_INSTANCES };
    instancesCacheTime = now;
    return instancesCache;
  }
}

function normalizeStreamList(data: any, videoId: string, instance: string) {
  const streamingUrls: {
    url: string;
    quality?: string;
    mimeType?: string;
    bitrate?: number;
    kind?: string;
  }[] = [];

  // Prefer dedicated audio streams
  for (const s of data?.audioStreams || []) {
    if (s?.url) {
      streamingUrls.push({
        url: s.url,
        quality: s.quality,
        mimeType: s.mimeType,
        bitrate: s.bitrate || 0,
        kind: "audio",
      });
    }
  }

  // Fallback: muxed video streams (include audio) when pure audio is blocked
  if (!streamingUrls.length) {
    for (const s of data?.videoStreams || []) {
      if (s?.url && s.videoOnly === false) {
        streamingUrls.push({
          url: s.url,
          quality: s.quality || "muxed",
          mimeType: s.mimeType || "video/mp4",
          bitrate: s.bitrate || 0,
          kind: "muxed",
        });
      }
    }
  }

  // HLS as last resort
  if (!streamingUrls.length && data?.hls) {
    streamingUrls.push({
      url: data.hls,
      quality: "hls",
      mimeType: "application/x-mpegURL",
      bitrate: 0,
      kind: "hls",
    });
  }

  if (!streamingUrls.length) return null;

  streamingUrls.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  return {
    success: true as const,
    instance,
    streamingUrls,
    metadata: {
      id: videoId,
      title: data.title,
      uploader: data.uploader || data.author,
      thumbnail: data.thumbnailUrl || data.videoThumbnails?.[0]?.url,
      duration: data.duration || data.lengthSeconds,
      views: data.views || data.viewCount,
    },
    hlsUrl: data.hls || null,
  };
}

export async function fetchFromPiped(videoId: string) {
  const { piped } = await getDynamicInstances();

  // Race instances in parallel batches of 4 for speed
  const batchSize = 4;
  for (let i = 0; i < piped.length; i += batchSize) {
    const batch = piped.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (instance) => {
        const data = await fetchJson(`${instance}/streams/${videoId}`);
        if (!data || data.error) return null;
        return normalizeStreamList(data, videoId, instance);
      }),
    );
    const hit = results.find((r) => r?.success && r.streamingUrls?.length);
    if (hit) return hit;
  }

  return { success: false as const, error: "No working Piped instances found" };
}

export async function fetchFromInvidious(videoId: string) {
  const { invidious } = await getDynamicInstances();

  const batchSize = 4;
  for (let i = 0; i < invidious.length; i += batchSize) {
    const batch = invidious.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (instance) => {
        const data = await fetchJson(`${instance}/api/v1/videos/${videoId}`);
        if (!data || data.error) return null;

        const audioFormats = (data.adaptiveFormats || []).filter(
          (f: any) =>
            String(f.type || f.mimeType || "").includes("audio"),
        );

        const streamingUrls = audioFormats.map((f: any) => ({
          url:
            f.url ||
            `${instance}/latest_version?id=${videoId}&itag=${f.itag}`,
          directUrl: f.url,
          bitrate: f.bitrate || 0,
          mimeType: f.type || f.mimeType,
          kind: "audio" as const,
        })).filter((u: any) => u.url);

        // Muxed progressive formats
        if (!streamingUrls.length) {
          for (const f of data.formatStreams || []) {
            if (f?.url) {
              streamingUrls.push({
                url: f.url,
                bitrate: f.bitrate || 0,
                mimeType: f.type,
                kind: "muxed",
              });
            }
          }
        }

        if (!streamingUrls.length) return null;
        streamingUrls.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

        return {
          success: true as const,
          instance,
          streamingUrls,
          metadata: {
            id: videoId,
            title: data.title,
            author: data.author,
            thumbnail: data.videoThumbnails?.[0]?.url,
            lengthSeconds: data.lengthSeconds,
            viewCount: data.viewCount,
          },
        };
      }),
    );
    const hit = results.find((r) => r?.success && r.streamingUrls?.length);
    if (hit) return hit;
  }

  return {
    success: false as const,
    error: "No working Invidious instances found",
  };
}
