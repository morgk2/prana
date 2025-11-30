import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Animated,
  Modal,
  TextInput,
  FlatList,
  useWindowDimensions,
  Alert,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import SwipeableTrackRow from './SwipeableTrackRow';
import { getPlayableTrack, getFreshTidalStream } from '../utils/tidalStreamHelper';
import { useDownload } from '../context/DownloadContext';
import { searchAlbums, getSpotifyAlbumDetails } from '../services/SpotifyService';

// Waveform Component for Playing State
const PlayingIndicator = ({ color }) => {
  const [bar1] = useState(new Animated.Value(0.4));
  const [bar2] = useState(new Animated.Value(0.7));
  const [bar3] = useState(new Animated.Value(0.5));

  useEffect(() => {
    const animate = (anim, delay) => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration: 400 + Math.random() * 200,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.3,
            duration: 400 + Math.random() * 200,
            useNativeDriver: true,
          }),
        ])
      ).start();
    };

    animate(bar1, 0);
    setTimeout(() => animate(bar2, 0), 200);
    setTimeout(() => animate(bar3, 0), 400);
  }, []);

  const Bar = ({ anim }) => (
    <Animated.View
      style={{
        width: 3,
        height: 14,
        backgroundColor: color,
        marginHorizontal: 1,
        borderRadius: 1.5,
        transform: [{ scaleY: anim }],
      }}
    />
  );

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height: 16, justifyContent: 'center' }}>
      <Bar anim={bar1} />
      <Bar anim={bar2} />
      <Bar anim={bar3} />
    </View>
  );
};

import ExplicitBadge from './ExplicitBadge';

