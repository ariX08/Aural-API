/**
 * Stream Routes
 * /api/stream, /api/proxy, /api/music/find
 */

import { json, error, corsHeaders } from "../helpers/response.ts";
import { fetchFromPiped, fetchFromInvidious } from "../services/streaming.ts";
import type { YTMusic } from "../services/ytmusic.ts";

export async function handleStream(searchParams: URLSearchParams): Promise<Response> {
  const id = searchParams.get("id");
  if (!id) return error("Missing id");

  const piped = await fetchFromPiped(id);
  if (piped.success) {
    return json({
      success: true, service: "piped", instance: piped.instance,
      streamingUrls: piped.streamingUrls, metadata: piped.metadata,
      requestedId: id, timestamp: new Date().toISOString(),
    });
  }

  const invidious = await fetchFromInvidious(id);
  if (invidious.success) {
    return json({
      success: true, service: "invidious", instance: invidious.instance,
      streamingUrls: invidious.streamingUrls, metadata: invidious.metadata,
      requestedId: id, timestamp: new Date().toISOString(),
    });
  }

  return json({
    success: false,
    error: "No streaming data found",
    hint: "YouTube is blocking stream extractors on this server IP. Try again later or another track.",
  }, 404);
}

export async function handleProxy(searchParams: URLSearchParams, req: Request): Promise<Response> {
  const audioUrl = searchParams.get("url");
  if (!audioUrl) return error("Missing url");

  try {
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "*/*",
      "Referer": "https://www.youtube.com/",
      "Origin": "https://www.youtube.com",
    };
    const rangeHeader = req.headers.get("Range");
    if (rangeHeader) headers["Range"] = rangeHeader;

    const response = await fetch(audioUrl, { headers });
    if (!response.ok && response.status !== 206) {
      return new Response(`Failed: ${response.status}`, { status: 502, headers: corsHeaders });
    }

    const responseHeaders = new Headers();
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "Range, Content-Type");
    responseHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    responseHeaders.set("Cache-Control", "public, max-age=3600");
    responseHeaders.set("Content-Type", response.headers.get("Content-Type") || "audio/mp4");
    if (response.headers.get("Content-Length")) responseHeaders.set("Content-Length", response.headers.get("Content-Length")!);
    if (response.headers.get("Content-Range")) responseHeaders.set("Content-Range", response.headers.get("Content-Range")!);
    if (response.headers.get("Accept-Ranges")) responseHeaders.set("Accept-Ranges", response.headers.get("Accept-Ranges")!);

    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch (err) {
    return new Response("Proxy error: " + String(err), { status: 502, headers: corsHeaders });
  }
}

export async function handleMusicFind(searchParams: URLSearchParams, ytmusic: YTMusic): Promise<Response> {
  const name = searchParams.get("name"), artist = searchParams.get("artist");
  if (!name || !artist) return error("Missing name and artist");

  const searchResults = await ytmusic.search(`${name} ${artist}`, "songs");
  if (!searchResults.results?.length) return json({ success: false, error: "Song not found" }, 404);

  const normalize = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "").toLowerCase();
  const nName = normalize(name);
  const artistsList = artist.split(",").map(a => normalize(a));

  const match = searchResults.results.find((song: any) => {
    const nSongName = normalize(song.title || "");
    const songArtists = (song.artists || []).map((a: any) => normalize(a.name || ""));
    return (nSongName.includes(nName) || nName.includes(nSongName)) &&
      artistsList.some(a => songArtists.some((sa: string) => sa.includes(a) || a.includes(sa)));
  });

  return match ? json({ success: true, data: match }) : json({ success: false, error: "Song not found" }, 404);
}
