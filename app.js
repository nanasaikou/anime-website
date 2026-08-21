const STORAGE_KEY = "soralist_app_v1";
const API_CACHE_KEY = "soralist_api_cache_v2";
const API_BASE = "https://api.jikan.moe/v4";
const ANILIST_API = "https://graphql.anilist.co";
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
const REFRESH_INTERVAL = 30 * 60 * 1000;
const PBKDF2_ITERATIONS = 600000;
const FRANCHISE_RELATION_TYPES = new Set(["PREQUEL", "SEQUEL", "ALTERNATIVE"]);
const defaultStore = {
  users: [],
  groups: [],
  session: null,
  theme: "light",
  density: "comfortable",
  reduceMotion: false,
  alwaysShowListControls: false
};
let store = loadStore();
let catalog = [];
let trending = [];
let topRated = [];
let currentSeason = [];
let upcoming = [];
let apiState = "loading";
let lastApiUpdate = 0;
let searchTimer = null;
let searchController = null;
let discoverRequestId = 0;
let discoverResults = null;
let discoverLoading = false;
let catalogRefreshInFlight = false;
const detailAvailabilityCache = new Map();
const franchiseSeasonCache = new Map();
const relationRecordCache = new Map();
const titleFamilyCache = new Map();
const regionalAvailabilityCache = new Map();
let watchRegionsCache = null;
let detailRequestId = 0;
let regionalRequestId = 0;
let featuredIndex = 0;
let currentView = "home";
let discoverFilters = { genre: "All", format: "all", status: "all", season: "all", year: "all", minScore: "0", sort: "popular" };
let listFilter = "all";
let homeFeed = "trending";
let friendsTab = "connected";
let friendInviteUsername = null;
let activeGroupId = null;
let detailAnimeId = null;
let oauthProviderState = { google: null, discord: null };
let oauthAction = "signin";
let pendingProfileAvatar = null;
let visibleRecoveryCode = null;
let visibleRecoveryCodeOwner = null;
let supabaseMode = false;
let supabaseRefreshPromise = null;
let supabaseRefreshAgain = false;
let supabaseMutationQueue = Promise.resolve();
let preferenceSyncTimer = null;
let savePickerAnimeId = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function loadStore() {
  try { return { ...defaultStore, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) }; }
  catch { return { ...defaultStore }; }
}

function saveStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  if (!supabaseMode || !currentUser()?.supabaseAccount) return;
  clearTimeout(preferenceSyncTimer);
  preferenceSyncTimer = setTimeout(() => {
    const user = currentUser();
    if (!user) return;
    window.SoraListSupabase.savePreferences({
      theme: store.theme,
      density: store.density,
      reduceMotion: Boolean(store.reduceMotion),
      alwaysShowListControls: Boolean(store.alwaysShowListControls),
      location: user.location || ""
    }, selectedWatchRegion()).catch((error) => console.error("Preference sync failed:", error));
  }, 350);
}
function currentUser() { return store.users.find((u) => u.usernameLower === store.session) || null; }
function getUserList() { return currentUser()?.list || []; }
function findAnime(id) {
  const animeId = Number(id);
  const liveAnime = [...catalog, ...upcoming].find((anime) => Number(anime.id) === animeId);
  if (liveAnime) return liveAnime;
  for (const profile of store.users) {
    const savedAnime = (profile.list || []).find((entry) => Number(entry.animeId) === animeId)?.snapshot;
    if (savedAnime) return savedAnime;
  }
  for (const group of store.groups || []) {
    const savedAnime = (group.animeEntries || []).find((entry) => Number(entry.animeId) === animeId)?.snapshot;
    if (savedAnime) return savedAnime;
  }
  return null;
}
function initials(name = "?") { return name.slice(0, 2).toUpperCase(); }
function avatarHue(name = "?") {
  return [...name].reduce((total, character) => total + character.codePointAt(0), 0) % 360;
}
function ensureFriendRequestState(profile) {
  if (!profile) return profile;
  profile.friends ||= [];
  profile.incomingFriendRequests ||= [];
  profile.outgoingFriendRequests ||= [];
  profile.rejectedFriendRequests ||= [];
  return profile;
}
function requestProfiles(user, field) {
  if (!user) return [];
  ensureFriendRequestState(user);
  const usernames = new Set(user[field] || []);
  return store.users.filter((profile) => usernames.has(profile.usernameLower));
}
function friendRelationship(user, profile) {
  if (!user || !profile) return "none";
  ensureFriendRequestState(user);
  if (user.friends.includes(profile.usernameLower)) return "connected";
  if (user.incomingFriendRequests.includes(profile.usernameLower)) return "incoming";
  if (user.outgoingFriendRequests.includes(profile.usernameLower)) return "outgoing";
  if (user.rejectedFriendRequests.includes(profile.usernameLower)) return "rejected";
  return "none";
}
function connectedProfiles(user = currentUser()) {
  if (!user) return [];
  ensureFriendRequestState(user);
  const friendNames = new Set(user.friends || []);
  return store.users.filter((profile) => profile.usernameLower !== user.usernameLower && friendNames.has(profile.usernameLower));
}
function profilesForAnime(animeId, user = currentUser()) {
  if (!user) return [];
  return [user, ...connectedProfiles(user)].filter((profile) => (profile.list || []).some((entry) => Number(entry.animeId) === Number(animeId)));
}
function sharedAnimeIds(user = currentUser()) {
  if (!user) return new Set();
  return new Set((user.list || []).filter((entry) => profilesForAnime(entry.animeId, user).length > 1).map((entry) => Number(entry.animeId)));
}
function escapeHtml(text = "") { const div = document.createElement("div"); div.textContent = text; return div.innerHTML; }
function safeAvatarUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}
function safeUploadedAvatar(value) {
  return typeof value === "string" && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : null;
}
function avatarInnerMarkup(profile) {
  const avatarUrl = safeUploadedAvatar(profile?.customAvatarDataUrl) || safeAvatarUrl(profile?.customAvatarUrl || profile?.avatarUrl);
  return avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="">` : escapeHtml(initials(profile?.username));
}
function setProfileAvatar(element, profile) {
  if (!element) return;
  element.style.setProperty("--avatar-hue", avatarHue(profile?.username));
  element.innerHTML = profile ? avatarInnerMarkup(profile) : "?";
}
function profileAvatarMarkup(profile, className = "collaborator-avatar") {
  return `<span class="${className}" style="--avatar-hue:${avatarHue(profile.username)}" title="${escapeHtml(profile.username)}" aria-label="${escapeHtml(profile.username)}">${avatarInnerMarkup(profile)}</span>`;
}
function collaboratorSummary(profiles, user = currentUser()) {
  if (!profiles.length) return "No friends have added this yet";
  const includesCurrent = Boolean(user && profiles.some((profile) => profile.usernameLower === user.usernameLower));
  const others = profiles.filter((profile) => !user || profile.usernameLower !== user.usernameLower);
  if (includesCurrent && !others.length) return "Only you so far";
  if (includesCurrent && others.length === 1) return `You + ${others[0].username}`;
  if (includesCurrent) return `You + ${others.length} friends`;
  if (profiles.length === 1) return `${profiles[0].username} added this`;
  return `${profiles.length} friends added this`;
}
function collaboratorMarkup(profiles, { compact = false } = {}) {
  if (!profiles.length) return "";
  const visible = profiles.slice(0, 4);
  const names = profiles.map((profile) => profile.username).join(", ");
  return `<div class="collaborator-cell ${compact ? "compact" : ""}" aria-label="Added by ${escapeHtml(names)}"><div class="avatar-stack">${visible.map((profile) => profileAvatarMarkup(profile)).join("")}${profiles.length > visible.length ? `<span class="collaborator-avatar avatar-overflow">+${profiles.length - visible.length}</span>` : ""}</div><small>${escapeHtml(collaboratorSummary(profiles))}</small></div>`;
}

function reportSupabaseError(error, fallback = "That change could not be synced.") {
  console.error(error);
  toast(error?.message || fallback);
}

function queueSupabaseMutation(operation) {
  const result = supabaseMutationQueue.then(operation);
  supabaseMutationQueue = result.catch((error) => reportSupabaseError(error));
  return result;
}

function captureGroupComposerState() {
  const input = $('[data-group-message-form] input[name="message"]');
  if (!input) return null;
  return {
    groupId: activeGroupId,
    draft: input.value,
    focused: document.activeElement === input,
    selectionStart: input.selectionStart,
    selectionEnd: input.selectionEnd
  };
}

function restoreGroupComposerState(state) {
  if (!state || state.groupId !== activeGroupId) return;
  const input = $('[data-group-message-form] input[name="message"]');
  if (!input) return;
  input.value = state.draft;
  if (!state.focused) return;
  input.focus({ preventScroll: true });
  if (Number.isInteger(state.selectionStart) && Number.isInteger(state.selectionEnd)) {
    input.setSelectionRange(state.selectionStart, state.selectionEnd);
  }
}

async function refreshSupabaseStore() {
  if (!supabaseMode || !window.SoraListSupabase.session) return;
  if (supabaseRefreshPromise) {
    supabaseRefreshAgain = true;
    return supabaseRefreshPromise;
  }
  supabaseRefreshPromise = (async () => {
    const syncedStore = await window.SoraListSupabase.loadLegacyStore(store);
    if (!syncedStore) return;
    store = syncedStore;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    applyTheme();
    renderAll();
    if (savePickerAnimeId && !$("#saveAnimeModal").hidden) renderAnimeSavePicker();
    if (detailAnimeId && !$("#detailModal").hidden) showDetails(detailAnimeId);
  })();
  try {
    await supabaseRefreshPromise;
  } catch (error) {
    reportSupabaseError(error, "Your shared data could not be refreshed.");
  } finally {
    supabaseRefreshPromise = null;
    if (supabaseRefreshAgain) {
      supabaseRefreshAgain = false;
      refreshSupabaseStore();
    }
  }
}

async function initializeSupabase() {
  try {
    const session = await window.SoraListSupabase.initialize();
    supabaseMode = true;
    oauthProviderState = { google: true, discord: true };
    updateOAuthButtons();
    window.SoraListSupabase.onAuthStateChange(async (nextSession, event) => {
      if (!nextSession) {
        store.session = null;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        renderAll();
        return;
      }
      await refreshSupabaseStore();
      window.SoraListSupabase.subscribeToChanges(refreshSupabaseStore);
      closeModal("authModal");
      if (event === "PASSWORD_RECOVERY") {
        switchView("account");
        toast("Choose your new password in Account security.");
      }
    });
    if (session) {
      await refreshSupabaseStore();
      window.SoraListSupabase.subscribeToChanges(refreshSupabaseStore);
    } else {
      store.session = null;
      renderAll();
    }
  } catch (error) {
    oauthProviderState = { google: false, discord: false };
    updateOAuthButtons();
    reportSupabaseError(error, "SoraList could not connect to its shared database.");
  }
}
function truncate(text = "", length = 180) { return text.length > length ? `${text.slice(0, length).trim()}…` : text; }
function formatScore(score) { return score ? Number(score).toFixed(1) : "New"; }
function episodeLabel(episodes) {
  const count = Number(episodes);
  return Number.isFinite(count) && count > 0 ? `${count} ${count === 1 ? "episode" : "episodes"}` : "Episodes TBA";
}
function formatDate(value, suppliedParts = null) {
  let parts = suppliedParts?.year ? suppliedParts : null;
  if (!parts && typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  }
  if (!parts?.year) return { month: "", day: "", compact: "TBA", full: "Date to be announced" };
  const monthValid = parts.month >= 1 && parts.month <= 12;
  const dayValid = monthValid && parts.day >= 1 && parts.day <= 31;
  const monthLong = monthValid ? new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, parts.month - 1, 1))) : null;
  const monthShort = monthValid ? monthLong.slice(0, 3).toUpperCase() : "";
  const full = dayValid ? `${monthLong} ${parts.day}, ${parts.year}` : monthValid ? `${monthLong} ${parts.year}` : String(parts.year);
  const compact = dayValid ? `${parts.day} ${monthShort}` : monthValid ? `${monthShort} ${parts.year}` : String(parts.year);
  return { month: monthShort, day: dayValid ? parts.day : "", compact, full };
}
function releaseTime(anime) {
  if (anime.startDate) {
    const parsed = Date.parse(anime.startDate);
    if (Number.isFinite(parsed)) return parsed;
  }
  const parts = anime.startDateParts;
  return parts?.year ? Date.UTC(parts.year, Math.max(0, (parts.month || 12) - 1), parts.day || 31) : Number.MAX_SAFE_INTEGER;
}

async function hashPassword(password) {
  const encoded = new TextEncoder().encode(password);
  const buffer = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveSecret(secret, salt, iterations = PBKDF2_ITERATIONS) {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, keyMaterial, 256);
  return new Uint8Array(bits);
}

async function createSecretCredential(secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveSecret(secret, salt);
  return { version: 1, algorithm: "PBKDF2-SHA-256", iterations: PBKDF2_ITERATIONS, salt: bytesToBase64(salt), hash: bytesToBase64(hash) };
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function verifySecret(secret, credential) {
  if (!credential?.salt || !credential?.hash) return false;
  try {
    const expected = base64ToBytes(credential.hash);
    const actual = await deriveSecret(secret, base64ToBytes(credential.salt), Number(credential.iterations) || PBKDF2_ITERATIONS);
    return constantTimeEqual(actual, expected);
  } catch { return false; }
}

async function verifyUserPassword(user, password) {
  if (user?.passwordCredential) return verifySecret(password, user.passwordCredential);
  if (user?.passwordHash) return (await hashPassword(password)) === user.passwordHash;
  return false;
}

function generateRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const characters = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return characters.match(/.{1,4}/g).join("-");
}

function uniqueOAuthUsername(displayName, provider) {
  const normalized = String(displayName || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  const base = (normalized.length >= 3 ? normalized : `${provider}_user`).slice(0, 20);
  let candidate = base;
  let suffix = 2;
  while (store.users.some((user) => user.usernameLower === candidate.toLowerCase())) {
    const addition = `_${suffix}`;
    candidate = `${base.slice(0, 20 - addition.length)}${addition}`;
    suffix += 1;
  }
  return candidate;
}

function completeOAuthSignIn(profile) {
  if (!profile || !["google", "discord"].includes(profile.provider) || !String(profile.providerId || "").trim()) {
    toast("The sign-in provider returned an invalid profile.");
    return;
  }
  const identity = `${profile.provider}:${profile.providerId}`;
  const identityOwner = store.users.find((candidate) => (candidate.identities || []).includes(identity));
  if (oauthAction === "link" && currentUser()) {
    const linkedUser = currentUser();
    oauthAction = "signin";
    if (identityOwner && identityOwner !== linkedUser) {
      toast(`That ${profile.provider} account is already linked to another SoraList profile.`);
      return;
    }
    linkedUser.identities = [...new Set([...(linkedUser.identities || []), identity])];
    linkedUser.authProvider ||= profile.provider;
    linkedUser.email ||= profile.email || null;
    linkedUser.avatarUrl ||= profile.avatarUrl || null;
    saveStore();
    renderAll();
    toast(`${profile.provider[0].toUpperCase() + profile.provider.slice(1)} connected`);
    return;
  }
  let user = identityOwner;
  if (!user) {
    const username = uniqueOAuthUsername(profile.username, profile.provider);
    user = {
      username,
      usernameLower: username.toLowerCase(),
      passwordHash: null,
      identities: [identity],
      authProvider: profile.provider,
      email: profile.email || null,
      avatarUrl: profile.avatarUrl || null,
      createdAt: new Date().toISOString(),
      friends: [],
      incomingFriendRequests: [],
      outgoingFriendRequests: [],
      rejectedFriendRequests: [],
      list: []
    };
    store.users.push(user);
  } else {
    user.avatarUrl = profile.avatarUrl || user.avatarUrl || null;
    user.email = profile.email || user.email || null;
  }
  store.session = user.usernameLower;
  saveStore();
  closeModal("authModal");
  renderAll();
  toast(`Welcome to SoraList, ${user.username}`);
}

function updateOAuthButtons() {
  $$('[data-oauth-provider]').forEach((button) => {
    const state = oauthProviderState[button.dataset.oauthProvider];
    button.classList.toggle("not-configured", state === false);
    button.setAttribute("aria-disabled", state === false ? "true" : "false");
    button.title = state === false ? `${button.dataset.oauthProvider} OAuth credentials are not configured on this server yet.` : "";
  });
}

async function loadOAuthProviderStatus() {
  if (supabaseMode) {
    oauthProviderState = { google: true, discord: true };
    updateOAuthButtons();
    renderSecurity();
    return;
  }
  try {
    const data = await localApiRequest("/api/auth/providers");
    oauthProviderState = Object.fromEntries(Object.entries(data.providers || {}).map(([provider, config]) => [provider, Boolean(config.enabled)]));
  } catch {
    oauthProviderState = { google: false, discord: false };
  }
  updateOAuthButtons();
  renderSecurity();
}

async function startOAuthSignIn(provider, action = "signin") {
  if (!["google", "discord"].includes(provider)) return;
  if (window.SoraListSupabase?.connected) {
    try {
      if (action === "link") await window.SoraListSupabase.linkIdentity(provider, window.location.origin);
      else await window.SoraListSupabase.signInWithOAuth(provider, window.location.origin);
    } catch (error) {
      reportSupabaseError(error, `${provider} sign-in could not be started.`);
    }
    return;
  }
  if (oauthProviderState[provider] === false) {
    toast("The secure sign-in service is still connecting. Try again in a moment.");
    return;
  }
  oauthAction = action;
  const popup = window.open(`/auth/${provider}`, `soralist-${provider}-oauth`, "popup,width=520,height=720");
  if (!popup) toast("Allow pop-ups for SoraList to continue signing in.");
}

function normalizeJikan(item) {
  const suppliedDate = item.aired?.prop?.from || {};
  return {
    id: item.mal_id,
    malId: item.mal_id,
    anilistId: null,
    source: "jikan",
    title: item.title_english || item.title,
    canonicalTitles: [...new Set([item.title_english, item.title, item.title_japanese].filter(Boolean))],
    alternativeTitles: [...new Set([...(item.titles || []).map((title) => title.title), ...(item.title_synonyms || [])].filter(Boolean))],
    image: item.images?.webp?.large_image_url || item.images?.jpg?.large_image_url,
    banner: item.trailer?.images?.maximum_image_url || item.images?.jpg?.large_image_url,
    year: item.year || item.aired?.from?.slice(0, 4) || "TBA",
    season: item.season || null,
    format: item.type || null,
    episodes: item.episodes || "?",
    score: item.score,
    genres: item.genres?.map((g) => g.name) || [],
    studio: item.studios?.[0]?.name || "Studio TBA",
    status: item.status || "Unknown",
    synopsis: item.synopsis || "More details for this title will be announced soon.",
    startDate: item.aired?.from || null,
    startDateParts: { year: suppliedDate.year || null, month: suppliedDate.month || null, day: suppliedDate.day || null }
  };
}

function normalizeAniList(item) {
  const start = item.startDate || {};
  const startDate = start.year && start.month && start.day ? `${start.year}-${String(start.month).padStart(2, "0")}-${String(start.day).padStart(2, "0")}` : null;
  const studio = item.studios?.nodes?.find((node) => node.isAnimationStudio)?.name || item.studios?.nodes?.[0]?.name || "Studio TBA";
  const statusNames = { RELEASING: "Currently Airing", FINISHED: "Finished Airing", NOT_YET_RELEASED: "Not yet aired", CANCELLED: "Cancelled", HIATUS: "On hiatus" };
  return {
    id: item.idMal || 1000000 + item.id,
    malId: item.idMal || null,
    anilistId: item.id,
    source: "anilist",
    title: item.title?.english || item.title?.romaji || "Untitled anime",
    canonicalTitles: [...new Set([item.title?.english, item.title?.romaji, item.title?.native].filter(Boolean))],
    alternativeTitles: [...new Set([item.title?.english, item.title?.romaji, item.title?.native, ...(item.synonyms || [])].filter(Boolean))],
    image: item.coverImage?.extraLarge || item.coverImage?.large,
    banner: item.bannerImage || item.coverImage?.extraLarge,
    year: item.seasonYear || start.year || "TBA",
    season: item.season || null,
    format: item.format || null,
    episodes: item.episodes || "?",
    score: item.averageScore ? item.averageScore / 10 : null,
    genres: item.genres || [],
    studio,
    status: statusNames[item.status] || "Unknown",
    synopsis: (item.description || "More details for this title will be announced soon.").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    startDate,
    startDateParts: { year: start.year || null, month: start.month || null, day: start.day || null }
  };
}

async function fetchAniList(query, variables = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(ANILIST_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`AniList request failed with ${response.status}`);
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors[0].message);
    return payload.data;
  } finally {
    clearTimeout(timeout);
  }
}

const ANILIST_MEDIA_FIELDS = `
  id idMal title { english romaji native } synonyms coverImage { extraLarge large } bannerImage
  type season seasonYear format episodes averageScore genres status description(asHtml: false)
  studios(isMain: true) { nodes { name isAnimationStudio } }
  startDate { year month day }
`;

async function fetchAniListCatalog() {
  const now = new Date();
  const seasons = ["WINTER", "WINTER", "WINTER", "SPRING", "SPRING", "SPRING", "SUMMER", "SUMMER", "SUMMER", "FALL", "FALL", "FALL"];
  const query = `query ($season: MediaSeason, $year: Int) {
    current: Page(page: 1, perPage: 18) { media(type: ANIME, isAdult: false, season: $season, seasonYear: $year, sort: POPULARITY_DESC) { ${ANILIST_MEDIA_FIELDS} } }
    popular: Page(page: 1, perPage: 24) { media(type: ANIME, isAdult: false, sort: POPULARITY_DESC) { ${ANILIST_MEDIA_FIELDS} } }
    rated: Page(page: 1, perPage: 24) { media(type: ANIME, isAdult: false, sort: SCORE_DESC) { ${ANILIST_MEDIA_FIELDS} } }
    upcoming: Page(page: 1, perPage: 24) { media(type: ANIME, isAdult: false, status: NOT_YET_RELEASED, sort: START_DATE) { ${ANILIST_MEDIA_FIELDS} } }
  }`;
  const data = await fetchAniList(query, { season: seasons[now.getMonth()], year: now.getFullYear() });
  return {
    currentSeason: (data.current?.media || []).map(normalizeAniList).filter((anime) => anime.image),
    trending: (data.popular?.media || []).map(normalizeAniList).filter((anime) => anime.image),
    topRated: (data.rated?.media || []).map(normalizeAniList).filter((anime) => anime.image),
    upcoming: (data.upcoming?.media || []).map(normalizeAniList).filter((anime) => anime.image)
  };
}

function loadApiCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(API_CACHE_KEY));
    if (!cached?.savedAt || Date.now() - cached.savedAt > CACHE_MAX_AGE) return false;
    trending = cached.trending || [];
    topRated = cached.topRated || [];
    currentSeason = cached.currentSeason || [];
    upcoming = cached.upcoming || [];
    catalog = dedupeAnime([...currentSeason, ...trending, ...topRated]);
    lastApiUpdate = cached.savedAt;
    apiState = catalog.length ? "cached" : "loading";
    return Boolean(catalog.length);
  } catch {
    return false;
  }
}

function saveApiCache() {
  localStorage.setItem(API_CACHE_KEY, JSON.stringify({
    savedAt: lastApiUpdate,
    trending,
    topRated,
    currentSeason,
    upcoming
  }));
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchJikan(path, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${API_BASE}${path}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Jikan request failed with ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await wait(900 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function normalizeFeed(payload) {
  return (payload?.data || []).map(normalizeJikan).filter((anime) => anime.id && anime.image && anime.title);
}

async function fetchCatalog({ notifyOnError = false } = {}) {
  if (catalogRefreshInFlight) return;
  catalogRefreshInFlight = true;
  if (!catalog.length) {
    apiState = "loading";
    renderAll();
  } else {
    renderSyncStatus();
  }
  try {
    let feeds;
    try {
      feeds = await fetchAniListCatalog();
    } catch {
      const seasonPayload = await fetchJikan("/seasons/now?sfw=true&limit=18", 1);
      await wait(380);
      const popularPayload = await fetchJikan("/top/anime?filter=bypopularity&sfw=true&limit=24", 1);
      await wait(380);
      const ratedPayload = await fetchJikan("/top/anime?sfw=true&limit=24", 1);
      await wait(380);
      const upcomingPayload = await fetchJikan("/seasons/upcoming?sfw=true&limit=24", 1);
      feeds = {
        currentSeason: normalizeFeed(seasonPayload),
        trending: normalizeFeed(popularPayload),
        topRated: normalizeFeed(ratedPayload),
        upcoming: normalizeFeed(upcomingPayload)
      };
    }

    currentSeason = feeds.currentSeason;
    trending = feeds.trending;
    topRated = feeds.topRated;
    upcoming = feeds.upcoming.sort((a, b) => releaseTime(a) - releaseTime(b));
    catalog = dedupeAnime([...currentSeason, ...trending, ...topRated]);
    featuredIndex = Math.min(featuredIndex, Math.max(0, currentSeason.length - 1));
    lastApiUpdate = Date.now();
    apiState = "live";
    saveApiCache();
    renderAll();
  } catch (error) {
    apiState = catalog.length ? "cached" : "error";
    renderAll();
    if (notifyOnError) toast("The anime service is busy. Showing the latest saved data.");
    console.info("Live anime refresh is temporarily unavailable.", error);
  } finally {
    catalogRefreshInFlight = false;
  }
}

function dedupeAnime(items) {
  const seen = new Set();
  return items.filter((item) => !seen.has(item.id) && seen.add(item.id));
}

function skeletonCards(count = 5) {
  return Array.from({ length: count }, () => `<article class="anime-card card-skeleton"><div class="poster-wrap"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></article>`).join("");
}

function listToggleIcon(isAdded) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${isAdded ? '<path d="m6 12 4 4 8-9"/>' : '<path d="M12 5v14M5 12h14"/>'}</svg>`;
}

