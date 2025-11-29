
const SPOTIFY_CLIENT_ID = '3b04b56282cf497fbc68c6bf8cb51438';
const SPOTIFY_CLIENT_SECRET = 'b89842acfa4d4ec4ad55bdac57a1e4a2';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_URL = 'https://api.spotify.com/v1';

let spotifyAccessToken = null;
let spotifyAccessTokenExpiresAt = 0;

function encodeBasicAuth(id, secret) {
    // Simple base64 encoding for React Native environment
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    const str = `${id}:${secret}`;
    let output = '';

    for (let block = 0, charCode, i = 0, map = chars;
        str.charAt(i | 0) || (map = '=', i % 1);
        output += map.charAt(63 & block >> 8 - i % 1 * 8)) {

        charCode = str.charCodeAt(i += 3 / 4);

        if (charCode > 0xFF) {
            throw new Error("'btoa' failed: The string to be encoded contains characters outside of the Latin1 range.");
        }

        block = block << 8 | charCode;
    }

    return output;
}

async function getSpotifyToken() {
    const now = Date.now();
    if (spotifyAccessToken && now < spotifyAccessTokenExpiresAt - 60000) {
        return spotifyAccessToken;
    }

    try {
        // Use built-in btoa if available, otherwise use polyfill
        const authString = typeof btoa === 'function'
            ? btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)
            : encodeBasicAuth(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET);

        const res = await fetch(SPOTIFY_TOKEN_URL, {
            method: 'POST',
            headers: {
                Authorization: 'Basic ' + authString,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Spotify auth error ${res.status}: ${errText}`);
        }

        const json = await res.json();
        spotifyAccessToken = json.access_token;
        spotifyAccessTokenExpiresAt = Date.now() + (json.expires_in || 3600) * 1000;
        return spotifyAccessToken;
    } catch (error) {
        console.error('Failed to get Spotify token:', error);
        return null;
    }
}

export const getNewReleases = async (limit = 20) => {
    const token = await getSpotifyToken();
    if (!token) return [];

    try {
        const res = await fetch(`${SPOTIFY_API_URL}/browse/new-releases?limit=${limit}&country=US`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error(`Spotify New Releases Error: ${res.status}`);

        const data = await res.json();
        return data.albums?.items || [];
    } catch (error) {
        console.error('Error fetching Spotify new releases:', error);
        return [];
    }
};

export const searchAlbums = async (albumTitle, artistName, limit = 1) => {
    const token = await getSpotifyToken();
    if (!token) return null;

    try {
        // Build search query
        const query = `album:${albumTitle} artist:${artistName}`;
        const encodedQuery = encodeURIComponent(query);
        
        const res = await fetch(`${SPOTIFY_API_URL}/search?q=${encodedQuery}&type=album&limit=${limit}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error(`Spotify Album Search Error: ${res.status}`);

        const data = await res.json();
        return data.albums?.items || [];
    } catch (error) {
        console.error('Error searching Spotify albums:', error);
        return null;
    }
};

export const getSpotifyAlbumDetails = async (albumId) => {
    const token = await getSpotifyToken();
    if (!token) return null;

    try {
        const res = await fetch(`${SPOTIFY_API_URL}/albums/${albumId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error(`Spotify Album Details Error: ${res.status}`);

        return await res.json();
    } catch (error) {
        console.error('Error fetching Spotify album details:', error);
        return null;
    }
};

export const getSpotifyTrackDetails = async (trackId) => {
    const token = await getSpotifyToken();
    if (!token) return null;

    try {
        const res = await fetch(`${SPOTIFY_API_URL}/tracks/${trackId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error(`Spotify Track Details Error: ${res.status}`);

        return await res.json();
    } catch (error) {
        console.error('Error fetching Spotify track details:', error);
        return null;
    }
};

// Scrape a Spotify playlist to get track IDs, then fetch details for a random one
export const scrapeFeaturedPlaylist = async (playlistId) => {
    try {
        const response = await fetch(`https://open.spotify.com/playlist/${playlistId}`);
        const html = await response.text();

        // Regex to find track IDs in the HTML
        // Matches patterns like /track/4cOdK2wGLETKBW3PvgPWqT
        const trackIdRegex = /\/track\/([a-zA-Z0-9]{22})/g;
        const matches = [...html.matchAll(trackIdRegex)];

        if (matches.length === 0) {
            console.warn('No tracks found in playlist scrape');
            return null;
        }

        // Extract unique IDs
        const trackIds = [...new Set(matches.map(m => m[1]))];

        if (trackIds.length === 0) return null;

        // Pick a random track ID
        const randomTrackId = trackIds[Math.floor(Math.random() * trackIds.length)];

        // Fetch track details to get the album
        const trackDetails = await getSpotifyTrackDetails(randomTrackId);

        if (trackDetails && trackDetails.album) {
            return trackDetails.album;
        }

        return null;
    } catch (error) {
        console.error('Error scraping featured playlist:', error);
        return null;
    }
};

export const getFeaturedPlaylists = async (limit = 10) => {
    // Deprecated/Broken for Spotify owned playlists via API, returning empty
    return [];
};

export const getPlaylistDetails = async (playlistId) => {
    const token = await getSpotifyToken();
    if (!token) return null;

    try {
        const res = await fetch(`${SPOTIFY_API_URL}/playlists/${playlistId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error(`Spotify Playlist Details Error: ${res.status}`);

        return await res.json();
    } catch (error) {
        console.error('Error fetching Spotify playlist details:', error);
        return null;
    }
};
