import React, { createContext, useState, useContext, useRef, useEffect } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import { getPlayableTrack, getFreshTidalStream } from '../utils/tidalStreamHelper';

const DownloadContext = createContext();

const LIBRARY_DIR = FileSystem.documentDirectory + 'library';
const DOWNLOADS_FILE = LIBRARY_DIR + '/downloads.json';
const SILENT_AUDIO_URI = FileSystem.cacheDirectory + 'background_keep_alive.wav';
// A short silent WAV file (16-bit PCM, Mono, 44.1kHz, approx 0.1s) to keep the audio session active
const SILENT_AUDIO_B64 = 'UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

export const useDownload = () => useContext(DownloadContext);

export const DownloadProvider = ({ children, addToLibrary, useTidalForUnowned }) => {
  const [activeDownloads, setActiveDownloads] = useState({}); // { [trackId]: progress }
  const [albumDownloads, setAlbumDownloads] = useState({}); // { [albumKey]: { progress, total, completed } }
  const [downloadedTracks, setDownloadedTracks] = useState(new Set()); // Set of URIs or IDs
  const [recentDownloads, setRecentDownloads] = useState({}); // { [trackId]: fileUri } - Map for immediate playback
  const [isLoaded, setIsLoaded] = useState(false);
  const keepAliveSound = useRef(null);

  // Manage background keep-alive sound
  const hasActiveDownloads = Object.keys(activeDownloads).length > 0 || Object.values(albumDownloads).some(a => a.isDownloading);

  useEffect(() => {
    // Request notification permissions
    Notifications.requestPermissionsAsync();
  }, []);

  useEffect(() => {
    let mounted = true;

    const manageKeepAlive = async () => {
      if (hasActiveDownloads) {
        if (!keepAliveSound.current) {
          console.log('[DownloadContext] Starting background keep-alive');
          try {
            // Ensure silent file exists
            const info = await FileSystem.getInfoAsync(SILENT_AUDIO_URI);
            if (!info.exists) {
              await FileSystem.writeAsStringAsync(SILENT_AUDIO_URI, SILENT_AUDIO_B64, { encoding: FileSystem.EncodingType.Base64 });
            }

            // Play silent sound in loop to keep app active in background
            const { sound } = await Audio.Sound.createAsync(
              { uri: SILENT_AUDIO_URI },
              { shouldPlay: true, isLooping: true, volume: 0 }
            );
            
            if (mounted) {
              keepAliveSound.current = sound;
            } else {
              await sound.unloadAsync();
            }
          } catch (e) {
            console.warn('[DownloadContext] Failed to start keep-alive sound', e);
          }
        }
      } else {
        if (keepAliveSound.current) {
          console.log('[DownloadContext] Stopping background keep-alive');
          try {
            await keepAliveSound.current.stopAsync();
            await keepAliveSound.current.unloadAsync();
          } catch (e) {
            // ignore
          }
          keepAliveSound.current = null;
        }
      }
    };

    manageKeepAlive();

    return () => {
      mounted = false;
      // We don't necessarily want to kill the sound on every render if hasActiveDownloads is still true,
      // but since we check hasActiveDownloads in the dependency, this effect runs when it flips.
      // However, if the component unmounts (app kill), we should cleanup.
    };
  }, [hasActiveDownloads]);

  // Load downloads persistence on mount
  useEffect(() => {
    const loadDownloads = async () => {
      try {
        const dirInfo = await FileSystem.getInfoAsync(LIBRARY_DIR);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(LIBRARY_DIR, { intermediates: true });
        }

        const fileInfo = await FileSystem.getInfoAsync(DOWNLOADS_FILE);
        if (fileInfo.exists) {
          const content = await FileSystem.readAsStringAsync(DOWNLOADS_FILE);
          const data = JSON.parse(content);
          if (data) {
            if (data.downloadedTracks) {
              setDownloadedTracks(prev => {
                const next = new Set(data.downloadedTracks);
                for (const item of prev) next.add(item);
                return next;
              });
            }
            if (data.recentDownloads) {
              setRecentDownloads(prev => ({ ...data.recentDownloads, ...prev }));
            }
          }
        }
      } catch (e) {
        console.warn('[DownloadContext] Failed to load downloads persistence', e);
      } finally {
        setIsLoaded(true);
      }
    };
    loadDownloads();
  }, []);

  // Save downloads persistence on change
  useEffect(() => {
    if (!isLoaded) return;

    const saveDownloads = async () => {
      try {
        const data = {
          downloadedTracks: Array.from(downloadedTracks),
          recentDownloads
        };
        await FileSystem.writeAsStringAsync(DOWNLOADS_FILE, JSON.stringify(data));
      } catch (e) {
        console.warn('[DownloadContext] Failed to save downloads persistence', e);
      }
    };
    
    saveDownloads();
  }, [downloadedTracks, recentDownloads, isLoaded]);

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
      
      // Determine file extension based on URL content
      let extension = 'flac'; // Default for Tidal
      if (streamUrl && (streamUrl.includes('.mp3') || streamUrl.includes('format=mp3'))) {
          extension = 'mp3';
      }
      
      const filename = `${playableTrack.artist} - ${playableTrack.name}.${extension}`.replace(/[^a-z0-9 \.\-_]/gi, '_');
      
      console.log('[DownloadContext] Destination:', filename, 'Ext:', extension);

      const performDownload = async (url) => {
        const fileUri = FileSystem.documentDirectory + filename;
        const downloadResumable = FileSystem.createDownloadResumable(
          url,
          fileUri,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          },
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
        
        // Verify download
        const fileInfo = await FileSystem.getInfoAsync(downloadResult.uri);
        console.log('[DownloadContext] Downloaded file info:', fileInfo);
        
        if (fileInfo.size < 1000) {
             // Likely an error page
             console.warn('[DownloadContext] Downloaded file is too small, likely an error page');
             // Try to read it to see error
             const content = await FileSystem.readAsStringAsync(downloadResult.uri);
             console.warn('[DownloadContext] File content start:', content.substring(0, 200));
             throw new Error('Downloaded file invalid (too small)');
        }

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
      
      // Mark as downloaded and save URI for immediate access
      setDownloadedTracks(prev => {
          const next = new Set(prev);
          next.add(trackId);
          if (track.uri) next.add(track.uri); 
          return next;
      });
      setRecentDownloads(prev => ({
          ...prev,
          [trackId]: downloadResult.uri,
          [track.name]: downloadResult.uri // Fallback key
      }));

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Update Album Progress if part of an album download
      if (albumKey) {
          let progressInfo = null;

          setAlbumDownloads(prev => {
              const current = prev[albumKey];
              if (!current) return prev;
              const newCompleted = current.completed + 1;
              const newProgress = newCompleted / current.total;

              progressInfo = { completed: newCompleted, total: current.total };
              
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

          // Fire notification
          if (progressInfo) {
            if (progressInfo.completed < progressInfo.total) {
              Notifications.scheduleNotificationAsync({
                identifier: `download-${albumKey}`,
                content: {
                  title: 'Downloading Music',
                  body: `Downloaded ${progressInfo.completed} of ${progressInfo.total} Tracks`,
                  sound: false,
                  priority: Notifications.AndroidNotificationPriority.LOW,
                },
                trigger: null,
              });
            } else {
              // Done
              Notifications.scheduleNotificationAsync({
                identifier: `download-${albumKey}`,
                content: {
                  title: 'Download Complete',
                  body: `Finished downloading ${progressInfo.total} tracks.`,
                },
                trigger: null,
              });
            }
          }
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

  const resetDownloads = async () => {
    setActiveDownloads({});
    setAlbumDownloads({});
    setDownloadedTracks(new Set());
    setRecentDownloads({});
    try {
      // Clear the persistence file directly if needed, though state update will trigger save
      const fileInfo = await FileSystem.getInfoAsync(DOWNLOADS_FILE);
      if (fileInfo.exists) {
        await FileSystem.deleteAsync(DOWNLOADS_FILE);
      }
    } catch (e) {
      console.warn('[DownloadContext] Failed to delete downloads file', e);
    }
  };

  return (
    <DownloadContext.Provider value={{
      activeDownloads,
      albumDownloads,
      downloadedTracks,
      recentDownloads,
      handleDownloadTrack,
      startAlbumDownload,
      resetDownloads
    }}>
      {children}
    </DownloadContext.Provider>
  );
};