export default function LibraryAlbumPage({ route, navigation }) {
  const { album: initialAlbum, theme, onTrackPress, libraryAlbums, library, openArtistByName, deleteTrack, updateTrack, addToQueue, addAlbumToQueue, currentTrack, isPlaying, togglePlay, useTidalForUnowned, addToLibrary, showNotification, playlists, addTrackToPlaylist, reloadArtwork } = route.params;
  const loading = false;
  const isFocused = useIsFocused();
  const { height: screenHeight } = useWindowDimensions();

  // Find the current album from libraryAlbums to get live updates
  const [album, setAlbum] = useState(initialAlbum);
  const [contextMenuTrack, setContextMenuTrack] = useState(null);
  const [selectedTrackKey, setSelectedTrackKey] = useState(null);
  const [menuAnim] = useState(new Animated.Value(0));
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editTrackName, setEditTrackName] = useState('');
  const [editTrackArtist, setEditTrackArtist] = useState('');
  const [editTrackAlbum, setEditTrackAlbum] = useState('');
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [playlistSheetVisible, setPlaylistSheetVisible] = useState(false);
  const [selectedTrackForPlaylist, setSelectedTrackForPlaylist] = useState(null);
  const [selectedPlaylists, setSelectedPlaylists] = useState(new Set());
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const trackRefs = useRef({});
  const scrollY = useRef(new Animated.Value(0)).current;

  // Animate sheet
  useEffect(() => {
    if (playlistSheetVisible) {
      Animated.timing(sheetAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(sheetAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [playlistSheetVisible]);

  // Handle playlist selection
  const togglePlaylistSelection = (playlistId) => {
    setSelectedPlaylists(prev => {
      const newSet = new Set(prev);
      if (newSet.has(playlistId)) {
        newSet.delete(playlistId);
      } else {
        newSet.add(playlistId);
      }
      return newSet;
    });
  };

  // Add track to selected playlists
  const handleAddToSelectedPlaylists = () => {
    if (selectedTrackForPlaylist && selectedPlaylists.size > 0 && addTrackToPlaylist) {
      selectedPlaylists.forEach(playlistId => {
        addTrackToPlaylist(playlistId, selectedTrackForPlaylist);
      });
      if (showNotification) {
        showNotification(`Added to ${selectedPlaylists.size} playlist${selectedPlaylists.size > 1 ? 's' : ''}`);
      }
    }
    setPlaylistSheetVisible(false);
    setSelectedTrackForPlaylist(null);
    setSelectedPlaylists(new Set());
  };

  // Close sheet
  const closePlaylistSheet = () => {
    setPlaylistSheetVisible(false);
    setSelectedTrackForPlaylist(null);
    setSelectedPlaylists(new Set());
  };
  const trackScaleAnims = useRef({});
  const [spotifyTracks, setSpotifyTracks] = useState([]);
  const [albumMetadata, setAlbumMetadata] = useState(null);
  const [loadingSpotify, setLoadingSpotify] = useState(false);
  const { activeDownloads, albumDownloads, downloadedTracks, recentDownloads, handleDownloadTrack, startAlbumDownload, cancelAlbumDownload } = useDownload();

  // Album Menu State
  const [albumMenuVisible, setAlbumMenuVisible] = useState(false);
  const [albumMenuPosition, setAlbumMenuPosition] = useState({ x: 0, y: 0 });
  const albumMenuAnim = useRef(new Animated.Value(0)).current;
  const albumMenuButtonRef = useRef(null);

  const isAlbumInLibrary = React.useMemo(() => {
    if (!libraryAlbums) return false;
    // Normalize current album details
    const name = (album.title || album.name || '').toLowerCase().trim();
    const artist = (typeof album.artist === 'object' ? album.artist.name : album.artist || '').toLowerCase().trim();

    return libraryAlbums.some(a => {
      const aName = (a.title || a.name || '').toLowerCase().trim();
      const aArtist = (typeof a.artist === 'object' ? a.artist.name : a.artist || '').toLowerCase().trim();
      return aName === name && aArtist === artist;
    });
  }, [libraryAlbums, album]);

  // Derive tracks once
  const allTracks = React.useMemo(() => {
    const tracks = spotifyTracks.length > 0 ? spotifyTracks : album.tracks;
    return tracks.map((track, index) => {
      // Check if this track exists in local library
      const libraryToCheck = library || album.tracks;
      const localTrack = libraryToCheck.find(t =>
        t.name?.toLowerCase().trim() === track.name?.toLowerCase().trim()
      );

      const isDownloaded = downloadedTracks.has(track.id) || downloadedTracks.has(track.name);
      const recentUri = recentDownloads ? (recentDownloads[track.id] || recentDownloads[track.name]) : null;

      // If local, return local track enriched with index/number
      if (localTrack || isDownloaded) {
        const baseTrack = localTrack || track;
        return {
          ...baseTrack,
          disc_number: track.disc_number || track.discNumber || 1,
          // Ensure image is present if missing on local track
          image: (baseTrack.image && baseTrack.image.length > 0) ? baseTrack.image :
            (album.artwork ? [{ '#text': album.artwork, size: 'extralarge' }] : []),
          // If it was found in downloadedTracks but not libraryToCheck, force isLocal=true so it displays correctly
          isLocal: true,
          uri: recentUri || baseTrack.uri || (isDownloaded ? 'file://downloaded' : undefined)
        };
      }

      // If remote, return track enriched with album metadata
      return {
        ...track,
        artist: track.artist || track.artists?.[0]?.name || album.artist,
        album: track.album || album.title,
        image: (track.image && track.image.length > 0) ? track.image :
          (album.artwork ? [{ '#text': album.artwork, size: 'extralarge' }] : []),
        track_number: track.track_number || track.trackNumber || index + 1,
        disc_number: track.disc_number || track.discNumber || 1,
      };
    }).sort((a, b) => {
      const discA = a.disc_number || 1;
      const discB = b.disc_number || 1;
      if (discA !== discB) return discA - discB;
      return (a.track_number || 0) - (b.track_number || 0);
    });
  }, [spotifyTracks, album.tracks, library, album.artwork, album.artist, album.title, downloadedTracks]);

  // Helper function to filter tracks for offline mode
  const getPlayableTracks = (tracks) => {
    // If offline (no Tidal streaming), filter to only local tracks
    if (!useTidalForUnowned) {
      return tracks.filter(t => t.isLocal);
    }
    return tracks;
  };

  useEffect(() => {
    if (isFocused && libraryAlbums) {
      const updatedAlbum = libraryAlbums.find(a => a.key === initialAlbum.key);
      if (updatedAlbum) {
        setAlbum(updatedAlbum);
      }
    }
  }, [libraryAlbums, isFocused, initialAlbum.key]);

  // Fetch album tracks from Spotify with caching
  useEffect(() => {
    const fetchAlbumTracks = async () => {
      if (!album || album.title === 'Unknown Album') return;

      const cacheDir = FileSystem.documentDirectory + 'album_cache/';
      const cacheFile = cacheDir + `${album.key}.json`;

      setLoadingSpotify(true);
      try {
        // Ensure cache directory exists
        const dirInfo = await FileSystem.getInfoAsync(cacheDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
        }

        // Check cache first
        const fileInfo = await FileSystem.getInfoAsync(cacheFile);
        if (fileInfo.exists) {
          const cachedData = await FileSystem.readAsStringAsync(cacheFile);
          const parsed = JSON.parse(cachedData);
          // Check if cache is less than 7 days old
          if (Date.now() - parsed.timestamp < 7 * 24 * 60 * 60 * 1000) {
            setSpotifyTracks(parsed.tracks);
            setAlbumMetadata(parsed.metadata || null);
            setLoadingSpotify(false);
            return;
          }
        }

        // Search for the album on Spotify
        const artistName = typeof album.artist === 'object' ? album.artist?.name : album.artist;
        const searchResults = await searchAlbums(album.title, artistName, 1);

        if (!searchResults || searchResults.length === 0) {
          console.log('Spotify album search returned no results');
          return;
        }

        const spotifyAlbum = searchResults[0];

        // Fetch full album details with tracks
        const albumDetails = await getSpotifyAlbumDetails(spotifyAlbum.id);

        if (albumDetails) {
          const date = albumDetails.release_date;
          const label = albumDetails.label;

          const tracks = albumDetails.tracks?.items?.map((track, index) => ({
            name: track.name,
            track_number: track.track_number,
            disc_number: track.disc_number,
            artists: track.artists?.map(a => ({ name: a.name })) || [{ name: artistName }],
            id: track.id,
            duration: track.duration_ms,
            explicit: track.explicit || false,
          })) || [];

          const totalDuration = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
          const metadata = { date, label, totalDuration };

          // Save to cache
          await FileSystem.writeAsStringAsync(cacheFile, JSON.stringify({
            tracks,
            metadata,
            timestamp: Date.now(),
          }));

          setSpotifyTracks(tracks);
          setAlbumMetadata(metadata);
        }
      } catch (error) {
        console.error('Error fetching album tracks:', error);
      } finally {
        setLoadingSpotify(false);
      }
    };

    fetchAlbumTracks();
  }, [album]);

  const openContextMenu = (track, trackKey, isLastItem = false) => {
    const ref = trackRefs.current[trackKey];
    if (ref) {
      // Trigger haptic feedback
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      ref.measure((x, y, width, height, pageX, pageY) => {
        const MENU_HEIGHT = 320; // Approximate height of the menu (increased for new items)
        const OFFSET = 60; // Overlap offset

        // Default position (below with overlap)
        let finalY = pageY + height - OFFSET;

        // If menu would go off screen bottom OR it's the last item, show above instead
        if (isLastItem || (finalY + MENU_HEIGHT > screenHeight - 20)) { // 20px buffer
          finalY = pageY - MENU_HEIGHT + OFFSET;
        }

        setMenuPosition({ x: pageX, y: finalY });
        setContextMenuTrack(track);
        setSelectedTrackKey(trackKey);

        // Animate menu
        Animated.spring(menuAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 100,
          friction: 10,
        }).start();

        // Animate track scale up
        if (!trackScaleAnims.current[trackKey]) {
          trackScaleAnims.current[trackKey] = new Animated.Value(1);
        }
        Animated.spring(trackScaleAnims.current[trackKey], {
          toValue: 1.02,
          useNativeDriver: true,
          tension: 100,
          friction: 10,
        }).start();
      });
    }
  };

  const closeContextMenu = () => {
    const currentTrackKey = selectedTrackKey;

    // Animate menu out
    Animated.timing(menuAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setContextMenuTrack(null);
      setSelectedTrackKey(null);
    });

    // Animate track scale back down
    if (currentTrackKey && trackScaleAnims.current[currentTrackKey]) {
      Animated.spring(trackScaleAnims.current[currentTrackKey], {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 10,
      }).start();
    }
  };

  const openAlbumMenu = () => {
    if (albumMenuButtonRef.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      albumMenuButtonRef.current.measure((x, y, width, height, pageX, pageY) => {
        setAlbumMenuPosition({ x: pageX, y: pageY + height });
        setAlbumMenuVisible(true);
        Animated.spring(albumMenuAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 100,
          friction: 10,
        }).start();
      });
    }
  };

  const closeAlbumMenu = () => {
    Animated.timing(albumMenuAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setAlbumMenuVisible(false);
    });
  };

  const handleDownloadAlbum = async () => {
    if (!useTidalForUnowned) return;
    closeAlbumMenu();

    const tracksToDownload = allTracks.filter(t => {
      const isLocal = t.uri && t.uri.startsWith('file://');
      return !isLocal;
    });

    if (tracksToDownload.length === 0) {
      alert('All tracks are already downloaded');
      return;
    }

    startAlbumDownload(album.key, tracksToDownload);
  };

  const handleStopDownload = () => {
    if (cancelAlbumDownload) {
      cancelAlbumDownload(album.key);
    }
    closeAlbumMenu();
  };

  const handleAddAlbumToLibrary = async () => {
    if (!addToLibrary) return;
    closeAlbumMenu();

    // Add all tracks to library as remote tracks
    for (const track of allTracks) {
      // Ensure we have necessary metadata
      const trackToAdd = {
        ...track,
        album: album.title || album.name,
        image: album.artwork ? [{ '#text': album.artwork, size: 'extralarge' }] : track.image,
      };
      await addToLibrary(trackToAdd, null, track.name);
    }
    if (showNotification) {
      showNotification('Album added to library');
    } else {
      alert('Album added to library');
    }
  };



  // Handle playing unowned tracks via Tidal
  const handleUnownedTrackPress = async (track, index, shouldQueueAlbum) => {
    if (!useTidalForUnowned) {
      console.log('[LibraryAlbumPage] Tidal streaming is disabled');
      return;
    }

    try {
      console.log('[LibraryAlbumPage] Attempting to stream unowned track:', track.name);

      // Use the derived track object which already has metadata
      const enrichedTrack = {
        ...allTracks[index], // Use the index passed in
        isFetching: true,
      };

      console.log('[LibraryAlbumPage] Enriched track artist:', enrichedTrack.artist);

      const queue = shouldQueueAlbum ? allTracks : [enrichedTrack];
      const qIndex = shouldQueueAlbum ? index : 0;

      // Open player immediately with loading state
      if (onTrackPress) {
        onTrackPress(enrichedTrack, queue, qIndex);
      }

      // Show loading state (optional - could add a loading indicator)
      const playableTrack = await getPlayableTrack(enrichedTrack, useTidalForUnowned);

      // Check if we got a valid track (either has uri OR is a Tidal stream with tidalId)
      if (playableTrack && (playableTrack.uri || playableTrack.tidalId) && onTrackPress) {
        // Update the track in the queue
        // We must ensure the queue we pass matches what we intended
        // If we didn't queue the album, we update the single track queue
        // If we did, we update the current track but keep the album queue (SongPlayer handles updating current track metadata)
        const updatedQueue = shouldQueueAlbum ? allTracks : [playableTrack];
        onTrackPress(playableTrack, updatedQueue, qIndex);
      } else {
        console.warn('[LibraryAlbumPage] Could not find stream for track:', track.name);
      }
    } catch (error) {
      console.error('[LibraryAlbumPage] Error streaming track:', error);
    }
  };

  const confirmAndPlayTrack = (track, index, isLocal) => {
    // TEMPORARILY DISABLED: Always play single track only (no queue prompt)
    if (isLocal) {
      if (onTrackPress) onTrackPress(track, [track], 0);
    } else {
      handleUnownedTrackPress(track, index, false);
    }

    /* ORIGINAL CODE - RE-ENABLE LATER
    Alert.alert(
      "Play Track",
      "Add the rest of the album to the queue?",
      [
        {
          text: "No",
          onPress: () => {
            if (isLocal) {
              if (onTrackPress) onTrackPress(track, [track], 0);
            } else {
              handleUnownedTrackPress(track, index, false);
            }
          }
        },
        {
          text: "Yes",
          onPress: () => {
            if (isLocal) {
              if (addAlbumToQueue) {
                // Add clicked track + all tracks after it (not before)
                const tracksToAdd = allTracks.slice(index);
                addAlbumToQueue(tracksToAdd, true);
              } else if (onTrackPress) {
                onTrackPress(track, allTracks, index);
              }
            } else {
              if (addAlbumToQueue) {
                // Add clicked track + all tracks after it (not before)
                const tracksToAdd = allTracks.slice(index);
                addAlbumToQueue(tracksToAdd, true);
              } else {
                handleUnownedTrackPress(track, index, true);
              }
            }
          }
        },
        {
          text: "Cancel",
          style: "cancel"
        }
      ]
    );
    */
  };

  const handleEditTrack = () => {
    setEditTrackName(contextMenuTrack.name);
    setEditTrackArtist(typeof contextMenuTrack.artist === 'object' ? contextMenuTrack.artist?.name : contextMenuTrack.artist || '');
    setEditTrackAlbum(contextMenuTrack.album || '');
    setEditModalVisible(true);
    closeContextMenu();
  };

  const handleDeleteTrack = async () => {
    if (contextMenuTrack && deleteTrack) {
      await deleteTrack(contextMenuTrack);
      closeContextMenu();
    }
  };

  const handleAddToQueue = () => {
    if (contextMenuTrack && addToQueue) {
      addToQueue(contextMenuTrack);
      closeContextMenu();
    }
  };

  const handleGoToArtist = () => {
    if (!openArtistByName) {
      console.warn('openArtistByName function not available');
      closeContextMenu();
      return;
    }
    if (contextMenuTrack) {
      const artistName = typeof contextMenuTrack.artist === 'object' 
        ? contextMenuTrack.artist?.name 
        : contextMenuTrack.artist || 'Unknown Artist';
      openArtistByName(artistName);
      closeContextMenu();
    }
  };

  const handleGoToAlbum = () => {
    // Already in album page, just close menu
    closeContextMenu();
  };

  const saveTrackEdit = async () => {
    if (contextMenuTrack && updateTrack && editTrackName.trim()) {
      await updateTrack(contextMenuTrack, {
        name: editTrackName.trim(),
        artist: editTrackArtist.trim(),
        album: editTrackAlbum.trim(),
      });
      setEditModalVisible(false);
      setEditTrackName('');
      setEditTrackArtist('');
      setEditTrackAlbum('');
    }
  };

  const renderContent = () => {
    if (loading) {
      return <ActivityIndicator style={styles.loading} size="large" color={theme.primaryText} />;
    }

    if (!album || !album.tracks || album.tracks.length === 0) {
      return (
        <Text style={[styles.emptyText, { color: theme.secondaryText }]}>
          No tracks in this album
        </Text>
      );
    }

    return (
      <>
        {/* Album Artwork - Square with rounded corners */}
        <View style={styles.artworkContainer}>
          {album?.artwork ? (
            <Animated.Image
              style={[
                styles.albumArtwork,
                {
                  transform: [
                    {
                      scale: scrollY.interpolate({
                        inputRange: [-200, 0],
                        outputRange: [1.4, 1],
                        extrapolateRight: 'clamp',
                      })
                    },
                    {
                      translateY: scrollY.interpolate({
                        inputRange: [-200, 0],
                        outputRange: [-56, 0], // (280 * 0.4) / 2 = 56. Moves image up to anchor bottom.
                        extrapolateRight: 'clamp',
                      })
                    }
                  ]
                }
              ]}
              source={{ uri: album.artwork }}
              onError={() => {
                console.log('[LibraryAlbumPage] Artwork load error for:', album.title);
                if (reloadArtwork) reloadArtwork(album.title, typeof album.artist === 'object' ? album.artist.name : album.artist);
              }}
            />
          ) : (
            <Animated.View style={[
              styles.albumArtwork,
              {
                backgroundColor: theme.card,
                transform: [
                  {
                    scale: scrollY.interpolate({
                      inputRange: [-200, 0],
                      outputRange: [1.4, 1],
                      extrapolateRight: 'clamp',
                    })
                  },
                  {
                    translateY: scrollY.interpolate({
                      inputRange: [-200, 0],
                      outputRange: [-56, 0],
                      extrapolateRight: 'clamp',
                    })
                  }
                ]
              }
            ]}>
              <Ionicons name="disc-outline" size={100} color={theme.secondaryText} />
            </Animated.View>
          )}
        </View>

        {/* Album Info */}
        <View style={styles.albumInfoSection}>
          <Text style={[styles.albumTitle, { color: theme.primaryText }]}>{album.title}</Text>
          <Pressable onPress={() => openArtistByName && openArtistByName(typeof album.artist === 'object' ? album.artist?.name : album.artist)}>
            <Text style={[styles.albumArtist, { color: theme.secondaryText }]}>
              {typeof album.artist === 'object' ? album.artist?.name : album.artist}
            </Text>
          </Pressable>
        </View>

        {/* Action Buttons - Play and Shuffle */}
        <View style={styles.actionButtonsContainer}>
          {(() => {
            // Determine if this specific album is playing
            const isAlbumPlaying = isPlaying && currentTrack && (
              (currentTrack.album === album.title || currentTrack.album === album.name) &&
              (currentTrack.artist === (typeof album.artist === 'object' ? album.artist.name : album.artist))
            );
            return (
              <Pressable
                style={[styles.actionButton, styles.playButton, { backgroundColor: theme.primaryText }]}
                onPress={() => {
                  if (isAlbumPlaying) {
                    if (togglePlay) togglePlay();
                  } else {
                    if (allTracks.length > 0 && onTrackPress) {
                      // Filter to only local tracks if offline
                      const playableTracks = getPlayableTracks(allTracks);
                      if (playableTracks.length === 0) {
                        if (showNotification) {
                          showNotification('No downloaded tracks in this album', 'error');
                        }
                        return;
                      }
                      // Play first track with full queue
                      onTrackPress(playableTracks[0], playableTracks, 0, false);
                    }
                  }
                }}
              >
                <Ionicons name={isAlbumPlaying ? "stop" : "play"} size={20} color={theme.background} />
                <Text style={[styles.actionButtonText, { color: theme.background }]}>{isAlbumPlaying ? "Stop" : "Play"}</Text>
              </Pressable>
            );
          })()}

          <Pressable
            style={[styles.actionButton, styles.shuffleButton, { borderColor: theme.border, backgroundColor: theme.card }]}
            onPress={() => {
              if (allTracks.length > 0 && onTrackPress) {
                // Filter to only local tracks if offline, then shuffle
                const playableTracks = getPlayableTracks(allTracks);
                if (playableTracks.length === 0) {
                  if (showNotification) {
                    showNotification('No downloaded tracks in this album', 'error');
                  }
                  return;
                }
                // Shuffle the tracks and play from the beginning
                const shuffled = [...playableTracks].sort(() => Math.random() - 0.5);
                onTrackPress(shuffled[0], shuffled, 0);
              }
            }}
          >
            <Ionicons name="shuffle" size={20} color={theme.primaryText} />
            <Text style={[styles.actionButtonText, { color: theme.primaryText }]}>Shuffle</Text>
          </Pressable>
        </View>

        {/* Download Progress Indicator */}
        {albumDownloads[album.key]?.isDownloading && (
          <View style={{ width: '100%', marginBottom: 20 }}>
            <View style={{ height: 4, backgroundColor: theme.border, width: '100%' }}>
              <View
                style={{
                  height: '100%',
                  width: `${(albumDownloads[album.key].progress || 0) * 100}%`,
                  backgroundColor: theme.accent
                }}
              />
            </View>
          </View>
        )}

        {/* Track List */}
        <View style={styles.trackListSection}>
          {allTracks.map((track, index) => {
            const prevTrack = allTracks[index - 1];
            const currentDisc = track.disc_number || 1;
            const prevDisc = prevTrack ? (prevTrack.disc_number || 1) : 0;
            const hasMultipleDiscs = allTracks.some(t => (t.disc_number || 1) > 1);
            const showDiscHeader = hasMultipleDiscs && (index === 0 || currentDisc !== prevDisc);

            // Check if imported based on track.uri or similar marker from our derivation
            // Our derived allTracks have local props if local
            const isImported = !!track.uri && !track.source; // Simple heuristic: local tracks have URI and usually no explicit source='tidal' yet (unless downloaded)
            // Actually better check: if it was found in libraryToCheck in useMemo
            // Let's rely on the fact that local tracks have a URI that is not http (file://)
            const isLocal = track.uri && track.uri.startsWith('file://');

            const trackNum = track.track_number || index + 1;
            const trackKey = `track-${index}`;

            // Check if this track is currently playing
            const isTrackPlaying = currentTrack && (
              (track.uri && currentTrack.uri && track.uri === currentTrack.uri) ||
              (track.name === currentTrack.name && track.artist === currentTrack.artist)
            );
            const showPlayingIndicator = isTrackPlaying && isPlaying;

            // Initialize scale animation for this track if it doesn't exist
            if (!trackScaleAnims.current[trackKey]) {
              trackScaleAnims.current[trackKey] = new Animated.Value(1);
            }

            return (
              <React.Fragment key={`album-track-wrapper-${track.id || track.name || index}-${index}`}>
                {showDiscHeader && (
                  <View style={styles.discHeader}>
                    <Ionicons name="disc-outline" size={20} color={theme.secondaryText} />
                    <Text style={[styles.discHeaderText, { color: theme.primaryText }]}>Disc {currentDisc}</Text>
                  </View>
                )}
                <Animated.View
                  key={`album-track-${track.id || track.name || index}-${index}`}
                ref={(ref) => { if (ref) trackRefs.current[trackKey] = ref; }}
                collapsable={false}
                style={{
                  transform: [{ scale: trackScaleAnims.current[trackKey] }],
                  opacity: isLocal ? 1 : (useTidalForUnowned ? 0.7 : 0.4),
                }}
              >
                {isLocal ? (
                  <SwipeableTrackRow
                    theme={theme}
                    onSwipeLeft={() => {
                      if (addToQueue) {
                        addToQueue(track);
                      }
                    }}
                  >
                    <Pressable
                      onPress={() => confirmAndPlayTrack(track, index, true)}
                      style={[styles.trackRow, { borderBottomColor: theme.border, backgroundColor: theme.background }]} // Ensure background color for swipeable
                    >
                      <View style={styles.trackNumberContainer}>
                        {showPlayingIndicator ? (
                          <PlayingIndicator color={theme.primaryText} />
                        ) : (
                          <Text style={[styles.trackNumber, {
                            color: isTrackPlaying ? theme.primaryText : theme.secondaryText,
                            fontWeight: isTrackPlaying ? 'bold' : 'normal'
                          }]}>
                            {trackNum}
                          </Text>
                        )}
                      </View>
                      <View style={styles.trackInfo}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1, paddingRight: 8 }}>
                          <Text
                            style={[
                              styles.trackName,
                              {
                                color: isTrackPlaying ? theme.primaryText : theme.primaryText,
                                fontWeight: isTrackPlaying ? '700' : '400',
                                flexShrink: 1
                              }
                            ]}
                            numberOfLines={1}
                          >
                            {track.name}
                          </Text>
                          {track.explicit && <ExplicitBadge theme={theme} />}
                        </View>
                        <Text style={[styles.trackArtist, { color: theme.secondaryText }]} numberOfLines={1}>
                          {track.artist}
                        </Text>
                      </View>
                      {track.favorite && (
                        <Ionicons name="star" size={16} color={theme.primaryText} style={{ marginRight: 8 }} />
                      )}
                      <Pressable onPress={() => openContextMenu(track, trackKey, index === allTracks.length - 1)} hitSlop={10}>
                        <Ionicons name="ellipsis-horizontal" size={20} color={theme.secondaryText} />
                      </Pressable>
                    </Pressable>
                  </SwipeableTrackRow>
                ) : (
                  <Pressable
                    onPress={() => confirmAndPlayTrack(track, index, false)}
                    disabled={!useTidalForUnowned}
                    style={[styles.trackRow, { borderBottomColor: theme.border }]}
                  >
                    <View style={styles.trackNumberContainer}>
                      {showPlayingIndicator ? (
                        <PlayingIndicator color={theme.primaryText} />
                      ) : (
                        <Text style={[styles.trackNumber, {
                          color: isTrackPlaying ? theme.primaryText : theme.secondaryText,
                          fontWeight: isTrackPlaying ? 'bold' : 'normal'
                        }]}>
                          {trackNum}
                        </Text>
                      )}
                    </View>
                    <View style={styles.trackInfo}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1, paddingRight: 8 }}>
                        <Text
                          style={[
                            styles.trackName,
                            {
                              color: isTrackPlaying ? theme.primaryText : theme.secondaryText,
                              fontWeight: isTrackPlaying ? '700' : '400',
                              flexShrink: 1
                            }
                          ]}
                          numberOfLines={1}
                        >
                          {track.name}
                        </Text>
                        {track.explicit && <ExplicitBadge theme={theme} />}
                      </View>
                      <Text style={[styles.trackArtist, { color: theme.secondaryText }]} numberOfLines={1}>
                        {track.artist}
                      </Text>
                    </View>
                    {track.favorite && (
                      <Ionicons name="star" size={16} color={theme.primaryText} style={{ marginRight: 8 }} />
                    )}
                    {useTidalForUnowned ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        {/* Only show download option if album is in library */}
                        {isAlbumInLibrary && (
                          <>
                            {activeDownloads[track.id || track.name] !== undefined ? (
                              <View style={{ width: 40, height: 40, justifyContent: 'center', alignItems: 'center' }}>
                                <ActivityIndicator size="small" color={theme.accent} />
                              </View>
                            ) : (
                              <Pressable
                                onPress={(e) => {
                                  handleDownloadTrack(track);
                                }}
                                style={({ pressed }) => ({
                                  opacity: pressed ? 0.5 : 1,
                                  padding: 10, // Increase touch target
                                  margin: -10, // Offset margin to keep layout tight but touch area large
                                })}
                                hitSlop={16}
                              >
                                <Ionicons name="download-outline" size={22} color={theme.secondaryText} />
                              </Pressable>
                            )}
                          </>
                        )}
                        {/* Always show cloud icon for unowned remote tracks */}
                        <Ionicons name="cloud-outline" size={16} color={theme.accent} />
                      </View>
                    ) : (
                      <Ionicons name="lock-closed-outline" size={16} color={theme.secondaryText} />
                    )}
                  </Pressable>
                )}
              </Animated.View>
              </React.Fragment>
            );
          })}

          {/* Song count at bottom, like Spotify */}
          <Text
            style={[
              styles.albumMeta,
              {
                color: theme.secondaryText,
                marginTop: 16,
                marginBottom: albumMetadata ? 8 : 32,
              },
            ]}
          >
            {spotifyTracks.length > 0 ? (
              <>
                {album.tracks.length} of {spotifyTracks.length} {spotifyTracks.length === 1 ? 'song' : 'songs'} imported
              </>
            ) : (
              <>
                {album.tracks.length} {album.tracks.length === 1 ? 'song' : 'songs'}
              </>
            )}
          </Text>

          {albumMetadata && (
            <View style={{ alignItems: 'flex-start', marginBottom: 16 }}>
              <Text style={{ color: theme.secondaryText, fontSize: 13, opacity: 0.7 }}>
                {albumMetadata.date ? new Date(albumMetadata.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : ''}
                {albumMetadata.date && albumMetadata.label ? ' • ' : ''}
                {albumMetadata.label || ''}
              </Text>
              {albumMetadata.totalDuration > 0 && (
                <Text style={{ color: theme.secondaryText, fontSize: 13, opacity: 0.7, marginTop: 4 }}>
                  {Math.floor(albumMetadata.totalDuration / 60000)} min {Math.round((albumMetadata.totalDuration % 60000) / 1000)} sec
                </Text>
              )}
            </View>
          )}
          <View style={{ height: 100 }} />
        </View>
      </>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Back Button and Album Menu */}
      <View style={[styles.header, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
        <Pressable onPress={() => navigation.goBack()} style={[styles.backButton, { backgroundColor: theme.backButton }]}>
          <Ionicons name="chevron-back" size={24} color={theme.backButtonText} />
        </Pressable>

        <Animated.View style={{
          opacity: scrollY.interpolate({
            inputRange: [300, 350],
            outputRange: [0, 1],
            extrapolate: 'clamp',
          }),
          alignItems: 'center',
          flex: 1,
          marginHorizontal: 10
        }}>
          <Text style={{ color: theme.primaryText, fontWeight: 'bold', fontSize: 16 }} numberOfLines={1}>
            {album.title}
          </Text>
          <Text style={{ color: theme.secondaryText, fontSize: 12 }} numberOfLines={1}>
            {typeof album.artist === 'object' ? album.artist?.name : album.artist}
          </Text>
        </Animated.View>

        <View>
          <Pressable
            ref={albumMenuButtonRef}
            onPress={openAlbumMenu}
            style={{ padding: 8 }}
            hitSlop={16}
          >
            <Ionicons name="ellipsis-horizontal" size={24} color={theme.primaryText} />
          </Pressable>
        </View>
      </View>

      <Animated.ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scrollViewContent}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
      >
        {renderContent()}
      </Animated.ScrollView>

      {/* Album Context Menu */}
      {albumMenuVisible && (
        <>
          <Pressable
            style={styles.transparentBackdrop}
            onPress={closeAlbumMenu}
          />
          <Animated.View
            style={[
              styles.trackContextMenu,
              {
                backgroundColor: theme.card,
                borderColor: theme.border,
                right: 16,
                top: albumMenuPosition.y + 10, // Adjust position
                opacity: albumMenuAnim,
                transform: [
                  {
                    scale: albumMenuAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.95, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            {openArtistByName && (
              <>
                <Pressable style={styles.contextMenuItem} onPress={() => {
                  const artistName = typeof album.artist === 'object' ? album.artist?.name : album.artist;
                  openArtistByName(artistName);
                  closeAlbumMenu();
                }}>
                  <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Go to Artist</Text>
                  <Ionicons name="person-outline" size={20} color={theme.primaryText} />
                </Pressable>
                <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
              </>
            )}
            <Pressable style={styles.contextMenuItem} onPress={() => {
              if (addAlbumToQueue) {
                addAlbumToQueue(album);
                closeAlbumMenu();
              }
            }}>
              <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Add to Queue</Text>
              <Ionicons name="list-outline" size={20} color={theme.primaryText} />
            </Pressable>
            <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
            <Pressable style={styles.contextMenuItem} onPress={() => {
              const track = contextMenuTrack;
              setContextMenuTrack(null);
              setSelectedTrackForPlaylist(track);
              setSelectedPlaylists(new Set());
              setPlaylistSheetVisible(true);
            }}>
              <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Add to Playlist</Text>
              <Ionicons name="add-outline" size={20} color={theme.primaryText} />
            </Pressable>
            <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />

            {/* Show in library only if NOT in library */}
            {!isAlbumInLibrary && (
              <>
                <Pressable style={styles.contextMenuItem} onPress={handleAddAlbumToLibrary}>
                  <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Show in library</Text>
                  <Ionicons name="library-outline" size={20} color={theme.primaryText} />
                </Pressable>
                <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
              </>
            )}

            {/* Only show Download/Stop if in library and modules are enabled */}
            {isAlbumInLibrary && useTidalForUnowned && (
              <>
                {albumDownloads[album.key]?.isDownloading ? (
                  <Pressable style={styles.contextMenuItem} onPress={handleStopDownload}>
                    <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Stop downloading</Text>
                    <Ionicons name="close-circle-outline" size={20} color={theme.primaryText} />
                  </Pressable>
                ) : (
                  <Pressable style={styles.contextMenuItem} onPress={handleDownloadAlbum}>
                    <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Make available offline</Text>
                    <Ionicons name="download-outline" size={20} color={theme.primaryText} />
                  </Pressable>
                )}
                <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
              </>
            )}

            {/* Only show Delete if in library */}
            {isAlbumInLibrary && (
              <Pressable style={styles.contextMenuItem} onPress={() => {
                // Placeholder for delete album
                closeAlbumMenu();
              }}>
                <Text style={[styles.contextMenuText, { color: theme.error }]}>Delete</Text>
                <Ionicons name="trash-outline" size={20} color={theme.error} />
              </Pressable>
            )}
          </Animated.View>
        </>
      )}

      {/* Context Menu */}
      {contextMenuTrack && (
        <>
          {/* Transparent backdrop to dismiss menu */}
          <Pressable
            style={styles.transparentBackdrop}
            onPress={closeContextMenu}
          />
          <Animated.View
            style={[
              styles.trackContextMenu,
              {
                backgroundColor: theme.card,
                borderColor: theme.border,
                right: 16,
                top: menuPosition.y,
                opacity: menuAnim,
                transform: [
                  {
                    scale: menuAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.95, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            {openArtistByName && (
              <>
                <Pressable style={styles.contextMenuItem} onPress={handleGoToArtist}>
                  <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Go to Artist</Text>
                  <Ionicons name="person-outline" size={20} color={theme.primaryText} />
                </Pressable>
                <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
              </>
            )}
            <Pressable style={styles.contextMenuItem} onPress={handleAddToQueue}>
              <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Add to Queue</Text>
              <Ionicons name="list-outline" size={20} color={theme.primaryText} />
            </Pressable>
            <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
            <Pressable style={styles.contextMenuItem} onPress={() => {
              const track = contextMenuTrack;
              setContextMenuTrack(null);
              setSelectedTrackForPlaylist(track);
              setSelectedPlaylists(new Set());
              setPlaylistSheetVisible(true);
            }}>
              <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Add to Playlist</Text>
              <Ionicons name="add-outline" size={20} color={theme.primaryText} />
            </Pressable>
            <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
            <Pressable style={styles.contextMenuItem} onPress={handleEditTrack}>
              <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Edit</Text>
              <Ionicons name="pencil-outline" size={20} color={theme.primaryText} />
            </Pressable>
            <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
            <Pressable style={styles.contextMenuItem} onPress={handleDeleteTrack}>
              <Text style={[styles.contextMenuText, { color: theme.error }]}>Delete</Text>
              <Ionicons name="trash-outline" size={20} color={theme.error} />
            </Pressable>
          </Animated.View>
        </>
      )}

      {/* Edit Track Modal */}
      <Modal
        visible={editModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.primaryText }]}>Edit Track</Text>
            <TextInput
              style={[
                styles.modalInput,
                {
                  backgroundColor: theme.inputBackground,
                  borderColor: theme.inputBorder,
                  color: theme.primaryText,
                },
              ]}
              placeholder="Track name"
              placeholderTextColor={theme.secondaryText}
              value={editTrackName}
              onChangeText={setEditTrackName}
            />
            <TextInput
              style={[
                styles.modalInput,
                {
                  backgroundColor: theme.inputBackground,
                  borderColor: theme.inputBorder,
                  color: theme.primaryText,
                },
              ]}
              placeholder="Artist"
              placeholderTextColor={theme.secondaryText}
              value={editTrackArtist}
              onChangeText={setEditTrackArtist}
            />
            <TextInput
              style={[
                styles.modalInput,
                {
                  backgroundColor: theme.inputBackground,
                  borderColor: theme.inputBorder,
                  color: theme.primaryText,
                },
              ]}
              placeholder="Album"
              placeholderTextColor={theme.secondaryText}
              value={editTrackAlbum}
              onChangeText={setEditTrackAlbum}
            />
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, { backgroundColor: theme.inputBackground }]}
                onPress={() => setEditModalVisible(false)}
              >
                <Text style={[styles.modalButtonText, { color: theme.primaryText }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, { backgroundColor: theme.primaryText }]}
                onPress={saveTrackEdit}
              >
                <Text style={[styles.modalButtonText, { color: theme.background }]}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Playlist Selection Bottom Sheet */}
      <Modal
        visible={playlistSheetVisible}
        transparent={true}
        animationType="none"
        onRequestClose={closePlaylistSheet}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={closePlaylistSheet}
        >
          {/* Bottom Sheet */}
          <Animated.View
            style={[
              styles.playlistSheet,
              {
                backgroundColor: theme.card,
                transform: [{
                  translateY: sheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1000, 0],
                  })
                }]
              }
            ]}
          >
            <Pressable style={{ flex: 1 }} onPress={() => { }}>
              {/* Handle Bar */}
              <View style={[styles.sheetHandle, { backgroundColor: theme.secondaryText, opacity: 0.3 }]} />

              {/* Header */}
              <View style={styles.sheetHeader}>
                <Pressable onPress={closePlaylistSheet} style={styles.sheetHeaderButton} hitSlop={10}>
                  <Text style={[styles.sheetHeaderButtonText, { color: theme.accent }]}>Cancel</Text>
                </Pressable>
                <Text style={[styles.sheetTitle, { color: theme.primaryText }]}>
                  Add to Playlist
                </Text>
                <Pressable
                  onPress={handleAddToSelectedPlaylists}
                  disabled={selectedPlaylists.size === 0}
                  style={[styles.sheetHeaderButton, { opacity: selectedPlaylists.size > 0 ? 1 : 0.3 }]}
                  hitSlop={10}
                >
                  <Text style={[styles.sheetHeaderButtonText, { color: theme.accent, fontWeight: '600' }]}>Done</Text>
                </Pressable>
              </View>

              {/* Playlists List */}
              <ScrollView
                style={styles.playlistsScrollView}
                contentContainerStyle={{ paddingBottom: 40 }}
                showsVerticalScrollIndicator={false}
              >
                {/* Create New Playlist Row */}
                <Pressable
                  style={[styles.playlistItem, { borderBottomColor: theme.border }]}
                  onPress={() => {
                    closePlaylistSheet();
                    navigation.navigate('AddPlaylist', {
                      theme,
                      showNotification,
                      onPlaylistAdded: (newPlaylist) => {
                        // Optional handling
                      }
                    });
                  }}
                >
                  <View style={[styles.createPlaylistIcon, { backgroundColor: theme.accent }]}>
                    <Ionicons name="add" size={24} color={theme.background} />
                  </View>
                  <Text style={[styles.createPlaylistText, { color: theme.primaryText }]}>
                    Create New Playlist
                  </Text>
                </Pressable>

                {playlists && playlists.length > 0 ? (
                  playlists.map((playlist, index) => {
                    const isSelected = selectedPlaylists.has(playlist.id);
                    return (
                      <Pressable
                        key={playlist.id || index}
                        style={[styles.playlistItem, { borderBottomColor: theme.border }]}
                        onPress={() => togglePlaylistSelection(playlist.id)}
                      >
                        <Image
                          source={playlist.image ? { uri: playlist.image } : require('../../assets/adaptive-icon.png')}
                          style={styles.playlistImage}
                        />

                        <View style={styles.playlistInfo}>
                          <Text style={[styles.playlistName, { color: theme.primaryText }]} numberOfLines={1}>
                            {playlist.name}
                          </Text>
                          <Text style={[styles.playlistTrackCount, { color: theme.secondaryText }]}>
                            {playlist.tracks ? playlist.tracks.length : 0} tracks
                          </Text>
                        </View>

                        {/* Selection Indicator */}
                        {isSelected ? (
                          <Ionicons name="checkmark-circle" size={24} color={theme.accent} />
                        ) : (
                          <View style={[styles.circleOutline, { borderColor: theme.secondaryText }]} />
                        )}
                      </Pressable>
                    );
                  })
                ) : (
                  <View style={styles.emptyPlaylists}>
                    <Text style={[styles.emptyText, { color: theme.secondaryText }]}>
                      No playlists found
                    </Text>
                  </View>
                )}
              </ScrollView>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  header: {
    paddingTop: 40,
    paddingHorizontal: 16,
    paddingBottom: 8,
    zIndex: 10,
  },
  backButton: {
    padding: 8,
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  scrollViewContent: {
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  artworkContainer: {
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  albumArtwork: {
    width: 280,
    height: 280,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  albumInfoSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  albumTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 6,
  },
  albumArtist: {
    fontSize: 16,
    marginBottom: 4,
  },
  albumMeta: {
    fontSize: 14,
    opacity: 0.6,
  },
  actionButtonsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 32,
    paddingHorizontal: 8,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  playButton: {
    // Primary button style
  },
  shuffleButton: {
    borderWidth: 1,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  trackListSection: {
    marginTop: 8,
  },
  discHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 12,
    marginTop: 8,
    gap: 8,
  },
  discHeaderText: {
    fontSize: 16,
    fontWeight: '600',
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trackNumberContainer: {
    width: 32,
    alignItems: 'center',
  },
  trackNumber: {
    fontSize: 14,
    fontWeight: '500',
  },
  trackInfo: {
    flex: 1,
    marginLeft: 12,
  },
  trackName: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 2,
  },
  trackArtist: {
    fontSize: 14,
  },
  loading: {
    marginTop: 50,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 50,
    fontSize: 16,
  },
  trackContextMenu: {
    position: 'absolute',
    width: 200,
    borderRadius: 10,
    borderWidth: 1,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 6,
    zIndex: 1000,
  },
  contextMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  contextMenuText: {
    fontSize: 16,
    fontWeight: '500',
  },
  contextMenuDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 8,
  },
  transparentBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    zIndex: 999,
  },
  contextMenuBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 999,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '80%',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    fontSize: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  // Bottom Sheet Styles
  sheetBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    zIndex: 1000,
  },
  playlistSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '92%',
    height: '92%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 16,
    zIndex: 1001,
    paddingBottom: 34,
  },
  sheetHandle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.2)',
    height: 50,
  },
  sheetHeaderButton: {
    padding: 8,
    minWidth: 60,
  },
  sheetHeaderButtonText: {
    fontSize: 17,
    fontWeight: '400',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    flex: 1,
  },
  createPlaylistIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  createPlaylistText: {
    fontSize: 17,
    fontWeight: '500',
  },
  playlistsScrollView: {
    flex: 1,
  },
  playlistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  playlistImage: {
    width: 48,
    height: 48,
    borderRadius: 6,
    marginRight: 16,
  },
  playlistInfo: {
    flex: 1,
    marginRight: 12,
  },
  playlistName: {
    fontSize: 17,
    fontWeight: '500',
    marginBottom: 2,
  },
  playlistTrackCount: {
    fontSize: 15,
  },
  circleOutline: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    opacity: 0.3,
  },
  emptyPlaylists: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 17,
    marginBottom: 8,
  },
});
