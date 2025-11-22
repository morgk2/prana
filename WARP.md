# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Development commands

This is an Expo-managed React Native app.

- Install dependencies:
  - `npm install`
- Start the Expo dev server (interactive Metro bundler, choose platform in the UI or via CLI flags):
  - `npm run start`
- Run on a specific platform:
  - Android: `npm run android`
  - iOS: `npm run ios`
  - Web: `npm run web`

There are currently **no lint or test scripts** defined in `package.json`, and no test framework configured. If you add one (e.g. Jest), update this file with the commands and how to run a single test.

## High-level architecture

### Entry point and app shell

- `index.js` uses Expo’s `registerRootComponent` to register `App` as the root component. This is the standard Expo entry; you normally don’t need to touch this unless you change the app root.
- `App.js` is the primary UI and state container. It:
  - Uses `useColorScheme()` and `src/theme/colors.js` to choose between light and dark theme variants and threads a `theme` object into UI components (notably `ArtistPage`).
  - Holds the main state for search: `query`, `loading`, `error`, and the aggregated `artists`, `albums`, and `tracks` result lists.
  - Implements a simple, internal navigation model via local state:
    - `view` is `'search'` or `'artist'`.
    - `selectedArtist` plus `artistTopTracks` and `artistTopAlbums` back the artist detail view.
  - Renders either:
    - The search screen: header, search input, `Button` to trigger search, and a combined `FlatList` of artists, albums, and tracks.
    - Or the artist detail screen: delegates to `src/components/ArtistPage.js` when `view === 'artist'` and `selectedArtist` is set.

### Search and intent detection

All search behaviour is centralized in `App.js` and `src/api/lastfm.js`:

- `detectIntent(query)` in `App.js` is the key orchestration function for search:
  - It calls `searchLastfmArtists`, `searchLastfmAlbums`, and `searchLastfmTracks` in parallel for the raw query.
  - It then classifies the query into one of four intents: `'artist' | 'album' | 'track' | 'mixed'`.
  - Intent is derived by:
    - Exact string equality checks between the query and the top artist/album/track names.
    - A custom scoring heuristic (`scoreNameMatch`) that favours exact and prefix matches over substring matches, and a “dominance” factor comparing the best artist vs album vs track scores.
    - Simple pattern hints (e.g. queries containing `' - '` or `' by '` are skewed toward `track`; those mentioning "album", "ep", or "lp" skew toward `album`).
  - Based on the resulting intent, `onSearch` in `App.js` populates `artists`, `albums`, and `tracks` differently:
    - `artist`: fetches that artist’s top tracks and top albums, and sets `artists` to just the top match.
    - `album`: resolves album info (including track list) and sets `albums` to the chosen album and `tracks` to its tracks.
    - `track`: emphasises `tracks` but also surfaces `artists` and `albums` from the search.
    - `mixed`: passes through all three result lists as-is.

When editing search behaviour or tuning UX for different query types, `detectIntent` and `onSearch` are the main coordination points.

### Data layer: Spotify-backed Last.fm-style client

The data fetching layer lives under `src/api/` and is intentionally thin but opinionated:

- `src/api/lastfm.js` implements a **Spotify-backed client** while preserving the older Last.fm-style function names and response shapes so that existing UI code (e.g. `App.js`) remains mostly unchanged.
  - Credential handling:
    - It uses `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` defined in this file, then exchanges them for an app-only access token via the client credentials flow.
    - **These values are currently hard-coded for local/dev use, with comments warning not to ship production builds with real secrets.** When working on productionization tasks, prefer moving these credentials to a secure backend or environment-based configuration and updating this module accordingly.
  - Token management:
    - `getSpotifyToken` caches the access token in-memory and tracks its expiry (`spotifyAccessTokenExpiresAt`), reusing it until ~60 seconds before expiration.
  - Search primitives:
    - `spotifySearch(params, { signal })` is the low-level helper: builds the query string, defaults `market` to `US`, and issues authenticated requests to `/v1/search`.
  - Mapping helpers:
    - `mapSpotifyImagesToLastfmStyle`, `mapSpotifyArtistToLastfm`, `mapSpotifyAlbumToLastfm`, and `mapSpotifyTrackToLastfm` normalize Spotify responses into a Last.fm-like structure (e.g. `image` arrays with `'#text'` and `size`, reuse the Spotify ID in the `mbid` slot, treat `artist` as a name or object-with-name).
  - Public API consumed by `App.js`:
    - `searchLastfmArtists(query, { limit })`
    - `searchLastfmAlbums(query, { limit })`
    - `searchLastfmTracks(query, { limit })`
    - `getArtistTopTracks(artistName, { limit })`
    - `getArtistTopAlbums(artistName, { limit })`
    - `getAlbumInfo({ artist, album, mbid })` (treats `mbid` as a Spotify album ID when present; otherwise resolves via search).

