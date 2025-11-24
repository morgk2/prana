/**
 * Tidal Stream Helper
 * Provides functionality to stream unowned tracks via Tidal
 */

import { ModuleManager } from '../services/ModuleManager';
import { getArtworkWithFallback } from './artworkFallback';
import { getCachedTrack, saveToCache, removeFromCache, getCachedTrackByMetadata } from './tidalCache';

/**
 * Search for a track on Tidal and get its stream URL
 * @param {string} trackName - Track title
 * @param {string} artistName - Artist name
 * @param {string} albumName - Album name (optional)
 * @returns {Promise<Object|null>} Formatted track object or null if not found
 */
export async function findAndStreamTrack(trackName, artistName, albumName = null) {
    try {
        // Build search query - ALWAYS include artist if available
        let query = '';

        if (artistName && artistName !== 'Unknown Artist' && artistName.trim() !== '') {
            // Include artist for better matching
            query = `${trackName} ${artistName}`;
        } else {
            query = trackName;
        }

        console.log('[Tidal Stream Helper] Searching for:', query, '(Track:', trackName, 'Artist:', artistName || 'N/A', ')');

        // Search via ModuleManager
        const response = await ModuleManager.searchTracks(query, 10); // Get top 10 results
        const tracks = response.tracks || [];

        if (tracks.length === 0) {
            console.warn('[Tidal Stream Helper] No results found');
            return null;
        }

        // Filter candidates that match the artist (if provided)
        let candidates = tracks;
        if (artistName && artistName !== 'Unknown Artist') {
            const searchArtist = artistName.toLowerCase();
            const searchTitle = trackName.toLowerCase();

            // Prioritize exact matches
            candidates = tracks.filter(track => {
                const trackArtist = (typeof track.artist === 'string' ? track.artist : track.artist?.name || '').toLowerCase();
                const trackTitle = track.title.toLowerCase();
                // Require BOTH artist and title to match to avoid wrong songs from same artist
                return trackArtist.includes(searchArtist) && trackTitle.includes(searchTitle); 
            });

            // If no strict matches, try title match only (in case artist name varies e.g. "Feat.")
            if (candidates.length === 0) {
                 candidates = tracks.filter(track => {
                    const trackTitle = track.title.toLowerCase();
                    return trackTitle.includes(searchTitle);
                 });
            }

            // If still no matches, DO NOT revert to all tracks (which often contains irrelevant results)
            // This prevents playing "Gorgeous" when asking for "New Slaves"
            if (candidates.length === 0) {
                console.warn('[Tidal Stream Helper] No candidates matched the search criteria strictly');
                return null; 
            }
        }

        console.log(`[Tidal Stream Helper] Found ${candidates.length} candidates. Verifying streamability...`);

        // Iterate through candidates to find one that is actually streamable
        for (const candidate of candidates) {
            try {
                // Verify if we can get a stream URL for this track
                // We use the same quality fallback logic as the player
                console.log(`[Tidal Stream Helper] Verifying candidate: ${candidate.title} by ${candidate.artist} (ID: ${candidate.id})`);

                // This will throw if no stream is available at any quality
                const streamData = await ModuleManager.getTrackStreamUrl(candidate.id, 'LOSSLESS');

                console.log('[Tidal Stream Helper] Verified streamable track:', candidate.title);

                // Get artwork with fallback
                const artwork = await getArtworkWithFallback(candidate);

                // Format track for player
                const formattedTrack = {
                    name: candidate.title,
                    artist: typeof candidate.artist === 'string' ? candidate.artist : (candidate.artist?.name || 'Unknown Artist'),
                    album: candidate.album || 'Unknown Album',
                    duration: candidate.duration,
                    image: artwork,
                    source: 'tidal',
                    tidalId: candidate.id,
                    uri: streamData.streamUrl,
                    isStreaming: true,
                };

                // Save to cache
                await saveToCache(candidate.id, formattedTrack);

                return formattedTrack;
            } catch (error) {
                console.warn(`[Tidal Stream Helper] Candidate ${candidate.id} not streamable:`, error.message);
                // Continue to next candidate
            }
        }

        console.warn('[Tidal Stream Helper] No streamable tracks found among candidates');
        return null;
    } catch (error) {
        console.error('[Tidal Stream Helper] Error:', error);
        return null;
    }
}

