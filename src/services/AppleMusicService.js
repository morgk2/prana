import { Platform } from 'react-native';
import { APPLE_MUSIC_DEVELOPER_TOKEN } from '../config/envConfig.js';

const DEVELOPER_TOKEN = APPLE_MUSIC_DEVELOPER_TOKEN;
const APPLE_MUSIC_API_URL = 'https://api.music.apple.com/v1';

// Store country code, default to US. 
// In a real app, you might want to fetch this from the device locale or user settings.
let storefront = 'us'; 

export const getAppleMusicHeader = () => {
    return {
        'Authorization': `Bearer ${DEVELOPER_TOKEN}`,
        'Content-Type': 'application/json'
    };
};

/**
 * Search for albums, songs, artists on Apple Music
 * @param {string} query - Search term
 * @param {number} limit - Number of results
 * @param {string} types - Comma separated types (albums,songs,artists)
 */
export const searchAppleMusic = async (query, limit = 20, types = 'albums,songs') => {
    try {
        const encodedQuery = encodeURIComponent(query.replace(/ /g, '+'));
        const url = `${APPLE_MUSIC_API_URL}/catalog/${storefront}/search?term=${encodedQuery}&limit=${limit}&types=${types}`;
        
        const res = await fetch(url, {
            headers: getAppleMusicHeader()
        });

        if (!res.ok) {
            console.error('Apple Music Search Error:', res.status);
            return null;
        }

        const json = await res.json();
        return json.results;
    } catch (error) {
        console.error('Error searching Apple Music:', error);
        return null;
    }
};

export const getAppleAlbumDetails = async (albumId) => {
    try {
        const res = await fetch(`${APPLE_MUSIC_API_URL}/catalog/${storefront}/albums/${albumId}`, {
            headers: getAppleMusicHeader()
        });

        if (!res.ok) throw new Error(`Apple Album Error: ${res.status}`);

        const json = await res.json();
        return json.data?.[0];
    } catch (error) {
        console.error('Error fetching Apple Music album:', error);
        return null;
    }
};

export const getAppleTrackDetails = async (trackId) => {
    try {
        const res = await fetch(`${APPLE_MUSIC_API_URL}/catalog/${storefront}/songs/${trackId}`, {
            headers: getAppleMusicHeader()
        });

        if (!res.ok) throw new Error(`Apple Track Error: ${res.status}`);

        const json = await res.json();
        return json.data?.[0];
    } catch (error) {
        console.error('Error fetching Apple Music track:', error);
        return null;
    }
};

export const getAppleNewReleases = async (limit = 10) => {
    // Apple Music Charts or specific playlists can be used for "New Releases"
    // Or use the /charts endpoint
    try {
        const res = await fetch(`${APPLE_MUSIC_API_URL}/catalog/${storefront}/charts?types=albums&limit=${limit}`, {
            headers: getAppleMusicHeader()
        });

        if (!res.ok) throw new Error(`Apple Charts Error: ${res.status}`);
        
        const json = await res.json();
        return json.results.albums?.[0]?.data || [];
    } catch (error) {
        console.error('Error fetching Apple Music charts:', error);
        return [];
    }
};

/**
 * Get similar artists from Apple Music
 * @param {string} artistName - Name of the artist to search for
 * @param {number} limit - Number of results to return
 */
export const getAppleSimilarArtists = async (artistName, limit = 10) => {
    try {
        // 1. Search for the artist ID first
        const searchResults = await searchAppleMusic(artistName, 1, 'artists');
        const artistId = searchResults?.artists?.data?.[0]?.id;

        if (!artistId) {
            console.warn(`Apple Music: Artist not found for similar search: ${artistName}`);
            return [];
        }

        // 2. Fetch artist details with similar artists view
        const url = `${APPLE_MUSIC_API_URL}/catalog/${storefront}/artists/${artistId}/view/similar-artists?limit=${limit}`;
        const res = await fetch(url, {
            headers: getAppleMusicHeader()
        });

        if (!res.ok) throw new Error(`Apple Similar Artists Error: ${res.status}`);

        const json = await res.json();
        const data = json.data || [];

        // 3. Normalize format to match app expectations
        return data.map(artist => ({
            name: artist.attributes.name,
            mbid: artist.id, // Use Apple ID as fallback MBID
            image: artist.attributes.artwork ? [
                {
                    '#text': artist.attributes.artwork.url.replace('{w}', '300').replace('{h}', '300'),
                    size: 'large'
                },
                {
                    '#text': artist.attributes.artwork.url.replace('{w}', '600').replace('{h}', '600'),
                    size: 'extralarge'
                }
            ] : []
        }));

    } catch (error) {
        console.error('Error fetching Apple Music similar artists:', error);
        return [];
    }
};

export const getAppleArtistTopTracks = async (appleArtistId, limit = 20) => {
    try {
        const url = `${APPLE_MUSIC_API_URL}/catalog/${storefront}/artists/${appleArtistId}/view/top-songs?limit=${limit}`;
        const res = await fetch(url, {
            headers: getAppleMusicHeader()
        });

        if (!res.ok) throw new Error(`Apple Top Tracks Error: ${res.status}`);

        const json = await res.json();
        const data = json.data || [];

        return data.map(song => ({
            name: song.attributes.name,
            mbid: song.id, // Use Apple ID
            artist: song.attributes.artistName,
            album: song.attributes.albumName,
            image: song.attributes.artwork ? [
                { '#text': song.attributes.artwork.url.replace('{w}', '300').replace('{h}', '300'), size: 'large' },
                { '#text': song.attributes.artwork.url.replace('{w}', '600').replace('{h}', '600'), size: 'extralarge' }
            ] : [],
            // Store preview URL if needed for non-native playback
            previewUrl: song.attributes.previews?.[0]?.url
        }));
    } catch (error) {
        console.error(`Error fetching top tracks for artist ${appleArtistId}:`, error);
        return [];
    }
};

// Note: Playback requires Native Modules (MusicKit) or MusicKit JS.
// The standard API only provides previews (url in attributes.previews[0].url)