function listToggleButton(animeId, isAdded, className = "card-add") {
  const action = isAdded ? "Remove from my list" : "Add to my list";
  return `<button type="button" class="${className} ${isAdded ? "added" : ""}" data-list-toggle="${animeId}" aria-label="${action}" aria-pressed="${isAdded}" title="${action}">${listToggleIcon(isAdded)}</button>`;
}

function renderSyncStatus() {
  const status = $("#syncStatus");
  if (!status) return;
  status.className = `sync-status ${apiState}`;
  if (apiState === "loading") $("#syncLabel").textContent = "Syncing…";
  else if (apiState === "error") $("#syncLabel").textContent = "API offline";
  else if (apiState === "cached") $("#syncLabel").textContent = "Saved data";
  else {
    const ageMinutes = Math.floor((Date.now() - lastApiUpdate) / 60000);
    $("#syncLabel").textContent = ageMinutes < 1 ? "Live · now" : `Live · ${ageMinutes}m`;
  }
  status.title = apiState === "loading" ? "Updating from the live anime APIs…" : "Refresh anime data now";
}

function animeCard(anime) {
  const entry = getUserList().find((item) => item.animeId === anime.id);
  const collaborators = profilesForAnime(anime.id);
  return `<article class="anime-card" data-anime-id="${anime.id}">
    <div class="poster-wrap" data-open-anime="${anime.id}" tabindex="0" role="button" aria-label="View ${escapeHtml(anime.title)} details">
      <img src="${anime.image}" alt="${escapeHtml(anime.title)} poster" loading="lazy" />
      <div class="poster-scrim"></div>
      ${anime.score ? `<span class="score-badge"><span>★</span> ${formatScore(anime.score)}</span>` : ""}
      ${listToggleButton(anime.id, Boolean(entry))}
    </div>
    <h3 data-open-anime="${anime.id}">${escapeHtml(anime.title)}</h3>
    <p>${escapeHtml(anime.genres.slice(0, 2).join(" · ") || "Anime")} · ${anime.year}</p>
    ${collaborators.length > 1 ? collaboratorMarkup(collaborators, { compact: true }) : ""}
  </article>`;
}

function renderHero() {
  const featuredFeed = currentSeason.length ? currentSeason : trending;
  const anime = featuredFeed[featuredIndex % Math.min(featuredFeed.length, 4)];
  if (!anime) {
    $(".hero-art").style.backgroundImage = "none";
    $("#heroTitle").textContent = apiState === "error" ? "We couldn't reach the anime catalog" : "Finding your next story…";
    $("#heroSynopsis").textContent = apiState === "error" ? "Check your connection and try the live refresh again." : "SoraList is loading the newest seasonal anime directly from MyAnimeList.";
    $("#heroMeta").innerHTML = "<span>LIVE CATALOG</span>";
    $("#heroAddButton").disabled = true;
    $("#heroDetailsButton").disabled = true;
    $("#heroPagination").innerHTML = "";
    return;
  }
  $("#heroAddButton").disabled = false;
  $("#heroDetailsButton").disabled = false;
  $(".hero-art").style.backgroundImage = `url("${anime.banner || anime.image}")`;
  $("#heroTitle").textContent = anime.title;
  $("#heroSynopsis").textContent = anime.synopsis;
  $("#heroMeta").innerHTML = `<span>${anime.year}</span><i></i><span>${episodeLabel(anime.episodes)}</span><i></i><span>${escapeHtml(anime.genres[0] || "Genre TBA")}</span>${anime.score ? `<i></i><span class="hero-score">★ ${formatScore(anime.score)}</span>` : ""}`;
  $("#heroAddButton").dataset.animeId = anime.id;
  $("#heroDetailsButton").dataset.animeId = anime.id;
  const isAdded = getUserList().some((entry) => entry.animeId === anime.id);
  $("#heroAddButton").classList.toggle("added", isAdded);
  $("#heroAddButton").setAttribute("aria-pressed", String(isAdded));
  $("#heroAddButton").setAttribute("aria-label", isAdded ? "Remove featured anime from my list" : "Add featured anime to my list");
  $("#heroAddButton").title = isAdded ? "Remove from my list" : "Add to my list";
  $("#heroAddButton").innerHTML = listToggleIcon(isAdded);
  $("#heroPagination").innerHTML = featuredFeed.slice(0, 4).map((_, index) => `<button class="${index === featuredIndex ? "active" : ""}" data-feature-index="${index}" aria-label="Show featured anime ${index + 1}"></button>`).join("");
}

function renderHome() {
  const feed = homeFeed === "top" ? topRated : trending;
  $("#homeGrid").innerHTML = feed.length ? feed.slice(0, 5).map(animeCard).join("") : apiState === "loading" ? skeletonCards(5) : emptyState("Live catalog unavailable", "We couldn't load this feed from the anime API.", "Try again", "retry");
  $("#homeUpcoming").innerHTML = upcoming.length ? upcoming.slice(0, 3).map((anime) => {
    const date = formatDate(anime.startDate, anime.startDateParts);
    return `<article class="release-row" data-open-anime="${anime.id}"><img src="${anime.image}" alt="" loading="lazy"><div><h4>${escapeHtml(anime.title)}</h4><p>${escapeHtml(anime.studio)} · ${escapeHtml(anime.genres.slice(0, 2).join(" / ") || "Genre TBA")}</p></div><div class="release-date"><strong>${date.compact}</strong><span>${episodeLabel(anime.episodes)}</span></div></article>`;
  }).join("") : `<div class="api-inline-state">${apiState === "loading" ? "Loading upcoming releases…" : "Upcoming releases are temporarily unavailable."}</div>`;
  renderHero();
  renderProgress();
}

function normalizedAnimeStatus(status) {
  const value = String(status || "").toUpperCase();
  if (value.includes("NOT_YET") || value.includes("NOT YET")) return "NOT_YET_RELEASED";
  if (value.includes("RELEAS") || value.includes("CURRENTLY") || value === "AIRING") return "RELEASING";
  if (value.includes("FINISH") || value.includes("COMPLETE")) return "FINISHED";
  return value;
}

