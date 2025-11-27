export const HIFI_MORGK_MODULE_CODE = `
/**
 * HIFI MORGK - Pre-configured Subsonic Server
 * High-quality lossless music streaming from morgk's personal server
 */

// Pre-configured server credentials
let SUBSONIC_SERVER_URL = 'https://api.401658.xyz';
let SUBSONIC_USERNAME = 'morgk';
let SUBSONIC_PASSWORD = 'moumendz';

// API version
const CLIENT_NAME = '8SPINE';

/**
 * Build authenticated Subsonic API URL
 */
function buildSubsonicUrl(endpoint, params = {}) {
    // Use legacy authentication (API v1.12.0 or earlier)
    const baseParams = {
        u: SUBSONIC_USERNAME,
        p: SUBSONIC_PASSWORD,
        v: '1.12.0',
        c: CLIENT_NAME,
        f: 'json'
    };
    
    const allParams = { ...baseParams, ...params };
    const queryString = Object.keys(allParams)
        .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(allParams[key]))
        .join('&');
    
    // Ensure server URL doesn't end with slash
    let serverUrl = SUBSONIC_SERVER_URL;
    if (serverUrl.charAt(serverUrl.length - 1) === '/') {
        serverUrl = serverUrl.slice(0, -1);
    }
    // Add .view extension if not present
    let viewEndpoint = endpoint;
    if (viewEndpoint.indexOf('.view') === -1) {
        viewEndpoint = viewEndpoint + '.view';
    }
    return serverUrl + '/rest/' + viewEndpoint + '?' + queryString;
}

/**
 * Make API request to Subsonic server
 */
async function subsonicRequest(endpoint, params = {}) {
    try {
        const url = buildSubsonicUrl(endpoint, params);
        console.log('[HIFI MORGK] Requesting:', endpoint);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('HTTP ' + response.status + ': ' + response.statusText);
        }
        
        const data = await response.json();
        
        // Check for Subsonic API errors
        if (data['subsonic-response']?.status === 'failed') {
            const error = data['subsonic-response']?.error;
            throw new Error(error?.message || 'Subsonic API error');
        }
        
        return data['subsonic-response'];
    } catch (error) {
        console.error('[HIFI MORGK] Request failed:', error);
        throw error;
    }
}

/**
 * Test connection to Subsonic server
 */
async function ping() {
    const response = await subsonicRequest('ping');
    return response.status === 'ok';
}

/**
 * Search for tracks
 */
async function searchTracks(query, limit = 50) {
    try {
        const response = await subsonicRequest('search3', {
            query: query,
            songCount: limit,
            songOffset: 0,
            artistCount: 0,
            albumCount: 0
        });
        
        const songs = response.searchResult3?.song || [];
        
        return {
            tracks: songs.map(song => ({
                id: song.id,
                title: song.title || 'Unknown Title',
                artist: song.artist || 'Unknown Artist',
                artistId: song.artistId,
                album: song.album || 'Unknown Album',
                albumId: song.albumId,
                albumCover: song.coverArt ? buildSubsonicUrl('getCoverArt', { id: song.coverArt, size: 300 }) : null,
                duration: song.duration || 0,
                audioQuality: song.bitRate ? (song.bitRate + ' kbps') : 'LOSSLESS',
                track: song.track,
                year: song.year,
                genre: song.genre,
                contentType: song.contentType,
                suffix: song.suffix
            })),
            total: songs.length,
            limit: limit,
            offset: 0
        };
    } catch (error) {
        console.error('[HIFI MORGK] Search failed:', error);
        throw error;
    }
}

/**
 * Get stream URL for a track
 */
async function getTrackStreamUrl(trackId, preferredQuality = 'LOSSLESS') {
    try {
        // For Subsonic, we can directly construct the stream URL
        const streamUrl = buildSubsonicUrl('stream', { 
            id: trackId,
            format: 'raw'
        });
        
        // Get track info for metadata
        const response = await subsonicRequest('getSong', { id: trackId });
        const song = response.song;
        
        return {
            streamUrl: streamUrl,
            track: {
                id: song.id,
                title: song.title || 'Unknown Title',
                artist: song.artist || 'Unknown Artist',
                album: song.album || 'Unknown Album',
                albumCover: song.coverArt ? buildSubsonicUrl('getCoverArt', { id: song.coverArt, size: 500 }) : null,
                duration: song.duration || 0,
                audioQuality: song.bitRate ? (song.bitRate + ' kbps') : 'LOSSLESS'
            }
        };
    } catch (error) {
        console.error('[HIFI MORGK] Failed to get stream URL:', error);
        throw error;
    }
}

/**
 * Get album details
 */
async function getAlbum(albumId) {
    try {
        const response = await subsonicRequest('getAlbum', { id: albumId });
        const album = response.album;
        
        const tracks = (album.song || []).map(song => ({
            id: song.id,
            title: song.title || 'Unknown Title',
            artist: song.artist || album.artist || 'Unknown Artist',
            artistId: song.artistId || album.artistId,
            album: album.name,
            albumId: album.id,
            albumCover: album.coverArt ? buildSubsonicUrl('getCoverArt', { id: album.coverArt, size: 500 }) : null,
            duration: song.duration || 0,
            track: song.track,
            year: song.year || album.year,
            genre: song.genre || album.genre
        }));
        
        return {
            album: {
                id: album.id,
                title: album.name,
                artist: album.artist || 'Unknown Artist',
                artistId: album.artistId,
                cover: album.coverArt ? buildSubsonicUrl('getCoverArt', { id: album.coverArt, size: 500 }) : null,
                year: album.year,
                genre: album.genre,
                songCount: album.songCount || tracks.length,
                duration: album.duration
            },
            tracks: tracks
        };
    } catch (error) {
        console.error('[HIFI MORGK] Failed to get album:', error);
        throw error;
    }
}

/**
 * Get artist details
 */
async function getArtist(artistId) {
    try {
        const response = await subsonicRequest('getArtist', { id: artistId });
        const artist = response.artist;
        
        const albums = (artist.album || []).map(album => ({
            id: album.id,
            name: album.name,
            artist: artist.name,
            artistId: artist.id,
            coverArt: album.coverArt ? buildSubsonicUrl('getCoverArt', { id: album.coverArt, size: 300 }) : null,
            songCount: album.songCount,
            duration: album.duration,
            year: album.year,
            genre: album.genre
        }));
        
        return {
            artist: {
                id: artist.id,
                name: artist.name,
                albumCount: artist.albumCount || albums.length,
                coverArt: artist.coverArt ? buildSubsonicUrl('getCoverArt', { id: artist.coverArt, size: 500 }) : null
            },
            albums: albums
        };
    } catch (error) {
        console.error('[HIFI MORGK] Failed to get artist:', error);
        throw error;
    }
}

// Export module interface
return {
    id: 'hifi-morgk',
    name: 'HIFI MORGK',
    version: '1.0.0',
    labels: ['PERFECT', 'LOSSLESS', 'STREAM & DOWNLOAD'],
    
    // Core functionality
    ping: ping,
    searchTracks: searchTracks,
    getTrackStreamUrl: getTrackStreamUrl,
    getAlbum: getAlbum,
    getArtist: getArtist
};
`;
