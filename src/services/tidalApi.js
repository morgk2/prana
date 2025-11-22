/**
 * Tidal API Service
 * Uses third-party proxy servers to access Tidal's music catalog
 * No authentication required - proxy handles everything
 */

// Cluster of proxy servers for load balancing and redundancy
const TIDAL_SERVERS = [
    // Primary cluster (Monochrome - currently more reliable)
    'https://hifi.prigoana.com',
    'https://california.monochrome.tf',
    'https://london.monochrome.tf',
    'https://singapore.monochrome.tf',
    'https://ohio.monochrome.tf',
    'https://oregon.monochrome.tf',
    'https://virginia.monochrome.tf',
    'https://frankfurt.monochrome.tf',
    'https://tokyo.monochrome.tf',
    // Secondary cluster (Squid)
    'https://kraken.squid.wtf',
    'https://triton.squid.wtf',
    'https://zeus.squid.wtf',
    'https://aether.squid.wtf',
    'https://phoenix.squid.wtf',
    'https://shiva.squid.wtf',
    'https://chaos.squid.wtf',
    // Backup cluster
    'https://hund.qqdl.site',
    'https://katze.qqdl.site',
    'https://maus.qqdl.site',
    'https://vogel.qqdl.site',
    'https://wolf.qqdl.site',
];

// Select a random server for load distribution
function getRandomServer() {
    return TIDAL_SERVERS[Math.floor(Math.random() * TIDAL_SERVERS.length)];
}

// Primary server (fallback)
const PRIMARY_SERVER = TIDAL_SERVERS[0];

/**
 * Extract stream URL from base64-encoded manifest
 */