function animeMatchesDiscoverFilters(anime, filters) {
  const format = String(anime.format || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const year = Number(anime.year);
  const score = Number(anime.score) || 0;
  return (filters.genre === "All" || anime.genres?.includes(filters.genre))
    && (filters.format === "all" || format === filters.format)
    && (filters.status === "all" || normalizedAnimeStatus(anime.status) === filters.status)
    && (filters.season === "all" || String(anime.season || "").toUpperCase() === filters.season)
    && (filters.year === "all" || year === Number(filters.year))
    && (!Number(filters.minScore) || score >= Number(filters.minScore));
}

function sortDiscoverAnime(items, sort) {
  const results = [...items];
  if (sort === "rating") return results.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  if (sort === "newest") return results.sort((a, b) => {
    const aTime = releaseTime(a) === Number.MAX_SAFE_INTEGER ? 0 : releaseTime(a);
    const bTime = releaseTime(b) === Number.MAX_SAFE_INTEGER ? 0 : releaseTime(b);
    return bTime - aTime;
  });
  if (sort === "title") return results.sort((a, b) => a.title.localeCompare(b.title));
  return results;
}

function applyDiscoverFilters(items) {
  return sortDiscoverAnime(items.filter((anime) => animeMatchesDiscoverFilters(anime, discoverFilters)), discoverFilters.sort);
}

function buildDiscoverQuery(filters) {
  const definitions = [];
  const argumentsList = ["type: ANIME", "isAdult: false"];
  const variables = {};
  const addFilter = (variable, type, argument, value) => {
    if (value === null || value === undefined || value === "") return;
    definitions.push(`$${variable}: ${type}`);
    argumentsList.push(`${argument}: $${variable}`);
    variables[variable] = value;
  };
  addFilter("genre", "String", "genre", filters.genre === "All" ? null : filters.genre);
  addFilter("format", "MediaFormat", "format", filters.format === "all" ? null : filters.format);
  addFilter("status", "MediaStatus", "status", filters.status === "all" ? null : filters.status);
  addFilter("season", "MediaSeason", "season", filters.season === "all" ? null : filters.season);
  addFilter("year", "Int", "seasonYear", filters.year === "all" ? null : Number(filters.year));
  addFilter("minimumScore", "Int", "averageScore_greater", Number(filters.minScore) ? Number(filters.minScore) * 10 - 1 : null);
  const sortValues = { popular: "POPULARITY_DESC", rating: "SCORE_DESC", newest: "START_DATE_DESC", title: "TITLE_ROMAJI" };
  addFilter("sort", "[MediaSort]", "sort", [sortValues[filters.sort] || sortValues.popular]);
  const declaration = definitions.length ? `(${definitions.join(", ")})` : "";
  return {
    query: `query ${declaration} { Page(page: 1, perPage: 30) { media(${argumentsList.join(", ")}) { ${ANILIST_MEDIA_FIELDS} } } }`,
    variables
  };
}

function renderDiscoverFilterControls(resultCount = 0) {
  $$("[data-genre]", $("#genreFilters")).forEach((button) => button.classList.toggle("active", button.dataset.genre === discoverFilters.genre));
  $$('[data-discover-filter]').forEach((select) => { if (select.id !== "discoverYear") select.value = discoverFilters[select.dataset.discoverFilter]; });
  const yearSelect = $("#discoverYear");
  const years = [...new Set([...catalog, ...upcoming, ...(discoverResults || [])].map((anime) => Number(anime.year)).filter((year) => year > 1900))].sort((a, b) => b - a);
  if (discoverFilters.year !== "all" && !years.includes(Number(discoverFilters.year))) years.unshift(Number(discoverFilters.year));
  yearSelect.innerHTML = `<option value="all">Any year</option>${years.map((year) => `<option value="${year}" ${String(year) === String(discoverFilters.year) ? "selected" : ""}>${year}</option>`).join("")}`;
  $("#discoverResultCount").textContent = discoverLoading ? "Searching live catalog…" : `${resultCount} ${resultCount === 1 ? "title" : "titles"}`;
}

function renderDiscover() {
  const filtered = applyDiscoverFilters(discoverResults || catalog);
  renderDiscoverFilterControls(filtered.length);
  if (discoverLoading) {
    $("#discoverGrid").innerHTML = skeletonCards(12);
    return;
  }
  $("#discoverGrid").innerHTML = filtered.map(animeCard).join("") || (apiState === "loading" ? skeletonCards(12) : emptyState("No titles match", "Try removing one or more filters to widen the live search.", "Clear filters", "reset-discover"));
}

function emptyState(title, copy, action, view) {
  return `<div class="empty-state" style="grid-column: 1 / -1"><div class="empty-icon">✦</div><h3>${title}</h3><p>${copy}</p><button class="primary-button" data-empty-action="${view}">${action}</button></div>`;
}

function renderList() {
  const user = currentUser();
  const list = getUserList();
  const sharedIds = sharedAnimeIds(user);
  $("#listCount").textContent = list.length;
  const ratings = list.filter((item) => item.rating).map((item) => item.rating);
  $("#averageRating").textContent = ratings.length ? `${(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)} / 5` : "—";
  $("#listSubtitle").textContent = user ? `${list.length} ${list.length === 1 ? "story" : "stories"} in ${user.username}'s collection.` : "Sign in to keep every story in one place.";
  ["all", "watching", "completed", "planned"].forEach((status) => {
    const button = $(`[data-status="${status}"]`, $("#listTabs"));
    if (button) button.querySelector("span").textContent = status === "all" ? list.length : list.filter((item) => item.status === status).length;
  });
  const sharedSpotlight = $("#sharedListSpotlight");
  if (!user) {
    sharedSpotlight.innerHTML = "";
    $("#listContent").innerHTML = emptyState("Your list starts here", "Create a profile to save titles, track episodes, and leave ratings.", "Sign in or create account", "auth");
    return;
  }
  const sharedFriends = connectedProfiles(user).filter((friend) => (friend.list || []).some((entry) => sharedIds.has(Number(entry.animeId))));
  sharedSpotlight.innerHTML = sharedIds.size ? `<section class="shared-list-banner"><div class="shared-list-copy"><span class="shared-spark">✦</span><div><strong>${sharedIds.size} shared ${sharedIds.size === 1 ? "pick" : "picks"}</strong><small>You and your friends saved the same anime.</small></div></div>${collaboratorMarkup([user, ...sharedFriends], { compact: true })}</section>` : "";
  const entries = listFilter === "all" ? list : list.filter((item) => item.status === listFilter);
  if (!entries.length) {
    $("#listContent").innerHTML = emptyState("Nothing here yet", "Explore the catalog and add a title when it catches your eye.", "Discover anime", "discover");
    return;
  }
  $("#listContent").innerHTML = entries.map((entry) => {
    const anime = findAnime(entry.animeId) || entry.snapshot;
    const total = Number(anime.episodes) || "?";
    const collaborators = profilesForAnime(anime.id, user);
    return `<article class="list-row" data-open-anime="${anime.id}">
      <div class="list-anime" data-open-anime="${anime.id}" tabindex="0" role="button" aria-label="Open details for ${escapeHtml(anime.title)}"><img src="${anime.image}" alt=""><div><strong>${escapeHtml(anime.title)}</strong><small>${anime.year} · ${escapeHtml(anime.studio || "Anime")}</small></div></div>
      <select class="status-select" data-list-status="${anime.id}" aria-label="Watch status for ${escapeHtml(anime.title)}">
        <option value="planned" ${entry.status === "planned" ? "selected" : ""}>Plan to watch</option><option value="watching" ${entry.status === "watching" ? "selected" : ""}>Watching</option><option value="completed" ${entry.status === "completed" ? "selected" : ""}>Completed</option>
      </select>
      <div class="progress-stepper"><button data-progress="minus" data-anime-id="${anime.id}" aria-label="Decrease progress">−</button><span>${entry.progress || 0} / ${total}</span><button data-progress="plus" data-anime-id="${anime.id}" aria-label="Increase progress">+</button></div>
      <div class="list-stars" aria-label="Rating">${[1,2,3,4,5].map((star) => `<button class="${star <= (entry.rating || 0) ? "filled" : ""}" data-list-rating="${star}" data-anime-id="${anime.id}" aria-label="Rate ${star} out of 5">★</button>`).join("")}</div>
      ${collaboratorMarkup(collaborators)}
      <button class="remove-button" data-remove-anime="${anime.id}" aria-label="Remove ${escapeHtml(anime.title)}">×</button>
    </article>`;
  }).join("");
}

function sharedAnimeWithProfile(user, profile) {
  const friendAnimeIds = new Set((profile.list || []).map((entry) => Number(entry.animeId)));
  return (user.list || []).filter((entry) => friendAnimeIds.has(Number(entry.animeId))).map((entry) => findAnime(entry.animeId) || entry.snapshot).filter(Boolean);
}

function friendProfileCard(profile, user, connected) {
  const sharedAnime = sharedAnimeWithProfile(user, profile);
  const previews = sharedAnime.slice(0, 4).map((anime) => `<button type="button" data-open-anime="${anime.id}" title="${escapeHtml(anime.title)}"><img src="${anime.image}" alt="${escapeHtml(anime.title)}"></button>`).join("");
  return `<article class="friend-profile-card">
    <div class="friend-profile-heading">${profileAvatarMarkup(profile, "friend-page-avatar")}<span><strong>${escapeHtml(profile.username)}</strong><small>${(profile.list || []).length} saved ${(profile.list || []).length === 1 ? "title" : "titles"}</small></span><button class="friend-toggle ${connected ? "connected" : ""}" ${connected ? "data-toggle-friend" : "data-send-friend"}="${escapeHtml(profile.usernameLower)}">${connected ? "Connected" : "Add friend"}</button></div>
    <div class="friend-shared-summary"><strong>${sharedAnime.length}</strong><span>shared anime</span></div>
    ${previews ? `<div class="friend-shared-preview">${previews}${sharedAnime.length > 4 ? `<span>+${sharedAnime.length - 4}</span>` : ""}</div>` : `<p class="friend-no-overlap">No shared titles yet. Add the same anime to see it here.</p>`}
  </article>`;
}

function friendRequestCard(profile, type) {
  const descriptions = {
    incoming: "wants to connect and compare anime lists with you.",
    outgoing: "has not responded to your request yet.",
    rejected: "was declined. This private history is visible only to you."
  };
  const actions = type === "incoming"
    ? `<button class="friend-request-button accept" data-accept-friend="${escapeHtml(profile.usernameLower)}">Accept</button><button class="friend-request-button reject" data-reject-friend="${escapeHtml(profile.usernameLower)}">Reject</button>`
    : type === "outgoing"
      ? `<button class="friend-request-button" data-cancel-friend="${escapeHtml(profile.usernameLower)}">Cancel request</button>`
      : `<button class="friend-request-button" data-dismiss-rejected="${escapeHtml(profile.usernameLower)}">Dismiss</button>`;
  return `<article class="friend-request-card">${profileAvatarMarkup(profile, "friend-page-avatar")}<div><strong>${escapeHtml(profile.username)}</strong><p>${descriptions[type]}</p></div><div class="friend-request-actions">${actions}</div></article>`;
}

function switchFriendsTab(tab, { focusInput = false } = {}) {
  const availableTabs = new Set(["connected", "pending", "outgoing", "rejected", "add"]);
  friendsTab = availableTabs.has(tab) ? tab : "connected";
  $$('[data-friends-tab]', $("#friendsTabs")).forEach((button) => {
    const active = button.dataset.friendsTab === friendsTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$('[data-friends-panel]', $("#friendsView")).forEach((panel) => {
    panel.hidden = panel.dataset.friendsPanel !== friendsTab;
  });
  if (focusInput && friendsTab === "add") setTimeout(() => $("#friendUsernameInput")?.focus(), 0);
}

function buildFriendInviteLink(user) {
  if (!user) return "";
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "friends";
  url.searchParams.set("friend", user.username);
  return url.href;
}

function friendInviteFromLocation() {
  try {
    const username = String(new URL(window.location.href).searchParams.get("friend") || "").trim();
    return /^[A-Za-z0-9_]{3,20}$/.test(username) ? username : null;
  } catch { return null; }
}

function renderFriendInviteTools(user) {
  const linkInput = $("#friendInviteLink");
  const copyButton = $("#copyFriendInvite");
  linkInput.value = user ? buildFriendInviteLink(user) : "Sign in to create your invite link";
  copyButton.disabled = !user;
  const preview = $("#friendInvitePreview");
  if (!friendInviteUsername) {
    preview.hidden = true;
    preview.innerHTML = "";
    return;
  }
  const usernameLower = friendInviteUsername.toLowerCase();
  const invitedProfile = store.users.find((profile) => profile.usernameLower === usernameLower);
  const displayProfile = invitedProfile || { username: friendInviteUsername, usernameLower };
  let action = `<button class="primary-button" data-empty-action="auth">Sign in to add</button>`;
  let note = "Sign in to send this profile a friend request.";
  if (user) {
    const relationship = invitedProfile ? friendRelationship(user, invitedProfile) : "none";
    if (user.usernameLower === usernameLower) {
      action = `<button class="outline-button" disabled>Your profile</button>`;
      note = "This is your personal invite link. Copy it and send it to a friend.";
    } else if (relationship === "connected") {
      action = `<button class="outline-button" disabled>Already connected</button>`;
      note = "You and this profile are already friends.";
    } else if (relationship === "outgoing") {
      action = `<button class="outline-button" disabled>Request sent</button>`;
      note = "Your friend request is waiting for a response.";
    } else if (relationship === "incoming") {
      action = `<button class="primary-button" data-friends-jump="pending">Review request</button>`;
      note = "This profile already sent you a friend request.";
    } else {
      action = `<button class="primary-button" data-send-friend="${escapeHtml(usernameLower)}">Add Friend</button>`;
      note = invitedProfile ? "Send a friend request to connect your anime lists." : "Sign in on the shared SoraList site to resolve this profile.";
    }
  }
  preview.hidden = false;
  preview.innerHTML = `${profileAvatarMarkup(displayProfile, "friend-page-avatar")}<div><p class="eyebrow">PROFILE INVITE</p><h2>${escapeHtml(displayProfile.username)} invited you</h2><p>${escapeHtml(note)}</p></div>${action}`;
}

async function copyFriendInviteLink() {
  const link = $("#friendInviteLink").value;
  if (!currentUser() || !link) { openModal("authModal"); return; }
  try {
    await navigator.clipboard.writeText(link);
    toast("Profile invite link copied");
  } catch {
    $("#friendInviteLink").select();
    toast("Select the link and copy it manually.");
  }
}

function renderFriends() {
  const user = currentUser();
  const connected = connectedProfiles(user);
  $("#friendsCount").textContent = connected.length;
  renderFriendInviteTools(user);
  if (!user) {
    $("#friendsConnectedCount").textContent = "0";
    $("#friendsPendingCount").textContent = "0";
    $("#friendsOutgoingCount").textContent = "0";
    $("#friendsRejectedCount").textContent = "0";
    $("#friendsConnectedList").innerHTML = emptyState("Sign in to find friends", "Connect profiles, compare lists, and discover shared anime.", "Sign in", "auth");
    $("#friendsPendingList").innerHTML = "";
    $("#friendsOutgoingList").innerHTML = "";
    $("#friendsRejectedList").innerHTML = "";
    $("#friendsDiscoverList").innerHTML = "";
    switchFriendsTab(friendsTab);
    return;
  }
  ensureFriendRequestState(user);
  const otherProfiles = store.users.filter((profile) => profile.usernameLower !== user.usernameLower);
  const connectedNames = new Set(connected.map((profile) => profile.usernameLower));
  const pendingProfiles = requestProfiles(user, "incomingFriendRequests");
  const outgoingProfiles = requestProfiles(user, "outgoingFriendRequests");
  const rejectedProfiles = requestProfiles(user, "rejectedFriendRequests");
  const unavailableNames = new Set([...connectedNames, ...user.incomingFriendRequests, ...user.outgoingFriendRequests, ...user.rejectedFriendRequests]);
  const availableProfiles = otherProfiles.filter((profile) => !unavailableNames.has(profile.usernameLower));
  $("#friendsConnectedCount").textContent = connected.length;
  $("#friendsPendingCount").textContent = pendingProfiles.length;
  $("#friendsOutgoingCount").textContent = outgoingProfiles.length;
  $("#friendsRejectedCount").textContent = rejectedProfiles.length;
  $("#friendsConnectedList").innerHTML = connected.length
    ? connected.sort((left, right) => sharedAnimeWithProfile(user, right).length - sharedAnimeWithProfile(user, left).length).map((profile) => friendProfileCard(profile, user, true)).join("")
    : emptyState("Your circle is waiting", "Enter a friend's username above to start comparing anime lists.", "Add friends", "friends");
  $("#friendsPendingList").innerHTML = pendingProfiles.length
    ? pendingProfiles.map((profile) => friendRequestCard(profile, "incoming")).join("")
    : `<div class="friends-empty-note">You have no incoming friend requests.</div>`;
  $("#friendsOutgoingList").innerHTML = outgoingProfiles.length
    ? outgoingProfiles.map((profile) => friendRequestCard(profile, "outgoing")).join("")
    : `<div class="friends-empty-note">You have no outgoing friend requests.</div>`;
  $("#friendsRejectedList").innerHTML = rejectedProfiles.length
    ? rejectedProfiles.map((profile) => friendRequestCard(profile, "rejected")).join("")
    : `<div class="friends-empty-note">You have not rejected any requests.</div>`;
  $("#friendsDiscoverList").innerHTML = availableProfiles.length
    ? availableProfiles.map((profile) => friendProfileCard(profile, user, false)).join("")
    : `<div class="friends-empty-note">${otherProfiles.length ? "No other profiles are available to add right now." : "Other profiles will appear here when your friends create their accounts."}</div>`;
  switchFriendsTab(friendsTab);
}

function groupsForUser(user = currentUser()) {
  if (!user) return [];
  store.groups ||= [];
  return store.groups.filter((group) => (group.memberUsernames || []).includes(user.usernameLower));
}

function groupMembers(group) {
  const usernames = new Set(group?.memberUsernames || []);
  return store.users.filter((profile) => usernames.has(profile.usernameLower));
}

function groupAvatarStack(profiles, label = "Group members") {
  const visible = profiles.slice(0, 4);
  return `<div class="group-avatar-stack" aria-label="${escapeHtml(label)}">${visible.map((profile) => profileAvatarMarkup(profile, "friend-avatar")).join("")}${profiles.length > 4 ? `<span class="friend-avatar group-avatar-overflow">+${profiles.length - 4}</span>` : ""}</div>`;
}

function renderGroupCreator() {
  const user = currentUser();
  const friends = connectedProfiles(user);
  $("#newGroupButton").textContent = user ? "+ Create group" : "Sign in to create";
  $("#groupMemberChoices").innerHTML = !user
    ? `<p class="group-create-note">Sign in before creating a group list.</p>`
    : friends.length
      ? friends.map((profile) => `<label class="group-member-choice"><input type="checkbox" name="members" value="${escapeHtml(profile.usernameLower)}"><span>${profileAvatarMarkup(profile, "friend-avatar")}<span><strong>${escapeHtml(profile.username)}</strong><small>${(profile.list || []).length} saved titles</small></span></span></label>`).join("")
      : `<p class="group-create-note">Connect at least one friend before creating a group. <button type="button" data-view-jump="friends">Open Friends</button></p>`;
}

function showGroupCreator(show = true) {
  if (!currentUser()) { openModal("authModal"); return; }
  $("#groupCreatePanel").hidden = !show;
  if (show) setTimeout(() => $("#createGroupForm").elements.groupName.focus(), 0);
}

function createGroupList(form) {
  const user = currentUser();
  if (!user) return false;
  const data = new FormData(form);
  const name = String(data.get("groupName") || "").trim();
  const connectedNames = new Set(connectedProfiles(user).map((profile) => profile.usernameLower));
  const selectedFriends = data.getAll("members").map(String).filter((username) => connectedNames.has(username));
  const error = $("#groupCreateError");
  if (name.length < 2) { error.textContent = "Use at least 2 characters for the group name."; return false; }
  if (!selectedFriends.length) { error.textContent = "Choose at least one connected friend."; return false; }
  if (user.supabaseAccount) {
    queueSupabaseMutation(async () => {
      const memberIds = selectedFriends.map((username) => store.users.find((profile) => profile.usernameLower === username)?.dbId).filter(Boolean);
      const group = await window.SoraListSupabase.createGroup(name, memberIds);
      activeGroupId = group.id;
      form.reset();
      error.textContent = "";
      showGroupCreator(false);
      await refreshSupabaseStore();
      toast(`${name} was created`);
    }).catch((createError) => {
      error.textContent = createError.message || "The group could not be created.";
    });
    return true;
  }
  const now = new Date().toISOString();
  const group = {
    id: crypto.randomUUID?.() || `group-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    ownerUsernameLower: user.usernameLower,
    memberUsernames: [user.usernameLower, ...selectedFriends],
    animeEntries: [],
    messages: [{ id: `system-${Date.now()}`, authorUsernameLower: user.usernameLower, text: `created ${name}.`, system: true, createdAt: now }],
    createdAt: now,
    updatedAt: now
  };
  store.groups ||= [];
  store.groups.unshift(group);
  activeGroupId = group.id;
  saveStore();
  form.reset();
  error.textContent = "";
  showGroupCreator(false);
  renderAll();
  toast(`${name} was created`);
  return true;
}

function activeGroup() {
  const user = currentUser();
  return groupsForUser(user).find((group) => group.id === activeGroupId) || null;
}

function groupAnimeCandidates(query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return [];
  const saved = store.users.flatMap((profile) => (profile.list || []).map((entry) => entry.snapshot).filter(Boolean));
  const seen = new Set();
  return [...catalog, ...currentSeason, ...upcoming, ...saved].filter((anime) => {
    if (!anime?.id || seen.has(Number(anime.id))) return false;
    seen.add(Number(anime.id));
    return String(anime.title || "").toLowerCase().includes(normalized);
  }).slice(0, 7);
}

function renderGroupAnimeSearch(query = "") {
  const results = $("#groupAnimeResults");
  if (!results) return;
  const group = activeGroup();
  const matches = groupAnimeCandidates(query);
  const user = currentUser();
  if (!String(query).trim()) {
    results.innerHTML = `<p>Search the live catalog to add the group's next anime.</p>`;
    return;
  }
  results.innerHTML = matches.length ? matches.map((anime) => {
    const entry = (group?.animeEntries || []).find((item) => Number(item.animeId) === Number(anime.id));
    const alreadyAdded = entry?.addedBy?.includes(user?.usernameLower);
    return `<button type="button" class="group-anime-result" data-group-add-anime="${anime.id}" ${alreadyAdded ? "disabled" : ""}><img src="${escapeHtml(anime.image)}" alt=""><span><strong>${escapeHtml(anime.title)}</strong><small>${anime.year || "Year TBA"} · ${escapeHtml(anime.studio || "Studio TBA")}</small></span><b>${alreadyAdded ? "Added" : entry ? "+ Join" : "+ Add"}</b></button>`;
  }).join("") : `<p>No loaded anime matches “${escapeHtml(query)}”. Try the main search for more API results.</p>`;
}

function recordGroupActivity(group, user, text) {
  group.messages ||= [];
  group.messages.push({ id: `system-${Date.now()}-${Math.random().toString(16).slice(2)}`, authorUsernameLower: user.usernameLower, text, system: true, createdAt: new Date().toISOString() });
  group.updatedAt = new Date().toISOString();
}

function addAnimeToGroup(animeId, groupId) {
  const group = groupId ? groupsForUser().find((item) => item.id === groupId) : activeGroup();
  const user = currentUser();
  const anime = findAnime(animeId);
  if (!group || !user || !anime) return false;
  if (user.supabaseAccount) {
    queueSupabaseMutation(async () => {
      await window.SoraListSupabase.setGroupAnimeInterest(group.id, animeId, anime, true);
      await refreshSupabaseStore();
      if (typeof savePickerAnimeId !== "undefined" && savePickerAnimeId) renderAnimeSavePicker();
      toast(`${anime.title} added to ${group.name}`);
    });
    return true;
  }
  group.animeEntries ||= [];
  let entry = group.animeEntries.find((item) => Number(item.animeId) === Number(animeId));
  if (entry?.addedBy?.includes(user.usernameLower)) { toast("You already added this anime to the group"); return false; }
  if (entry) entry.addedBy = [...new Set([...(entry.addedBy || []), user.usernameLower])];
  else {
    entry = { animeId: Number(animeId), snapshot: anime, addedBy: [user.usernameLower], addedAt: new Date().toISOString() };
    group.animeEntries.unshift(entry);
  }
  recordGroupActivity(group, user, `${entry.addedBy.length > 1 ? "also wants to watch" : "added"} ${anime.title}.`);
  saveStore();
  renderAll();
  if (typeof savePickerAnimeId !== "undefined" && savePickerAnimeId) renderAnimeSavePicker();
  toast(`${anime.title} added to ${group.name}`);
  return true;
}

function toggleGroupAnimeInterest(animeId, groupId) {
  const group = groupId ? groupsForUser().find((item) => item.id === groupId) : activeGroup();
  const user = currentUser();
  if (!group || !user) return;
  const entry = (group.animeEntries || []).find((item) => Number(item.animeId) === Number(animeId));
  if (user.supabaseAccount) {
    const isInterested = Boolean(entry?.addedBy?.includes(user.usernameLower));
    const anime = findAnime(animeId) || entry?.snapshot;
    queueSupabaseMutation(async () => {
      await window.SoraListSupabase.setGroupAnimeInterest(group.id, animeId, anime, !isInterested);
      await refreshSupabaseStore();
      if (typeof savePickerAnimeId !== "undefined" && savePickerAnimeId) renderAnimeSavePicker();
    });
    return;
  }
  if (!entry || !(entry.addedBy || []).includes(user.usernameLower)) { addAnimeToGroup(animeId, groupId); return; }
  entry.addedBy = entry.addedBy.filter((name) => name !== user.usernameLower);
  const anime = findAnime(animeId) || entry.snapshot;
  if (!entry.addedBy.length) group.animeEntries = group.animeEntries.filter((item) => item !== entry);
  recordGroupActivity(group, user, `removed ${anime.title} from their picks.`);
  saveStore();
  renderAll();
  if (typeof savePickerAnimeId !== "undefined" && savePickerAnimeId) renderAnimeSavePicker();
}

async function sendGroupMessage(form) {
  const group = activeGroup();
  const user = currentUser();
  const message = String(new FormData(form).get("message") || "").trim();
  if (!group || !user || !message) return false;
  if (user.supabaseAccount) {
    try {
      form.reset();
      await window.SoraListSupabase.sendGroupMessage(group.id, message);
      await refreshSupabaseStore();
      return true;
    } catch (error) {
      reportSupabaseError(error, "Your message could not be sent.");
      return false;
    }
  }
  group.messages ||= [];
  group.messages.push({ id: `message-${Date.now()}-${Math.random().toString(16).slice(2)}`, authorUsernameLower: user.usernameLower, text: message.slice(0, 500), system: false, createdAt: new Date().toISOString() });
  group.updatedAt = new Date().toISOString();
  form.reset();
  saveStore();
  renderAll();
  return true;
}

function groupMessageMarkup(message) {
  const author = store.users.find((profile) => profile.usernameLower === message.authorUsernameLower) || { username: message.authorUsernameLower, usernameLower: message.authorUsernameLower };
  const parsedDate = new Date(message.createdAt);
  const time = Number.isFinite(parsedDate.getTime()) ? parsedDate.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  if (message.system) return `<div class="group-system-message">${profileAvatarMarkup(author, "group-chat-avatar")}<p><strong>${escapeHtml(author.username)}</strong> ${escapeHtml(message.text)}</p><time>${escapeHtml(time)}</time></div>`;
  return `<article class="group-chat-message">${profileAvatarMarkup(author, "group-chat-avatar")}<div><span><strong>${escapeHtml(author.username)}</strong><time>${escapeHtml(time)}</time></span><p>${escapeHtml(message.text)}</p></div></article>`;
}

function groupAnimeEntryMarkup(entry, group, user) {
  const anime = findAnime(entry.animeId) || entry.snapshot;
  if (!anime) return "";
  const contributors = (entry.addedBy || []).map((name) => store.users.find((profile) => profile.usernameLower === name)).filter(Boolean);
  const currentAdded = (entry.addedBy || []).includes(user.usernameLower);
  return `<article class="group-anime-card" data-open-anime="${anime.id}"><img src="${escapeHtml(anime.image)}" alt=""><div><strong>${escapeHtml(anime.title)}</strong><small>${anime.year || "Year TBA"} · ${escapeHtml(anime.studio || "Studio TBA")}</small><div class="group-anime-people">${groupAvatarStack(contributors, `Added by ${contributors.map((profile) => profile.username).join(", ")}`)}<span>${contributors.length} ${contributors.length === 1 ? "member" : "members"} added this</span></div></div><button class="group-interest-button ${currentAdded ? "active" : ""}" data-group-toggle-anime="${anime.id}">${currentAdded ? "✓ Added" : "+ Join"}</button></article>`;
}

function renderGroupWorkspace(group, user) {
  if (!group) {
    return emptyState("Create your first group list", "Choose connected friends, build one shared watchlist, and talk about what to watch next.", "Create group", "create-group");
  }
  const members = groupMembers(group);
  const animeEntries = group.animeEntries || [];
  const messages = (group.messages || []).slice(-60);
  return `<header class="group-workspace-header"><div><p class="eyebrow">GROUP LIST</p><h2>${escapeHtml(group.name)}</h2><p>${members.length} ${members.length === 1 ? "member" : "members"} · ${animeEntries.length} ${animeEntries.length === 1 ? "anime" : "anime"}</p></div>${groupAvatarStack(members)}</header>
    <div class="group-content-grid">
      <section class="group-watchlist-panel">
        <div class="group-panel-heading"><div><p class="eyebrow">SHARED WATCHLIST</p><h3>What should we watch?</h3></div><span>${animeEntries.length}</span></div>
        <label class="group-anime-search"><span>Search anime to add</span><input id="groupAnimeSearch" type="search" autocomplete="off" placeholder="Search the live catalog…"></label>
        <div class="group-anime-results" id="groupAnimeResults"><p>Search the live catalog to add the group's next anime.</p></div>
        <div class="group-anime-list">${animeEntries.length ? animeEntries.map((entry) => groupAnimeEntryMarkup(entry, group, user)).join("") : `<div class="group-panel-empty"><strong>No anime yet</strong><p>Search above and add the first title. When friends add the same anime, their avatars will appear together.</p></div>`}</div>
      </section>
      <section class="group-chat-panel">
        <div class="group-panel-heading"><div><p class="eyebrow">GROUP CHAT</p><h3>${escapeHtml(group.name)}</h3></div><span>${messages.filter((message) => !message.system).length}</span></div>
        <div class="group-chat-messages" id="groupChatMessages">${messages.length ? messages.map(groupMessageMarkup).join("") : `<div class="group-panel-empty"><p>Start the conversation.</p></div>`}</div>
        <form class="group-message-form" data-group-message-form><input name="message" maxlength="500" autocomplete="off" placeholder="Message ${escapeHtml(group.name)}" aria-label="Message ${escapeHtml(group.name)}" required><button type="submit" aria-label="Send message">Send</button></form>
      </section>
    </div>`;
}

function renderGroups() {
  const user = currentUser();
  const groups = groupsForUser(user);
  $("#groupsCount").textContent = groups.length;
  $("#groupRailMeta").textContent = `${groups.length} ${groups.length === 1 ? "group" : "groups"}`;
  renderGroupCreator();
  if (!user) {
    $("#groupList").innerHTML = "";
    $("#groupWorkspace").innerHTML = emptyState("Sign in to use group lists", "Create shared watchlists and chat with connected friends.", "Sign in", "auth");
    return;
  }
  if (!groups.some((group) => group.id === activeGroupId)) activeGroupId = groups[0]?.id || null;
  $("#groupList").innerHTML = groups.length ? groups.map((group) => {
    const members = groupMembers(group);
    return `<button class="group-rail-item ${group.id === activeGroupId ? "active" : ""}" data-select-group="${escapeHtml(group.id)}"><span class="group-rail-icon">${escapeHtml(initials(group.name))}</span><span><strong>${escapeHtml(group.name)}</strong><small>${(group.animeEntries || []).length} anime · ${members.length} members</small></span></button>`;
  }).join("") : `<p class="group-rail-empty">No groups yet.</p>`;
  $("#groupWorkspace").innerHTML = renderGroupWorkspace(activeGroup(), user);
  const chat = $("#groupChatMessages");
  if (chat) requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
}

function renderUpcoming() {
  const now = new Date();
  const season = now.getMonth() < 3 ? "Winter" : now.getMonth() < 6 ? "Spring" : now.getMonth() < 9 ? "Summer" : "Fall";
  $("#seasonLabel").textContent = `${season} ${now.getFullYear()}`;
  const featured = upcoming[0];
  if (featured) {
    const date = formatDate(featured.startDate, featured.startDateParts);
    const added = getUserList().some((entry) => entry.animeId === featured.id);
    $("#upcomingFeature").innerHTML = `${listToggleButton(featured.id, added, "feature-list-toggle")}<div class="feature-copy"><p class="eyebrow">NEXT API RELEASE</p><h2>${escapeHtml(featured.title)}</h2><div class="hero-meta"><span>${date.full}</span><i></i><span>${episodeLabel(featured.episodes)}</span><i></i><span>${escapeHtml(featured.studio)}</span></div><p>${escapeHtml(truncate(featured.synopsis, 230))}</p></div><div class="feature-image" style="background-image:url('${featured.banner || featured.image}')"></div>`;
  } else {
    $("#upcomingFeature").innerHTML = `<div class="feature-copy"><p class="eyebrow">LIVE RELEASE RADAR</p><h2>${apiState === "loading" ? "Loading the next season…" : "Upcoming feed unavailable"}</h2><p>${apiState === "loading" ? "Checking MyAnimeList for newly announced shows and release dates." : "Use the live refresh when your connection is restored."}</p></div>`;
  }
  $("#upcomingGrid").innerHTML = upcoming.length ? upcoming.slice(1).map((anime) => {
    const date = formatDate(anime.startDate, anime.startDateParts);
    const added = getUserList().some((entry) => entry.animeId === anime.id);
    return `<article class="upcoming-card" data-open-anime="${anime.id}"><img src="${anime.image}" alt="${escapeHtml(anime.title)}" loading="lazy"><div><h3>${escapeHtml(anime.title)}</h3><p>${escapeHtml(anime.genres.slice(0, 2).join(" · "))} · ${anime.studio}</p><small>${date.full}</small></div>${listToggleButton(anime.id, added, "round-add")}</article>`;
  }).join("") : (apiState === "loading" ? skeletonCards(8) : emptyState("No release data available", "The API could not provide the upcoming season right now.", "Try again", "retry"));
}

function renderProgress() {
  const user = currentUser();
  const list = getUserList();
  $("#watchingStat").textContent = list.filter((item) => item.status === "watching").length;
  $("#completedStat").textContent = list.filter((item) => item.status === "completed").length;
  $("#ratedStat").textContent = list.filter((item) => item.rating > 0).length;
  $("#progressTitle").textContent = user ? `${user.username}'s journey` : "Make this space yours";
  $("#progressMessage").textContent = user ? (list.length ? `You've collected ${list.length} ${list.length === 1 ? "story" : "stories"}. Keep going.` : "Your watch history is ready for its first great story.") : "Sign in to track your watch history and see your stats.";
  setProfileAvatar($("#progressAvatar"), user);
  $("#progressAction").textContent = user ? "Open my list" : "Create your profile";
}

function renderAuthState() {
  const user = currentUser();
  const authButton = $("#authButton");
  authButton.classList.toggle("signed-in", Boolean(user));
  if (user) {
    authButton.style.setProperty("--avatar-hue", avatarHue(user.username));
    authButton.innerHTML = avatarInnerMarkup(user);
    authButton.setAttribute("aria-label", `Open ${user.username}'s profile`);
    authButton.title = user.username;
  } else {
    authButton.textContent = "Sign in";
    authButton.setAttribute("aria-label", "Sign in");
    authButton.title = "";
  }
  $("#profileDropdownName").textContent = user?.username || "Your account";
  setProfileAvatar($("#profileAvatar"), user);
  setProfileAvatar($("#accountPageAvatar"), user);
  $("#profileTitle").textContent = user?.username || "Guest mode";
  $("#profileMeta").textContent = user ? `Member since ${new Date(user.createdAt).toLocaleDateString("en", { month: "long", year: "numeric" })} · ${getUserList().length} titles` : "Sign in to start your list.";
  $("#profileSignOutButton").textContent = user ? "Sign out" : "Sign in";
  $("#accountPageName").textContent = user?.username || "Guest mode";
  $("#accountPageEmail").textContent = user?.email || (user ? "No email connected" : "Sign in to manage your account");
  $("#accountPageProvider").textContent = user ? (user.authProvider ? `${user.authProvider[0].toUpperCase() + user.authProvider.slice(1)} account` : "Local account") : "No active account";
  const friendPanel = $("#friendPanel");
  if (!user) {
    friendPanel.hidden = true;
    return;
  }
  friendPanel.hidden = false;
  const connected = connectedProfiles(user);
  const otherProfiles = store.users.filter((profile) => profile.usernameLower !== user.usernameLower);
  $("#friendPanelMeta").textContent = connected.length ? `${connected.length} connected ${connected.length === 1 ? "friend" : "friends"}` : "Connect another unique profile to compare lists.";
  $("#friendList").innerHTML = otherProfiles.length ? otherProfiles.map((profile) => {
    const relationship = friendRelationship(user, profile);
    const sharedCount = (user.list || []).filter((entry) => (profile.list || []).some((friendEntry) => Number(friendEntry.animeId) === Number(entry.animeId))).length;
    const action = relationship === "connected"
      ? `<button class="friend-toggle connected" data-toggle-friend="${escapeHtml(profile.usernameLower)}">Connected</button>`
      : relationship === "incoming"
        ? `<button class="friend-toggle pending" data-friends-jump="pending">Review</button>`
        : relationship === "outgoing"
          ? `<button class="friend-toggle pending" disabled>Requested</button>`
          : relationship === "rejected"
            ? `<button class="friend-toggle rejected" disabled>Rejected</button>`
            : `<button class="friend-toggle" data-send-friend="${escapeHtml(profile.usernameLower)}">Add friend</button>`;
    return `<div class="friend-row">${profileAvatarMarkup(profile, "friend-avatar")}<span><strong>${escapeHtml(profile.username)}</strong><small>${sharedCount} shared ${sharedCount === 1 ? "title" : "titles"}</small></span>${action}</div>`;
  }).join("") : `<p class="friend-empty">Create another unique profile to connect with a friend on this device.</p>`;
}

function renderProfilePage() {
  const user = currentUser();
  if (!user) return;
  const list = user.list || [];
  const animeEntries = list.map((entry) => ({ entry, anime: findAnime(entry.animeId) || entry.snapshot })).filter((item) => item.anime);
  const ratings = list.map((entry) => Number(entry.rating)).filter((rating) => rating > 0);
  const averageRating = ratings.length ? (ratings.reduce((total, rating) => total + rating, 0) / ratings.length).toFixed(1) : "—";
  const episodesWatched = list.reduce((total, entry) => total + (Number(entry.progress) || 0), 0);
  const genreCounts = new Map();
  animeEntries.forEach(({ anime }) => (anime.genres || []).forEach((genre) => genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1)));
  const favoriteGenres = [...genreCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6);
  const studioCounts = new Map();
  animeEntries.forEach(({ anime }) => {
    const studio = String(anime.studio || "").trim();
    if (studio && studio !== "Studio TBA" && studio !== "Unknown studio") studioCounts.set(studio, (studioCounts.get(studio) || 0) + 1);
  });
  const favoriteStudios = [...studioCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
  const statusCounts = {
    watching: list.filter((entry) => entry.status === "watching").length,
    completed: list.filter((entry) => entry.status === "completed").length,
    planned: list.filter((entry) => entry.status === "planned").length
  };
  $("#profileTitlesStat").textContent = list.length;
  $("#profileEpisodesStat").textContent = episodesWatched.toLocaleString();
  $("#profileWatchingStat").textContent = statusCounts.watching;
  $("#profileCompletedStat").textContent = statusCounts.completed;
  $("#profilePlannedStat").textContent = statusCounts.planned;
  $("#profileRatingStat").textContent = averageRating === "—" ? averageRating : `${averageRating} / 5`;
  $("#profileSharedStat").textContent = sharedAnimeIds(user).size;
  $("#profileBio").textContent = user.bio || "Add a short bio so friends know what you love to watch.";
  $("#profileGenreList").innerHTML = favoriteGenres.length ? favoriteGenres.map(([genre, count]) => `<span>${escapeHtml(genre)} <b>${count}</b></span>`).join("") : `<p class="profile-empty-copy">Add anime to build your taste profile.</p>`;
  $("#profileStudioList").innerHTML = favoriteStudios.length ? favoriteStudios.map(([studio, count]) => `<span>${escapeHtml(studio)} <b>${count}</b></span>`).join("") : `<p class="profile-empty-copy">Studios from your saved anime will appear here.</p>`;
  const joinedAt = Number.isFinite(Date.parse(user.createdAt)) ? new Date(user.createdAt).toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric" }) : "Not available";
  const signInMethod = user.authProvider ? user.authProvider[0].toUpperCase() + user.authProvider.slice(1) : "Username and password";
  $("#profileAccountDetails").innerHTML = [
    ["Unique username", `@${user.username}`],
    ["Email", user.email || "Not provided"],
    ["Location", user.location || "Not provided"],
    ["Member since", joinedAt],
    ["Sign-in method", signInMethod],
    ["Connected friends", String(connectedProfiles(user).length)],
    ["Streaming region", selectedWatchRegion()]
  ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  $("#profileRatedCount").textContent = `${ratings.length} rated ${ratings.length === 1 ? "title" : "titles"}`;
  $("#profileStatusBreakdown").innerHTML = [
    ["Currently watching", statusCounts.watching],
    ["Completed", statusCounts.completed],
    ["Plan to watch", statusCounts.planned]
  ].map(([label, count]) => {
    const percentage = list.length ? Math.round((count / list.length) * 100) : 0;
    return `<div class="profile-status-row"><div><span>${escapeHtml(label)}</span><strong>${count}</strong></div><div class="profile-status-track"><i style="width:${percentage}%"></i></div><small>${percentage}% of your list</small></div>`;
  }).join("");
  const recent = [...animeEntries].sort((a, b) => Date.parse(b.entry.addedAt || 0) - Date.parse(a.entry.addedAt || 0)).slice(0, 6);
  $("#profileRecentList").innerHTML = recent.length ? recent.map(({ entry, anime }) => `<article class="profile-recent-row" data-open-anime="${anime.id}"><img src="${anime.image}" alt=""><div><strong>${escapeHtml(anime.title)}</strong><small>${escapeHtml(entry.status === "planned" ? "Plan to watch" : entry.status[0].toUpperCase() + entry.status.slice(1))} · ${entry.progress || 0} / ${Number(anime.episodes) || "?"} episodes</small></div>${entry.rating ? `<span>★ ${entry.rating}</span>` : ""}</article>`).join("") : `<p class="profile-empty-copy">Your recently saved anime will appear here.</p>`;
  populateEditProfileForm(user);
}

function populateEditProfileForm(user = currentUser()) {
  const form = $("#editProfileForm");
  if (!form || !user) return;
  form.elements.username.value = user.username || "";
  form.elements.location.value = user.location || "";
  form.elements.bio.value = user.bio || "";
  form.elements.avatarUrl.value = user.customAvatarUrl || "";
  pendingProfileAvatar = safeUploadedAvatar(user.customAvatarDataUrl);
  $("#profileBioCount").textContent = form.elements.bio.value.length;
  $("#profileAvatarDropText").textContent = pendingProfileAvatar ? "Uploaded image ready" : "Drag and drop an image here";
  renderProfileAvatarPreview();
  $("#editProfileError").textContent = "";
}

function renderProfileAvatarPreview() {
  const user = currentUser();
  const form = $("#editProfileForm");
  if (!user || !form) return;
  setProfileAvatar($("#profileAvatarPreview"), {
    ...user,
    customAvatarDataUrl: pendingProfileAvatar,
    customAvatarUrl: form.elements.avatarUrl.value.trim() || null
  });
}

function resizeProfileAvatar(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) return Promise.reject(new Error("Choose a PNG, JPG, or WebP image."));
  if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error("Choose an image smaller than 8 MB."));
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) { reject(new Error("This browser could not process the image.")); return; }
      const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      resolve(canvas.toDataURL("image/jpeg", .82));
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("That image could not be opened.")); };
    image.src = objectUrl;
  });
}

