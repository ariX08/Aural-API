/**
 * Cloudflare Workers entry point for Aural API.
 * The original Deno entry point remains available for Render/Deno deployments.
 */

import { YTMusic } from "./src/services/ytmusic.ts";
import { YouTubeSearch } from "./src/services/youtube-search.ts";
import { json, corsHeaders } from "./src/helpers/response.ts";
import { html as uiHtml } from "./ui.ts";

import { handleSearch, handleSearchSuggestions, handleYTSearch } from "./src/routes/search.ts";
import { handleContentRoutes } from "./src/routes/content.ts";
import { handleDiscoverRoutes } from "./src/routes/discover.ts";
import { handleStream, handleProxy, handleMusicFind } from "./src/routes/stream.ts";
import { handleInfoRoutes } from "./src/routes/info.ts";
import { handleFeedRoutes } from "./src/routes/feed.ts";

const ytmusic = new YTMusic();
const youtubeSearch = new YouTubeSearch();

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname, searchParams } = url;

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (pathname === "/") {
      return new Response(uiHtml, {
        headers: { "Content-Type": "text/html; charset=UTF-8", ...corsHeaders },
      });
    }

    // Fetch the existing logo from the public repository instead of using Deno.readFile().
    if (pathname === "/assets/logo.png" || pathname === "/assets/Logo.png") {
      const logo = await fetch("https://raw.githubusercontent.com/ariX08/Aural-API/main/assets/Logo.png");
      if (logo.ok) {
        return new Response(logo.body, {
          headers: { "Content-Type": "image/png", ...corsHeaders, "Cache-Control": "public, max-age=86400" },
        });
      }
      return new Response("Logo not found", { status: 404, headers: corsHeaders });
    }

    if (pathname === "/favicon.ico") return new Response(null, { status: 204 });
    if (pathname === "/health") return json({ status: "ok", version: "2.0.0", runtime: "cloudflare-workers" });

    if (pathname === "/api/search") return await handleSearch(req, searchParams, ytmusic, youtubeSearch);
    if (pathname === "/api/search/suggestions") return await handleSearchSuggestions(searchParams, ytmusic, youtubeSearch);
    if (pathname === "/api/yt_search") return await handleYTSearch(searchParams, youtubeSearch);

    const contentResponse = await handleContentRoutes(pathname, searchParams, ytmusic);
    if (contentResponse) return contentResponse;

    const discoverResponse = await handleDiscoverRoutes(pathname, searchParams, ytmusic, youtubeSearch);
    if (discoverResponse) return discoverResponse;

    if (pathname === "/api/music/find") return await handleMusicFind(searchParams, ytmusic);
    if (pathname === "/api/stream") return await handleStream(searchParams);
    if (pathname === "/api/proxy") return await handleProxy(searchParams, req);

    const infoResponse = await handleInfoRoutes(pathname, searchParams);
    if (infoResponse) return infoResponse;

    const feedResponse = await handleFeedRoutes(pathname, searchParams);
    if (feedResponse) return feedResponse;

    return json({ error: "Route not found", path: pathname }, 404);
  } catch (err) {
    console.error("Error:", err);
    return json({ error: "Internal server error", message: String(err) }, 500);
  }
}

export default {
  fetch: handler,
};