function extractStreamUrl(manifest) {
    if (!manifest) return null;

    try {
        // Decode base64 manifest
        const decoded = atob(manifest);

        // Try parsing as JSON first
        try {
            const parsed = JSON.parse(decoded);
            if (parsed.urls && Array.isArray(parsed.urls) && parsed.urls.length > 0) {
                return parsed.urls[0];
            }
        } catch {
            // Fall back to regex extraction
            const match = decoded.match(/https?:\/\/[\w\-.~:?#[\]@!$&'()*+,;=%/]+/);
            if (match) return match[0];
        }
    } catch (error) {
        console.error('[Tidal] Failed to decode manifest:', error);
    }

    return null;
}

/**
 * Fetch with automatic server fallback
 */
async function fetchWithFallback(endpoint, options = {}) {
    // Try random server first, then all servers in order
    const servers = [getRandomServer(), ...TIDAL_SERVERS];
    const uniqueServers = [...new Set(servers)];

    let lastError = null;

    for (const server of uniqueServers) {
        try {
            const url = `${server}${endpoint}`;
            console.log(`[Tidal] Trying: ${url}`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

            const response = await fetch(url, {
                ...options,
                headers: {
                    'Accept': 'application/json',
                    ...options.headers,
                },
                signal: controller.signal,
            }).finally(() => clearTimeout(timeoutId));

            if (response.ok) {
                const text = await response.text();

                // Check if response is HTML (error page) instead of JSON
                if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
                    console.warn(`[Tidal] Server ${server} returned HTML instead of JSON (likely out of service)`);
                    lastError = new Error('Server returned HTML error page');
                    continue;
                }

                try {
                    return JSON.parse(text);
                } catch (parseError) {
                    console.warn(`[Tidal] Failed to parse JSON from ${server}:`, text.substring(0, 200));
                    lastError = new Error('Invalid JSON response from server');
                    continue;
                }
            }

            // Rate limited - try next server
            if (response.status === 429) {
                console.warn(`[Tidal] Rate limited on ${server}, trying next...`);
                continue;
            }

            // Payment required / Out of service - try next server
            if (response.status === 402) {
                console.warn(`[Tidal] Server ${server} is out of service (402), trying next...`);
                lastError = new Error('Server out of service');
                continue;
            }

            // Server error - try next server
            if (response.status >= 500) {
                console.warn(`[Tidal] Server error ${response.status} on ${server}, trying next...`);
                lastError = new Error(`Server error: ${response.status}`);
                continue;
            }

            // Client error - check if we should retry or throw
            if (response.status >= 400) {
                // Special handling for 404: Some proxies might not have the track cached or available,
                // but others might. Treat 404 as a "try next server" event.
                if (response.status === 404) {
                    console.warn(`[Tidal] Server ${server} returned 404 (Not Found), trying next...`);
                    lastError = new Error(`HTTP 404: Track not found on ${server}`);
                    continue;
                }

                const errorText = await response.text().catch(() => '');
                throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
            }

            lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        } catch (error) {
            // If it's a client error (4xx), don't retry servers, just throw
            // UNLESS it's a timeout or network error
            if (error.message && error.message.includes('HTTP 4')) {
                throw error;
            }
            console.warn(`[Tidal] Server ${server} failed:`, error.message);
            lastError = error;
        }
    }

    throw lastError || new Error('All Tidal servers failed');
}

/**
 * Recursively find the tracks section in the response
 */
function findTracksSection(data, visited = new Set()) {
    if (!data || typeof data !== 'object' || visited.has(data)) {
        return null;
    }
    visited.add(data);

    // Check if this object has tracks items
    if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        const firstItem = data.items[0];
        // Check if items look like tracks (have title, artist, album, duration)
        if (firstItem && firstItem.title && firstItem.duration) {
            return data;
        }
    }

    // Recursively search in nested objects and arrays
    for (const value of Object.values(data)) {
        if (typeof value === 'object' && value !== null) {
            const found = findTracksSection(value, visited);
            if (found) return found;
        }
    }

    return null;
}

/**
 * Search for tracks
 */
export async function searchTracks(query, limit = 50) {
    try {
        const data = await fetchWithFallback(
            `/search/?s=${encodeURIComponent(query)}&limit=${limit}`
        );

        // Find the tracks section in the response
        const tracksSection = findTracksSection(data);
        const items = tracksSection?.items || data.items || [];

        if (!Array.isArray(items)) {
            console.warn('[Tidal] Unexpected response structure:', data);
            return { tracks: [], total: 0, limit, offset: 0 };
        }

        return {
            tracks: items.map(track => ({
                id: track.id,
                title: track.title,
                artist: track.artist?.name || track.artists?.[0]?.name || 'Unknown Artist',
                artistId: track.artist?.id || track.artists?.[0]?.id,
                album: track.album?.title || 'Unknown Album',
                albumId: track.album?.id,
                albumCover: track.album?.cover,
                duration: track.duration || 0,
                audioQuality: track.audioQuality || 'LOSSLESS',
                explicit: track.explicit || false,
                trackNumber: track.trackNumber,
                volumeNumber: track.volumeNumber,
            })),
            total: tracksSection?.totalNumberOfItems || data.totalNumberOfItems || items.length,
            limit: tracksSection?.limit || data.limit || limit,
            offset: tracksSection?.offset || data.offset || 0,
        };
    } catch (error) {
        console.error('[Tidal] Search failed:', error);
        throw error;
    }
}

/**
 * Search for albums
 */
export async function searchAlbums(query, limit = 50) {
    try {
        const data = await fetchWithFallback(
            `/search/?al=${encodeURIComponent(query)}&limit=${limit}`
        );

        const items = data.items || [];
        return {
            albums: items.map(album => ({
                id: album.id,
                title: album.title,
                artist: album.artist?.name || album.artists?.[0]?.name || 'Unknown Artist',
                artistId: album.artist?.id || album.artists?.[0]?.id,
                cover: album.cover,
                releaseDate: album.releaseDate,
                numberOfTracks: album.numberOfTracks,
                duration: album.duration,
                explicit: album.explicit || false,
            })),
            total: data.totalNumberOfItems || items.length,
        };
    } catch (error) {
        console.error('[Tidal] Album search failed:', error);
        throw error;
    }
}

/**
 * Search for artists
 */
export async function searchArtists(query, limit = 50) {
    try {
        const data = await fetchWithFallback(
            `/search/?a=${encodeURIComponent(query)}&limit=${limit}`
        );

        const items = data.items || [];
        return {
            artists: items.map(artist => ({
                id: artist.id,
                name: artist.name,
                picture: artist.picture,
                type: artist.type,
            })),
            total: data.totalNumberOfItems || items.length,
        };
    } catch (error) {
        console.error('[Tidal] Artist search failed:', error);
        throw error;
    }
}

/**
 * Get track stream URL
 * Quality options: 'HIGH' (AAC 320kbps), 'LOSSLESS' (FLAC), 'HI_RES_LOSSLESS' (Hi-Res FLAC)
 */
export async function getTrackStreamUrl(trackId, preferredQuality = 'LOSSLESS') {
    const qualities = ['HI_RES_LOSSLESS', 'LOSSLESS', 'HIGH', 'LOW'];
    let startIndex = qualities.indexOf(preferredQuality);
    if (startIndex === -1) startIndex = 1; // Default to LOSSLESS

    let lastError = null;

    // Try preferred quality and lower
    for (let i = startIndex; i < qualities.length; i++) {
        const quality = qualities[i];
        try {
            console.log(`[Tidal] Requesting stream for track ${trackId} with quality ${quality}`);

            const data = await fetchWithFallback(
                `/track/?id=${trackId}&quality=${quality}`
            );

            // Parse response - can be array or object
            const entries = Array.isArray(data) ? data : [data];

            let track = null;
            let info = null;
            let originalTrackUrl = null;

            for (const entry of entries) {
                if (!entry || typeof entry !== 'object') continue;

                // Find track metadata
                if (!track && entry.album && entry.artist && entry.duration) {
                    track = entry;
                }

                // Find stream info
                if (!info && entry.manifest) {
                    info = entry;
                }

                // Find direct URL (sometimes provided)
                if (!originalTrackUrl && entry.OriginalTrackUrl) {
                    originalTrackUrl = entry.OriginalTrackUrl;
                }
            }

            if (!track || !info) {
                // If we got a response but no track/info, it might be a weird response.
                // Throwing here will trigger the catch block and try the next quality.
                throw new Error('Invalid track response from server');
            }

            // Try direct URL first
            if (originalTrackUrl) {
                return {
                    streamUrl: originalTrackUrl,
                    track: {
                        id: track.id,
                        title: track.title,
                        artist: track.artist?.name || 'Unknown Artist',
                        album: track.album?.title || 'Unknown Album',
                        albumCover: track.album?.cover,
                        duration: track.duration,
                        audioQuality: track.audioQuality || quality,
                    },
                };
            }

            // Extract from manifest
            const streamUrl = extractStreamUrl(info.manifest);
            if (!streamUrl) {
                throw new Error('Could not extract stream URL from manifest');
            }

            return {
                streamUrl,
                track: {
                    id: track.id,
                    title: track.title,
                    artist: track.artist?.name || 'Unknown Artist',
                    album: track.album?.title || 'Unknown Album',
                    albumCover: track.album?.cover,
                    duration: track.duration,
                    audioQuality: track.audioQuality || quality,
                },
            };

        } catch (error) {
            console.warn(`[Tidal] Failed to get stream for ${trackId} at ${quality}:`, error.message);
            lastError = error;

            // If it's a 404 or "quality unavailable", continue to next quality
            // Otherwise, if it's a network error, it might have already retried servers in fetchWithFallback
            // so we continue to next quality just in case.
        }
    }

    console.error('[Tidal] All quality attempts failed for track', trackId);
    throw lastError || new Error('Failed to get stream URL for any quality');
}

/**
 * Get album with all tracks
 */
export async function getAlbum(albumId) {
    try {
        const data = await fetchWithFallback(`/album/?id=${albumId}`);

        const entries = Array.isArray(data) ? data : [data];

        let album = null;
        let trackCollection = null;

        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') continue;

            // Find album metadata
            if (!album && entry.title && entry.id && entry.cover) {
                album = entry;
            }

            // Find track collection
            if (!trackCollection && entry.items && Array.isArray(entry.items)) {
                trackCollection = entry;
            }
        }

        if (!album) {
            throw new Error('Album not found');
        }

        const tracks = [];
        if (trackCollection?.items) {
            for (const rawItem of trackCollection.items) {
                const track = rawItem.item || rawItem;
                if (!track) continue;

                tracks.push({
                    id: track.id,
                    title: track.title,
                    artist: track.artist?.name || album.artist?.name || 'Unknown Artist',
                    artistId: track.artist?.id || album.artist?.id,
                    album: album.title,
                    albumId: album.id,
                    albumCover: album.cover,
                    duration: track.duration || 0,
                    trackNumber: track.trackNumber,
                    volumeNumber: track.volumeNumber,
                    audioQuality: track.audioQuality,
                    explicit: track.explicit || false,
                });
            }
        }

        return {
            album: {
                id: album.id,
                title: album.title,
                artist: album.artist?.name || album.artists?.[0]?.name || 'Unknown Artist',
                artistId: album.artist?.id || album.artists?.[0]?.id,
                cover: album.cover,
                releaseDate: album.releaseDate,
                numberOfTracks: album.numberOfTracks || tracks.length,
                duration: album.duration,
                explicit: album.explicit || false,
            },
            tracks,
        };
    } catch (error) {
        console.error('[Tidal] Failed to get album:', error);
        throw error;
    }
}

