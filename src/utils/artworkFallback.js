import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } from '../config/envConfig.js';

/**
 * Artwork Fallback Utility
 * Fetches album artwork from Spotify when Tidal artwork is missing
 * Includes cache versioning to prevent corruption on app updates
 */

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_SEARCH_URL = 'https://api.spotify.com/v1/search';

const CACHE_DIR = `${FileSystem.documentDirectory}artwork_cache/`;
const CACHE_VERSION_FILE = `${FileSystem.documentDirectory}artwork_cache/version.json`;
const CURRENT_CACHE_VERSION = Constants.expoConfig?.version || '1.0.0';

let spotifyAccessToken = null;
let spotifyAccessTokenExpiresAt = 0;
let cacheInitialized = false;

/**
 * Validate that a cached file is a valid image
 */
async function validateCachedImage(filePath) {
    try {
        const fileInfo = await FileSystem.getInfoAsync(filePath);
        if (!fileInfo.exists) return false;
        
        // Check file size - should be at least 1KB for a valid image
        if (fileInfo.size < 1024) {
            console.warn('[Artwork Cache] File too small, likely corrupted:', filePath);
            return false;
        }
        
        // File exists and has reasonable size
        return true;
    } catch (error) {
        console.warn('[Artwork Cache] Error validating file:', error);
        return false;
    }
}

/**
 * Clear all cached artwork files
 */
async function clearArtworkCache() {
    try {
        const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
        if (dirInfo.exists) {
            console.log('[Artwork Cache] Clearing cache directory...');
            await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
        }
        cacheInitialized = false; // Reset to force reinitialization
    } catch (error) {
        console.error('[Artwork Cache] Error clearing cache:', error);
    }
}

/**
 * Public function to manually clear artwork cache
 */
export async function clearArtworkCacheManually() {
    await clearArtworkCache();
    console.log('[Artwork Cache] Manual cache clear complete');
}

/**
 * Initialize cache directory and handle versioning
 */
async function ensureCacheDir() {
    if (cacheInitialized) return;
    
    try {
        // Ensure directory exists
        const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
        if (!dirInfo.exists) {
            await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
            // Write version file for new cache
            await FileSystem.writeAsStringAsync(
                CACHE_VERSION_FILE,
                JSON.stringify({ version: CURRENT_CACHE_VERSION, createdAt: Date.now() })
            );
            console.log('[Artwork Cache] Created new cache with version:', CURRENT_CACHE_VERSION);
            cacheInitialized = true;
            return;
        }
        
        // Check cache version
        const versionFileInfo = await FileSystem.getInfoAsync(CACHE_VERSION_FILE);
        if (!versionFileInfo.exists) {
            // Old cache without version - clear it
            console.log('[Artwork Cache] No version file found, clearing old cache...');
            await clearArtworkCache();
            await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
            await FileSystem.writeAsStringAsync(
                CACHE_VERSION_FILE,
                JSON.stringify({ version: CURRENT_CACHE_VERSION, createdAt: Date.now() })
            );
            console.log('[Artwork Cache] Cache cleared and versioned');
        } else {
            // Check if version matches
            const versionData = JSON.parse(await FileSystem.readAsStringAsync(CACHE_VERSION_FILE));
            if (versionData.version !== CURRENT_CACHE_VERSION) {
                console.log(`[Artwork Cache] Version mismatch (${versionData.version} -> ${CURRENT_CACHE_VERSION}), clearing cache...`);
                await clearArtworkCache();
                await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
                await FileSystem.writeAsStringAsync(
                    CACHE_VERSION_FILE,
                    JSON.stringify({ version: CURRENT_CACHE_VERSION, createdAt: Date.now() })
                );
                console.log('[Artwork Cache] Cache cleared due to version change');
            } else {
                console.log('[Artwork Cache] Cache version valid:', CURRENT_CACHE_VERSION);
            }
        }
        
        cacheInitialized = true;
    } catch (error) {
        console.error('[Artwork Cache] Error during cache initialization:', error);
        // Try to recover by creating fresh cache
        try {
            await clearArtworkCache();
            await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
            await FileSystem.writeAsStringAsync(
                CACHE_VERSION_FILE,
                JSON.stringify({ version: CURRENT_CACHE_VERSION, createdAt: Date.now() })
            );
            cacheInitialized = true;
        } catch (recoveryError) {
            console.error('[Artwork Cache] Failed to recover cache:', recoveryError);
        }
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
export async function getArtworkWithFallback(track, forceRefresh = false) {
    try {
        await ensureCacheDir();
        const cachePath = getCachePath(track);
        
        if (!forceRefresh) {
            // Check if cached file exists and is valid
            const isValid = await validateCachedImage(cachePath);
            if (isValid) {
                console.log('[Artwork Fallback] Found valid cached artwork:', cachePath);
                return [
                    { '#text': cachePath, size: 'extralarge' },
                    { '#text': cachePath, size: 'large' },
                    { '#text': cachePath, size: 'medium' },
                    { '#text': cachePath, size: 'small' },
                ];
            }
        } else {
            console.log('[Artwork Fallback] Force refresh requested, ignoring/clearing cache');
            const info = await FileSystem.getInfoAsync(cachePath);
            if (info.exists) {
                await FileSystem.deleteAsync(cachePath, { idempotent: true });
            }
        }

        // Clean up if invalid file exists (from !forceRefresh path failing validation)
        if (await FileSystem.getInfoAsync(cachePath).then(info => info.exists)) {
            // File exists but is invalid - delete it
            console.log('[Artwork Fallback] Removing corrupted cache file:', cachePath);
            await FileSystem.deleteAsync(cachePath, { idempotent: true });
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
                try {
                    console.log('[Artwork Fallback] Downloading artwork to cache...');
                    const downloadResult = await FileSystem.downloadAsync(largestImage['#text'], cachePath);
                    
                    // Validate the downloaded file
                    if (await validateCachedImage(cachePath)) {
                        console.log('[Artwork Fallback] Artwork cached successfully');
                        return [
                            { '#text': cachePath, size: 'extralarge' },
                            { '#text': cachePath, size: 'large' },
                            { '#text': cachePath, size: 'medium' },
                            { '#text': cachePath, size: 'small' },
                        ];
                    } else {
                        console.warn('[Artwork Fallback] Downloaded file validation failed, using URL');
                        await FileSystem.deleteAsync(cachePath, { idempotent: true });
                        return spotifyArtwork;
                    }
                } catch (downloadError) {
                    console.error('[Artwork Fallback] Download failed:', downloadError);
                    return spotifyArtwork;
                }
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
