// Spotify-backed music search client for 8SPINE
// This file keeps the old Last.fm-style function names so App.js can stay mostly unchanged.
// IMPORTANT: For production, move the Spotify client secret to a secure backend.

const LASTFM_API_KEY = '4a9f5581a9cdf20a699f540aa52a95c9'; // Public shared key for demo purposes. Replace with your own!
const LASTFM_BASE_URL = 'https://ws.audioscrobbler.com/2.0/';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_SEARCH_URL = 'https://api.spotify.com/v1/search';
const SPOTIFY_ARTISTS_URL = 'https://api.spotify.com/v1/artists';
const SPOTIFY_ALBUMS_URL = 'https://api.spotify.com/v1/albums';
const SPOTIFY_PLAYLISTS_URL = 'https://api.spotify.com/v1/playlists';

// TEMP: hard-coded credentials for local/dev use only.
// Replace these placeholders with your real Spotify client ID and secret.
// DO NOT ship a production build with real secrets in the bundle.
const SPOTIFY_CLIENT_ID = '3b04b56282cf497fbc68c6bf8cb51438';
const SPOTIFY_CLIENT_SECRET = 'b89842acfa4d4ec4ad55bdac57a1e4a2';

let spotifyAccessToken = null;
let spotifyAccessTokenExpiresAt = 0;

function ensureSpotifyCredentials() {
  if (
    !SPOTIFY_CLIENT_ID ||
    !SPOTIFY_CLIENT_SECRET ||
    SPOTIFY_CLIENT_ID === 'YOUR_SPOTIFY_CLIENT_ID' ||
    SPOTIFY_CLIENT_SECRET === 'YOUR_SPOTIFY_CLIENT_SECRET'
  ) {
    throw new Error('Spotify client ID/secret not configured in src/api/lastfm.js');
  }
}

function encodeBasicAuth(id, secret) {
  const raw = `${id}:${secret}`;
  if (typeof btoa === 'function') {
    return btoa(raw);
  }
  // Fallback for environments with Buffer (e.g. Node during testing)
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(raw, 'utf8').toString('base64');
  }
  throw new Error('No base64 encoder available for Spotify auth');
}

