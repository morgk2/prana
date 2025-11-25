export const SPARTDL_MODULE_CODE = `
/**
 * SpartDL Module (Spotify Downloads via SpartDL API)
 * Direct Spotify track downloads using SpartDL service
 */

const SPARTDL_API_URLS = [
    'https://spartdl-production.up.railway.app/get/audio-download-link',
    'https://spartdl.fly.dev/get/audio-download-link'
];

const SPOTIFY_CLIENT_ID = '3b04b56282cf497fbc68c6bf8cb51438';
const SPOTIFY_CLIENT_SECRET = 'b89842acfa4d4ec4ad55bdac57a1e4a2';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_SEARCH_URL = 'https://api.spotify.com/v1/search';

let spotifyAccessToken = null;
let spotifyAccessTokenExpiresAt = 0;

function encodeBasicAuth(id, secret) {
    const raw = \`\${id}:\${secret}\`;
    if (typeof btoa !== 'undefined') {
        return btoa(raw);
    }
    throw new Error('No base64 encoder available');
}

async function getSpotifyToken() {
    const now = Date.now();
    if (spotifyAccessToken && now < spotifyAccessTokenExpiresAt - 60000) {
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
        throw new Error(\`Spotify auth error \${res.status}\`);
    }

    const json = await res.json();
    spotifyAccessToken = json.access_token;
    spotifyAccessTokenExpiresAt = Date.now() + (json.expires_in || 3600) * 1000;
    return spotifyAccessToken;
}

async function searchTracks(query, limit = 20) {
    try {
        // 1. If query is a Spotify Link, return it directly
        if (query.includes('open.spotify.com/track/')) {
             return {
                tracks: [{
                    id: query.trim(),
                    title: 'Spotify Link',
                    artist: 'Unknown',
                    album: 'Unknown',
                    duration: 0,
                    audioQuality: 'HIGH',
                }],
                total: 1,
            };
        }

        // 2. Otherwise, search Spotify API
        const token = await getSpotifyToken();
        const url = \`\${SPOTIFY_SEARCH_URL}?q=\${encodeURIComponent(query)}&type=track&limit=\${limit}\`;
        
        const res = await fetch(url, {
            headers: { 'Authorization': \`Bearer \${token}\` }
        });

        if (!res.ok) throw new Error(\`Spotify Search Error: \${res.status}\`);

        const data = await res.json();
        const items = data.tracks?.items || [];

        const tracks = items.map(item => ({
            id: item.external_urls.spotify, // USE SPOTIFY URL AS ID
            title: item.name,
            artist: item.artists.map(a => a.name).join(', '),
            album: item.album.name,
            albumCover: item.album.images[0]?.url,
            duration: Math.floor(item.duration_ms / 1000),
            audioQuality: 'HIGH',
            originalId: item.id // Keep original ID just in case
        }));

        return {
            tracks,
            total: data.tracks?.total || tracks.length
        };

    } catch (error) {
        console.error('[SpartDL] Search failed:', error);
        return { tracks: [], total: 0 };
    }
}

async function getTrackStreamUrl(trackId, preferredQuality = 'mp3') {
    const cleanId = trackId.trim();
    let lastError = null;

    // Extract Spotify track ID from URL to get metadata
    let spotifyTrackId = null;
    let originalTrackInfo = null;
    
    try {
        // Try to get track info from Spotify API first to preserve duration
        if (cleanId.includes('open.spotify.com/track/')) {
            const urlParts = cleanId.split('/');
            spotifyTrackId = urlParts[urlParts.length - 1].split('?')[0];
            
            const token = await getSpotifyToken();
            const trackUrl = \`https://api.spotify.com/v1/tracks/\${spotifyTrackId}\`;
            
            const trackRes = await fetch(trackUrl, {
                headers: { 'Authorization': \`Bearer \${token}\` }
            });

            if (trackRes.ok) {
                const trackData = await trackRes.json();
                originalTrackInfo = {
                    title: trackData.name,
                    artist: trackData.artists.map(a => a.name).join(', '),
                    album: trackData.album.name,
                    duration: Math.floor(trackData.duration_ms / 1000),
                    albumCover: trackData.album.images[0]?.url
                };
                console.log('[SpartDL] Retrieved track metadata from Spotify API');
            }
        }
    } catch (metadataError) {
        console.warn('[SpartDL] Failed to get track metadata:', metadataError.message);
        // Continue without metadata - will use fallback values
    }

    // Try each API endpoint in order
    for (const apiUrl of SPARTDL_API_URLS) {
        try {
            console.log(\`[SpartDL] Requesting download from \${apiUrl} for:\`, cleanId);
            
            // Call SpartDL API without timeout
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    spotify_url: cleanId,
                    format: 'mp3' // Force MP3 format for iOS compatibility
                })
            });

            if (!response.ok) {
                throw new Error(\`SpartDL API error: \${response.status}\`);
            }

            const data = await response.json();
            console.log('[SpartDL] API Response:', JSON.stringify(data).substring(0, 200) + '...');

            if (!data.audio_download_url) {
                throw new Error('No download URL in SpartDL response');
            }

            // Validate the download URL
            if (typeof data.audio_download_url !== 'string' || !data.audio_download_url.startsWith('http')) {
                throw new Error('Invalid download URL in SpartDL response');
            }

            // Convert HTTP to HTTPS for iOS compatibility
            let streamUrl = data.audio_download_url;
            if (streamUrl.startsWith('http://')) {
                streamUrl = streamUrl.replace('http://', 'https://');
                console.log('[SpartDL] Converted HTTP to HTTPS for iOS compatibility');
            }

            // Use Spotify metadata if available, otherwise extract from filename
            let trackTitle = originalTrackInfo?.title || 'Downloaded Track';
            let trackArtist = originalTrackInfo?.artist || 'SpartDL';
            let trackAlbum = originalTrackInfo?.album || 'Unknown Album';
            let trackDuration = originalTrackInfo?.duration || 0;
            
            if (data.filename && !originalTrackInfo) {
                // Parse "Artist - Title" from filename only if we don't have Spotify metadata
                const nameWithoutExt = data.filename.replace(/\.[^/.]+$/, '');
                const parts = nameWithoutExt.split(' - ');
                if (parts.length >= 2) {
                    trackArtist = parts[0].trim();
                    trackTitle = parts.slice(1).join(' - ').trim();
                } else {
                    trackTitle = nameWithoutExt.trim();
                }
            }

            return {
                streamUrl: streamUrl, // Use HTTPS-converted URL
                track: {
                    id: cleanId,
                    title: trackTitle,
                    artist: trackArtist,
                    audioQuality: 'HIGH' // Simplified like YTDL
                }
            };
        } catch (error) {
            console.warn(\`[SpartDL] API \${apiUrl} failed:\`, error.message);
            lastError = error;
            // Continue to next API endpoint on error
        }
    }

    // All endpoints failed
    console.warn('[SpartDL] All endpoints failed, last error:', lastError.message);
    throw lastError || new Error('All SpartDL endpoints failed');
}

async function getAlbum(albumId) {
    throw new Error('Album fetching not supported by SpartDL module');
}

async function getArtist(artistId) {
    throw new Error('Artist fetching not supported by SpartDL module');
}

return {
    id: 'spartdl',
    name: 'SpartDL (Spotify Downloads)',
    version: '1.2.1',
    labels: ["I'm hosting it on a potato", "Great for downloading"],
    searchTracks,
    getTrackStreamUrl,
    getAlbum,
    getArtist
};
`;
