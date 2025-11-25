export const YTDL_MODULE_CODE = `
/**
 * YTDL Module (PaxSenix + Spotify Search)
 * Search Spotify, then stream via PaxSenix/YouTube
 */

const API_BASE = 'https://api.paxsenix.org';
const API_KEY = 'sk-paxsenix-BsjVL0-o7w0TEZhzSxcFCkispUuWMQ_cGfRWa6JMxGlOJxox';

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
    // Fallback for environments without btoa (rare in RN, but safe)
    // Assuming standard RN env, btoa should exist.
    // If not, we can't easily fallback without buffer.
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

// List of proxies for rotation (Direct + CORS proxies to change IP)
const PROXIES = [
    null, // Direct connection (Primary)
    'https://corsproxy.io/?', // Public CORS proxy (Secondary IP)
    // Add more web proxies here if needed
];

async function fetchWithAuth(url) {
    let lastError = null;

    for (const proxy of PROXIES) {
        try {
            // Construct URL: Direct or via Proxy
            // For corsproxy.io, we append the target URL directly
            const requestUrl = proxy ? \`\${proxy}\${url}\` : url;
            
            if (proxy) {
                console.log(\`[YTDL] Retrying via proxy: \${proxy}\`);
            }

            const response = await fetch(requestUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': \`Bearer \${API_KEY}\`,
                    // Add origin header if using proxy to be safe
                    ...(proxy ? { 'Origin': 'http://localhost' } : {})
                }
            });

            if (!response.ok) {
                // Check for rate limits or auth errors
                if (response.status === 429 || response.status === 401) {
                    console.warn(\`[YTDL] Rate limit/Auth error (\${response.status}) on \${proxy ? 'proxy' : 'direct'}, rotating...\`);
                    continue; // Try next proxy
                }

                // Check for specific "try after" message in body if possible
                const text = await response.text();
                try {
                    const json = JSON.parse(text);
                    if (json.message && json.message.toLowerCase().includes('try after')) {
                        console.warn(\`[YTDL] Rate limit message detected: "\${json.message}", rotating...\`);
                        continue;
                    }
                    // If other error, throw it
                    throw new Error(json.message || \`API Error: \${response.status}\`);
                } catch (e) {
                    throw new Error(\`API Error: \${response.status} \${text}\`);
                }
            }

            return response.json();

        } catch (error) {
            console.warn(\`[YTDL] Request failed via \${proxy || 'direct'}:\`, error.message);
            lastError = error;
            // Continue to next proxy on network errors
        }
    }

    throw lastError || new Error('All proxies failed');
}

async function tryService(serviceName, encodedUrl) {
     const apiUrl = \`\${API_BASE}/dl/spotify?url=\${encodedUrl}&serv=\${serviceName}\`;
     console.log(\`[YTDL] Requesting (\${serviceName}):\`, apiUrl);
     
     const data = await fetchWithAuth(apiUrl);
     console.log(\`[YTDL] Response (\${serviceName}):\`, JSON.stringify(data).substring(0, 200) + '...');
    
     if (!data.ok && !data.url && !data.directUrl) {
         throw new Error(data.message || \`Failed to resolve stream via \${serviceName}\`);
     }
     return data.directUrl || data.url;
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
        console.error('[YTDL] Search failed:', error);
        return { tracks: [], total: 0 };
    }
}

async function getTrackStreamUrl(trackId, preferredQuality) {
    const cleanId = trackId.trim();
    const encodedUrl = encodeURIComponent(cleanId);

    try {
        let streamUrl;
        
        try {
            // Primary: spotdl (direct MP3s)
            streamUrl = await tryService('spotdl', encodedUrl);
        } catch (e) {
            console.warn('[YTDL] spotdl failed, trying deezer fallback:', e.message);
            // Fallback: deezer
            streamUrl = await tryService('deezer', encodedUrl);
        }
        
        if (!streamUrl) {
             throw new Error('No stream URL in response');
        }
        
        console.log('[YTDL] Stream URL found:', streamUrl); 

        return {
            streamUrl: streamUrl,
            track: {
                id: cleanId,
                title: 'Resolved Track', 
                artist: 'YTDL', 
                audioQuality: 'HIGH'
            }
        };
    } catch (error) {
        // Log as warning instead of error since this might be a retryable failure
        console.warn('[YTDL] Stream resolution failed:', error.message); 
        throw error;
    }
}

async function getAlbum(albumId) {
    throw new Error('Album fetching not supported by YTDL module');
}

async function getArtist(artistId) {
    throw new Error('Artist fetching not supported by YTDL module');
}

return {
    id: 'ytdl',
    name: 'YTDL (Spotify Search)',
    version: '1.6.0',
    labels: ['Fast', 'Perfect for streaming'],
    searchTracks,
    getTrackStreamUrl,
    getAlbum,
    getArtist
};
`;
