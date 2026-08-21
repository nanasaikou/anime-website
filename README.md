# SoraList

A polished, responsive anime tracking app inspired by the clarity of modern catalog apps. It supports browsing, search, upcoming releases, Supabase authentication, unique usernames, personal watch statuses, episode progress, and 1–5 star ratings.

## Run locally

No dependency installation is required. Start the included server:

```powershell
npm run dev
```

Then open `http://127.0.0.1:4173`.

## Regional streaming availability

Regional watch-provider data requires a free TMDB API credential. Keep it on the server rather than placing it in `app.js`:

```powershell
$env:TMDB_API_TOKEN="your_tmdb_read_access_token"
npm run dev
```

Alternatively, set `TMDB_API_KEY` to a TMDB v3 API key. The included `.env.example` documents both options, but environment values must be exported in the shell before starting the server.

The included npm scripts also load a private `.env` file automatically. Copy `.env.example` to `.env`, replace the placeholder, and keep `.env` out of version control.

Anime detail pages load supported regions dynamically and group watch providers into subscription streaming, free, ad-supported, rent, and buy sections. TMDB supplies this watch-provider data through its JustWatch integration; provider availability can change.

The catalog is fully API-driven: AniList powers the main live feeds and Jikan is used automatically as a secondary provider. Current-season, popular, top-rated, upcoming, search, and genre results refresh without editing local anime records. Data refreshes every 30 minutes while the app is open and a recent API response is cached for temporary service interruptions.

Opening any title performs a live availability lookup. Episode totals, aired and remaining counts, upcoming episode timestamps, broadcast schedules, and legal streaming links are derived only from AniList or Jikan responses. Missing fields are shown as unavailable instead of being estimated.

Franchise entries are grouped from AniList's media relation graph and supplemented by normalized API-title matching when providers separate related seasons. Immediately below the selected anime's header, connected titles are separated into visible **Seasons**, **Movies**, and **Watch more** grids. Direct relations and matching API names render progressively. Selecting an entry switches every displayed field to that title's own API data.

## Collaborative lists

Signed-in profiles can connect from the profile panel. When connected profiles save the same API anime ID, SoraList displays their stacked avatars on catalog cards, anime details, and list rows. The **Shared** list filter collects these mutual picks automatically.

Profiles, friendships, personal lists, group lists, and chat use Supabase with row-level security and Realtime updates. Browser storage is retained only as a local UI cache and for non-sensitive display preferences.

## Supabase and social sign-in

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` using `.env.example`, then run the migrations in `supabase/migrations` in filename order. The publishable key is safe in the browser because every shared-data table has explicit grants and row-level security.

Google and Discord are configured in Supabase Authentication. Register the following Supabase callback URL in both provider dashboards:

`https://<project-ref>.supabase.co/auth/v1/callback`

For local development, set the Supabase Site URL to `http://127.0.0.1:4173` and allow `http://127.0.0.1:4173/**` as an additional redirect URL.

To prevent unrelated titles from crossing into a franchise, every related entry must pass a shared canonical-title check; loose API synonyms are not used for grouping. Franchise cards use the same full-detail action as catalog cards, and selecting one resets the scrollable modal to that title's header, description, episode information, schedule, and streaming links.

Passwords, OAuth identities, and reset links are handled by Supabase Auth rather than being stored by the website.
