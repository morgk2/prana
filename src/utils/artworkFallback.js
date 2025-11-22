import * as FileSystem from 'expo-file-system/legacy';

/**
 * Artwork Fallback Utility
 * Fetches album artwork from Spotify when Tidal artwork is missing
 */

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_SEARCH_URL = 'https://api.spotify.com/v1/search';
const SPOTIFY_CLIENT_ID = '3b04b56282cf497fbc68c6bf8cb51438';
const SPOTIFY_CLIENT_SECRET = 'b89842acfa4d4ec4ad55bdac57a1e4a2';

const CACHE_DIR = `${FileSystem.documentDirectory}artwork_cache/`;

let spotifyAccessToken = null;
let spotifyAccessTokenExpiresAt = 0;

async function ensureCacheDir() {
    const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
    if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
    }
}

function getCacheKey(track) {
    const artist = typeof track.artist === 'object' ? track.artist.name : track.artist || 'Unknown Artist';
    const album = typeof track.album === 'object' ? track.album.title : track.album || 'Unknown Album';
    // Use album as primary key since artwork is usually per-album
    const sanitized = `${artist}_${album}`
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase();
    return `${sanitized}.jpg`;
}

function getCachePath(track) {
    return `${CACHE_DIR}${getCacheKey(track)}`;
}

function encodeBasicAuth(id, secret) {
    const raw = `${id}:${secret}`;
    if (typeof btoa !== 'undefined') {
        return btoa(raw);
    }
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(raw, 'utf8').toString('base64');
    }
    throw new Error('No base64 encoder available');
}

async function getSpotifyToken() {
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
    });

    if (!res.ok) {
        throw new Error(`Spotify auth error ${res.status}`);
    }

    const json = await res.json();
    spotifyAccessToken = json.access_token;
    spotifyAccessTokenExpiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
    return spotifyAccessToken;
}

/**
 * Search Spotify for a track and get its album artwork
 */
export async function getSpotifyArtwork(trackTitle, artistName, albumName) {
    try {
        const token = await getSpotifyToken();

        // Build search query - prioritize track + artist for best match
        let query = `track:${trackTitle}`;
        if (artistName && artistName !== 'Unknown Artist') {
            query += ` artist:${artistName}`;
        }
        if (albumName && albumName !== 'Unknown Album') {
            query += ` album:${albumName}`;
        }

        const url = new URL(SPOTIFY_SEARCH_URL);
        url.searchParams.set('q', query);
        url.searchParams.set('type', 'track');
        url.searchParams.set('limit', '1');

        console.log('[Artwork Fallback] Searching Spotify:', query);

        const response = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            console.warn('[Artwork Fallback] Spotify search failed:', response.status);
            return null;
        }

        const data = await response.json();
        const track = data.tracks?.items?.[0];

        if (!track || !track.album?.images) {
            console.warn('[Artwork Fallback] No Spotify match found');
            return null;
        }

        // Get the highest quality image (first one is usually largest)
        const images = track.album.images;
        if (images.length === 0) return null;

        console.log('[Artwork Fallback] Found Spotify artwork:', images[0].url);

        // Return in Last.fm style format for compatibility
        return images.map((img, index) => ({
            '#text': img.url,
            size: index === 0 ? 'extralarge' : index === images.length - 1 ? 'small' : 'large',
        }));
    } catch (error) {
        console.error('[Artwork Fallback] Error fetching Spotify artwork:', error);
        return null;
    }
}

/**
 * Get artwork with fallback chain: Cache -> Spotify -> Cache
 */
export async function getArtworkWithFallback(track) {
    try {
        await ensureCacheDir();
        const cachePath = getCachePath(track);
        const fileInfo = await FileSystem.getInfoAsync(cachePath);

        if (fileInfo.exists) {
            console.log('[Artwork Fallback] Found cached artwork:', cachePath);
            return [
                { '#text': cachePath, size: 'extralarge' },
                { '#text': cachePath, size: 'large' },
                { '#text': cachePath, size: 'medium' },
                { '#text': cachePath, size: 'small' },
            ];
        }

        // Always try Spotify first as requested
        const spotifyArtwork = await getSpotifyArtwork(
            track.name || track.title,
            typeof track.artist === 'object' ? track.artist.name : track.artist,
            typeof track.album === 'object' ? track.album.title : track.album
        );

        if (spotifyArtwork && spotifyArtwork.length > 0) {
            // Download and cache the largest image
            const largestImage = spotifyArtwork.find(img => img.size === 'extralarge') || spotifyArtwork[0];
            if (largestImage && largestImage['#text']) {
                console.log('[Artwork Fallback] Downloading artwork to cache...');
                await FileSystem.downloadAsync(largestImage['#text'], cachePath);
                console.log('[Artwork Fallback] Artwork cached successfully');

                return [
                    { '#text': cachePath, size: 'extralarge' },
                    { '#text': cachePath, size: 'large' },
                    { '#text': cachePath, size: 'medium' },
                    { '#text': cachePath, size: 'small' },
                ];
            }
            return spotifyArtwork;
        }

        // No artwork found
        return [];
    } catch (error) {
        console.error('[Artwork Fallback] Error in getArtworkWithFallback:', error);
        return [];
    }
}

/**
 * Batch fetch artwork for multiple tracks
 */
export async function batchGetArtwork(tracks, maxConcurrent = 3) {
    const results = [];

    // Process in batches to avoid overwhelming the API
    for (let i = 0; i < tracks.length; i += maxConcurrent) {
        const batch = tracks.slice(i, i + maxConcurrent);
        const batchResults = await Promise.all(
            batch.map(track => getArtworkWithFallback(track))
        );
        results.push(...batchResults);
    }

    return results;
}