async function handleProfileAvatarFile(file) {
  const error = $("#editProfileError");
  $("#profileAvatarDropText").textContent = "Processing image…";
  error.textContent = "";
  try {
    pendingProfileAvatar = await resizeProfileAvatar(file);
    $("#editProfileForm").elements.avatarUrl.value = "";
    $("#profileAvatarDropText").textContent = `${file.name} is ready`;
    renderProfileAvatarPreview();
  } catch (uploadError) {
    $("#profileAvatarDropText").textContent = "Drag and drop an image here";
    error.textContent = uploadError.message;
  }
}

async function saveEditedProfile(form) {
  const user = currentUser();
  if (!user) return;
  const data = new FormData(form);
  const username = String(data.get("username") || "").trim();
  const usernameLower = username.toLowerCase();
  const location = String(data.get("location") || "").trim();
  const bio = String(data.get("bio") || "").trim();
  const avatarValue = String(data.get("avatarUrl") || "").trim();
  const error = $("#editProfileError");
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    error.textContent = "Use 3–20 letters, numbers, or underscores for your username.";
    return;
  }
  if (store.users.some((profile) => profile !== user && profile.usernameLower === usernameLower)) {
    error.textContent = "That username is already taken. Try another unique name.";
    return;
  }
  const customAvatarUrl = avatarValue ? safeAvatarUrl(avatarValue) : null;
  if (avatarValue && !customAvatarUrl) {
    error.textContent = "Enter a valid HTTPS image URL for your avatar.";
    return;
  }
  if (user.supabaseAccount) {
    error.textContent = "";
    try {
      const avatarUrl = pendingProfileAvatar ? await window.SoraListSupabase.uploadAvatar(pendingProfileAvatar) : customAvatarUrl;
      await window.SoraListSupabase.updateProfile({
        username,
        display_name: username,
        bio,
        avatar_url: avatarUrl,
        preferences: {
          theme: store.theme,
          density: store.density,
          reduceMotion: Boolean(store.reduceMotion),
          alwaysShowListControls: Boolean(store.alwaysShowListControls),
          location
        },
        region: selectedWatchRegion()
      });
      pendingProfileAvatar = null;
      await refreshSupabaseStore();
      toast("Your profile has been updated");
    } catch (updateError) {
      error.textContent = updateError?.code === "23505" ? "That username is already taken. Try another unique name." : updateError.message || "Your profile could not be updated.";
    }
    return;
  }
  const previousUsernameLower = user.usernameLower;
  if (previousUsernameLower !== usernameLower) {
    store.users.forEach((profile) => {
      profile.friends = (profile.friends || []).map((friendName) => friendName === previousUsernameLower ? usernameLower : friendName);
      profile.incomingFriendRequests = (profile.incomingFriendRequests || []).map((friendName) => friendName === previousUsernameLower ? usernameLower : friendName);
      profile.outgoingFriendRequests = (profile.outgoingFriendRequests || []).map((friendName) => friendName === previousUsernameLower ? usernameLower : friendName);
      profile.rejectedFriendRequests = (profile.rejectedFriendRequests || []).map((friendName) => friendName === previousUsernameLower ? usernameLower : friendName);
    });
    (store.groups || []).forEach((group) => {
      if (group.ownerUsernameLower === previousUsernameLower) group.ownerUsernameLower = usernameLower;
      group.memberUsernames = (group.memberUsernames || []).map((name) => name === previousUsernameLower ? usernameLower : name);
      (group.animeEntries || []).forEach((entry) => { entry.addedBy = (entry.addedBy || []).map((name) => name === previousUsernameLower ? usernameLower : name); });
      (group.messages || []).forEach((message) => { if (message.authorUsernameLower === previousUsernameLower) message.authorUsernameLower = usernameLower; });
    });
  }
  user.username = username;
  user.usernameLower = usernameLower;
  user.location = location;
  user.bio = bio;
  user.customAvatarUrl = customAvatarUrl;
  user.customAvatarDataUrl = customAvatarUrl ? null : pendingProfileAvatar;
  store.session = usernameLower;
  saveStore();
  renderAll();
  toast("Your profile has been updated");
}

