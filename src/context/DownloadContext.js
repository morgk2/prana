import React, { createContext, useState, useContext, useRef } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { getPlayableTrack, getFreshTidalStream } from '../utils/tidalStreamHelper';

const DownloadContext = createContext();

export const useDownload = () => useContext(DownloadContext);

export const DownloadProvider = ({ children, addToLibrary, useTidalForUnowned }) => {
  const [activeDownloads, setActiveDownloads] = useState({}); // { [trackId]: progress }
  const [albumDownloads, setAlbumDownloads] = useState({}); // { [albumKey]: { progress, total, completed } }
  const [downloadedTracks, setDownloadedTracks] = useState(new Set()); // Set of URIs or IDs

  const handleDownloadTrack = async (track, albumKey = null) => {
    if (!useTidalForUnowned) return;

    const trackId = track.id || track.name;
    if (activeDownloads[trackId]) return; // Already downloading

    try {
      setActiveDownloads(prev => ({ ...prev, [trackId]: 0 }));
      console.log('[DownloadContext] Starting download for:', track.name);

      // 1. Resolve stream
      const enrichedTrack = { ...track };
      // Assuming track already has album/artist metadata from the UI context
      
      const playableTrack = await getPlayableTrack(enrichedTrack, true);

      if (!playableTrack || !playableTrack.tidalId) {
        throw new Error('Could not resolve Tidal stream for download');
      }

      // 2. Download
      let streamUrl = playableTrack.uri;
      const filename = `${playableTrack.artist} - ${playableTrack.name}.flac`.replace(/[^a-z0-9 \.\-_]/gi, '_');
      
      const performDownload = async (url) => {
        const fileUri = FileSystem.documentDirectory + filename;
        const downloadResumable = FileSystem.createDownloadResumable(
          url,
          fileUri,
          {},
          (downloadProgress) => {
            const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
            setActiveDownloads(prev => ({ ...prev, [trackId]: progress }));
          }
        );
        return await downloadResumable.downloadAsync();
      };

      let downloadResult;
      try {
        if (!streamUrl) throw new Error('No initial stream URL');
        downloadResult = await performDownload(streamUrl);
      } catch (initialError) {
        console.warn('[DownloadContext] Retry fetch for:', track.name);
        const freshTrack = await getFreshTidalStream(playableTrack.tidalId);
        if (freshTrack && freshTrack.uri) {
          downloadResult = await performDownload(freshTrack.uri);
        } else {
          throw new Error('No stream URL returned from fresh fetch');
        }
      }

      // 3. Add to Library
      let image = playableTrack.image;
      // Fallback image logic should be handled by the caller or resolved before, 
      // but we can try to preserve what we have.
      
      const trackToAdd = {
        ...playableTrack,
        image,
        album: track.album || playableTrack.album, 
      };

      await addToLibrary(trackToAdd, downloadResult.uri, filename);
      
      // Mark as downloaded
      setDownloadedTracks(prev => {
          const next = new Set(prev);
          next.add(trackId);
          if (track.uri) next.add(track.uri); // Also add original URI if any
          return next;
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Update Album Progress if part of an album download
      if (albumKey) {
          setAlbumDownloads(prev => {
              const current = prev[albumKey];
              if (!current) return prev;
              const newCompleted = current.completed + 1;
              const newProgress = newCompleted / current.total;
              
              if (newCompleted >= current.total) {
                  // Album finished
                  const { [albumKey]: _, ...rest } = prev;
                  return rest;
              }
              
              return {
                  ...prev,
                  [albumKey]: {
                      ...current,
                      completed: newCompleted,
                      progress: newProgress,
                  }
              };
          });
      }

    } catch (error) {
      console.error('[DownloadContext] Download failed:', error);
      alert(`Download failed: ${error.message}`);
    } finally {
      setActiveDownloads(prev => {
        const { [trackId]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  const startAlbumDownload = async (albumKey, tracks) => {
      if (!tracks || tracks.length === 0) return;
      
      // Filter already downloaded
      // We rely on the caller to filter, or we can check our internal set + simple heuristics
      // For now, assume 'tracks' contains only unowned/un-downloaded tracks
      
      if (albumDownloads[albumKey]) return; // Already downloading

      setAlbumDownloads(prev => ({
          ...prev,
          [albumKey]: {
              total: tracks.length,
              completed: 0,
              progress: 0,
              isDownloading: true
          }
      }));

      // Process sequentially to avoid rate limits / overload
      for (const track of tracks) {
          await handleDownloadTrack(track, albumKey);
      }
  };

  return (
    <DownloadContext.Provider value={{
      activeDownloads,
      albumDownloads,
      downloadedTracks,
      handleDownloadTrack,
      startAlbumDownload
    }}>
      {children}
    </DownloadContext.Provider>
  );
};
