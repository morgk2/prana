
const BASE_URL = 'https://api.deezer.com';

// Helper to handle CORS proxies if needed, but usually direct works for read-only public APIs or via backend.
// Since this is Expo, direct fetch might work if CORS isn't an issue, or we might need a proxy.
// Deezer API supports JSONP but fetch doesn't.
// We'll try direct fetch. If it fails due to CORS, we might need a proxy.
// For now, assuming it works or using a proxy if defined.

export const getChart = async () => {
    try {
        const response = await fetch(`${BASE_URL}/chart`);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching Deezer chart:', error);
        return null;
    }
};

export const getTrendingAlbums = async () => {
    try {
        const response = await fetch(`${BASE_URL}/chart/0/albums`);
        const data = await response.json();
        return data.data;
    } catch (error) {
        console.error('Error fetching trending albums:', error);
        return [];
    }
};

export const getTrendingPlaylists = async () => {
    try {
        const response = await fetch(`${BASE_URL}/chart/0/playlists`);
        const data = await response.json();
        return data.data;
    } catch (error) {
        console.error('Error fetching trending playlists:', error);
        return [];
    }
};

export const getTrendingTracks = async () => {
    try {
        // Use Global Top 100 Playlist to avoid IP-based geolocation (Algeria)
        // Playlist ID: 3155776842 (Global Top 100)
        const response = await fetch(`${BASE_URL}/playlist/3155776842/tracks`);
        const data = await response.json();
        return data.data;
    } catch (error) {
        console.error('Error fetching trending tracks:', error);
        // Fallback to chart if playlist fails
        try {
            const response = await fetch(`${BASE_URL}/chart/0/tracks`);
            const data = await response.json();
            return data.data;
        } catch (e) {
            return [];
        }
    }
};

export const getTrendingArtists = async () => {
    try {
        const response = await fetch(`${BASE_URL}/chart/0/artists`);
        const data = await response.json();
        return data.data;
    } catch (error) {
        console.error('Error fetching trending artists:', error);
        return [];
    }
};

export const getPlaylistDetails = async (playlistId) => {
    try {
        const response = await fetch(`${BASE_URL}/playlist/${playlistId}`);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching playlist details:', error);
        return null;
    }
};

export const getAlbumDetails = async (albumId) => {
    try {
        const response = await fetch(`${BASE_URL}/album/${albumId}`);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching album details:', error);
        return null;
    }
};
