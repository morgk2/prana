export const TIDAL_MODULE_CODE = `
/**
 * Tidal API Module
 * Uses third-party proxy servers to access Tidal's music catalog
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

function extractStreamUrl(manifest) {
    if (!manifest) return null;
    try {
        const decoded = atob(manifest);
        try {
            const parsed = JSON.parse(decoded);
            if (parsed.urls && Array.isArray(parsed.urls) && parsed.urls.length > 0) {
                return parsed.urls[0];
            }
        } catch {
            const match = decoded.match(/https?:\\/\\/[\\w\\-.~:?#[\\]@!$&'()*+,;=%/]+/);
            if (match) return match[0];
        }
    } catch (error) {
        console.error('[Tidal] Failed to decode manifest:', error);
    }
    return null;
}

async function fetchWithFallback(endpoint, options = {}) {
    const servers = [getRandomServer(), ...TIDAL_SERVERS];
    const uniqueServers = [...new Set(servers)];
    let lastError = null;

    for (const server of uniqueServers) {
        try {
            const url = \`\${server}\${endpoint}\`;
            console.log(\`[Tidal] Trying: \${url}\`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            
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
                if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
                    continue;
                }
                try {
                    return JSON.parse(text);
                } catch (parseError) {
                    continue;
                }
            }
            if (response.status === 429 || response.status === 402 || response.status >= 500) {
                continue;
            }
            if (response.status >= 400) {
                if (response.status === 404) {
                    continue;
                }
                const errorText = await response.text().catch(() => '');
                throw new Error(\`HTTP \${response.status}: \${errorText || response.statusText}\`);
            }
            lastError = new Error(\`HTTP \${response.status}: \${response.statusText}\`);
        } catch (error) {
            if (error.message && error.message.includes('HTTP 4')) {
                throw error;
            }
            lastError = error;
        }
    }
    throw lastError || new Error('All Tidal servers failed');
}

function findTracksSection(data, visited = new Set()) {
    if (!data || typeof data !== 'object' || visited.has(data)) {
        return null;
    }
    visited.add(data);
    if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        const firstItem = data.items[0];
        if (firstItem && firstItem.title && firstItem.duration) {
            return data;
        }
    }
    for (const value of Object.values(data)) {
        if (typeof value === 'object' && value !== null) {
            const found = findTracksSection(value, visited);
            if (found) return found;
        }
    }
    return null;
}

async function searchTracks(query, limit = 50) {
    try {
        const data = await fetchWithFallback(
            \`/search/?s=\${encodeURIComponent(query)}&limit=\${limit}\`
        );
        const tracksSection = findTracksSection(data);
        const items = tracksSection?.items || data.items || [];
        if (!Array.isArray(items)) {
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

async function getTrackStreamUrl(trackId, preferredQuality = 'LOSSLESS') {
    const qualities = ['HI_RES_LOSSLESS', 'LOSSLESS', 'HIGH', 'LOW'];
    let startIndex = qualities.indexOf(preferredQuality);
    if (startIndex === -1) startIndex = 1;

    let lastError = null;
    for (let i = startIndex; i < qualities.length; i++) {
        const quality = qualities[i];
        try {
            console.log(\`[Tidal] Requesting stream for track \${trackId} with quality \${quality}\`);
            const data = await fetchWithFallback(
                \`/track/?id=\${trackId}&quality=\${quality}\`
            );
            const entries = Array.isArray(data) ? data : [data];
            let track = null;
            let info = null;
            let originalTrackUrl = null;

            for (const entry of entries) {
                if (!entry || typeof entry !== 'object') continue;
                if (!track && entry.album && entry.artist && entry.duration) track = entry;
                if (!info && entry.manifest) info = entry;
                if (!originalTrackUrl && entry.OriginalTrackUrl) originalTrackUrl = entry.OriginalTrackUrl;
            }

            if (!track || !info) throw new Error('Invalid track response from server');

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

            const streamUrl = extractStreamUrl(info.manifest);
            if (!streamUrl) throw new Error('Could not extract stream URL from manifest');

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
            console.warn(\`[Tidal] Failed to get stream for \${trackId} at \${quality}:\`, error.message);
            lastError = error;
        }
    }
    throw lastError || new Error('Failed to get stream URL for any quality');
}

async function getAlbum(albumId) {
    // Minimal implementation for album fetch
    const data = await fetchWithFallback(\`/album/?id=\${albumId}\`);
    // ... implementation simplified for brevity but should match original if possible
    // For now, just return the raw data structure if possible or copy full logic
    // To save space I'll just copy the relevant logic in full
    const entries = Array.isArray(data) ? data : [data];
    let album = null;
    let trackCollection = null;
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        if (!album && entry.title && entry.id && entry.cover) album = entry;
        if (!trackCollection && entry.items && Array.isArray(entry.items)) trackCollection = entry;
    }
    if (!album) throw new Error('Album not found');
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
}

return {
    id: 'tidal',
    name: 'Tidal Music',
    version: '1.0.0',
    searchTracks,
    getTrackStreamUrl,
    getAlbum
};
`;
