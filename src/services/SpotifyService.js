import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CryptoJS from 'crypto-js';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } from '../config/envConfig.js';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_URL = 'https://api.spotify.com/v1';

// User Auth Config
const REDIRECT_URI = 'eightspine://spotify-auth';
const SCOPES = [
    'user-library-read',
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-read-email',
    'user-read-private'
].join(' ');

const STATE_KEY = 'spotify_auth_state';
const CODE_VERIFIER_KEY = 'spotify_code_verifier';
const USER_TOKEN_KEY = 'spotify_user_token';
const USER_REFRESH_TOKEN_KEY = 'spotify_user_refresh_token';
const USER_EXPIRATION_KEY = 'spotify_token_expiration';

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

// ==========================================
// User Authentication Flow (PKCE)
// ==========================================

function generateRandomString(length) {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function base64URLEncode(str) {
    return str.toString(CryptoJS.enc.Base64)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

function sha256(plain) {
    return CryptoJS.SHA256(plain);
}

export const initiateSpotifyLogin = async () => {
    const state = generateRandomString(16);
    const codeVerifier = generateRandomString(128);
    const codeChallenge = base64URLEncode(sha256(codeVerifier));

    await AsyncStorage.setItem(STATE_KEY, state);
    await AsyncStorage.setItem(CODE_VERIFIER_KEY, codeVerifier);

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: SPOTIFY_CLIENT_ID,
        scope: SCOPES,
        redirect_uri: REDIRECT_URI,
        state: state,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
    });

    const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;
    await Linking.openURL(authUrl);
};

export const handleSpotifyCallback = async (url) => {
    if (!url) return null;
    
    const queryString = url.split('?')[1];
    if (!queryString) return null;

    const params = new URLSearchParams(queryString);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    if (error) {
        throw new Error(`Spotify Auth Error: ${error}`);
    }

    const storedState = await AsyncStorage.getItem(STATE_KEY);
    // if (state !== storedState) throw new Error('State mismatch');

    const codeVerifier = await AsyncStorage.getItem(CODE_VERIFIER_KEY);
    
    const bodyParams = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI,
        client_id: SPOTIFY_CLIENT_ID,
        code_verifier: codeVerifier,
        client_secret: SPOTIFY_CLIENT_SECRET
    });

    const res = await fetch(SPOTIFY_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: bodyParams.toString()
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Token Exchange Failed: ${errText}`);
    }

    const data = await res.json();
    await storeUserTokens(data);
    return data.access_token;
};

const storeUserTokens = async (data) => {
    const now = Date.now();
    await AsyncStorage.setItem(USER_TOKEN_KEY, data.access_token);
    if (data.refresh_token) {
        await AsyncStorage.setItem(USER_REFRESH_TOKEN_KEY, data.refresh_token);
    }
    await AsyncStorage.setItem(USER_EXPIRATION_KEY, (now + (data.expires_in || 3600) * 1000).toString());
};

export const getSpotifyUserToken = async () => {
    const token = await AsyncStorage.getItem(USER_TOKEN_KEY);
    const expiration = await AsyncStorage.getItem(USER_EXPIRATION_KEY);
    const refreshToken = await AsyncStorage.getItem(USER_REFRESH_TOKEN_KEY);

    if (!token || !expiration || !refreshToken) return null;

    if (Date.now() > parseInt(expiration, 10) - 60000) {
        return await refreshSpotifyUserToken(refreshToken);
    }

    return token;
};

const refreshSpotifyUserToken = async (refreshToken) => {
    try {
        const bodyParams = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: SPOTIFY_CLIENT_ID,
            client_secret: SPOTIFY_CLIENT_SECRET
        });

        const res = await fetch(SPOTIFY_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: bodyParams.toString()
        });

        if (!res.ok) throw new Error('Failed to refresh token');

        const data = await res.json();
        
        if (!data.refresh_token) {
            data.refresh_token = refreshToken;
        }
        
        await storeUserTokens(data);
        return data.access_token;
    } catch (error) {
        console.error('Token refresh failed', error);
        await logoutSpotify();
        return null;
    }
};

export const logoutSpotify = async () => {
    await AsyncStorage.multiRemove([USER_TOKEN_KEY, USER_REFRESH_TOKEN_KEY, USER_EXPIRATION_KEY, STATE_KEY, CODE_VERIFIER_KEY]);
};

export const getSpotifyUserProfile = async () => {
    const token = await getSpotifyUserToken();
    if (!token) return null;

    const res = await fetch(`${SPOTIFY_API_URL}/me`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!res.ok) return null;
    return await res.json();
};

export const getUserPlaylists = async () => {
    const token = await getSpotifyUserToken();
    if (!token) return null;

    try {
        const res = await fetch(`${SPOTIFY_API_URL}/me/playlists?limit=50`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!res.ok) throw new Error('Failed to fetch playlists');
        const json = await res.json();
        
        // Return with image mapping compatible with ImportExternalPlaylist
        return (json.items || []).map(p => ({
             name: p.name,
             id: p.id,
             description: p.description,
             image: p.images, // Keep raw images, mapping handled in component if needed
             trackCount: p.tracks?.total || 0,
             owner: p.owner?.display_name
        }));
    } catch (e) {
        console.error(e);
        return [];
    }
};