/**
 * Get fresh stream URL for a known Tidal track ID and update cache
 * Used when playback fails (e.g. expired link)
 */
export async function getFreshTidalStream(tidalId) {
    try {
        console.log('[Tidal Stream Helper] Getting fresh stream for ID:', tidalId);
        const streamData = await ModuleManager.getTrackStreamUrl(tidalId, 'LOSSLESS');
        
        if (streamData && streamData.streamUrl) {
            // Get existing cache to preserve metadata if possible
            const cached = await getCachedTrack(tidalId);
            
            const updatedTrack = {
                ...(cached || {}),
                uri: streamData.streamUrl,
                tidalId: tidalId,
                // Ensure minimal fields are present if cache was empty
                isStreaming: true,
                source: 'tidal'
            };

            // Update cache
            await saveToCache(tidalId, updatedTrack);
            
            return updatedTrack;
        }
    } catch (e) {
        console.warn('[Tidal Stream Helper] Failed to get fresh stream:', e);
    }
    return null;
}

/**
 * Check if a track should be streamed from Tidal
 * @param {Object} track - Track object
 * @param {boolean} useTidalForUnowned - Whether Tidal streaming is enabled
 * @returns {boolean} True if track should be streamed
 */
export function shouldStreamFromTidal(track, useTidalForUnowned) {
    if (!useTidalForUnowned) return false;

    // Stream if track has no local URI (unowned)
    if (!track.uri || track.uri.startsWith('http')) {
        return true;
    }

    // Stream if track is marked as preview only
    if (track.previewUrl && !track.uri) {
        return true;
    }

    return false;
}

/**
 * Get playable track - either local or streamed from Tidal
 * @param {Object} track - Original track object
 * @param {boolean} useTidalForUnowned - Whether Tidal streaming is enabled
 * @returns {Promise<Object>} Playable track object
 */
export async function getPlayableTrack(track, useTidalForUnowned = false) {
    // If track has local URI, return as-is
    if (track.uri && !track.uri.startsWith('http')) {
        return track;
    }

    // If Tidal streaming is disabled, return original track (may have preview URL)
    if (!useTidalForUnowned) {
        return track;
    }

    // Check if we already have a specific Tidal ID from previous interactions
    if (track.tidalId) {
        const cached = await getCachedTrack(track.tidalId);
        if (cached && cached.uri) {
            console.log('[Tidal Stream Helper] Found cached stream by ID for:', track.name);
            return {
                ...track, // Keep original context
                ...cached, // Overlay cached data (uri, tidalId, etc)
            };
        }
    }

    // Try to find in cache by metadata (Name + Artist)
    // This handles cases where we haven't "enriched" the track object in the UI yet but have it in cache
    const cachedByMeta = await getCachedTrackByMetadata(
        track.name, 
        typeof track.artist === 'string' ? track.artist : (track.artist?.name || track.artist)
    );
    
    if (cachedByMeta && cachedByMeta.uri) {
        console.log('[Tidal Stream Helper] Found cached stream by Metadata for:', track.name);
        return {
            ...track,
            ...cachedByMeta,
        };
    }

    // Try to find and stream from Tidal
    console.log('[Tidal Stream Helper] Attempting to stream unowned track:', track.name);
    const streamedTrack = await findAndStreamTrack(
        track.name,
        typeof track.artist === 'string' ? track.artist : (track.artist?.name || track.artist),
        track.album
    );

    if (streamedTrack) {
        console.log('[Tidal Stream Helper] Successfully found stream for:', track.name);
        return streamedTrack;
    }

    // Fallback to original track
    console.warn('[Tidal Stream Helper] Could not find stream, using original track');
    return track;
}
