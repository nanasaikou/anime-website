import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT) || 4173;
const publicBaseUrl = (process.env.PUBLIC_BASE_URL?.trim() || `http://127.0.0.1:${port}`).replace(/\/$/, "");
const tmdbToken = process.env.TMDB_API_TOKEN?.trim();
const tmdbApiKey = process.env.TMDB_API_KEY?.trim();
const supabaseUrl = process.env.SUPABASE_URL?.trim() || "https://lpnlwqneytlgxfqurjxc.supabase.co";
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || "sb_publishable_wb0wp_0xS-ZuWxBl-UPO2w_KJdju7gK";
const apiCache = new Map();
const oauthStates = new Map();
const oauthProviders = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID?.trim(),
    clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim(),
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token"
  },
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID?.trim(),
    clientSecret: process.env.DISCORD_CLIENT_SECRET?.trim(),
    authorizeUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token"
  }
};
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

async function tmdbRequest(path, params = {}) {
  if (!tmdbToken && !tmdbApiKey) {
    const error = new Error("TMDB credentials are not configured");
    error.code = "TMDB_NOT_CONFIGURED";
    throw error;
  }
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  if (!tmdbToken) url.searchParams.set("api_key", tmdbApiKey);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(tmdbToken ? { Authorization: `Bearer ${tmdbToken}` } : {})
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`TMDB request failed with ${response.status}`);
  return response.json();
}