function renderSettingsRegionOptions(regions = watchRegionsCache || []) {
  const select = $("#settingsRegion");
  if (!select) return;
  const selected = selectedWatchRegion();
  const availableRegions = regions.some((region) => region.code === selected)
    ? regions
    : [{ code: selected, name: selected }, ...regions];
  select.innerHTML = availableRegions.map((region) => `<option value="${escapeHtml(region.code)}">${escapeHtml(region.name)} (${escapeHtml(region.code)})</option>`).join("");
  select.value = selected;
  const selectedName = availableRegions.find((region) => region.code === selected)?.name || selected;
  $("#settingsRegionNote").textContent = `Streaming services will be checked for ${selectedName} (${selected}).`;
}

async function loadSettingsRegions() {
  renderSettingsRegionOptions();
  try {
    renderSettingsRegionOptions(await fetchWatchRegions());
  } catch {
    $("#settingsRegionNote").textContent = `Using ${selectedWatchRegion()}. More regions will appear when the streaming service reconnects.`;
  }
}

function renderSettings() {
  const user = currentUser();
  $$("[data-settings-theme]").forEach((button) => {
    const active = button.dataset.settingsTheme === (store.theme === "dark" ? "dark" : "light");
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$("[data-settings-density]").forEach((button) => {
    const active = button.dataset.settingsDensity === (store.density === "compact" ? "compact" : "comfortable");
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#settingsAlwaysShowControls").checked = Boolean(store.alwaysShowListControls);
  $("#settingsReduceMotion").checked = Boolean(store.reduceMotion);
  renderSettingsRegionOptions();
  const syncLabels = { loading: "Refreshing live catalog…", error: "Anime APIs are offline", cached: "Using recently saved catalog", live: "Live catalog is connected" };
  $("#settingsSyncState").textContent = syncLabels[apiState] || "Catalog status unavailable";
  $("#settingsAccountName").textContent = user?.username || "Guest mode";
  $("#settingsAccountType").textContent = user
    ? (user.authProvider ? `Signed in with ${user.authProvider[0].toUpperCase() + user.authProvider.slice(1)}` : "Username and password account")
    : "Sign in to save lists and connect with friends";
  $("#settingsProfileButton").textContent = user ? "Manage account" : "Sign in";
}

function renderSecurity() {
  const user = currentUser();
  if (!user) return;
  const hasPassword = user.supabaseAccount ? Boolean(user.hasPassword) : Boolean(user.passwordCredential || user.passwordHash);
  const currentPasswordField = $("#securityCurrentPasswordField");
  currentPasswordField.hidden = user.supabaseAccount || !hasPassword;
  currentPasswordField.querySelector("input").required = !user.supabaseAccount && hasPassword;
  $("#securityPasswordTitle").textContent = hasPassword ? "Change password" : "Create a password";
  $("#securityPasswordHint").textContent = hasPassword ? "Confirm your current password before choosing a new one." : "Add password sign-in as a backup to your connected account.";
  $("#changePasswordButton").textContent = hasPassword ? "Update password" : "Create password";
  $("#recoveryStatus").textContent = user.supabaseAccount ? `Reset links are sent securely to ${user.email || "your email"}` : user.recoveryCredential ? "Recovery code is active" : "No recovery code generated";
  $("#generateRecoveryCode").textContent = user.supabaseAccount ? "Send password-reset email" : user.recoveryCredential ? "Replace recovery code" : "Generate recovery code";
  const showRecoveryCode = visibleRecoveryCodeOwner === user.usernameLower && Boolean(visibleRecoveryCode);
  $("#recoveryCodeDisplay").hidden = !showRecoveryCode;
  $("#recoveryCodeValue").textContent = showRecoveryCode ? visibleRecoveryCode : "";
  const identities = user.identities || [];
  const connectedProviders = ["google", "discord"].filter((provider) => identities.some((identity) => identity.startsWith(`${provider}:`)));
  $("#securityProviderList").innerHTML = ["google", "discord"].map((provider) => {
    const connected = connectedProviders.includes(provider);
    const label = provider[0].toUpperCase() + provider.slice(1);
    const canUnlink = hasPassword || connectedProviders.length > 1;
    const unavailable = oauthProviderState[provider] === false;
    const button = connected
      ? `<button type="button" class="security-provider-action danger" data-unlink-provider="${provider}" ${canUnlink ? "" : "disabled"}>${canUnlink ? "Disconnect" : "Required"}</button>`
      : `<button type="button" class="security-provider-action" data-link-provider="${provider}" ${unavailable ? "disabled" : ""}>${unavailable ? "Unavailable" : "Connect"}</button>`;
    return `<div class="security-provider-row"><span class="security-provider-icon ${provider}">${provider === "google" ? "G" : "◉"}</span><span><strong>${label}</strong><small>${connected ? "Connected to this profile" : "Not connected"}</small></span>${button}</div>`;
  }).join("");
}

async function updateAccountPassword(form) {
  const user = currentUser();
  if (!user) return;
  const data = new FormData(form);
  const currentPassword = String(data.get("currentPassword") || "");
  const newPassword = String(data.get("newPassword") || "");
  const confirmation = String(data.get("confirmPassword") || "");
  const hasPassword = Boolean(user.passwordCredential || user.passwordHash);
  const error = $("#changePasswordError");
  error.textContent = "";
  if (user.supabaseAccount) {
    if (newPassword.length < 10) { error.textContent = "Your new password must contain at least 10 characters."; return; }
    if (newPassword !== confirmation) { error.textContent = "The new passwords do not match."; return; }
    try {
      await window.SoraListSupabase.updatePassword(newPassword);
      form.reset();
      await refreshSupabaseStore();
      toast("Password updated securely");
    } catch (updateError) {
      error.textContent = updateError.message || "Your password could not be updated.";
    }
    return;
  }
  if (hasPassword && !(await verifyUserPassword(user, currentPassword))) { error.textContent = "Your current password is incorrect."; return; }
  if (newPassword.length < 10) { error.textContent = "Your new password must contain at least 10 characters."; return; }
  if (newPassword !== confirmation) { error.textContent = "The new passwords do not match."; return; }
  if (hasPassword && await verifyUserPassword(user, newPassword)) { error.textContent = "Choose a password different from your current password."; return; }
  user.passwordCredential = await createSecretCredential(newPassword);
  user.passwordHash = null;
  saveStore();
  form.reset();
  renderSecurity();
  toast(hasPassword ? "Password updated securely" : "Password sign-in enabled");
}

async function createRecoveryCodeForUser() {
  const user = currentUser();
  if (!user) return;
  if (user.supabaseAccount) {
    try {
      await window.SoraListSupabase.sendPasswordReset(user.email, window.location.origin);
      toast("A secure password-reset link was sent to your email");
    } catch (error) {
      reportSupabaseError(error, "The reset email could not be sent.");
    }
    return;
  }
  const code = generateRecoveryCode();
  user.recoveryCredential = await createSecretCredential(code);
  visibleRecoveryCode = code;
  visibleRecoveryCodeOwner = user.usernameLower;
  saveStore();
  $("#recoveryCodeValue").textContent = code;
  $("#recoveryCodeDisplay").hidden = false;
  $("#recoveryStatus").textContent = "New recovery code generated — save it now";
  $("#generateRecoveryCode").textContent = "Replace recovery code";
}

async function resetPasswordWithRecovery(form) {
  const data = new FormData(form);
  if (supabaseMode) {
    const email = String(data.get("email") || "").trim();
    const error = $("#resetPasswordError");
    error.textContent = "";
    try {
      await window.SoraListSupabase.sendPasswordReset(email, window.location.origin);
      form.reset();
      error.textContent = "Check your email for the secure reset link.";
    } catch (resetError) {
      error.textContent = resetError.message || "The reset email could not be sent.";
    }
    return;
  }
  const usernameLower = String(data.get("username") || "").trim().toLowerCase();
  const compactRecoveryCode = String(data.get("recoveryCode") || "").toUpperCase().replace(/[^A-F0-9]/g, "");
  const recoveryCode = compactRecoveryCode.match(/.{1,4}/g)?.join("-") || "";
  const newPassword = String(data.get("newPassword") || "");
  const confirmation = String(data.get("confirmPassword") || "");
  const user = store.users.find((profile) => profile.usernameLower === usernameLower);
  const error = $("#resetPasswordError");
  error.textContent = "";
  if (!user?.recoveryCredential || !(await verifySecret(recoveryCode, user.recoveryCredential))) { error.textContent = "The username or recovery code is invalid."; return; }
  if (newPassword.length < 10) { error.textContent = "Your new password must contain at least 10 characters."; return; }
  if (newPassword !== confirmation) { error.textContent = "The new passwords do not match."; return; }
  user.passwordCredential = await createSecretCredential(newPassword);
  user.passwordHash = null;
  user.recoveryCredential = null;
  store.session = user.usernameLower;
  saveStore();
  form.reset();
  closeModal("authModal");
  switchView("account");
  renderAll();
  toast("Password reset. Generate a new recovery code from Account.");
}

async function unlinkOAuthProvider(provider) {
  const user = currentUser();
  if (!user || !["google", "discord"].includes(provider)) return;
  const identities = user.identities || [];
  if (user.supabaseAccount) {
    try {
      await window.SoraListSupabase.unlinkIdentity(provider);
      await refreshSupabaseStore();
      toast(`${provider[0].toUpperCase() + provider.slice(1)} disconnected`);
    } catch (error) {
      reportSupabaseError(error, `${provider} could not be disconnected.`);
    }
    return;
  }
  const remaining = identities.filter((identity) => !identity.startsWith(`${provider}:`));
  if (!user.passwordCredential && !user.passwordHash && remaining.length === 0) { toast("Create a password before disconnecting your only sign-in method."); return; }
  user.identities = remaining;
  if (user.authProvider === provider) user.authProvider = remaining[0]?.split(":")[0] || null;
  saveStore();
  renderAll();
  toast(`${provider[0].toUpperCase() + provider.slice(1)} disconnected`);
}

function renderAll() {
  const composerState = captureGroupComposerState();
  renderSyncStatus();
  renderAuthState();
  renderProfilePage();
  renderSettings();
  renderSecurity();
  renderHome();
  renderDiscover();
  renderList();
  renderFriends();
  renderGroups();
  renderUpcoming();
  restoreGroupComposerState(composerState);
}

async function fetchDiscoverAnime() {
  const requestId = ++discoverRequestId;
  discoverLoading = true;
  renderDiscover();
  try {
    const request = buildDiscoverQuery(discoverFilters);
    const data = await fetchAniList(request.query, request.variables);
    if (requestId !== discoverRequestId) return;
    discoverResults = (data.Page?.media || []).map(normalizeAniList).filter((anime) => anime.image);
    catalog = dedupeAnime([...catalog, ...discoverResults]);
  } catch {
    if (requestId !== discoverRequestId) return;
    discoverResults = applyDiscoverFilters(catalog);
    toast("Showing saved matches while the filtered search reconnects.");
  } finally {
    if (requestId === discoverRequestId) {
      discoverLoading = false;
      renderDiscover();
    }
  }
}

function resetDiscoverFilters() {
  discoverFilters = { genre: "All", format: "all", status: "all", season: "all", year: "all", minScore: "0", sort: "popular" };
  discoverResults = null;
  fetchDiscoverAnime();
}

function searchResultMarkup(matches, query) {
  if (!matches.length) return `<div class="empty-state" style="min-height:120px"><p>No API results match “${escapeHtml(query)}”.</p></div>`;
  return matches.map((anime) => `<button class="search-result" data-open-anime="${anime.id}"><img src="${anime.image}" alt=""><span><strong>${escapeHtml(anime.title)}</strong><span>${anime.year} · ${escapeHtml(anime.genres.slice(0, 2).join(" / "))}</span></span><em>${anime.score ? `★ ${formatScore(anime.score)}` : "New"}</em></button>`).join("");
}

async function searchAnimeApi(query) {
  if (searchController) searchController.abort();
  searchController = new AbortController();
  const results = $("#searchResults");
  results.innerHTML = `<div class="api-inline-state">Searching the live catalog…</div>`;
  results.hidden = false;
  try {
    let matches;
    try {
      const searchQuery = `query ($search: String) { Page(page: 1, perPage: 8) { media(type: ANIME, isAdult: false, search: $search, sort: SEARCH_MATCH) { ${ANILIST_MEDIA_FIELDS} } } }`;
      const data = await fetchAniList(searchQuery, { search: query });
      matches = (data.Page?.media || []).map(normalizeAniList).filter((anime) => anime.image);
    } catch {
      const response = await fetch(`${API_BASE}/anime?q=${encodeURIComponent(query)}&sfw=true&order_by=popularity&sort=asc&limit=8`, { signal: searchController.signal });
      if (!response.ok) throw new Error(`Search failed with ${response.status}`);
      matches = normalizeFeed(await response.json());
    }
    if ($("#searchInput").value.trim() !== query) return;
    catalog = dedupeAnime([...catalog, ...matches]);
    results.innerHTML = searchResultMarkup(matches, query);
  } catch (error) {
    if (error.name === "AbortError") return;
    const savedMatches = [...catalog, ...upcoming].filter((anime) => `${anime.title} ${anime.genres.join(" ")} ${anime.studio}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
    results.innerHTML = savedMatches.length ? searchResultMarkup(savedMatches, query) : `<div class="api-inline-state">Search is temporarily unavailable. Please try again.</div>`;
  }
}

function getProviderIds(anime) {
  return {
    anilistId: anime.anilistId || (anime.id >= 1000000 ? anime.id - 1000000 : null),
    malId: anime.malId || (anime.id < 1000000 ? anime.id : null)
  };
}

function providerKey(ids) {
  return ids.anilistId ? `anilist:${ids.anilistId}` : `mal:${ids.malId}`;
}

async function fetchRelationRecord(ids) {
  const key = providerKey(ids);
  const cached = relationRecordCache.get(key);
  if (cached) return cached;
  const lookup = ids.anilistId ? "id: $id" : "idMal: $idMal";
  const query = `query ($id: Int, $idMal: Int) {
    Media(${lookup}, type: ANIME) {
      ${ANILIST_MEDIA_FIELDS}
      relations {
        edges {
          relationType
          node { ${ANILIST_MEDIA_FIELDS} }
        }
      }
    }
  }`;
  const payload = await fetchAniList(query, { id: ids.anilistId, idMal: ids.malId });
  if (!payload.Media) throw new Error("Anime relations were not found");
  const record = {
    anime: normalizeAniList(payload.Media),
    related: (payload.Media.relations?.edges || [])
      .filter((edge) => edge.node?.type === "ANIME" && FRANCHISE_RELATION_TYPES.has(edge.relationType))
      .map((edge) => ({ relationType: edge.relationType, anime: normalizeAniList(edge.node) }))
  };
  relationRecordCache.set(key, record);
  return record;
}

function orderFranchiseNodes(nodes, edges) {
  const byId = new Map(nodes.map((anime) => [anime.id, anime]));
  const outgoing = new Map(nodes.map((anime) => [anime.id, new Set()]));
  const indegree = new Map(nodes.map((anime) => [anime.id, 0]));
  edges.forEach(([from, to]) => {
    if (!byId.has(from) || !byId.has(to) || outgoing.get(from).has(to)) return;
    outgoing.get(from).add(to);
    indegree.set(to, indegree.get(to) + 1);
  });
  const byRelease = (a, b) => releaseTime(byId.get(a)) - releaseTime(byId.get(b)) || a - b;
  const ready = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id).sort(byRelease);
  const ordered = [];
  while (ready.length) {
    const id = ready.shift();
    ordered.push(byId.get(id));
    outgoing.get(id).forEach((nextId) => {
      indegree.set(nextId, indegree.get(nextId) - 1);
      if (indegree.get(nextId) === 0) {
        ready.push(nextId);
        ready.sort(byRelease);
      }
    });
  }
  if (ordered.length < nodes.length) {
    const included = new Set(ordered.map((anime) => anime.id));
    ordered.push(...nodes.filter((anime) => !included.has(anime.id)).sort((a, b) => releaseTime(a) - releaseTime(b) || a.id - b.id));
  }
  return ordered;
}

function normalizeComparableTitle(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function franchiseTitleStem(title) {
  const firstPhrase = String(title || "").split(/\s*[:–—]\s*|\s+-\s*/)[0];
  return normalizeComparableTitle(firstPhrase)
    .replace(/\b(season|part|cour|movie|film|chapter|arc)\s*(\d+|[ivx]+)?\b.*$/i, "")
    .replace(/\s+(\d+|[ivx]+)$/i, "")
    .trim();
}

function animeMatchesTitleFamily(anime, stem) {
  if (!stem) return false;
  const names = [anime.title, ...(anime.canonicalTitles || [])].map(normalizeComparableTitle).filter(Boolean);
  return names.some((name) => name === stem || name.startsWith(`${stem} `) || (stem.includes(" ") && name.endsWith(` ${stem}`)));
}

async function fetchTitleMatchedEntries(anime) {
  const stem = franchiseTitleStem(anime.title);
  if (stem.length < 4) return [];
  const cached = titleFamilyCache.get(stem);
  if (cached && Date.now() - cached.savedAt < 60 * 60 * 1000) return cached.titles;
  const query = `query ($search: String) {
    Page(page: 1, perPage: 50) {
      media(type: ANIME, isAdult: false, search: $search, sort: SEARCH_MATCH) { ${ANILIST_MEDIA_FIELDS} }
    }
  }`;
  const payload = await fetchAniList(query, { search: stem });
  const titles = (payload.Page?.media || [])
    .map(normalizeAniList)
    .filter((candidate) => candidate.image && animeMatchesTitleFamily(candidate, stem));
  titleFamilyCache.set(stem, { savedAt: Date.now(), titles });
  return titles;
}

function mergeFranchiseIntoCatalog(titles) {
  titles.forEach((title) => {
    const index = catalog.findIndex((item) => item.id === title.id);
    if (index >= 0) catalog[index] = { ...catalog[index], ...title };
    else catalog.push(title);
  });
}

async function fetchFranchiseSeasons(anime, onProgress = null) {
  const cached = franchiseSeasonCache.get(anime.id);
  if (cached && Date.now() - cached.savedAt < 60 * 60 * 1000) {
    onProgress?.(cached.seasons);
    return cached.seasons;
  }
  const queue = [getProviderIds(anime)];
  const visited = new Set();
  const nodes = new Map([[anime.id, anime]]);
  const edges = [];
  const rootTitleStem = franchiseTitleStem(anime.title);
  const titleMatchesPromise = fetchTitleMatchedEntries(anime)
    .then((matches) => {
      matches.forEach((match) => nodes.set(match.id, match));
      const partial = orderFranchiseNodes([...nodes.values()], edges);
      mergeFranchiseIntoCatalog(partial);
      onProgress?.(partial);
      return matches;
    })
    .catch(() => []);

  while (queue.length && visited.size < 32) {
    const batch = [];
    while (queue.length && batch.length < 4 && visited.size < 32) {
      const ids = queue.shift();
      const key = providerKey(ids);
      if (visited.has(key)) continue;
      visited.add(key);
      batch.push(ids);
    }
    if (!batch.length) continue;
    const results = await Promise.allSettled(batch.map(fetchRelationRecord));
    results.forEach((result) => {
      if (result.status !== "fulfilled") return;
      const record = result.value;
      nodes.set(record.anime.id, record.anime);
      record.related.forEach(({ relationType, anime: relatedAnime }) => {
        if (!animeMatchesTitleFamily(relatedAnime, rootTitleStem)) return;
        nodes.set(relatedAnime.id, relatedAnime);
        if (relationType === "SEQUEL") edges.push([record.anime.id, relatedAnime.id]);
        else if (relationType === "PREQUEL") edges.push([relatedAnime.id, record.anime.id]);
        const relatedIds = getProviderIds(relatedAnime);
        if (!visited.has(providerKey(relatedIds))) queue.push(relatedIds);
      });
    });
    const partial = orderFranchiseNodes([...nodes.values()], edges);
    mergeFranchiseIntoCatalog(partial);
    if (partial.length) onProgress?.(partial);
  }

  await titleMatchesPromise;
  const ordered = orderFranchiseNodes([...nodes.values()], edges);
  if (!ordered.length) throw new Error("No franchise relation data was returned");
  mergeFranchiseIntoCatalog(ordered);
  const cachedValue = { savedAt: Date.now(), seasons: ordered };
  ordered.forEach((season) => franchiseSeasonCache.set(season.id, cachedValue));
  return ordered;
}

function seasonTabsLoadingMarkup() {
  return `<section class="franchise-browser"><div class="franchise-heading"><div><p class="eyebrow">MORE FROM THIS ANIME</p><h3>Finding seasons, movies, and related titles…</h3></div><span class="availability-loader"></span></div></section>`;
}

function franchiseCard(anime, label, activeAnimeId) {
  return `<button type="button" class="franchise-card ${anime.id === activeAnimeId ? "active" : ""}" data-open-anime="${anime.id}" data-franchise-entry aria-label="Open full details for ${escapeHtml(anime.title)}" ${anime.id === activeAnimeId ? 'aria-current="true"' : ""}><img src="${anime.image}" alt=""><span><small>${escapeHtml(label)}</small><strong>${escapeHtml(anime.title)}</strong><em>${anime.year || "Year TBA"} · ${episodeLabel(anime.episodes)}</em></span><b>→</b></button>`;
}

function franchiseGroupMarkup(title, items, activeAnimeId, labelForItem) {
  if (!items.length) return "";
  return `<div class="franchise-group"><div class="franchise-group-title"><h4>${title}</h4><span>${items.length}</span></div><div class="franchise-card-grid">${items.map((item, index) => franchiseCard(item, labelForItem(item, index), activeAnimeId)).join("")}</div></div>`;
}

function renderSeasonTabs(titles, activeAnimeId) {
  if (titles.length <= 1) return `<section class="franchise-browser compact-error"><div><p class="eyebrow">MORE FROM THIS ANIME</p><h3>No connected seasons or movies found</h3><p>The API currently lists this as a standalone title.</p></div></section>`;
  const seasons = titles.filter((anime) => ["TV", "TV_SHORT", "ONA"].includes(String(anime.format || "").toUpperCase()));
  const movies = titles.filter((anime) => String(anime.format || "").toUpperCase() === "MOVIE");
  const extras = titles.filter((anime) => !seasons.includes(anime) && !movies.includes(anime));
  const extraCounts = new Map();
  const extraLabel = (anime) => {
    const format = String(anime.format || "Related").replaceAll("_", " ").toUpperCase();
    const next = (extraCounts.get(format) || 0) + 1;
    extraCounts.set(format, next);
    return `${format} ${next}`;
  };
  return `<section class="franchise-browser"><div class="franchise-heading"><div><p class="eyebrow">MORE FROM THIS ANIME</p><h3>Continue the franchise</h3></div><small>${titles.length} connected titles · API relations & title matches</small></div>
    ${franchiseGroupMarkup("Seasons", seasons, activeAnimeId, (_, index) => `Season ${index + 1}`)}
    ${franchiseGroupMarkup("Movies", movies, activeAnimeId, (_, index) => `Movie ${index + 1}`)}
    ${franchiseGroupMarkup("Watch more", extras, activeAnimeId, extraLabel)}
  </section>`;
}

function seasonTabsErrorMarkup() {
  return `<section class="franchise-browser compact-error"><p>Related seasons and movies were not supplied by the API.</p></section>`;
}

function deriveEpisodeCounts(status, totalEpisodes, nextEpisode, airedFromSource = null) {
  const total = Number(totalEpisodes) > 0 ? Number(totalEpisodes) : null;
  let aired = Number(airedFromSource) >= 0 && airedFromSource !== null ? Number(airedFromSource) : null;
  if (Number(nextEpisode) > 0) aired = Math.max(0, Number(nextEpisode) - 1);
  else if (status === "FINISHED" || status === "Finished Airing") aired = total;
  else if (status === "NOT_YET_RELEASED" || status === "Not yet aired") aired = 0;
  const remaining = total !== null && aired !== null ? Math.max(0, total - aired) : null;
  return { total, aired, remaining };
}

function normalizeAniListAvailability(media) {
  const schedule = (media.airingSchedule?.nodes || [])
    .filter((item) => Number(item.airingAt) > 0 && Number(item.episode) > 0)
    .map((item) => ({ episode: item.episode, airingAt: item.airingAt }));
  const next = media.nextAiringEpisode || schedule[0] || null;
  const counts = deriveEpisodeCounts(media.status, media.episodes, next?.episode);
  return {
    ...counts,
    status: media.status,
    schedule,
    broadcastText: null,
    source: "AniList"
  };
}

async function fetchJikanAvailability(malId) {
  const fullPayload = await fetchJikan(`/anime/${malId}/full`, 1);
  const media = fullPayload.data;
  let airedFromSource = null;
  if (media.status === "Currently Airing") {
    try {
      const episodePayload = await fetchJikan(`/anime/${malId}/episodes?page=1`, 1);
      airedFromSource = episodePayload.pagination?.items?.total ?? null;
    } catch {
      airedFromSource = null;
    }
  }
  const counts = deriveEpisodeCounts(media.status, media.episodes, null, airedFromSource);
  return {
    ...counts,
    status: media.status,
    schedule: [],
    broadcastText: media.broadcast?.string || null,
    source: "Jikan / MyAnimeList"
  };
}

async function fetchAnimeAvailability(anime) {
  const cached = detailAvailabilityCache.get(anime.id);
  if (cached && Date.now() - cached.savedAt < 10 * 60 * 1000) return cached.data;
  const ids = getProviderIds(anime);
  let data;
  try {
    const lookup = ids.anilistId ? "id: $id" : "idMal: $idMal";
    const query = `query ($id: Int, $idMal: Int) {
      Media(${lookup}, type: ANIME) {
        id idMal status episodes
        nextAiringEpisode { airingAt episode timeUntilAiring }
        airingSchedule(notYetAired: true, page: 1, perPage: 6) { nodes { airingAt episode timeUntilAiring } }
      }
    }`;
    const payload = await fetchAniList(query, { id: ids.anilistId, idMal: ids.malId });
    if (!payload.Media) throw new Error("Anime not found on AniList");
    data = normalizeAniListAvailability(payload.Media);
  } catch (error) {
    if (!ids.malId) throw error;
    data = await fetchJikanAvailability(ids.malId);
  }
  detailAvailabilityCache.set(anime.id, { savedAt: Date.now(), data });
  return data;
}

function formatAiringTime(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function availabilityLoadingMarkup() {
  return `<section class="availability-panel"><div class="availability-heading"><div><p class="eyebrow">EPISODE SCHEDULE</p><h3>Loading live details…</h3></div><span class="availability-loader"></span></div></section>`;
}

function renderAvailability(availability) {
  const numberOrTba = (value) => value === null ? "Not announced" : String(value);
  const scheduleMarkup = availability.schedule.length
    ? `<div class="airing-list">${availability.schedule.map((item, index) => `<div class="airing-row"><span>${index === 0 ? "NEXT" : "UPCOMING"}</span><strong>Episode ${item.episode}</strong><time datetime="${new Date(item.airingAt * 1000).toISOString()}">${escapeHtml(formatAiringTime(item.airingAt) || "Time not supplied")}</time></div>`).join("")}</div>`
    : `<p class="availability-empty">${availability.broadcastText ? `Broadcast schedule: ${escapeHtml(availability.broadcastText)}` : availability.status === "FINISHED" || availability.status === "Finished Airing" ? "This title has finished airing." : "No upcoming broadcast time was supplied by the API."}</p>`;
  return `<section class="availability-panel">
    <div class="availability-heading"><div><p class="eyebrow">EPISODE PROGRESS</p><h3>Live airing information</h3></div><small>Source: ${escapeHtml(availability.source)}</small></div>
    <div class="episode-stats"><div><strong>${numberOrTba(availability.aired)}</strong><span>Episodes aired</span></div><div><strong>${numberOrTba(availability.remaining)}</strong><span>Episodes left</span></div><div><strong>${numberOrTba(availability.total)}</strong><span>Total episodes</span></div></div>
    <div class="availability-block"><h4>When it airs</h4>${scheduleMarkup}</div>
  </section>`;
}

function availabilityErrorMarkup() {
  return `<section class="availability-panel"><p class="eyebrow">EPISODE SCHEDULE</p><h3>Live details unavailable</h3><p class="availability-empty">Neither anime API supplied airing information for this title right now.</p><button class="outline-button" data-retry-availability>Try again</button></section>`;
}

function inferredRegion() {
  const locale = navigator.language || Intl.DateTimeFormat().resolvedOptions().locale || "";
  const match = locale.match(/[-_]([A-Za-z]{2})$/);
  return match ? match[1].toUpperCase() : "US";
}

function selectedWatchRegion() {
  return /^[A-Z]{2}$/.test(store.region || "") ? store.region : inferredRegion();
}

async function localApiRequest(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Local API failed with ${response.status}`);
    error.code = payload.error;
    throw error;
  }
  return payload;
}

async function fetchWatchRegions() {
  if (watchRegionsCache) return watchRegionsCache;
  const payload = await localApiRequest("/api/watch-regions");
  watchRegionsCache = payload.regions || [];
  return watchRegionsCache;
}

async function fetchRegionalAvailability(anime, region) {
  const key = `${anime.id}:${region}`;
  const cached = regionalAvailabilityCache.get(key);
  if (cached && Date.now() - cached.savedAt < 30 * 60 * 1000) return cached.data;
  const params = new URLSearchParams({
    title: anime.title,
    year: Number(anime.year) > 1900 ? String(anime.year) : "",
    type: String(anime.format || "").toUpperCase() === "MOVIE" ? "movie" : "tv",
    region
  });
  const data = await localApiRequest(`/api/watch-providers?${params}`);
  regionalAvailabilityCache.set(key, { savedAt: Date.now(), data });
  return data;
}

function regionalLoadingMarkup() {
  return `<section class="regional-panel"><div class="regional-heading"><div><p class="eyebrow">STREAMING IN YOUR REGION</p><h3>Checking local platforms…</h3></div><span class="availability-loader"></span></div></section>`;
}

function regionSelectorMarkup(regions, selected) {
  const options = regions.some((region) => region.code === selected) ? regions : [{ code: selected, name: selected }, ...regions];
  return `<label class="region-selector"><span>Region</span><select id="watchRegionSelect" aria-label="Streaming availability region">${options.map((region) => `<option value="${escapeHtml(region.code)}" ${region.code === selected ? "selected" : ""}>${escapeHtml(region.name)} (${escapeHtml(region.code)})</option>`).join("")}</select></label>`;
}

function providerGroupMarkup(title, providers, link) {
  if (!providers.length) return "";
  const cards = providers.map((provider) => {
    const content = `${provider.logoUrl ? `<img src="${escapeHtml(provider.logoUrl)}" alt="">` : '<span class="provider-logo-fallback">▶</span>'}<strong>${escapeHtml(provider.name)}</strong><span>↗</span>`;
    return link ? `<a class="provider-card" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${content}</a>` : `<div class="provider-card">${content}</div>`;
  }).join("");
  return `<div class="provider-group"><h4>${title}</h4><div class="provider-grid">${cards}</div></div>`;
}

function renderRegionalAvailability(data, regions, selected) {
  const groups = [
    providerGroupMarkup("Stream with subscription", data.providers.stream || [], data.link),
    providerGroupMarkup("Free", data.providers.free || [], data.link),
    providerGroupMarkup("Free with ads", data.providers.ads || [], data.link),
    providerGroupMarkup("Rent", data.providers.rent || [], data.link),
    providerGroupMarkup("Buy", data.providers.buy || [], data.link)
  ].filter(Boolean).join("");
  const total = Object.values(data.providers).reduce((count, providers) => count + providers.length, 0);
  const body = !data.matched
    ? `<p class="availability-empty">No matching regional catalog entry was returned for this anime.</p>`
    : total ? groups : `<p class="availability-empty">No streaming, rental, or purchase provider is currently listed for this title in the selected region.</p>`;
  return `<section class="regional-panel"><div class="regional-heading"><div><p class="eyebrow">STREAMING IN YOUR REGION</p><h3>Where to watch</h3>${data.matched ? `<small>Matched to ${escapeHtml(data.matched.title)}</small>` : ""}</div>${regionSelectorMarkup(regions, selected)}</div>${body}<p class="provider-attribution">Availability data provided by JustWatch through TMDB. Provider listings can change.</p></section>`;
}

function regionalSetupMarkup(errorCode) {
  const message = errorCode === "TMDB_NOT_CONFIGURED"
    ? "Regional streaming requires a TMDB read-access token on the local server. Set TMDB_API_TOKEN and restart the site."
    : "Regional provider information is temporarily unavailable.";
  return `<section class="regional-panel"><p class="eyebrow">STREAMING IN YOUR REGION</p><h3>Regional availability</h3><p class="availability-empty">${message}</p></section>`;
}

async function loadRegionalAvailability(anime, region = selectedWatchRegion()) {
  const target = $("#regionalAvailabilityContent");
  if (!target) return;
  const requestId = ++regionalRequestId;
  target.innerHTML = regionalLoadingMarkup();
  try {
    const [regions, data] = await Promise.all([fetchWatchRegions(), fetchRegionalAvailability(anime, region)]);
    if (requestId !== regionalRequestId || detailAnimeId !== anime.id || $("#detailModal").hidden) return;
    target.innerHTML = renderRegionalAvailability(data, regions, region);
  } catch (error) {
    if (requestId !== regionalRequestId || detailAnimeId !== anime.id || $("#detailModal").hidden) return;
    target.innerHTML = regionalSetupMarkup(error.code);
  }
}

function switchView(view) {
  currentView = view;
  $$(".view").forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === view));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $(".sidebar").classList.remove("open");
  $("#mobileScrim").hidden = true;
  closeProfileDropdown();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (view === "settings") loadSettingsRegions();
}

function openModal(id) {
  if (id === "authModal") {
    $("#resetPasswordForm").hidden = true;
    $("#signupForm").hidden = true;
    $("#signinForm").hidden = false;
    $$('[data-auth-view]', $("#authTabs")).forEach((button) => button.classList.toggle("active", button.dataset.authView === "signin"));
  }
  $("#" + id).hidden = false;
  document.body.style.overflow = "hidden";
}
function closeModal(id) {
  $("#" + id).hidden = true;
  if (id === "saveAnimeModal") savePickerAnimeId = null;
  document.body.style.overflow = $$(".modal-backdrop").some((modal) => !modal.hidden) ? "hidden" : "";
}
function requireAuth() { if (!currentUser()) { openModal("authModal"); return false; } return true; }

function closeProfileDropdown() {
  const dropdown = $("#profileDropdown");
  if (!dropdown) return;
  dropdown.hidden = true;
  $("#authButton").setAttribute("aria-expanded", "false");
}

function toggleProfileDropdown() {
  if (!currentUser()) { openModal("authModal"); return; }
  const dropdown = $("#profileDropdown");
  const willOpen = dropdown.hidden;
  dropdown.hidden = !willOpen;
  $("#authButton").setAttribute("aria-expanded", String(willOpen));
  if (willOpen) dropdown.querySelector('[role="menuitem"]')?.focus();
}

async function signOutCurrentUser() {
  const user = currentUser();
  if (!user) { openModal("authModal"); return; }
  const name = user.username;
  if (user.supabaseAccount) {
    try {
      await window.SoraListSupabase.signOut();
    } catch (error) {
      reportSupabaseError(error, "Sign out failed.");
      return;
    }
  }
  visibleRecoveryCode = null;
  visibleRecoveryCodeOwner = null;
  store.session = null;
  saveStore();
  closeProfileDropdown();
  switchView("home");
  renderAll();
  toast(`${name} signed out`);
}

function renderAnimeSavePicker() {
  const content = $("#saveAnimeContent");
  const anime = findAnime(savePickerAnimeId);
  const user = currentUser();
  if (!content || !anime || !user) return;
  const groups = groupsForUser(user);
  const inPersonalList = (user.list || []).some((entry) => Number(entry.animeId) === Number(anime.id));
  const destinationButton = ({ label, detail, active, attributes, avatarMarkup = "" }) => `
    <button type="button" class="save-destination-button ${active ? "active" : ""}" ${attributes} aria-pressed="${active}">
      <span class="save-destination-icon">${avatarMarkup || "<span>MY</span>"}</span>
      <span class="save-destination-copy"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></span>
      <span class="save-destination-check" aria-hidden="true">${active ? "✓" : "+"}</span>
    </button>`;
  content.innerHTML = `
    <div class="save-picker-heading">
      <img src="${escapeHtml(anime.image)}" alt="">
      <div><p class="eyebrow">SAVE TO LISTS</p><h2 id="saveAnimeTitle">${escapeHtml(anime.title)}</h2><p>Select one or more destinations. Changes save immediately.</p></div>
    </div>
    <div class="save-destination-list">
      ${destinationButton({ label: "My List", detail: inPersonalList ? "Saved to your personal list" : "Your private anime list", active: inPersonalList, attributes: `data-save-personal="${anime.id}"` })}
      ${groups.map((group) => {
        const entry = (group.animeEntries || []).find((item) => Number(item.animeId) === Number(anime.id));
        const active = Boolean(entry?.addedBy?.includes(user.usernameLower));
        const members = groupMembers(group);
        return destinationButton({
          label: group.name,
          detail: `${members.length} ${members.length === 1 ? "member" : "members"} · Group list`,
          active,
          attributes: `data-save-group="${escapeHtml(group.id)}" data-anime-id="${anime.id}"`,
          avatarMarkup: escapeHtml(initials(group.name))
        });
      }).join("")}
    </div>
    <button type="button" class="primary-button full save-picker-done" data-close-modal="saveAnimeModal">Done</button>`;
}

function openAnimeSavePicker(animeId) {
  if (!requireAuth()) return;
  savePickerAnimeId = Number(animeId);
  renderAnimeSavePicker();
  openModal("saveAnimeModal");
}

function togglePersonalListDestination(animeId) {
  const isAdded = getUserList().some((entry) => Number(entry.animeId) === Number(animeId));
  if (isAdded) removeFromList(animeId);
  else addToList(animeId);
  renderAnimeSavePicker();
  if (detailAnimeId === animeId && !$("#detailModal").hidden) showDetails(animeId);
}

function toggleAnimeInList(animeId) {
  if (!requireAuth()) return;
  if (groupsForUser().length) {
    openAnimeSavePicker(animeId);
    return;
  }
  const isAdded = getUserList().some((entry) => Number(entry.animeId) === Number(animeId));
  if (isAdded) removeFromList(animeId);
  else addToList(animeId);
  if (detailAnimeId === animeId && !$("#detailModal").hidden) showDetails(animeId);
}

function toggleFriend(usernameLower) {
  if (!requireAuth()) return;
  const user = currentUser();
  const friend = store.users.find((profile) => profile.usernameLower === usernameLower);
  if (!friend || friend.usernameLower === user.usernameLower) return;
  ensureFriendRequestState(user);
  ensureFriendRequestState(friend);
  const connected = user.friends.includes(friend.usernameLower);
  if (!connected) { addFriendByUsername(friend.username); return; }
  if (user.supabaseAccount) {
    queueSupabaseMutation(async () => {
      await window.SoraListSupabase.removeFriend(friend.username);
      await refreshSupabaseStore();
      toast(`Disconnected from ${friend.username}`);
    });
    return;
  }
  user.friends = user.friends.filter((name) => name !== friend.usernameLower);
  friend.friends = friend.friends.filter((name) => name !== user.usernameLower);
  saveStore();
  renderAll();
  toast(`Disconnected from ${friend.username}`);
}

function setFriendAddMessage(message, type = "") {
  const element = $("#friendAddMessage");
  element.textContent = message;
  element.className = `friend-add-message ${type}`.trim();
}

function addFriendByUsername(rawUsername) {
  if (!currentUser()) {
    setFriendAddMessage("Sign in before adding a friend.", "error");
    openModal("authModal");
    return false;
  }
  const usernameLower = String(rawUsername || "").trim().toLocaleLowerCase();
  const user = currentUser();
  if (!usernameLower) {
    setFriendAddMessage("Enter your friend's username.", "error");
    return false;
  }
  if (usernameLower === user.usernameLower) {
    setFriendAddMessage("You cannot add your own profile.", "error");
    return false;
  }
  const friend = store.users.find((profile) => profile.usernameLower === usernameLower);
  if (!friend) {
    setFriendAddMessage("No profile was found with that username.", "error");
    return false;
  }
  ensureFriendRequestState(user);
  ensureFriendRequestState(friend);
  if (user.friends.includes(friend.usernameLower)) {
    setFriendAddMessage(`${friend.username} is already connected.`, "error");
    return false;
  }
  if (user.outgoingFriendRequests.includes(friend.usernameLower)) {
    setFriendAddMessage(`Your request to ${friend.username} is still outgoing.`, "error");
    return false;
  }
  if (user.incomingFriendRequests.includes(friend.usernameLower)) {
    setFriendAddMessage(`${friend.username} already sent you a request. Review it under Pending requests.`, "error");
    return false;
  }
  if (user.supabaseAccount) {
    queueSupabaseMutation(async () => {
      await window.SoraListSupabase.sendFriendRequest(friend.username);
      await refreshSupabaseStore();
      $("#friendUsernameInput").value = "";
      setFriendAddMessage(`Friend request sent to ${friend.username}.`, "success");
      toast(`Friend request sent to ${friend.username}`);
    }).catch((error) => {
      setFriendAddMessage(error.message || "The friend request could not be sent.", "error");
    });
    return true;
  }
  user.outgoingFriendRequests.push(friend.usernameLower);
  if (!friend.incomingFriendRequests.includes(user.usernameLower)) friend.incomingFriendRequests.push(user.usernameLower);
  user.rejectedFriendRequests = user.rejectedFriendRequests.filter((name) => name !== friend.usernameLower);
  saveStore();
  renderAll();
  $("#friendUsernameInput").value = "";
  setFriendAddMessage(`Friend request sent to ${friend.username}.`, "success");
  toast(`Friend request sent to ${friend.username}`);
  return true;
}

function respondToFriendRequest(usernameLower, response) {
  const user = currentUser();
  const requester = store.users.find((profile) => profile.usernameLower === usernameLower);
  if (!user || !requester || !["accept", "reject"].includes(response)) return false;
  ensureFriendRequestState(user);
  ensureFriendRequestState(requester);
  if (!user.incomingFriendRequests.includes(requester.usernameLower)) return false;
  if (user.supabaseAccount) {
    const requestId = user.incomingFriendRequestIds?.[requester.usernameLower];
    if (!requestId) return false;
    queueSupabaseMutation(async () => {
      await window.SoraListSupabase.respondToFriendRequest(requestId, response === "accept");
      await refreshSupabaseStore();
      toast(response === "accept" ? `${requester.username} is now your friend` : `Request from ${requester.username} rejected`);
    });
    return true;
  }
  user.incomingFriendRequests = user.incomingFriendRequests.filter((name) => name !== requester.usernameLower);
  requester.outgoingFriendRequests = requester.outgoingFriendRequests.filter((name) => name !== user.usernameLower);
  if (response === "accept") {
    user.friends = [...new Set([...user.friends, requester.usernameLower])];
    requester.friends = [...new Set([...requester.friends, user.usernameLower])];
    user.rejectedFriendRequests = user.rejectedFriendRequests.filter((name) => name !== requester.usernameLower);
  } else {
    user.rejectedFriendRequests = [...new Set([...user.rejectedFriendRequests, requester.usernameLower])];
  }
  saveStore();
  renderAll();
  toast(response === "accept" ? `${requester.username} is now your friend` : `Request from ${requester.username} rejected`);
  return true;
}

function cancelFriendRequest(usernameLower) {
  const user = currentUser();
  const recipient = store.users.find((profile) => profile.usernameLower === usernameLower);
  if (!user || !recipient) return false;
  ensureFriendRequestState(user);
  ensureFriendRequestState(recipient);
  if (!user.outgoingFriendRequests.includes(recipient.usernameLower)) return false;
  if (user.supabaseAccount) {
    const requestId = user.outgoingFriendRequestIds?.[recipient.usernameLower];
    if (!requestId) return false;
    queueSupabaseMutation(async () => {
      await window.SoraListSupabase.cancelFriendRequest(requestId);
      await refreshSupabaseStore();
      toast(`Request to ${recipient.username} cancelled`);
    });
    return true;
  }
  user.outgoingFriendRequests = user.outgoingFriendRequests.filter((name) => name !== recipient.usernameLower);
  recipient.incomingFriendRequests = recipient.incomingFriendRequests.filter((name) => name !== user.usernameLower);
  saveStore();
  renderAll();
  toast(`Request to ${recipient.username} cancelled`);
  return true;
}

function dismissRejectedFriend(usernameLower) {
  const user = currentUser();
  if (!user) return false;
  ensureFriendRequestState(user);
  if (!user.rejectedFriendRequests.includes(usernameLower)) return false;
  if (user.supabaseAccount) {
    const rejected = store.users.find((profile) => profile.usernameLower === usernameLower);
    if (!rejected?.dbId) return false;
    queueSupabaseMutation(async () => {
      await window.SoraListSupabase.dismissRejectedFriend(rejected.dbId);
      await refreshSupabaseStore();
    });
    return true;
  }
  user.rejectedFriendRequests = user.rejectedFriendRequests.filter((name) => name !== usernameLower);
  saveStore();
  renderAll();
  return true;
}

function addToList(animeId, status = "planned") {
  if (!requireAuth()) return;
  const user = currentUser();
  if (user.list.some((entry) => entry.animeId === animeId)) { toast("Already in your list"); return; }
  const anime = findAnime(animeId);
  const entry = { animeId, status, progress: 0, rating: 0, addedAt: new Date().toISOString(), snapshot: anime };
  user.list.unshift(entry);
  saveStore();
  renderAll();
  toast(`${anime.title} added to your list`);
  if (user.supabaseAccount) queueSupabaseMutation(() => window.SoraListSupabase.upsertListEntry({ ...entry }));
}

function statusAwareEntryPatch(patch, anime) {
  const nextPatch = { ...patch };
  const totalEpisodes = Number(anime?.episodes);
  if (nextPatch.status === "planned") nextPatch.progress = 0;
  else if (nextPatch.status === "completed" && Number.isFinite(totalEpisodes) && totalEpisodes > 0) nextPatch.progress = totalEpisodes;
  return nextPatch;
}

function updateEntry(animeId, patch) {
  const entry = getUserList().find((item) => item.animeId === animeId);
  if (!entry) return;
  const anime = findAnime(animeId) || entry.snapshot;
  Object.assign(entry, statusAwareEntryPatch(patch, anime));
  saveStore();
  renderAll();
  if (currentUser()?.supabaseAccount) queueSupabaseMutation(() => window.SoraListSupabase.upsertListEntry({ ...entry }));
}

function removeFromList(animeId) {
  const user = currentUser();
  if (!user) return;
  const anime = findAnime(animeId) || user.list.find((e) => e.animeId === animeId)?.snapshot;
  user.list = user.list.filter((entry) => entry.animeId !== animeId);
  saveStore();
  renderAll();
  toast(`${anime?.title || "Anime"} removed`);
  if (user.supabaseAccount) queueSupabaseMutation(() => window.SoraListSupabase.deleteListEntry(animeId));
}

function showDetails(animeId) {
  const anime = findAnime(animeId);
  if (!anime) return;
  const requestId = ++detailRequestId;
  detailAnimeId = animeId;
  const entry = getUserList().find((item) => item.animeId === animeId);
  const collaborators = profilesForAnime(animeId);
  $("#detailContent").innerHTML = `<div class="detail-hero" style="background-image:url('${anime.banner || anime.image}')">${listToggleButton(anime.id, Boolean(entry), "detail-list-toggle")}<div class="detail-heading"><p class="eyebrow">${escapeHtml((anime.status || "Status not supplied").toUpperCase())}</p><h2 id="detailTitle">${escapeHtml(anime.title)}</h2><div class="hero-meta"><span>${anime.year || "Year TBA"}</span><i></i><span>${episodeLabel(anime.episodes)}</span><i></i><span>${escapeHtml(anime.studio || "Studio not supplied")}</span>${anime.score ? `<i></i><span class="hero-score">★ ${formatScore(anime.score)}</span>` : ""}</div></div></div>
    <div id="seasonTabsContent">${seasonTabsLoadingMarkup()}</div>
    <div class="detail-body ${entry || collaborators.length ? "" : "single-column"}"><div class="detail-information"><p>${escapeHtml(anime.synopsis || "No synopsis was supplied by the API.")}</p><div id="availabilityContent">${availabilityLoadingMarkup()}</div><div id="regionalAvailabilityContent">${regionalLoadingMarkup()}</div></div><div class="detail-controls">
      ${collaborators.length ? `<div class="detail-collaborators"><span class="control-label">ADDED BY</span>${collaboratorMarkup(collaborators)}</div>` : ""}
      ${entry ? `<label class="control-label">WATCH STATUS<select id="detailStatus"><option value="planned" ${entry.status === "planned" ? "selected" : ""}>Plan to watch</option><option value="watching" ${entry.status === "watching" ? "selected" : ""}>Watching</option><option value="completed" ${entry.status === "completed" ? "selected" : ""}>Completed</option></select></label><label class="control-label">YOUR RATING<div class="rating-control">${[1,2,3,4,5].map((star) => `<button class="${star <= (entry.rating || 0) ? "filled" : ""}" data-detail-rating="${star}" aria-label="${star} stars">★</button>`).join("")}</div></label>` : ""}
    </div></div>`;
  openModal("detailModal");
  $("#detailModal .detail-modal").scrollTop = 0;
  loadRegionalAvailability(anime);
  fetchAnimeAvailability(anime)
    .then((availability) => {
      if (requestId !== detailRequestId || $("#detailModal").hidden) return;
      $("#availabilityContent").innerHTML = renderAvailability(availability);
    })
    .catch(() => {
      if (requestId !== detailRequestId || $("#detailModal").hidden) return;
      $("#availabilityContent").innerHTML = availabilityErrorMarkup();
    });
  fetchFranchiseSeasons(anime, (seasons) => {
      if (requestId !== detailRequestId || $("#detailModal").hidden) return;
      $("#seasonTabsContent").innerHTML = renderSeasonTabs(seasons, anime.id);
    })
    .catch(() => {
      if (requestId !== detailRequestId || $("#detailModal").hidden) return;
      $("#seasonTabsContent").innerHTML = seasonTabsErrorMarkup();
    });
}

function toast(message) {
  const item = document.createElement("div"); item.className = "toast"; item.textContent = message;
  $("#toastRegion").append(item);
  setTimeout(() => item.remove(), 2800);
}

function setupEvents() {
  document.addEventListener("click", (event) => {
    const savePersonal = event.target.closest("[data-save-personal]");
    if (savePersonal) { togglePersonalListDestination(Number(savePersonal.dataset.savePersonal)); return; }
    const saveGroup = event.target.closest("[data-save-group]");
    if (saveGroup) { toggleGroupAnimeInterest(Number(saveGroup.dataset.animeId), saveGroup.dataset.saveGroup); return; }
    const selectGroup = event.target.closest("[data-select-group]");
    if (selectGroup) { activeGroupId = selectGroup.dataset.selectGroup; renderGroups(); return; }
    const addGroupAnime = event.target.closest("[data-group-add-anime]");
    if (addGroupAnime) { addAnimeToGroup(Number(addGroupAnime.dataset.groupAddAnime)); return; }
    const toggleGroupAnime = event.target.closest("[data-group-toggle-anime]");
    if (toggleGroupAnime) { event.stopPropagation(); toggleGroupAnimeInterest(Number(toggleGroupAnime.dataset.groupToggleAnime)); return; }
    const friendsTabButton = event.target.closest("[data-friends-tab]");
    if (friendsTabButton) { switchFriendsTab(friendsTabButton.dataset.friendsTab, { focusInput: friendsTabButton.dataset.friendsTab === "add" }); return; }
    const friendsJump = event.target.closest("[data-friends-jump]");
    if (friendsJump) { switchView("friends"); switchFriendsTab(friendsJump.dataset.friendsJump); return; }
    const themeSetting = event.target.closest("[data-settings-theme]");
    if (themeSetting) {
      store.theme = themeSetting.dataset.settingsTheme;
      saveStore();
      applyTheme();
      renderSettings();
      return;
    }
    const densitySetting = event.target.closest("[data-settings-density]");
    if (densitySetting) {
      store.density = densitySetting.dataset.settingsDensity;
      saveStore();
      applyTheme();
      renderSettings();
      return;
    }
    const profileMenuView = event.target.closest("[data-profile-menu-view]");
    if (profileMenuView) { switchView(profileMenuView.dataset.profileMenuView); return; }
    const linkProvider = event.target.closest("[data-link-provider]");
    if (linkProvider) { startOAuthSignIn(linkProvider.dataset.linkProvider, "link"); return; }
    const unlinkProvider = event.target.closest("[data-unlink-provider]");
    if (unlinkProvider) { unlinkOAuthProvider(unlinkProvider.dataset.unlinkProvider); return; }
    const oauthButton = event.target.closest("[data-oauth-provider]");
    if (oauthButton) { event.preventDefault(); startOAuthSignIn(oauthButton.dataset.oauthProvider); return; }
    const nav = event.target.closest("[data-view]");
    if (nav) {
      if (nav.dataset.view === "account" && !currentUser()) openModal("authModal");
      else switchView(nav.dataset.view);
    }
    const jump = event.target.closest("[data-view-jump]"); if (jump) switchView(jump.dataset.viewJump);
    const open = event.target.closest("[data-open-anime]");
    const interactiveOpenChild = event.target.closest("button, select, input, textarea, a");
    if (open && !event.target.closest("[data-list-toggle]") && (!interactiveOpenChild || interactiveOpenChild === open)) showDetails(Number(open.dataset.openAnime));
    const listToggle = event.target.closest("[data-list-toggle]"); if (listToggle) { event.stopPropagation(); toggleAnimeInList(Number(listToggle.dataset.listToggle)); }
    const remove = event.target.closest("[data-remove-anime]"); if (remove) { event.stopPropagation(); const id = Number(remove.dataset.removeAnime); removeFromList(id); if (!$("#detailModal").hidden) closeModal("detailModal"); }
    const close = event.target.closest("[data-close-modal]"); if (close) closeModal(close.dataset.closeModal);
    const feature = event.target.closest("[data-feature-index]"); if (feature) { featuredIndex = Number(feature.dataset.featureIndex); renderHero(); }
    const emptyAction = event.target.closest("[data-empty-action]");
    if (emptyAction) {
      const action = emptyAction.dataset.emptyAction;
      if (action === "auth") openModal("authModal");
      else if (action === "profile") currentUser() ? switchView("profile") : openModal("authModal");
      else if (action === "friends") { switchView("friends"); switchFriendsTab("add", { focusInput: true }); }
      else if (action === "create-group") showGroupCreator(true);
      else if (action === "reset-discover") resetDiscoverFilters();
      else if (action === "retry") fetchCatalog({ notifyOnError: true });
      else switchView(action);
    }
    const progress = event.target.closest("[data-progress]");
    if (progress) {
      const id = Number(progress.dataset.animeId); const entry = getUserList().find((i) => i.animeId === id); const anime = findAnime(id) || entry?.snapshot; const suppliedTotal = Number(anime?.episodes); const hasTotal = Number.isFinite(suppliedTotal) && suppliedTotal > 0; const max = hasTotal ? suppliedTotal : (entry.progress || 0) + 1;
      const next = Math.min(max, Math.max(0, entry.progress + (progress.dataset.progress === "plus" ? 1 : -1)));
      const nextStatus = hasTotal && next === suppliedTotal ? "completed" : entry.status === "completed" && (!hasTotal || next < suppliedTotal) ? "watching" : next > 0 && entry.status === "planned" ? "watching" : entry.status;
      updateEntry(id, { progress: next, status: nextStatus });
    }
    const rating = event.target.closest("[data-list-rating]"); if (rating) updateEntry(Number(rating.dataset.animeId), { rating: Number(rating.dataset.listRating) });
    const detailRating = event.target.closest("[data-detail-rating]"); if (detailRating) { updateEntry(detailAnimeId, { rating: Number(detailRating.dataset.detailRating) }); showDetails(detailAnimeId); }
    const retryAvailability = event.target.closest("[data-retry-availability]");
    if (retryAvailability && detailAnimeId) { detailAvailabilityCache.delete(detailAnimeId); showDetails(detailAnimeId); }
    const friendToggle = event.target.closest("[data-toggle-friend]");
    if (friendToggle) toggleFriend(friendToggle.dataset.toggleFriend);
    const sendFriend = event.target.closest("[data-send-friend]");
    if (sendFriend) addFriendByUsername(sendFriend.dataset.sendFriend);
    const acceptFriend = event.target.closest("[data-accept-friend]");
    if (acceptFriend) respondToFriendRequest(acceptFriend.dataset.acceptFriend, "accept");
    const rejectFriend = event.target.closest("[data-reject-friend]");
    if (rejectFriend) respondToFriendRequest(rejectFriend.dataset.rejectFriend, "reject");
    const cancelFriend = event.target.closest("[data-cancel-friend]");
    if (cancelFriend) cancelFriendRequest(cancelFriend.dataset.cancelFriend);
    const dismissRejected = event.target.closest("[data-dismiss-rejected]");
    if (dismissRejected) dismissRejectedFriend(dismissRejected.dataset.dismissRejected);
    const resetFilters = event.target.closest("[data-reset-discover]");
    if (resetFilters) resetDiscoverFilters();
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-list-status]")) updateEntry(Number(event.target.dataset.listStatus), { status: event.target.value });
    if (event.target.id === "detailStatus") { updateEntry(detailAnimeId, { status: event.target.value }); showDetails(detailAnimeId); }
    if (event.target.id === "watchRegionSelect") {
      store.region = event.target.value;
      saveStore();
      renderSettingsRegionOptions();
      const anime = findAnime(detailAnimeId);
      if (anime) loadRegionalAvailability(anime, store.region);
    }
    if (event.target.id === "settingsAlwaysShowControls") {
      store.alwaysShowListControls = event.target.checked;
      saveStore();
      applyTheme();
    }
    if (event.target.id === "settingsReduceMotion") {
      store.reduceMotion = event.target.checked;
      saveStore();
      applyTheme();
    }
    if (event.target.id === "settingsRegion") {
      store.region = event.target.value;
      saveStore();
      renderSettingsRegionOptions(watchRegionsCache || []);
      renderProfilePage();
    }
    if (event.target.matches("[data-discover-filter]")) {
      discoverFilters[event.target.dataset.discoverFilter] = event.target.value;
      discoverResults = null;
      fetchDiscoverAnime();
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.id === "groupAnimeSearch") renderGroupAnimeSearch(event.target.value);
  });

  document.addEventListener("submit", (event) => {
    if (!event.target.matches("[data-group-message-form]")) return;
    event.preventDefault();
    sendGroupMessage(event.target);
  });

  $("#heroAddButton").addEventListener("click", () => toggleAnimeInList(Number($("#heroAddButton").dataset.animeId)));
  $("#heroDetailsButton").addEventListener("click", () => showDetails(Number($("#heroDetailsButton").dataset.animeId)));
  $("#authButton").addEventListener("click", toggleProfileDropdown);
  $("#progressAction").addEventListener("click", () => currentUser() ? switchView("list") : openModal("authModal"));
  $("#profileSignOutButton").addEventListener("click", signOutCurrentUser);
  $("#profileMenuSignOut").addEventListener("click", signOutCurrentUser);
  $("#newGroupButton").addEventListener("click", () => showGroupCreator(true));
  $("#cancelGroupCreate").addEventListener("click", () => showGroupCreator(false));
  $("#createGroupForm").addEventListener("submit", (event) => {
    event.preventDefault();
    createGroupList(event.currentTarget);
  });
  $("#copyFriendInvite").addEventListener("click", copyFriendInviteLink);
  $("#addFriendForm").addEventListener("submit", (event) => {
    event.preventDefault();
    addFriendByUsername(event.currentTarget.elements.username.value);
  });
  $("#editProfileForm").addEventListener("submit", (event) => {
    event.preventDefault();
    saveEditedProfile(event.currentTarget);
  });
  $("#editProfileForm").elements.bio.addEventListener("input", (event) => {
    $("#profileBioCount").textContent = event.target.value.length;
  });
  $("#editProfileForm").elements.avatarUrl.addEventListener("input", (event) => {
    if (event.target.value.trim()) {
      pendingProfileAvatar = null;
      $("#profileAvatarDropText").textContent = "Image URL selected";
    }
    renderProfileAvatarPreview();
  });
  $("#chooseProfileAvatar").addEventListener("click", (event) => {
    event.stopPropagation();
    $("#profileAvatarFile").click();
  });
  $("#profileAvatarFile").addEventListener("change", (event) => {
    if (event.target.files?.[0]) handleProfileAvatarFile(event.target.files[0]);
  });
  const profileDropZone = $("#profileAvatarDropZone");
  profileDropZone.addEventListener("click", (event) => {
    if (!event.target.closest("button")) $("#profileAvatarFile").click();
  });
  profileDropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("#profileAvatarFile").click(); }
  });
  ["dragenter", "dragover"].forEach((type) => profileDropZone.addEventListener(type, (event) => {
    event.preventDefault();
    profileDropZone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((type) => profileDropZone.addEventListener(type, (event) => {
    event.preventDefault();
    profileDropZone.classList.remove("dragging");
  }));
  profileDropZone.addEventListener("drop", (event) => {
    if (event.dataTransfer?.files?.[0]) handleProfileAvatarFile(event.dataTransfer.files[0]);
  });
  $("#removeProfileAvatar").addEventListener("click", () => {
    pendingProfileAvatar = null;
    $("#editProfileForm").elements.avatarUrl.value = "";
    $("#profileAvatarFile").value = "";
    $("#profileAvatarDropText").textContent = "Profile picture removed. Save to confirm.";
    renderProfileAvatarPreview();
  });
  $("#resetProfileForm").addEventListener("click", () => populateEditProfileForm());
  $("#changePasswordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await updateAccountPassword(event.currentTarget);
  });
  $("#generateRecoveryCode").addEventListener("click", async () => {
    await createRecoveryCodeForUser();
  });
  $("#copyRecoveryCode").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#recoveryCodeValue").textContent); toast("Recovery code copied"); }
    catch { toast("Copy failed. Select the recovery code manually."); }
  });

  $("#authTabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-auth-view]"); if (!button) return;
    $$("[data-auth-view]", $("#authTabs")).forEach((b) => b.classList.toggle("active", b === button));
    $("#signinForm").hidden = button.dataset.authView !== "signin"; $("#signupForm").hidden = button.dataset.authView !== "signup"; $("#resetPasswordForm").hidden = true;
  });

  $("#showPasswordReset").addEventListener("click", () => {
    $("#signinForm").hidden = true;
    $("#signupForm").hidden = true;
    $("#resetPasswordForm").hidden = false;
  });
  $("#backToSignIn").addEventListener("click", () => {
    $("#resetPasswordForm").hidden = true;
    $("#signinForm").hidden = false;
    $$('[data-auth-view]', $("#authTabs")).forEach((button) => button.classList.toggle("active", button.dataset.authView === "signin"));
  });

  $("#signupForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.target); const username = form.get("username").trim(); const usernameLower = username.toLowerCase(); const error = $("#signupError");
    if (supabaseMode) {
      error.textContent = "";
      try {
        const result = await window.SoraListSupabase.signUp(String(form.get("email") || "").trim(), String(form.get("password")), username);
        event.target.reset();
        if (result.session) {
          closeModal("authModal");
          await refreshSupabaseStore();
          toast(`Welcome to SoraList, ${username}`);
        } else {
          error.textContent = "Check your email to confirm your new SoraList account.";
        }
      } catch (signupError) {
        error.textContent = signupError.message || "Your account could not be created.";
      }
      return;
    }
    if (store.users.some((u) => u.usernameLower === usernameLower)) { error.textContent = "That username is already taken. Try another one."; return; }
    const passwordCredential = await createSecretCredential(String(form.get("password")));
    store.users.push({ username, usernameLower, passwordHash: null, passwordCredential, createdAt: new Date().toISOString(), friends: [], incomingFriendRequests: [], outgoingFriendRequests: [], rejectedFriendRequests: [], list: [] }); store.session = usernameLower; saveStore(); event.target.reset(); error.textContent = ""; closeModal("authModal"); renderAll(); toast(`Welcome to SoraList, ${username}`);
  });

  $("#signinForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.target); const error = $("#signinError");
    if (supabaseMode) {
      error.textContent = "";
      try {
        await window.SoraListSupabase.signIn(String(form.get("email") || "").trim(), String(form.get("password")));
        event.target.reset();
        closeModal("authModal");
        await refreshSupabaseStore();
      } catch (signinError) {
        error.textContent = signinError.message || "The email or password does not match.";
      }
      return;
    }
    const usernameLower = form.get("username").trim().toLowerCase(); const password = String(form.get("password")); const user = store.users.find((candidate) => candidate.usernameLower === usernameLower);
    if (!user || !(await verifyUserPassword(user, password))) { error.textContent = "The username or password doesn't match."; return; }
    if (!user.passwordCredential && user.passwordHash) { user.passwordCredential = await createSecretCredential(password); user.passwordHash = null; }
    store.session = usernameLower; saveStore(); event.target.reset(); error.textContent = ""; closeModal("authModal"); renderAll(); toast(`Welcome back, ${user.username}`);
  });
  $("#resetPasswordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await resetPasswordWithRecovery(event.currentTarget);
  });

  $("#homeTabs").addEventListener("click", (event) => { const button = event.target.closest("[data-feed]"); if (!button) return; homeFeed = button.dataset.feed; $$("button", $("#homeTabs")).forEach((b) => b.classList.toggle("active", b === button)); renderHome(); });
  $("#genreFilters").addEventListener("click", (event) => { const button = event.target.closest("[data-genre]"); if (!button) return; discoverFilters.genre = button.dataset.genre; discoverResults = null; fetchDiscoverAnime(); });
  $("#listTabs").addEventListener("click", (event) => { const button = event.target.closest("[data-status]"); if (!button) return; listFilter = button.dataset.status; $$("button", $("#listTabs")).forEach((b) => b.classList.toggle("active", b === button)); renderList(); });

  $("#searchInput").addEventListener("input", (event) => {
    const query = event.target.value.trim(); const results = $("#searchResults");
    clearTimeout(searchTimer);
    if (searchController) searchController.abort();
    if (!query) { results.hidden = true; return; }
    results.innerHTML = `<div class="api-inline-state">Searching the live catalog…</div>`;
    results.hidden = false;
    searchTimer = setTimeout(() => searchAnimeApi(query), 450);
  });
  $("#searchResults").addEventListener("click", () => { $("#searchResults").hidden = true; $("#searchInput").value = ""; });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) { event.preventDefault(); $("#searchInput").focus(); }
    if (["Enter", " "].includes(event.key) && event.target.matches('[data-open-anime][role="button"]')) { event.preventDefault(); showDetails(Number(event.target.dataset.openAnime)); }
    if (event.key === "Escape") { closeProfileDropdown(); $$(".modal-backdrop").forEach((modal) => { if (!modal.hidden) closeModal(modal.id); }); }
  });
  document.addEventListener("click", (event) => { if (!event.target.closest(".search-wrap")) $("#searchResults").hidden = true; if (!event.target.closest(".topbar-profile-menu")) closeProfileDropdown(); });
  $("#themeButton").addEventListener("click", () => { store.theme = store.theme === "dark" ? "light" : "dark"; saveStore(); applyTheme(); renderSettings(); });
  $("#syncStatus").addEventListener("click", () => fetchCatalog({ notifyOnError: true }));
  $("#settingsRefreshButton").addEventListener("click", () => fetchCatalog({ notifyOnError: true }));
  $("#settingsProfileButton").addEventListener("click", () => currentUser() ? switchView("account") : openModal("authModal"));
  $("#mobileMenu").addEventListener("click", () => { $(".sidebar").classList.add("open"); $("#mobileScrim").hidden = false; });
  $("#mobileScrim").addEventListener("click", () => { $(".sidebar").classList.remove("open"); $("#mobileScrim").hidden = true; });
  $$(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closeModal(backdrop.id); }));
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || !event.data) return;
    if (event.data.type === "soralist-oauth") completeOAuthSignIn(event.data.profile);
    if (event.data.type === "soralist-oauth-error") toast(event.data.error || "Social sign-in could not be completed.");
  });
}

function applyTheme() {
  document.body.classList.toggle("dark", store.theme === "dark");
  document.body.classList.toggle("compact-density", store.density === "compact");
  document.body.classList.toggle("reduce-motion", Boolean(store.reduceMotion));
  document.body.classList.toggle("always-show-list-controls", Boolean(store.alwaysShowListControls));
}

async function init() {
  friendInviteUsername = friendInviteFromLocation();
  if (friendInviteUsername) friendsTab = "add";
  applyTheme(); setupEvents();
  oauthProviderState = { google: null, discord: null };
  $("#homeGrid").innerHTML = skeletonCards(5);
  loadApiCache();
  renderAll();
  initializeSupabase();
  if (friendInviteUsername) switchView("friends");
  fetchCatalog();
  setInterval(() => fetchCatalog(), REFRESH_INTERVAL);
  setInterval(renderSyncStatus, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastApiUpdate > REFRESH_INTERVAL) fetchCatalog();
  });
}

init();