When adding new UI features that need Spotify data, prefer going through this module so the Last.fm-style shapes remain consistent across the app.

- `src/api/musicbrainz.js` is a separate, generic MusicBrainz client that is **not currently wired into the UI** but is ready for use:
  - It defines `mbFetch` as a small wrapper around `fetch` with a required JSON `fmt` parameter and a descriptive `User-Agent` header, as required by MusicBrainz.
  - Provides helpers like `searchArtists`, `searchReleases`, `searchRecordings`, `searchRecordingsByArtist`, and `browseReleaseGroups`.

If you introduce new flows that use MusicBrainz (e.g. richer metadata, release information), build on these helpers rather than calling the HTTP API directly.

### UI components and theming

- `src/components/ArtistPage.js` is the dedicated artist detail screen.
  - It expects the `artist` object plus `topTracks`, `topAlbums`, `loading`, `error`, and a `theme` object passed from `App.js`, along with an `onBack` handler.
  - Implements a parallax-style animated header using `Animated.ScrollView` and several interpolated values (`headerTranslate`, `imageOpacity`, `imageTranslate`, `titleScale`, `titleTranslate`).
  - Uses `pickImageUrl` (duplicated from `App.js` with similar logic) to choose a suitable image URL from a Last.fm-style `image` array.
  - Renders two main sections when data is available:
    - **Popular Tracks**: a vertical list of the artist’s tracks (`topTracks`).
    - **Albums**: a vertical list of the artist’s albums (`topAlbums`).
  - Displays a floating back button (`Pressable`) anchored in the header region that calls `onBack` to switch `App.js` back to the search view.

- `src/theme/colors.js` defines theme tokens for the light and dark schemes:
  - Both `light` and `dark` objects specify semantic properties used throughout the app (e.g. `background`, `primaryText`, `secondaryText`, `card`, `border`, pill-related colors, input colors, error, header styling, and back button styling).
  - `App.js` reads `colors[colorScheme] || colors.dark` so adding new theme variants should keep this shape consistent.

### Data flow overview

- The user types a query in `App.js` and submits it (`onSubmitEditing` on the `TextInput` or pressing the `Search` button), which triggers `onSearch`.
- `onSearch`:
  - Resets view state to search mode, clears any selected artist, and sets `loading`.
  - Delegates to `detectIntent` to fetch and classify results.
  - Optionally performs follow-up fetches (e.g. artist top tracks/albums, album details) based on the chosen intent.
  - Populates `artists`, `albums`, and `tracks` in state.
- The combined `data` array merges the three typed lists into a single `FlatList` with `type` tags (`artist` | `album` | `track`) that drive the `renderRow` function.
- When the user taps an artist row, `openArtistPage` in `App.js`:
  - Switches `view` to `'artist'` and sets `selectedArtist`.
  - Fetches top tracks and albums for that artist and stores them in dedicated state slices.
  - The root render function then shows `ArtistPage` with that data until the user presses Back.

This structure keeps most app logic in `App.js` while reserving `src/components/ArtistPage.js` for the more complex detail layout and animations, and centralizes external data access in `src/api/` with theme tokens in `src/theme/`.