function comparableTitle(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function chooseMediaMatch(results, title, year, mediaType) {
  const expected = comparableTitle(title);
  return [...results].sort((a, b) => {
    const aTitle = comparableTitle(mediaType === "movie" ? a.title || a.original_title : a.name || a.original_name);
    const bTitle = comparableTitle(mediaType === "movie" ? b.title || b.original_title : b.name || b.original_name);
    const aYear = Number((mediaType === "movie" ? a.release_date : a.first_air_date)?.slice(0, 4));
    const bYear = Number((mediaType === "movie" ? b.release_date : b.first_air_date)?.slice(0, 4));
    const score = (candidate, candidateYear) => (candidate === expected ? 100 : candidate.startsWith(expected) || expected.startsWith(candidate) ? 60 : 0) + (year && candidateYear === year ? 25 : 0);
    return score(bTitle, bYear) - score(aTitle, aYear);
  })[0] || null;
}

function providerList(items = []) {
  return items.map((provider) => ({
    id: provider.provider_id,
    name: provider.provider_name,
    logoUrl: provider.logo_path ? `https://image.tmdb.org/t/p/w92${provider.logo_path}` : null,
    priority: provider.display_priority
  })).sort((a, b) => a.priority - b.priority);
}

async function handleWatchRegions(response) {
  const key = "watch-regions";
  const cached = apiCache.get(key);
  if (cached && Date.now() - cached.savedAt < 24 * 60 * 60 * 1000) return sendJson(response, 200, cached.data);
  const payload = await tmdbRequest("/watch/providers/regions", { language: "en-US" });
  const data = {
    regions: (payload.results || []).map((region) => ({ code: region.iso_3166_1, name: region.english_name || region.native_name })).sort((a, b) => a.name.localeCompare(b.name))
  };
  apiCache.set(key, { savedAt: Date.now(), data });
  sendJson(response, 200, data);
}

async function handleWatchProviders(requestUrl, response) {
  const title = requestUrl.searchParams.get("title")?.trim();
  const year = Number(requestUrl.searchParams.get("year")) || null;
  const mediaType = requestUrl.searchParams.get("type") === "movie" ? "movie" : "tv";
  const region = (requestUrl.searchParams.get("region") || "").toUpperCase();
  if (!title || title.length > 200 || !/^[A-Z]{2}$/.test(region)) return sendJson(response, 400, { error: "INVALID_REQUEST" });
  const key = `providers:${mediaType}:${region}:${year || ""}:${title.toLowerCase()}`;
  const cached = apiCache.get(key);
  if (cached && Date.now() - cached.savedAt < 30 * 60 * 1000) return sendJson(response, 200, cached.data);

  const searchParams = { query: title, include_adult: false, language: "en-US" };
  if (year) searchParams[mediaType === "movie" ? "primary_release_year" : "first_air_date_year"] = year;
  let search = await tmdbRequest(`/search/${mediaType}`, searchParams);
  if (!search.results?.length && year) search = await tmdbRequest(`/search/${mediaType}`, { query: title, include_adult: false, language: "en-US" });
  const match = chooseMediaMatch(search.results || [], title, year, mediaType);
  if (!match) {
    const data = { region, matched: null, providers: { stream: [], free: [], ads: [], rent: [], buy: [] }, source: "TMDB / JustWatch" };
    apiCache.set(key, { savedAt: Date.now(), data });
    return sendJson(response, 200, data);
  }

  const watchPayload = await tmdbRequest(`/${mediaType}/${match.id}/watch/providers`);
  const regional = watchPayload.results?.[region] || {};
  const data = {
    region,
    matched: {
      id: match.id,
      title: mediaType === "movie" ? match.title || match.original_title : match.name || match.original_name,
      mediaType
    },
    link: regional.link || null,
    providers: {
      stream: providerList(regional.flatrate),
      free: providerList(regional.free),
      ads: providerList(regional.ads),
      rent: providerList(regional.rent),
      buy: providerList(regional.buy)
    },
    source: "TMDB / JustWatch"
  };
  apiCache.set(key, { savedAt: Date.now(), data });
  sendJson(response, 200, data);
}

function providerEnabled(provider) {
  const config = oauthProviders[provider];
  return Boolean(config?.clientId && config?.clientSecret);
}

function oauthRedirectUri(provider) {
  return `${publicBaseUrl}/auth/${provider}/callback`;
}

function redirect(response, location) {
  response.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  response.end();
}

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function oauthPopupPage(response, { profile = null, error = null } = {}) {
  const origin = JSON.stringify(new URL(publicBaseUrl).origin);
  const payload = JSON.stringify(profile ? { type: "soralist-oauth", profile } : { type: "soralist-oauth-error", error: error || "Sign-in could not be completed." }).replaceAll("<", "\\u003c");
  const title = profile ? "Signed in" : "Sign-in unavailable";
  const message = profile ? `Welcome, ${profile.username}. This window can close now.` : error || "Sign-in could not be completed.";
  response.writeHead(profile ? 200 : 400, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"
  });
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)} · SoraList</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#12131a;color:#f3f3f7;font:16px system-ui}.card{max-width:360px;padding:32px;border:1px solid #2d303c;border-radius:20px;background:#1a1c25;text-align:center}h1{font-size:22px}p{color:#a4a8b5;line-height:1.6}a{color:#9d8aff}</style><div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a href="/">Return to SoraList</a></div><script>if(window.opener){window.opener.postMessage(${payload},${origin});setTimeout(()=>window.close(),350)}</script></html>`);
}

function pruneOAuthStates() {
  const now = Date.now();
  for (const [state, record] of oauthStates) if (record.expiresAt <= now) oauthStates.delete(state);
}

function handleOAuthStart(provider, response) {
  if (!oauthProviders[provider]) return oauthPopupPage(response, { error: "Unknown sign-in provider." });
  if (!providerEnabled(provider)) return oauthPopupPage(response, { error: `${provider[0].toUpperCase() + provider.slice(1)} sign-in has not been configured on this server yet.` });
  pruneOAuthStates();
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  oauthStates.set(state, { provider, nonce, expiresAt: Date.now() + 10 * 60 * 1000 });
  const config = oauthProviders[provider];
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: oauthRedirectUri(provider),
    response_type: "code",
    state
  });
  if (provider === "google") {
    params.set("scope", "openid email profile");
    params.set("nonce", nonce);
  } else {
    params.set("scope", "identify email");
    params.set("prompt", "consent");
  }
  redirect(response, `${config.authorizeUrl}?${params}`);
}

