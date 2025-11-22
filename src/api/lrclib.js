
const BASE_URL = 'https://lrclib.net/api';

/**
 * Fetch lyrics from LRCLIB
 * @param {Object} params
 * @param {string} [params.isrc]
 * @param {string} [params.trackName]
 * @param {string} [params.artistName]
 * @param {string} [params.albumName]
 * @param {number} [params.duration] - Duration in seconds
 * @returns {Promise<Object|null>} Returns object with plainLyrics and syncedLyrics, or null
 */
export async function getLyrics({ isrc, trackName, artistName, albumName, duration }) {
    try {
        // 1. Try getting by ISRC if available
        if (isrc) {
            const url = `${BASE_URL}/get?isrc=${encodeURIComponent(isrc)}`;
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                if (data && (data.plainLyrics || data.syncedLyrics)) {
                    return data;
                }
            }
        }

        // 2. Fallback to search
        // LRCLIB search endpoint requires at least track_name and artist_name for best results
        if (!trackName || !artistName) return null;

        const queryParams = new URLSearchParams({
            track_name: trackName,
            artist_name: artistName,
        });

        if (albumName) queryParams.append('album_name', albumName);
        if (duration) queryParams.append('duration', Math.round(duration));

        const searchUrl = `${BASE_URL}/get?${queryParams.toString()}`;
        const searchResponse = await fetch(searchUrl);

        if (searchResponse.ok) {
            const data = await searchResponse.json();
            if (data && (data.plainLyrics || data.syncedLyrics)) {
                return data;
            }
        }

        // If /get fails (404), try /search to find a close match
        const generalSearchUrl = `${BASE_URL}/search?q=${encodeURIComponent(`${trackName} ${artistName}`)}`;
        const generalResponse = await fetch(generalSearchUrl);

        if (generalResponse.ok) {
            const list = await generalResponse.json();
            if (Array.isArray(list) && list.length > 0) {
                // Find best match? For now just take the first one that has lyrics
                const match = list.find(item => item.plainLyrics || item.syncedLyrics);
                return match || null;
            }
        }

        return null;
    } catch (error) {
        console.warn('Error fetching lyrics:', error);
        return null;
    }
}