/**
 * Get artist details with albums and top tracks
 */
export async function getArtist(artistId) {
    try {
        const data = await fetchWithFallback(`/artist/?f=${artistId}`);

        const entries = Array.isArray(data) ? data : [data];

        let artist = null;
        const albums = [];
        const topTracks = [];

        // Recursively scan for artist, albums, and tracks
        function scanEntry(entry) {
            if (!entry || typeof entry !== 'object') return;

            // Check if this is an artist
            if (!artist && entry.id && entry.name && entry.type) {
                artist = {
                    id: entry.id,
                    name: entry.name,
                    picture: entry.picture,
                    type: entry.type,
                };
            }

            // Check if this is an album
            if (entry.id && entry.title && entry.cover && !entry.duration) {
                albums.push({
                    id: entry.id,
                    title: entry.title,
                    cover: entry.cover,
                    releaseDate: entry.releaseDate,
                    numberOfTracks: entry.numberOfTracks,
                });
            }

            // Check if this is a track
            if (entry.id && entry.title && entry.duration && entry.album) {
                topTracks.push({
                    id: entry.id,
                    title: entry.title,
                    artist: entry.artist?.name || artist?.name,
                    album: entry.album?.title,
                    albumCover: entry.album?.cover,
                    duration: entry.duration,
                });
            }

            // Recursively scan nested objects and arrays
            if (Array.isArray(entry)) {
                entry.forEach(scanEntry);
            } else {
                Object.values(entry).forEach(value => {
                    if (typeof value === 'object') {
                        scanEntry(value);
                    }
                });
            }
        }

        entries.forEach(scanEntry);

        if (!artist) {
            throw new Error('Artist not found');
        }

        return {
            artist,
            albums: albums.slice(0, 50), // Limit to 50 albums
            topTracks: topTracks.slice(0, 10), // Limit to 10 top tracks
        };
    } catch (error) {
        console.error('[Tidal] Failed to get artist:', error);
        throw error;
    }
}

/**
 * Get cover art URL
 */
export function getCoverArtUrl(coverId, size = 640) {
    if (!coverId) return null;

    // Tidal cover format: replace dashes with slashes
    const path = coverId.replace(/-/g, '/');
    return `https://resources.tidal.com/images/${path}/${size}x${size}.jpg`;
}

/**
 * Get artist picture URL
 */
export function getArtistPictureUrl(pictureId, size = 750) {
    if (!pictureId) return null;

    const path = pictureId.replace(/-/g, '/');
    return `https://resources.tidal.com/images/${path}/${size}x${size}.jpg`;
}

export default {
    searchTracks,
    searchAlbums,
    searchArtists,
    getTrackStreamUrl,
    getAlbum,
    getArtist,
    getCoverArtUrl,
    getArtistPictureUrl,
};
