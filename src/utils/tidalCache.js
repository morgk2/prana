import * as FileSystem from 'expo-file-system/legacy';

// Use a file inside the library directory
const LIBRARY_DIR = FileSystem.documentDirectory + 'library';
const CACHE_FILE = LIBRARY_DIR + '/tidal_cache.json';

let memoryCache = null;

/**
 * Ensure cache is loaded into memory
 */
export const loadCache = async () => {
    if (memoryCache) return memoryCache;

    try {
        // Ensure directory exists
        const dirInfo = await FileSystem.getInfoAsync(LIBRARY_DIR);
        if (!dirInfo.exists) {
            await FileSystem.makeDirectoryAsync(LIBRARY_DIR, { intermediates: true });
        }

        const info = await FileSystem.getInfoAsync(CACHE_FILE);
        if (info.exists) {
            const content = await FileSystem.readAsStringAsync(CACHE_FILE);
            memoryCache = JSON.parse(content);
        } else {
            memoryCache = {};
        }
    } catch (e) {
        console.warn('[TidalCache] Failed to load cache', e);
        memoryCache = {};
    }
    return memoryCache;
};

/**
 * Get cached track data
 * @param {string} trackId - Tidal track ID
 * @returns {Object|null} Cached track object with uri
 */
export const getCachedTrack = async (trackId) => {
    if (!memoryCache) await loadCache();
    
    const cached = memoryCache[trackId];
    if (!cached) return null;

    // Optional: Check expiration?
    // Tidal links might expire. If we encounter expiration issues, we can add a TTL check here.
    // For now, we rely on the player retrying if the link fails.
    
    return cached;
};

/**
 * Get cached track data by metadata (name and artist)
 * @param {string} name - Track name
 * @param {string} artist - Artist name
 * @returns {Object|null} Cached track object
 */
export const getCachedTrackByMetadata = async (name, artist) => {
    if (!memoryCache) await loadCache();
    
    if (!name || !artist) return null;

    const targetName = name.toLowerCase().trim();
    const targetArtist = artist.toLowerCase().trim();

    // Iterate through cache to find a match
    // Since memoryCache is keyed by ID, we need to check values
    for (const key in memoryCache) {
        const track = memoryCache[key];
        if (track && track.name && track.artist) {
            const trackName = track.name.toLowerCase().trim();
            const trackArtist = track.artist.toLowerCase().trim();

            // Simple exact or includes match
            // We check if our target names match the cached names
            if (trackName === targetName && trackArtist.includes(targetArtist)) {
                // console.log('[TidalCache] Found cache match by metadata:', name);
                return track;
            }
            
            // Also check reverse includes for artist
            if (trackName === targetName && targetArtist.includes(trackArtist)) {
                 // console.log('[TidalCache] Found cache match by metadata:', name);
                 return track;
            }
        }
    }

    return null;
};

/**
 * Save track to cache
 * @param {string} trackId - Tidal track ID
 * @param {Object} trackData - Track data including streamUrl/uri
 */
export const saveToCache = async (trackId, trackData) => {
    if (!memoryCache) await loadCache();
    
    memoryCache[trackId] = {
        ...trackData,
        cachedAt: Date.now()
    };
    
    try {
        await FileSystem.writeAsStringAsync(CACHE_FILE, JSON.stringify(memoryCache));
        // console.log('[TidalCache] Saved track to cache:', trackId);
    } catch (e) {
        console.warn('[TidalCache] Failed to save cache', e);
    }
};

/**
 * Remove track from cache
 * @param {string} trackId 
 */
export const removeFromCache = async (trackId) => {
    if (!memoryCache) await loadCache();
    
    if (memoryCache[trackId]) {
        delete memoryCache[trackId];
        try {
            await FileSystem.writeAsStringAsync(CACHE_FILE, JSON.stringify(memoryCache));
            console.log('[TidalCache] Removed track from cache:', trackId);
        } catch (e) {
            console.warn('[TidalCache] Failed to save cache after delete', e);
        }
    }
};

/**
 * Clear entire cache
 */
export const clearCache = async () => {
    memoryCache = {};
    try {
        await FileSystem.deleteAsync(CACHE_FILE, { idempotent: true });
    } catch (e) {
        console.warn('[TidalCache] Failed to clear cache', e);
    }
};
