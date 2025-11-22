import * as FileSystem from 'expo-file-system/legacy';
import { getLyrics } from '../api/lrclib';

const CACHE_DIR = `${FileSystem.documentDirectory}lyrics_cache/`;

// Ensure cache directory exists
async function ensureCacheDir() {
    const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
    if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
    }
}

// Generate cache key from track info
function getCacheKey(track) {
    const artist = track?.artist?.name ?? track?.artist ?? '';
    const name = track?.name ?? '';
    const album = track?.album?.title ?? track?.album ?? '';

    // Create a sanitized filename
    const sanitized = `${artist}_${name}_${album}`
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase()
        .substring(0, 200); // Limit length

    return `${sanitized}.lrc`;
}

// Get cache file path
function getCachePath(track) {
    return `${CACHE_DIR}${getCacheKey(track)}`;
}

// Check if lyrics are cached
export async function getCachedLyrics(track) {
    try {
        await ensureCacheDir();
        const cachePath = getCachePath(track);
        const fileInfo = await FileSystem.getInfoAsync(cachePath);

        if (fileInfo.exists) {
            const content = await FileSystem.readAsStringAsync(cachePath);
            return content;
        }
        return null;
    } catch (error) {
        console.warn('Error reading cached lyrics:', error);
        return null;
    }
}

// Cache lyrics to disk
export async function cacheLyrics(track, lyricsContent) {
    try {
        await ensureCacheDir();
        const cachePath = getCachePath(track);
        await FileSystem.writeAsStringAsync(cachePath, lyricsContent);
        return true;
    } catch (error) {
        console.warn('Error caching lyrics:', error);
        return false;
    }
}

// Fetch and cache lyrics
export async function fetchAndCacheLyrics(track) {
    try {
        // Check cache first
        const cached = await getCachedLyrics(track);
        if (cached) {
            return cached;
        }

        // Fetch from API using getLyrics
        const result = await getLyrics({
            isrc: track?.isrc,
            trackName: track?.name,
            artistName: track?.artist?.name ?? track?.artist,
            albumName: track?.album?.title ?? track?.album,
            duration: track?.duration,
        });

        if (result?.syncedLyrics) {
            // Cache the lyrics
            await cacheLyrics(track, result.syncedLyrics);
            return result.syncedLyrics;
        } else if (result?.plainLyrics) {
            // Cache plain lyrics if synced not available
            await cacheLyrics(track, result.plainLyrics);
            return result.plainLyrics;
        }

        return null;
    } catch (error) {
        console.warn('Error fetching and caching lyrics:', error);
        return null;
    }
}

// Preload lyrics for a track (non-blocking)
export function preloadLyrics(track) {
    if (!track) return;

    // Run in background, don't wait for result
    fetchAndCacheLyrics(track).catch(err => {
        console.warn('Background lyrics preload failed:', err);
    });
}

// Preload lyrics for multiple tracks (e.g., queue)
export function preloadQueueLyrics(queue, currentIndex, lookahead = 3) {
    if (!queue || queue.length === 0) return;

    // Preload current track and next few tracks
    const startIndex = Math.max(0, currentIndex);
    const endIndex = Math.min(queue.length, currentIndex + lookahead + 1);

    for (let i = startIndex; i < endIndex; i++) {
        if (queue[i]) {
            preloadLyrics(queue[i]);
        }
    }
}

// Clear old cache (optional - call this periodically to manage storage)
export async function clearOldCache(daysOld = 30) {
    try {
        await ensureCacheDir();
        const files = await FileSystem.readDirectoryAsync(CACHE_DIR);
        const now = Date.now();
        const maxAge = daysOld * 24 * 60 * 60 * 1000;

        for (const file of files) {
            const filePath = `${CACHE_DIR}${file}`;
            const info = await FileSystem.getInfoAsync(filePath);

            if (info.exists && info.modificationTime) {
                const age = now - info.modificationTime * 1000;
                if (age > maxAge) {
                    await FileSystem.deleteAsync(filePath);
                }
            }
        }
    } catch (error) {
        console.warn('Error clearing old cache:', error);
    }
}