async function getSpotifyToken({ signal } = {}) {
  ensureSpotifyCredentials();

  const now = Date.now();
  if (spotifyAccessToken && now < spotifyAccessTokenExpiresAt - 60_000) {
    return spotifyAccessToken;
  }

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + encodeBasicAuth(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify auth error ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (!json.access_token) {
    throw new Error('Spotify auth failed: no access token in response');
  }

  spotifyAccessToken = json.access_token;
  spotifyAccessTokenExpiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
  return spotifyAccessToken;
}

function mapSpotifyImagesToLastfmStyle(images) {
  if (!Array.isArray(images)) return [];

  // Spotify images usually come as [{width, height, url}, ...] highest-res first.
  return images.map((img, index) => ({
    '#text': img.url,
    size: index === 0 ? 'extralarge' : index === images.length - 1 ? 'small' : 'large',
  }));
}

function mapSpotifyArtistToLastfm(artist) {
  if (!artist) return null;
  return {
    name: artist.name,
    // Use Spotify ID in the mbid slot so existing keys keep working.
    mbid: artist.id,
    listeners: artist.followers?.total ?? undefined,
    image: mapSpotifyImagesToLastfmStyle(artist.images),
  };
}

function mapSpotifyAlbumToLastfm(album) {
  if (!album) return null;
  return {
    name: album.name,
    mbid: album.id,
    artist: { name: album.artists?.[0]?.name ?? '' },
    image: mapSpotifyImagesToLastfmStyle(album.images),
    total_tracks: album.total_tracks,
    release_date: album.release_date,
    album_type: album.album_type,
  };
}

function mapSpotifyTrackToLastfm(track) {
  if (!track) return null;
  const artistNames = (track.artists ?? []).map((a) => a.name).join(', ');
  return {
    name: track.name,
    mbid: track.id,
    // To match the existing UI, expose a simple artist string or object-with-name.
    artist: artistNames,
    album: track.album?.name ?? null,
    image: mapSpotifyImagesToLastfmStyle(track.album?.images ?? []),
    // 30s preview URL (if available) for playback.
    previewUrl: track.preview_url ?? null,
  };
}

async function spotifySearch(params, { signal } = {}) {
  const token = await getSpotifyToken({ signal });

  const url = new URL(SPOTIFY_SEARCH_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  // Use a default market to make results predictable and avoid region-locked items disappearing.
  if (!url.searchParams.has('market')) {
    url.searchParams.set('market', 'US');
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify search error ${res.status}: ${text}`);
  }

  return res.json();
}

async function findSpotifyArtistByName(name, { signal } = {}) {
  const json = await spotifySearch(
    {
      q: name,
      type: 'artist',
      limit: 1,
    },
    { signal },
  );

  const items = json.artists?.items ?? [];
  return items[0] ?? null;
}

// ---- Public API (same names as the old Last.fm client) ----

// Search artists (Spotify-backed)
export async function searchLastfmArtists(query, { limit = 10 } = {}) {
  const json = await spotifySearch({
    q: query,
    type: 'artist',
    limit,
  });

  const items = json.artists?.items ?? [];
  return items.map(mapSpotifyArtistToLastfm).filter(Boolean);
}

export async function getArtistInfo(artistName) {
  const [token, spotifyArtist] = await Promise.all([
    getSpotifyToken(),
    findSpotifyArtistByName(artistName),
  ]);

  return mapSpotifyArtistToLastfm(spotifyArtist);
}

// Helper to fetch from real Last.fm API as fallback
// NOTE: As of November 27, 2024, Spotify restricted access to the Related Artists endpoint
// for new apps and apps in development mode. This fallback ensures similar artists are still shown.
// See: https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api
async function getLastfmSimilarArtists(artistName, limit) {
  try {
    const url = new URL(LASTFM_BASE_URL);
    url.searchParams.set('method', 'artist.getsimilar');
    url.searchParams.set('artist', artistName);
    url.searchParams.set('api_key', LASTFM_API_KEY);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', String(limit));

    const res = await fetch(url.toString());
    if (!res.ok) return [];

    const json = await res.json();
    const items = json.similarartists?.artist ?? [];

    return items.map(artist => ({
      name: artist.name,
      mbid: artist.mbid || artist.name,
      listeners: undefined,
      image: Array.isArray(artist.image) ? artist.image : [],
    }));
  } catch (e) {
    console.warn('Last.fm fallback failed', e);
    return [];
  }
}

// Get related/similar artists
// NOTE: Spotify restricted the Related Artists endpoint for development mode apps as of Nov 27, 2024.
// This function will attempt Spotify first (for apps with extended access) then fall back to Last.fm.
// See: https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api
export async function getRelatedArtists(artistName, { limit = 20, artistId = null } = {}) {
  try {
    const token = await getSpotifyToken();
    let spotifyArtistId = artistId;

    // Validation: Spotify IDs are alphanumeric ~22 chars.
    // If it looks like a UUID (hyphens), or is too long/short, or has spaces, or equals the name, ignore it.
    if (spotifyArtistId) {
        const isUuid = spotifyArtistId.includes('-');
        const isName = spotifyArtistId === artistName;
        const hasSpaces = spotifyArtistId.includes(' ');
        const isBadLength = spotifyArtistId.length < 15 || spotifyArtistId.length > 30;

        if (isUuid || isName || hasSpaces || isBadLength) {
            spotifyArtistId = null;
        }
    }

    // If no ID provided (or filtered out), search by name
    if (!spotifyArtistId) {
      const spotifyArtist = await findSpotifyArtistByName(artistName);
      if (spotifyArtist) {
        spotifyArtistId = spotifyArtist.id;
      }
    }

    if (!spotifyArtistId) {
      // Fallback to Last.fm if we can't find a Spotify ID
      return getLastfmSimilarArtists(artistName, limit);
    }

    const url = `${SPOTIFY_ARTISTS_URL}/${encodeURIComponent(spotifyArtistId)}/related-artists`;

    let res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // If the ID was bad (404/400), try resolving by name if we haven't already
    if (!res.ok && (res.status === 404 || res.status === 400) && artistId && artistId === spotifyArtistId) {
      const spotifyArtist = await findSpotifyArtistByName(artistName);
      
      if (spotifyArtist) {
        const retryUrl = `${SPOTIFY_ARTISTS_URL}/${encodeURIComponent(spotifyArtist.id)}/related-artists`;
        const retryRes = await fetch(retryUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (retryRes.ok) {
          res = retryRes;
        }
      }
    }

    if (!res.ok) {
      // 404 is expected for development mode apps after Nov 27, 2024 - fall back to Last.fm
      return getLastfmSimilarArtists(artistName, limit);
    }

    const json = await res.json();
    const items = json.artists ?? [];
    return items.slice(0, limit).map(mapSpotifyArtistToLastfm).filter(Boolean);
  } catch (e) {
    console.warn('Error fetching related artists from Spotify, falling back to Last.fm', e);
    return getLastfmSimilarArtists(artistName, limit);
  }
}

// Get top tracks for an artist name (best Spotify match)
export async function getArtistTopTracks(artist, { limit = 50 } = {}) {
  const [token, spotifyArtist] = await Promise.all([
    getSpotifyToken(),
    findSpotifyArtistByName(artist),
  ]);

  if (!spotifyArtist) return [];

  const url = new URL(`${SPOTIFY_ARTISTS_URL}/${spotifyArtist.id}/top-tracks`);
  url.searchParams.set('market', 'US');

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify top-tracks error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const items = json.tracks ?? [];
  return items.slice(0, limit).map(mapSpotifyTrackToLastfm).filter(Boolean);
}

// Get top albums for an artist name (best Spotify match) - ALBUMS ONLY
export async function getArtistTopAlbums(artist, { limit = 50 } = {}) {
  const [token, spotifyArtist] = await Promise.all([
    getSpotifyToken(),
    findSpotifyArtistByName(artist),
  ]);

  if (!spotifyArtist) return [];

  const url = new URL(`${SPOTIFY_ARTISTS_URL}/${spotifyArtist.id}/albums`);
  url.searchParams.set('include_groups', 'album'); // Only albums, not singles
  url.searchParams.set('market', 'US');
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify artist-albums error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const items = json.items ?? [];
  return items.map(mapSpotifyAlbumToLastfm).filter(Boolean);
}

// Get singles for an artist name (best Spotify match) - SINGLES ONLY
export async function getArtistSingles(artist, { limit = 50 } = {}) {
  const [token, spotifyArtist] = await Promise.all([
    getSpotifyToken(),
    findSpotifyArtistByName(artist),
  ]);

  if (!spotifyArtist) return [];

  const url = new URL(`${SPOTIFY_ARTISTS_URL}/${spotifyArtist.id}/albums`);
  url.searchParams.set('include_groups', 'single'); // Only singles
  url.searchParams.set('market', 'US');
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify artist-singles error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const items = json.items ?? [];
  return items.map(mapSpotifyAlbumToLastfm).filter(Boolean);
}

// Search tracks (Spotify-backed)
export async function searchLastfmTracks(query, { limit = 20 } = {}) {
  const json = await spotifySearch({
    q: query,
    type: 'track',
    limit,
  });

  const items = json.tracks?.items ?? [];
  return items.map(mapSpotifyTrackToLastfm).filter(Boolean);
}

// Search albums (Spotify-backed)
export async function searchLastfmAlbums(query, { limit = 20 } = {}) {
  const json = await spotifySearch({
    q: query,
    type: 'album',
    limit,
  });

  const items = json.albums?.items ?? [];
  return items.map(mapSpotifyAlbumToLastfm).filter(Boolean);
}

// Get detailed info for a specific album (including track list)
// We treat `mbid` as a Spotify album ID when present.
export async function getAlbumInfo({ artist, album, mbid }) {
  const token = await getSpotifyToken();

  let albumId = mbid;
  if (!albumId) {
    // Fallback: search by album + artist to resolve an ID.
    const json = await spotifySearch({
      q: `album:${album} artist:${artist}`,
      type: 'album',
      limit: 1,
    });
    const best = json.albums?.items?.[0];
    if (!best) return null;
    albumId = best.id;
  }

  const url = new URL(`${SPOTIFY_ALBUMS_URL}/${albumId}`);
  url.searchParams.set('market', 'US');

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify album-info error ${res.status}: ${text}`);
  }

  const json = await res.json();

  const tracks = (json.tracks?.items ?? []).map((t) => ({
    ...mapSpotifyTrackToLastfm(t),
    // Album tracks share the album artwork
    image: mapSpotifyImagesToLastfmStyle(json.images),
  }));

  // Shape this similar to Last.fm's album.getinfo response so App.js can reuse it.
  return {
    name: json.name,
    mbid: json.id,
    artist: { name: json.artists?.[0]?.name ?? artist },
    image: mapSpotifyImagesToLastfmStyle(json.images),
    tracks: {
      track: tracks,
    },
  };
}

// Get playlist info and tracks (Spotify-backed)
export async function getSpotifyPlaylist(playlistId) {
  const token = await getSpotifyToken();

  const url = new URL(`${SPOTIFY_PLAYLISTS_URL}/${playlistId}`);
  url.searchParams.set('market', 'US');

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify playlist error ${res.status}: ${text}`);
  }

  const json = await res.json();

  // Extract tracks
  const tracks = (json.tracks?.items ?? []).map((item) => {
    if (!item.track) return null;
    return {
      ...mapSpotifyTrackToLastfm(item.track),
      // Ensure we have an image, if the track doesn't have one use the playlist image (or album image which is default)
    };
  }).filter(Boolean);

  return {
    name: json.name,
    id: json.id,
    description: json.description,
    image: mapSpotifyImagesToLastfmStyle(json.images),
    tracks,
    owner: json.owner?.display_name
  };
}

// Get user's public playlists
export async function getUserPlaylists(userId) {
  const token = await getSpotifyToken();

  const url = new URL(`https://api.spotify.com/v1/users/${userId}/playlists`);
  url.searchParams.set('limit', '50'); // Max limit per request

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify user playlists error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const items = json.items ?? [];

  return items.map(playlist => ({
    name: playlist.name,
    id: playlist.id,
    description: playlist.description,
    image: mapSpotifyImagesToLastfmStyle(playlist.images),
    trackCount: playlist.tracks?.total || 0,
    owner: playlist.owner?.display_name
  }));
}