async function postForm(url, values) {
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
    signal: AbortSignal.timeout(12000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error_description || payload.error || `Token exchange failed with ${response.status}`);
  return payload;
}

async function bearerJson(url, accessToken) {
  const response = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Profile request failed with ${response.status}`);
  return response.json();
}

async function exchangeOAuthProfile(provider, code) {
  const config = oauthProviders[provider];
  const token = await postForm(config.tokenUrl, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: oauthRedirectUri(provider)
  });
  if (provider === "google") {
    const user = await bearerJson("https://openidconnect.googleapis.com/v1/userinfo", token.access_token);
    return { provider, providerId: String(user.sub), username: user.name || user.email?.split("@")[0] || "Google user", email: user.email || null, avatarUrl: user.picture || null };
  }
  if (provider === "discord") {
    const user = await bearerJson("https://discord.com/api/v10/users/@me", token.access_token);
    const avatarUrl = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null;
    return { provider, providerId: String(user.id), username: user.global_name || user.username || "Discord user", email: user.email || null, avatarUrl };
  }
  throw new Error("Unknown OAuth provider");
}

async function handleOAuthCallback(provider, request, requestUrl, response) {
  const params = requestUrl.searchParams;
  const state = params.get("state");
  const stateRecord = state ? oauthStates.get(state) : null;
  if (state) oauthStates.delete(state);
  if (params.get("error")) return oauthPopupPage(response, { error: params.get("error_description") || "Sign-in was cancelled." });
  if (!stateRecord || stateRecord.provider !== provider || stateRecord.expiresAt <= Date.now()) return oauthPopupPage(response, { error: "The sign-in request expired or could not be verified. Please try again." });
  const code = params.get("code");
  if (!code) return oauthPopupPage(response, { error: "The provider did not return an authorization code." });
  try {
    const profile = await exchangeOAuthProfile(provider, code);
    oauthPopupPage(response, { profile });
  } catch (error) {
    console.error(`${provider} OAuth callback failed:`, error.message);
    oauthPopupPage(response, { error: `${provider[0].toUpperCase() + provider.slice(1)} sign-in could not be completed.` });
  }
}

createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const urlPath = decodeURIComponent(requestUrl.pathname);
    if (request.method === "GET" && urlPath === "/api/config") return sendJson(response, 200, { supabaseUrl, supabasePublishableKey });
    if (request.method === "GET" && urlPath === "/api/auth/providers") return sendJson(response, 200, { providers: Object.fromEntries(Object.keys(oauthProviders).map((provider) => [provider, { enabled: providerEnabled(provider) }])) });
    const oauthStart = urlPath.match(/^\/auth\/(google|discord)$/);
    if (request.method === "GET" && oauthStart) return handleOAuthStart(oauthStart[1], response);
    const oauthCallback = urlPath.match(/^\/auth\/(google|discord)\/callback$/);
    if (oauthCallback && request.method === "GET") return await handleOAuthCallback(oauthCallback[1], request, requestUrl, response);
    if (request.method === "GET" && urlPath === "/api/watch-regions") return await handleWatchRegions(response);
    if (request.method === "GET" && urlPath === "/api/watch-providers") return await handleWatchProviders(requestUrl, response);
    const requested = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const filePath = normalize(join(root, requested));

    if (!filePath.startsWith(root)) throw new Error("Invalid path");
    if (!(await stat(filePath)).isFile()) throw new Error("Not a file");

    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    response.end(await readFile(filePath));
  } catch (error) {
    if (error.code === "TMDB_NOT_CONFIGURED") return sendJson(response, 503, { error: "TMDB_NOT_CONFIGURED" });
    if (request.url?.startsWith("/api/")) return sendJson(response, 502, { error: "PROVIDER_LOOKUP_FAILED" });
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`SoraList is ready at http://127.0.0.1:${port}`);
});
