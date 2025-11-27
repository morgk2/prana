// Simple MusicBrainz API client for 8SPINE
// Docs: https://musicbrainz.org/doc/Development/XML_Web_Service/Version_2

const BASE_URL = 'https://musicbrainz.org/ws/2';

// IMPORTANT: MusicBrainz requires a descriptive User-Agent.
// Do NOT put secrets here. This is just public app identification.
const DEFAULT_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': '8SPINEMusic/1.0.0 ( https://example.com/contact )',
};

// A tiny wrapper around fetch for MusicBrainz
export async function mbFetch(path, { params = {}, signal } = {}) {
  const url = new URL(BASE_URL + path);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  });

  // All v2 calls must include fmt=json if you want JSON
  if (!url.searchParams.has('fmt')) {
    url.searchParams.set('fmt', 'json');
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: DEFAULT_HEADERS,
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`MusicBrainz error ${res.status}: ${text}`);
  }

  return res.json();
}

// Example: search for artists by name
export async function searchArtists(query, options = {}) {
  return mbFetch('/artist', {
    params: {
      query,
      limit: options.limit ?? 5,
      offset: options.offset ?? 0,
    },
  });
}

// Search for releases (albums, singles, etc.)
export async function searchReleases(query, options = {}) {
  return mbFetch('/release', {
    params: {
      query,
      limit: options.limit ?? 10,
      offset: options.offset ?? 0,
      inc: 'artist-credits',
    },
  });
}

// Search for recordings (tracks / songs)
export async function searchRecordings(query, options = {}) {
  return mbFetch('/recording', {
    params: {
      query,
      limit: options.limit ?? 10,
      offset: options.offset ?? 0,
      inc: 'releases+artist-credits',
    },
  });
}

// Browse release groups (albums/EPs) by artist
export async function browseReleaseGroups(artistId, options = {}) {
  return mbFetch('/release-group', {
    params: {
      artist: artistId,
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
      // primary types: Album, EP, Single
      type: 'album|ep',
    },
  });
}

// Browse recordings by artist (note: MB doesn't have a simple "top tracks" 
// endpoint, so we search for recordings BY this artist)
export async function searchRecordingsByArtist(artistId, options = {}) {
  // We use the search API but scoped to the artist ID
  return mbFetch('/recording', {
    params: {
      query: `artist:${artistId} AND video:false`,
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
      inc: 'releases+artist-credits',
    },
  });
}
