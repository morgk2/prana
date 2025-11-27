import { DownloadProvider, useDownload } from './src/context/DownloadContext';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TextInput, Button, ActivityIndicator, Image, FlatList, ScrollView, Pressable, useColorScheme, Animated, Modal, Alert, useWindowDimensions, Linking } from 'react-native';
import { useState, useEffect, useMemo, useRef } from 'react';
import { NavigationContainer, StackActions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAudioMetadata } from './src/utils/audioMetadata';
import { searchLastfmArtists, searchLastfmTracks, searchLastfmAlbums, getArtistTopTracks, getArtistTopAlbums, getAlbumInfo } from './src/api/lastfm';
import ArtistPage from './src/components/ArtistPage';
import LibraryAlbumPage from './src/components/LibraryAlbumPage';
import LibraryArtists from './src/components/LibraryArtists';
import LibraryAlbums from './src/components/LibraryAlbums';
import LibrarySongs from './src/components/LibrarySongs';
import LibraryPlaylists from './src/components/LibraryPlaylists';
import AddPlaylist from './src/components/AddPlaylist';
import PlaylistPage from './src/components/PlaylistPage';
import ImportExternalPlaylist from './src/components/ImportExternalPlaylist';
import SongPlayer from './src/components/SongPlayer';
import HomeScreen from './src/components/HomeScreen';
import ModulesPage from './src/components/ModulesPage';
import PlayerColorsPage from './src/components/PlayerColorsPage';
import { colors } from './src/theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { ModuleManager } from './src/services/ModuleManager';
import * as Notifications from 'expo-notifications';
import { clearArtworkCacheManually, getArtworkWithFallback } from './src/utils/artworkFallback';
import { clearCache as clearTidalCache } from './src/utils/tidalCache';
import { getPlayableTrack } from './src/utils/tidalStreamHelper';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// ... existing imports ...

function pickImageUrl(images, preferredSize = 'large') {
  if (!Array.isArray(images)) return null;
  // Last.fm image objects have keys: ['#text', 'size']
  const preferred = images.find((img) => img.size === preferredSize && img['#text']);
  if (preferred) return preferred['#text'];
  const any = images.find((img) => img['#text']);
  return any ? any['#text'] : null;
}

function scoreNameMatch(name, q) {
  if (!name || !q) return 0;
  const n = name.toLowerCase();
  const s = q.toLowerCase();
  if (n === s) return 100;
  if (n.startsWith(s)) return 70;
  if (n.includes(s)) return 40;
  return 10;
}

const LIBRARY_DIR = FileSystem.documentDirectory + 'library';
const LIBRARY_FILE = LIBRARY_DIR + '/tracks.json';
const ARTISTS_FILE = LIBRARY_DIR + '/artists.json';
const PLAYLISTS_FILE = LIBRARY_DIR + '/playlists.json';
const SETTINGS_FILE = LIBRARY_DIR + '/settings.json';
const PLAYER_STATE_FILE = LIBRARY_DIR + '/player_state.json';

const LibraryStack = createNativeStackNavigator();
const RootStack = createNativeStackNavigator();

function detectIntent(query, artistResults, albumResults, trackResults) {
  const q = query.trim();
  const qLower = q.toLowerCase();
  if (!q) return 'mixed';

  const topArtist = artistResults[0];
  const topAlbum = albumResults[0];
  const topTrack = trackResults[0];

  // 1) exact equality
  if (topArtist && topArtist.name.toLowerCase() === qLower) return 'artist';
  if (topAlbum && topAlbum.name.toLowerCase() === qLower) return 'album';
  if (topTrack && topTrack.name.toLowerCase() === qLower) return 'track';

  // 2) score-based dominance
  const artistScore = topArtist ? scoreNameMatch(topArtist.name, q) : 0;
  const albumScore = topAlbum ? scoreNameMatch(topAlbum.name, q) : 0;
  const trackScore = topTrack ? scoreNameMatch(topTrack.name, q) : 0;

  const maxScore = Math.max(artistScore, albumScore, trackScore);
  const dominance = 1.3;

  if (
    artistScore === maxScore &&
    artistScore > dominance * albumScore &&
    artistScore > dominance * trackScore
  ) {
    return 'artist';
  }

  if (
    albumScore === maxScore &&
    albumScore > dominance * artistScore &&
    albumScore > dominance * trackScore
  ) {
    return 'album';
  }

  if (
    trackScore === maxScore &&
    trackScore > dominance * artistScore &&
    trackScore > dominance * albumScore
  ) {
    return 'track';
  }

  // 3) pattern hints
  if (qLower.includes(' - ') || qLower.includes(' by ')) return 'track';
  if (
    qLower.includes(' album') ||
    qLower.includes(' ep') ||
    qLower.includes(' lp')
  ) {
    return 'album';
  }

  return 'mixed';
}


function LibraryHomeScreen({ route, navigation }) {
  const { theme, libraryAlbums, libraryArtists, library, playlists, addPlaylist, deletePlaylist, updatePlaylist, showNotification, pickLocalAudio, deleteAlbum, updateAlbum, openTrackPlayer, openArtistPage, addAlbumToQueue, addToQueue, currentTrack, insets, deleteTrack, updateTrack, addToLibrary, useTidalForUnowned, playerControls, clearAllData, addTrackToPlaylist, reloadArtwork } = route.params;
  const { height: screenHeight } = useWindowDimensions();

  const [contextMenuAlbum, setContextMenuAlbum] = useState(null);
  const [selectedAlbumKey, setSelectedAlbumKey] = useState(null);
  const [menuAnim] = useState(new Animated.Value(0));
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editAlbumName, setEditAlbumName] = useState('');
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const albumRefs = useRef({});
  const albumScaleAnims = useRef({});


  const openContextMenu = (album, albumKey) => {
    const ref = albumRefs.current[albumKey];
    if (ref) {
      // Trigger haptic feedback
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      ref.measure((x, y, width, height, pageX, pageY) => {
        const MENU_HEIGHT = 220; // Approximate height of the menu
        const OFFSET = 60; // Overlap offset

        // Default position (below with overlap)
        let finalY = pageY + height - OFFSET;

        // If menu would go off screen bottom, show above instead
        if (finalY + MENU_HEIGHT > screenHeight - 20) { // 20px buffer
          finalY = pageY - MENU_HEIGHT + OFFSET;
        }

        setMenuPosition({ x: pageX, y: finalY });
        setContextMenuAlbum(album);
        setSelectedAlbumKey(albumKey);

        // Animate menu
        Animated.spring(menuAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 100,
          friction: 10,
        }).start();

        // Animate album scale up
        if (!albumScaleAnims.current[albumKey]) {
          albumScaleAnims.current[albumKey] = new Animated.Value(1);
        }
        Animated.spring(albumScaleAnims.current[albumKey], {
          toValue: 1.05,
          useNativeDriver: true,
          tension: 100,
          friction: 10,
        }).start();
      });
    }
  };

  const closeContextMenu = () => {
    const currentAlbumKey = selectedAlbumKey;

    // Animate menu out
    Animated.timing(menuAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setContextMenuAlbum(null);
      setSelectedAlbumKey(null);
    });

    // Animate album scale back down
    if (currentAlbumKey && albumScaleAnims.current[currentAlbumKey]) {
      Animated.spring(albumScaleAnims.current[currentAlbumKey], {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 10,
      }).start();
    }
  };

  const handleEditAlbum = () => {
    setEditAlbumName(contextMenuAlbum.title);
    setEditModalVisible(true);
    closeContextMenu();
  };

  const handleDeleteAlbum = async () => {
    if (contextMenuAlbum && deleteAlbum) {
      await deleteAlbum(contextMenuAlbum.title);
      closeContextMenu();
    }
  };

  const handleAddAlbumToQueue = () => {
    if (contextMenuAlbum && contextMenuAlbum.tracks && addAlbumToQueue) {
      addAlbumToQueue(contextMenuAlbum.tracks);
      closeContextMenu();
    }
  };

  const saveAlbumEdit = async () => {
    if (contextMenuAlbum && updateAlbum && editAlbumName.trim()) {
      await updateAlbum(contextMenuAlbum.title, editAlbumName.trim());
      setEditModalVisible(false);
      setEditAlbumName('');
    }
  };

  const renderArtistGridItem = ({ item }) => {
    const artist = item;
    const imageUrl = pickImageUrl(artist.image, 'large');
    return (
      <Pressable style={styles.libraryCard} onPress={() => openArtistPage(artist)}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={[styles.libraryArtwork, { borderRadius: 100 }]} />
        ) : (
          <View style={[styles.libraryArtwork, { backgroundColor: theme.card, borderRadius: 100 }]}>
            <Ionicons name="person" size={60} color={theme.secondaryText} />
          </View>
        )}
        <Text style={[styles.libraryCardTitle, { color: theme.primaryText }]} numberOfLines={1}>
          {artist.name}
        </Text>
        <Text style={[styles.libraryCardArtist, { color: theme.secondaryText }]} numberOfLines={1}>
          {artist.listeners ? `${Number(artist.listeners).toLocaleString()} listeners` : 'Artist'}
        </Text>
      </Pressable>
    );
  };

  const renderAlbumGridItem = ({ item, index }) => {
    const album = item;
    const albumKey = `album-${index}`;

    // Initialize scale animation for this album if it doesn't exist
    if (!albumScaleAnims.current[albumKey]) {
      albumScaleAnims.current[albumKey] = new Animated.Value(1);
    }

    return (
      <Animated.View
        ref={(ref) => { if (ref) albumRefs.current[albumKey] = ref; }}
        collapsable={false}
        style={{
          transform: [{ scale: albumScaleAnims.current[albumKey] }],
        }}
      >
        <Pressable
          style={styles.libraryCard}
          onPress={() => navigation.navigate('LibraryAlbum', {
            album,
            theme,
            onTrackPress: openTrackPlayer,
            libraryAlbums,
            library,
            deleteTrack,
            updateTrack,
            addToQueue,
            addAlbumToQueue,
            addToLibrary,
            useTidalForUnowned,
            currentTrack,
            isPlaying: playerControls?.isPlaying,
            togglePlay: playerControls?.togglePlay,
            reloadArtwork,
          })}
          onLongPress={() => openContextMenu(album, albumKey)}
        >
          {album.artwork ? (
            <Image source={{ uri: album.artwork }} style={styles.libraryArtwork} />
          ) : (
            <View style={[styles.libraryArtwork, { backgroundColor: theme.card }]}>
              <Ionicons name="disc-outline" size={60} color={theme.secondaryText} />
            </View>
          )}
          <Text style={[styles.libraryCardTitle, { color: theme.primaryText }]} numberOfLines={1}>
            {album.title}
          </Text>
          <Text style={[styles.libraryCardArtist, { color: theme.secondaryText }]} numberOfLines={1}>
            {album.artist}
          </Text>
        </Pressable>
      </Animated.View>
    );
  };

  return (
    <View style={{ flex: 1, paddingTop: 60, backgroundColor: theme.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: Math.max(130, insets.bottom + 100) }}
        scrollEnabled={!contextMenuAlbum}
      >
        {/* Header with Title, Settings and Add Button */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 20 }}>
          <Text style={[styles.title, { color: theme.primaryText }]}>Library</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Pressable onPress={pickLocalAudio} hitSlop={10}>
              <Ionicons name="add" size={28} color={theme.primaryText} />
            </Pressable>
            <Pressable onPress={() => navigation.navigate('Settings', { theme, library, libraryArtists, libraryAlbums, clearAllData, addPlaylist, showNotification })} hitSlop={10}>
              <Ionicons name="cog" size={26} color={theme.primaryText} />
            </Pressable>
          </View>
        </View>

        {/* Navigation Buttons */}
        <View style={[styles.libraryNavContainer, { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }]}>
          <Pressable
            style={[styles.libraryNavButton, styles.libraryNavButtonFirst, { borderBottomColor: theme.border }]}
            onPress={() => navigation.navigate('LibraryPlaylists', {
              theme,
              playlists,
              library,
              addPlaylist,
              deletePlaylist,
              updatePlaylist,
              showNotification,
              onTrackPress: openTrackPlayer,
              currentTrack,
              addToQueue,
              addAlbumToQueue,
              useTidalForUnowned,
              onPlaylistPress: (playlist) => console.log('Open playlist', playlist)
            })}
          >
            <View style={styles.libraryNavIconContainer}>
              <Ionicons name="list" size={28} color={theme.primaryText} />
            </View>
            <Text style={[styles.libraryNavText, { color: theme.primaryText }]}>Playlists</Text>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>

          <Pressable
            style={[styles.libraryNavButton, { borderBottomColor: theme.border }]}
            onPress={() => navigation.navigate('LibraryArtists', { theme, libraryArtists, openArtistPage })}
          >
            <View style={styles.libraryNavIconContainer}>
              <Ionicons name="person" size={28} color={theme.primaryText} />
            </View>
            <Text style={[styles.libraryNavText, { color: theme.primaryText }]}>Artists</Text>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>

          <Pressable
            style={[styles.libraryNavButton, { borderBottomColor: theme.border }]}
            onPress={() => navigation.navigate('LibraryAlbums', { theme, libraryAlbums, onTrackPress: openTrackPlayer, reloadArtwork })}
          >
            <View style={styles.libraryNavIconContainer}>
              <Ionicons name="albums" size={28} color={theme.primaryText} />
            </View>
            <Text style={[styles.libraryNavText, { color: theme.primaryText }]}>Albums</Text>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>

          <Pressable
            style={[styles.libraryNavButton, styles.libraryNavButtonLast, { borderBottomWidth: 0 }]}
            onPress={() => navigation.navigate('LibrarySongs', { theme, library, onTrackPress: openTrackPlayer, addToQueue, deleteTrack, updateTrack, playlists, addTrackToPlaylist, showNotification })}
          >
            <View style={styles.libraryNavIconContainer}>
              <Ionicons name="musical-note" size={28} color={theme.primaryText} />
            </View>
            <Text style={[styles.libraryNavText, { color: theme.primaryText }]}>Songs</Text>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>
        </View>

        {
          libraryAlbums.length > 0 || libraryArtists.length > 0 ? (
            <View style={{ paddingHorizontal: 16 }}>
              <View style={styles.libraryGridRow}>
                {libraryAlbums.map((album, index) => (
                  <View key={`lib-album-${index}`} style={{ width: '50%', paddingHorizontal: 4 }}>
                    {renderAlbumGridItem({ item: album, index })}
                  </View>
                ))}
                {libraryArtists.map((artist, index) => (
                  <View key={`lib-artist-${index}`} style={{ width: '50%', paddingHorizontal: 4 }}>
                    {renderArtistGridItem({ item: artist })}
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <View style={styles.emptyLibrary}>
              <Ionicons
                name="musical-notes-outline"
                size={80}
                color={theme.secondaryText}
                style={{ opacity: 0.3, marginBottom: 16 }}
              />
              <Text style={{ color: theme.secondaryText, textAlign: 'center', fontSize: 16 }}>
                No albums yet
              </Text>
              <Text style={{ color: theme.secondaryText, textAlign: 'center', marginTop: 8 }}>
                Import songs with album metadata to see them grouped here
              </Text>
            </View>
          )
        }
      </ScrollView >

      {/* Context Menu */}
      {
        contextMenuAlbum && (
          <>
            {/* Transparent backdrop to dismiss menu */}
            <Pressable
              style={styles.transparentBackdrop}
              onPress={closeContextMenu}
            />
            <Animated.View
              style={[
                styles.albumContextMenu,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                  left: menuPosition.x,
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
              <Pressable style={styles.contextMenuItem} onPress={handleAddAlbumToQueue}>
                <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Add to Queue</Text>
                <Ionicons name="list-outline" size={20} color={theme.primaryText} />
              </Pressable>
              <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
              <Pressable style={styles.contextMenuItem} onPress={() => console.log('Add to Playlist')}>
                <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Add to Playlist</Text>
                <Ionicons name="add-outline" size={20} color={theme.primaryText} />
              </Pressable>
              <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
              <Pressable style={styles.contextMenuItem} onPress={handleEditAlbum}>
                <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Edit</Text>
                <Ionicons name="pencil-outline" size={20} color={theme.primaryText} />
              </Pressable>
              <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
              <Pressable style={styles.contextMenuItem} onPress={handleDeleteAlbum}>
                <Text style={[styles.contextMenuText, { color: theme.error }]}>Delete</Text>
                <Ionicons name="trash-outline" size={20} color={theme.error} />
              </Pressable>
            </Animated.View>
          </>
        )
      }

      {/* Edit Album Modal */}
      <Modal
        visible={editModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.primaryText }]}>Edit Album</Text>
            <TextInput
              style={[
                styles.modalInput,
                {
                  backgroundColor: theme.inputBackground,
                  borderColor: theme.inputBorder,
                  color: theme.primaryText,
                },
              ]}
              placeholder="Album name"
              placeholderTextColor={theme.secondaryText}
              value={editAlbumName}
              onChangeText={setEditAlbumName}
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
                onPress={saveAlbumEdit}
              >
                <Text style={[styles.modalButtonText, { color: theme.background }]}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

    </View >
  );
}

// Cache Page
function CachePage({ route, navigation }) {
  const { theme, library, libraryArtists, libraryAlbums, clearAllData } = route.params;
  const { resetDownloads } = useDownload();
  const [storageInfo, setStorageInfo] = useState({ free: 0, total: 0, used: 0, appUsed: 0 });

  useEffect(() => {
    loadStorageInfo();
  }, []);

  const loadStorageInfo = async () => {
    try {
      const free = await FileSystem.getFreeDiskStorageAsync();
      const total = await FileSystem.getTotalDiskCapacityAsync();

      // Estimate app usage (documents folder)
      let appUsed = 0;
      try {
        const docInfo = await FileSystem.getInfoAsync(FileSystem.documentDirectory, { size: true });
        if (docInfo.exists && docInfo.size) {
          appUsed = docInfo.size;
        }
      } catch (err) {
        console.log('Failed to get app size', err);
      }

      setStorageInfo({ free, total, used: total - free, appUsed });
    } catch (e) {
      console.warn('Failed to load storage info', e);
    }
  };

  const formatBytes = (bytes, decimals = 2) => {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  const getUsagePercentages = () => {
    if (storageInfo.total === 0) return { app: 0, other: 0, free: 0 };
    const app = (storageInfo.appUsed / storageInfo.total) * 100;
    const totalUsed = (storageInfo.used / storageInfo.total) * 100;
    const other = Math.max(0, totalUsed - app);
    return { app, other, free: 100 - totalUsed };
  };

  const handleClearArtworkCache = () => {
    Alert.alert(
      'Clear Artwork Cache',
      'This will clear all cached album and song covers. They will be downloaded again when needed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearArtworkCacheManually();
              Alert.alert('Success', 'Artwork cache cleared successfully');
            } catch (error) {
              Alert.alert('Error', 'Failed to clear artwork cache');
              console.error('Error clearing artwork cache:', error);
            }
          }
        }
      ]
    );
  };

  const handleClearStreamCache = () => {
    Alert.alert(
      'Clear Stream Cache',
      'This will clear all cached streaming links. Use this if songs are failing to play or if you switched streaming quality.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearTidalCache();
              Alert.alert('Success', 'Stream cache cleared successfully');
            } catch (error) {
              Alert.alert('Error', 'Failed to clear stream cache');
              console.error('Error clearing stream cache:', error);
            }
          }
        }
      ]
    );
  };

  const handleClearData = () => {
    Alert.alert(
      'Clear All Data',
      'Are you sure you want to delete all music, artists, and settings? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (clearAllData) {
              if (resetDownloads) await resetDownloads();
              await clearAllData();
              navigation.goBack();
            }
          }
        }
      ]
    );
  };

  const percentages = getUsagePercentages();

  return (
    <View style={[styles.settingsPageContainer, { backgroundColor: theme.background }]}>
      <View style={styles.settingsPageHeader}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backButtonContainer}>
          <Ionicons name="chevron-back" size={32} color={theme.primaryText} />
        </Pressable>
        <Text style={[styles.settingsPageTitle, { color: theme.primaryText }]}>Storage & Cache</Text>
      </View>

      <ScrollView style={{ flex: 1 }}>
        <View style={styles.settingsSection}>
          <Text style={[styles.sectionHeader, { color: theme.primaryText, marginBottom: 20 }]}>Library Stats</Text>

          <View style={[styles.settingsRow, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
            <Text style={[styles.settingsRowText, { color: theme.primaryText }]}>Songs</Text>
            <Text style={{ color: theme.secondaryText, fontSize: 16 }}>{library?.length || 0}</Text>
          </View>

          <View style={[styles.settingsRow, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
            <Text style={[styles.settingsRowText, { color: theme.primaryText }]}>Albums</Text>
            <Text style={{ color: theme.secondaryText, fontSize: 16 }}>{libraryAlbums?.length || 0}</Text>
          </View>

          <View style={[styles.settingsRow, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
            <Text style={[styles.settingsRowText, { color: theme.primaryText }]}>Artists</Text>
            <Text style={{ color: theme.secondaryText, fontSize: 16 }}>{libraryArtists?.length || 0}</Text>
          </View>
        </View>

        <View style={styles.settingsSection}>
          <Text style={[styles.sectionHeader, { color: theme.primaryText, marginBottom: 20 }]}>Device Storage</Text>

          <View style={[styles.settingsRow, { backgroundColor: theme.card, flexDirection: 'column', alignItems: 'flex-start', gap: 12 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
              <Text style={[styles.settingsRowText, { color: theme.primaryText }]}>8SPINE</Text>
              <Text style={{ color: theme.primaryText }}>{formatBytes(storageInfo.appUsed)}</Text>
            </View>

            <View style={{ height: 8, width: '100%', backgroundColor: theme.border, borderRadius: 4, overflow: 'hidden', flexDirection: 'row' }}>
              {/* App Usage */}
              <View
                style={{
                  height: '100%',
                  width: `${percentages.app}%`,
                  backgroundColor: theme.primaryText,
                }}
              />
              {/* Other Usage */}
              <View
                style={{
                  height: '100%',
                  width: `${percentages.other}%`,
                  backgroundColor: theme.secondaryText,
                  opacity: 0.3
                }}
              />
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.primaryText }} />
                  <Text style={{ color: theme.secondaryText, fontSize: 12 }}>8SPINE</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.secondaryText, opacity: 0.3 }} />
                  <Text style={{ color: theme.secondaryText, fontSize: 12 }}>Other</Text>
                </View>
              </View>
              <Text style={{ color: theme.secondaryText, fontSize: 12 }}>
                Free: {formatBytes(storageInfo.free)}
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.settingsSection, { marginTop: 20 }]}>
          <Text style={[styles.sectionHeader, { color: theme.primaryText, marginBottom: 12 }]}>Cache Management</Text>

          <Pressable
            style={[styles.settingsRow, { backgroundColor: theme.card, borderBottomColor: theme.border, justifyContent: 'center' }]}
            onPress={handleClearStreamCache}
          >
            <Text style={{ color: theme.accent, fontSize: 17, fontWeight: '600' }}>Clear Stream Cache</Text>
          </Pressable>
          <Text style={{ paddingHorizontal: 16, color: theme.secondaryText, fontSize: 12, marginTop: 8, textAlign: 'center', marginBottom: 20 }}>
            Fix playback issues by removing cached streaming links.
          </Text>

          <Pressable
            style={[styles.settingsRow, { backgroundColor: theme.card, borderBottomColor: theme.border, justifyContent: 'center' }]}
            onPress={handleClearArtworkCache}
          >
            <Text style={{ color: theme.accent, fontSize: 17, fontWeight: '600' }}>Clear Artwork Cache</Text>
          </Pressable>
          <Text style={{ paddingHorizontal: 16, color: theme.secondaryText, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
            Clear cached album and song covers. They will be re-downloaded when needed.
          </Text>
        </View>

        <View style={[styles.settingsSection, { marginTop: 20 }]}>
          <Pressable
            style={[styles.settingsRow, { backgroundColor: theme.card, borderBottomColor: theme.border, justifyContent: 'center' }]}
            onPress={handleClearData}
          >
            <Text style={{ color: theme.error, fontSize: 17, fontWeight: '600' }}>Clear All Data</Text>
          </Pressable>
          <Text style={{ paddingHorizontal: 16, color: theme.secondaryText, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
            This will delete all downloaded music, imported files, and reset your library.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

// Appearance Page
// Appearance Page
function AppearancePage({ route, navigation }) {
  const { theme, userTheme, setUserTheme } = route.params;
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [menuAnim] = useState(new Animated.Value(0));
  const themeRowRef = useRef(null);
  const { height: screenHeight } = useWindowDimensions();

  const openThemeMenu = () => {
    if (themeRowRef.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      themeRowRef.current.measure((x, y, width, height, pageX, pageY) => {
        const MENU_HEIGHT = 180; // Approximate height
        // Align vertically with the row, slightly overlapping or below
        let finalY = pageY + 10;

        // Check bottom overflow
        if (finalY + MENU_HEIGHT > screenHeight - 20) {
          finalY = pageY - MENU_HEIGHT + 20;
        }

        setMenuPosition({ x: pageX + 20, y: finalY });

        setShowThemeMenu(true);
        Animated.spring(menuAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 100,
          friction: 10,
        }).start();
      });
    }
  };

  const closeThemeMenu = () => {
    Animated.timing(menuAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setShowThemeMenu(false);
    });
  };

  const handleSetTheme = (mode) => {
    setUserTheme(mode);
    closeThemeMenu();
  };

  const getThemeLabel = () => {
    if (userTheme === 'auto') return 'Auto';
    if (userTheme === 'light') return 'Light';
    return 'Dark';
  };

  return (
    <View style={[styles.settingsPageContainer, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.settingsPageHeader}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backButtonContainer}>
          <Ionicons name="chevron-back" size={32} color={theme.primaryText} />
        </Pressable>
        <Text style={[styles.settingsPageTitle, { color: theme.primaryText }]}>Appearance</Text>
      </View>

      <ScrollView style={{ flex: 1 }}>
        <View style={styles.settingsSection}>
          <Text style={[styles.sectionHeader, { color: theme.primaryText, marginBottom: 20 }]}>Display</Text>

          <Pressable
            ref={themeRowRef}
            style={[styles.settingsRow, { backgroundColor: theme.card, borderBottomColor: theme.border }]}
            onPress={openThemeMenu}
          >
            <View style={styles.settingsRowLeft}>
              <Ionicons name="color-palette-outline" size={24} color={theme.primaryText} />
              <Text style={[styles.settingsRowText, { color: theme.primaryText }]}>Theme</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: theme.secondaryText, fontSize: 16 }}>{getThemeLabel()}</Text>
              <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
            </View>
          </Pressable>

          <Pressable
            style={[styles.settingsRow, { backgroundColor: theme.card, borderBottomColor: theme.border }]}
            onPress={() => navigation.navigate('PlayerColors', { theme, playerColorMode: route.params.playerColorMode, setPlayerColorMode: route.params.setPlayerColorMode })}
          >
            <View style={styles.settingsRowLeft}>
              <Ionicons name="color-fill-outline" size={24} color={theme.primaryText} />
              <Text style={[styles.settingsRowText, { color: theme.primaryText }]}>Player Colors</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: theme.secondaryText, fontSize: 16 }}>
                {route.params.playerColorMode === 'light' ? 'Light' : 'Dark'}
              </Text>
              <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
            </View>
          </Pressable>
        </View>
      </ScrollView>

      {/* Theme Context Menu */}
      {showThemeMenu && (
        <>
          <Pressable style={styles.transparentBackdrop} onPress={closeThemeMenu} />
          <Animated.View
            style={[
              styles.albumContextMenu,
              {
                width: 250,
                backgroundColor: theme.card,
                borderColor: theme.border,
                position: 'absolute',
                left: menuPosition.x,
                top: menuPosition.y,
                opacity: menuAnim,
                transform: [{
                  scale: menuAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.95, 1],
                  })
                }]
              }
            ]}
          >
            <Pressable style={styles.contextMenuItem} onPress={() => handleSetTheme('light')}>
              <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Light</Text>
              {userTheme === 'light' && <Ionicons name="checkmark" size={20} color={theme.accent} />}
            </Pressable>
            <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
            <Pressable style={styles.contextMenuItem} onPress={() => handleSetTheme('dark')}>
              <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Dark</Text>
              {userTheme === 'dark' && <Ionicons name="checkmark" size={20} color={theme.accent} />}
            </Pressable>
            <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
            <Pressable style={styles.contextMenuItem} onPress={() => handleSetTheme('auto')}>
              <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Auto</Text>
              {userTheme === 'auto' && <Ionicons name="checkmark" size={20} color={theme.accent} />}
            </Pressable>
          </Animated.View>
        </>
      )}
    </View>
  );
}

// Settings Page
function SettingsPage({ route, navigation }) {
  const { theme, library, libraryArtists, libraryAlbums, clearAllData } = route.params;

  return (
    <View style={[styles.settingsPageContainer, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.settingsPageHeader}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backButtonContainer}>
          <Ionicons name="chevron-back" size={32} color={theme.primaryText} />
        </Pressable>
        <Text style={[styles.settingsPageTitle, { color: theme.primaryText }]}>Settings</Text>
      </View>

      <ScrollView style={{ flex: 1 }}>
        <View style={styles.settingsSection}>
          <Pressable
            style={[styles.settingsRow, { backgroundColor: theme.card, borderBottomColor: theme.border }]}
            onPress={() => navigation.navigate('Appearance', { theme })}
          >
            <View style={styles.settingsRowLeft}>
              <Ionicons name="color-palette-outline" size={24} color={theme.primaryText} />
              <Text style={[styles.settingsRowText, { color: theme.primaryText }]}>Appearance</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>

          <Pressable
            style={[styles.settingsRow, { backgroundColor: theme.card, borderBottomColor: theme.border }]}
            onPress={() => navigation.navigate('Cache', { theme, library, libraryArtists, libraryAlbums, clearAllData })}
          >
            <View style={styles.settingsRowLeft}>
              <Ionicons name="stats-chart-outline" size={24} color={theme.primaryText} />
              <Text style={[styles.settingsRowText, { color: theme.primaryText }]}>Storage & Cache</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>

          <Pressable
            style={[styles.settingsRow, { backgroundColor: theme.card, borderBottomColor: theme.border }]}
            onPress={() => navigation.navigate('AdvancedCatalog', { theme })}
          >
            <View style={styles.settingsRowLeft}>
              <Ionicons name="folder-outline" size={24} color={theme.primaryText} />
              <Text style={[styles.settingsRowText, { color: theme.primaryText }]}>Advanced Catalog</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>

          <Pressable
            style={[styles.settingsRow, { backgroundColor: theme.card, borderBottomColor: theme.border }]}
            onPress={() => navigation.navigate('ImportExternalPlaylist', { theme, addPlaylist: route.params.addPlaylist, showNotification: route.params.showNotification })}
          >
            <View style={styles.settingsRowLeft}>
              <Ionicons name="musical-notes-outline" size={24} color={theme.primaryText} />
              <Text style={[styles.settingsRowText, { color: theme.primaryText }]}>Import External Playlists</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>

          <Pressable
            style={[styles.settingsRow, { backgroundColor: theme.card, borderBottomColor: theme.border }]}
            onPress={() => navigation.navigate('About', { theme })}
          >
            <View style={styles.settingsRowLeft}>
              <Ionicons name="information-circle-outline" size={24} color={theme.primaryText} />
              <Text style={[styles.settingsRowText, { color: theme.primaryText }]}>About</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>

          <Pressable
            style={[styles.settingsRow, { backgroundColor: theme.card, borderBottomColor: theme.border }]}
            onPress={() => navigation.navigate('Donate', { theme })}
          >
            <View style={styles.settingsRowLeft}>
              <Ionicons name="heart-outline" size={24} color={theme.primaryText} />
              <Text style={[styles.settingsRowText, { color: theme.primaryText }]}>Donate</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// Advanced Catalog Page
function AdvancedCatalogPage({ route, navigation }) {
  const { theme } = route.params;

  return (
    <View style={[styles.settingsPageContainer, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.settingsPageHeader}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backButtonContainer}>
          <Ionicons name="chevron-back" size={32} color={theme.primaryText} />
        </Pressable>
        <Text style={[styles.settingsPageTitle, { color: theme.primaryText }]}>Advanced Catalog</Text>
      </View>

      <ScrollView style={{ flex: 1 }}>
        <View style={styles.settingsSection}>
          <Pressable
            style={[styles.settingsRow, { backgroundColor: theme.card, borderBottomColor: theme.border }]}
            onPress={() => navigation.navigate('SelfHostedCollection', { theme })}
          >
            <View style={styles.settingsRowLeft}>
              <Ionicons name="server-outline" size={24} color={theme.primaryText} />
              <Text style={[styles.settingsRowText, { color: theme.primaryText }]}>Self Hosted Collection</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// Self Hosted Collection Page
function SelfHostedCollectionPage({ route, navigation }) {
  const { theme } = route.params;

  return (
    <View style={[styles.settingsPageContainer, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.settingsPageHeader}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backButtonContainer}>
          <Ionicons name="chevron-back" size={32} color={theme.primaryText} />
        </Pressable>
        <Text style={[styles.settingsPageTitle, { color: theme.primaryText }]}>Self Hosted Collection</Text>
      </View>

      <ScrollView style={{ flex: 1 }}>
        <View style={styles.settingsSection}>
          <Pressable
            style={[styles.settingsRow, { backgroundColor: theme.card, borderBottomColor: theme.border }]}
            onPress={() => navigation.navigate('Modules', { theme })}
          >
            <View style={styles.settingsRowLeft}>
              <Ionicons name="cube-outline" size={24} color={theme.primaryText} />
              <Text style={[styles.settingsRowText, { color: theme.primaryText }]}>Modules</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// About Page
function AboutPage({ route, navigation }) {
  const { theme } = route.params;

  return (
    <View style={[styles.settingsPageContainer, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.settingsPageHeader}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backButtonContainer}>
          <Ionicons name="chevron-back" size={32} color={theme.primaryText} />
        </Pressable>
        <Text style={[styles.settingsPageTitle, { color: theme.primaryText }]}>About</Text>
      </View>

      <View style={{ flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' }}>
        <Image
          source={require('./assets/logo.png')}
          style={{ width: 120, height: 120, marginBottom: 24, borderRadius: 24, tintColor: theme.primaryText }}
        />
        <Text style={[styles.title, { color: theme.primaryText, marginBottom: 16, textAlign: 'center' }]}>8SPINE</Text>
        <Text style={[styles.secondaryText, { color: theme.secondaryText, textAlign: 'center', fontSize: 16, lineHeight: 24 }]}>
          This is the closed testing of 8SPINE, modular advanced music cataloging and playing app.
        </Text>
      </View>
    </View>
  );
}

// Donate Page
function DonatePage({ route, navigation }) {
  const { theme } = route.params;

  return (
    <View style={[styles.settingsPageContainer, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.settingsPageHeader}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backButtonContainer}>
          <Ionicons name="chevron-back" size={32} color={theme.primaryText} />
        </Pressable>
        <Text style={[styles.settingsPageTitle, { color: theme.primaryText }]}>Donate</Text>
      </View>

      <ScrollView style={{ flex: 1 }}>
        <View style={{ flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' }}>
          <Image
            source={require('./assets/logo.png')}
            style={{ width: 120, height: 120, marginBottom: 24, borderRadius: 24, tintColor: theme.primaryText }}
          />
          <Text style={[styles.title, { color: theme.primaryText, marginBottom: 16, textAlign: 'center' }]}>Support 8SPINE</Text>

          <Text style={[{ color: theme.secondaryText, textAlign: 'center', fontSize: 16, lineHeight: 24, marginBottom: 20 }]}>
            I'm not planning on adding ads to this app, so the only way I'm keeping this app up is by you donating. Help me pay the bills.
          </Text>

          <Text style={[{ color: theme.secondaryText, textAlign: 'center', fontSize: 14, lineHeight: 20, marginBottom: 20, fontStyle: 'italic' }]}>
            I'm doing this for the love of the game, idk how long this love will last tho
          </Text>

          <Text style={[{ color: theme.secondaryText, textAlign: 'center', fontSize: 14, lineHeight: 20, marginBottom: 20 }]}>
            I have a record of publicly lying so, I might bloat the app with ads, you will never know
          </Text>

          <Pressable
            style={[styles.settingsRow, { backgroundColor: theme.card, borderBottomColor: theme.border, marginTop: 20, width: '100%', maxWidth: 300 }]}
            onPress={() => Linking.openURL('https://ko-fi.com/morgk')}
          >
            <View style={styles.settingsRowLeft}>
              <Ionicons name="heart" size={24} color="#FF6B6B" />
              <Text style={[styles.settingsRowText, { color: theme.primaryText }]}>Donate on Ko-Fi</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>

          <Text style={[{ color: theme.secondaryText, textAlign: 'center', fontSize: 14, lineHeight: 20, marginTop: 30 }]}>
            Every donation helps keep 8SPINE ad-free and supports continued development. Thank you for your support! ❤️
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function AppContent() {
  const colorScheme = useColorScheme();
  const [userTheme, setUserTheme] = useState('auto');
  const activeColorScheme = userTheme === 'auto' ? colorScheme : userTheme;
  const theme = colors[activeColorScheme] || colors.dark;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const initModules = async () => {
      await ModuleManager.init();
    };
    initModules();
  }, []);

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [artists, setArtists] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [error, setError] = useState(null);
  const [intent, setIntent] = useState('mixed');

  const handleSearch = async (q) => {
    if (!q || !q.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const [artistResults, trackResults, albumResults] = await Promise.all([
        searchLastfmArtists(q, { limit: 4 }),
        searchLastfmTracks(q, { limit: 10 }),
        searchLastfmAlbums(q, { limit: 10 }),
      ]);

      const detectedIntent = detectIntent(q, artistResults, albumResults, trackResults);
      setIntent(detectedIntent);

      setArtists(artistResults);
      setTracks(trackResults);
      setAlbums(albumResults);
    } catch (err) {
      setError('Failed to fetch results');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Real-time search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) {
        handleSearch(query);
      } else {
        setArtists([]);
        setAlbums([]);
        setTracks([]);
      }
    }, 500); // Debounce 500ms

    return () => clearTimeout(timer);
  }, [query]);

  const addToRecentSearches = (q) => {
    if (!q || !q.trim()) return;
    setRecentSearches((prev) => {
      const filtered = prev.filter((s) => s !== q);
      return [q, ...filtered].slice(0, 10);
    });
  };

  // navigation/state for detail views
  const [view, setView] = useState('search'); // 'search' | 'artist'
  const [selectedArtist, setSelectedArtist] = useState(null);
  const [artistTopTracks, setArtistTopTracks] = useState([]);
  const [artistTopAlbums, setArtistTopAlbums] = useState([]);

  // simple local library playlist of imported tracks
  const [library, setLibrary] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [libraryArtists, setLibraryArtists] = useState([]);
  const libraryAlbums = useMemo(() => {
    const albumMap = new Map();

    const getArtistName = (track) => {
      if (!track) return 'Unknown Artist';
      return (
        track.albumArtist ||
        (track.artist && track.artist.name) ||
        track.artist ||
        'Unknown Artist'
      );
    };

    const getSortableTrackNumber = (track) => {
      if (!track) return null;
      if (typeof track.trackNumber === 'number') return track.trackNumber;
      if (track.trackNumber && !Number.isNaN(Number(track.trackNumber))) {
        return Number(track.trackNumber);
      }
      const rank = track['@attr']?.rank;
      if (rank && !Number.isNaN(Number(rank))) {
        return Number(rank);
      }
      return null;
    };

    library.forEach((track) => {
      // Determine grouping artist: use albumArtist if available, otherwise use artist (stripped of features)
      let groupingArtist = track.albumArtist;

      if (!groupingArtist) {
        const rawArtist = (track.artist && track.artist.name) || track.artist || 'Unknown Artist';
        if (typeof rawArtist === 'string') {
          // Strip features to group under main artist
          groupingArtist = rawArtist.split(/\s+(?:feat\.?|ft\.?|featuring|with)\s+/i)[0].trim();
        } else {
          groupingArtist = 'Unknown Artist';
        }
      }

      const albumName = track?.album?.trim() || 'Unknown Album';

      // Create a unique key for each album-artist combination
      const key = `${albumName}||${groupingArtist}`;

      if (!albumMap.has(key)) {
        albumMap.set(key, {
          key,
          title: albumName,
          artist: groupingArtist, // Use the grouping artist (Album Artist) for the album container
          artwork: null,
          tracks: [],
          lastActivity: 0,
        });
      }

      const entry = albumMap.get(key);
      entry.tracks.push(track);

      // Update timestamps
      if (!entry.lastActivity || (track.dateAdded && track.dateAdded > entry.lastActivity)) {
        entry.lastActivity = track.dateAdded || 0;
      }
      if (track.lastPlayed && track.lastPlayed > entry.lastActivity) {
        entry.lastActivity = track.lastPlayed;
      }

      if (!entry.artwork) {
        const imageUrl = pickImageUrl(track.image, 'extralarge') || pickImageUrl(track.image, 'large');
        if (imageUrl) {
          entry.artwork = imageUrl;
        }
      }
    });

    return Array.from(albumMap.values())
      .map((album) => ({
        ...album,
        tracks: [...album.tracks].sort((a, b) => {
          const aNum = getSortableTrackNumber(a);
          const bNum = getSortableTrackNumber(b);
          if (aNum !== null && bNum !== null && aNum !== bNum) {
            return aNum - bNum;
          }
          if (aNum !== null) return -1;
          if (bNum !== null) return 1;
          return (a?.name || '').localeCompare(b?.name || '');
        }),
      }))
      .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
  }, [library]);

  // bottom tabs: 'home' | 'search' | 'library'
  const [currentTab, setCurrentTab] = useState('home');

  // Recent searches state
  const [recentSearches, setRecentSearches] = useState([]);

  // currently selected track and player view state
  const [currentTrack, setCurrentTrack] = useState(null);
  const [currentQueue, setCurrentQueue] = useState([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);
  const [playerControls, setPlayerControls] = useState({ togglePlay: null, isPlaying: false });
  const [queueNotification, setQueueNotification] = useState(null);

  // Tidal streaming toggle for unowned tracks
  const [useTidalForUnowned, setUseTidalForUnowned] = useState(false);
  const [modules, setModules] = useState({
    tidal: { enabled: true, name: 'Tidal Music' }
  });
  const [shouldAutoPlay, setShouldAutoPlay] = useState(true);
  const [importProgress, setImportProgress] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [isLibraryLoaded, setIsLibraryLoaded] = useState(false);
  const [playerColorMode, setPlayerColorMode] = useState('dark'); // 'dark' | 'light'
  const queueNotificationTimer = useRef(null);
  const queueNotificationAnim = useRef(new Animated.Value(0)).current;


  const loadLibrary = async () => {
    try {
      const dirInfo = await FileSystem.getInfoAsync(LIBRARY_DIR);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(LIBRARY_DIR, { intermediates: true });
      }

      // Load Tracks
      const fileInfo = await FileSystem.getInfoAsync(LIBRARY_FILE);
      if (fileInfo.exists) {
        const json = await FileSystem.readAsStringAsync(LIBRARY_FILE);
        const parsed = JSON.parse(json || '[]');
        if (Array.isArray(parsed)) {
          setLibrary(parsed);
        }
      }

      // Load Artists
      const artistFileInfo = await FileSystem.getInfoAsync(ARTISTS_FILE);
      if (artistFileInfo.exists) {
        const json = await FileSystem.readAsStringAsync(ARTISTS_FILE);
        const parsed = JSON.parse(json || '[]');
        if (Array.isArray(parsed)) {
          setLibraryArtists(parsed);
        }
      } else {
        setLibraryArtists([]);
      }
    } catch (e) {
      console.warn('Failed to load library', e);
    } finally {
      setIsLibraryLoaded(true);
    }
  };

  const loadPlaylists = async () => {
    try {
      const fileInfo = await FileSystem.getInfoAsync(PLAYLISTS_FILE);
      if (fileInfo.exists) {
        const json = await FileSystem.readAsStringAsync(PLAYLISTS_FILE);
        const parsed = JSON.parse(json || '[]');
        if (Array.isArray(parsed)) {
          setPlaylists(parsed);
        }
      }
    } catch (e) {
      console.warn('Failed to load playlists', e);
    }
  };

  const loadSettings = async () => {
    try {
      const fileInfo = await FileSystem.getInfoAsync(SETTINGS_FILE);
      if (fileInfo.exists) {
        const json = await FileSystem.readAsStringAsync(SETTINGS_FILE);
        const settings = JSON.parse(json || '{}');
        if (settings.useTidalForUnowned !== undefined) {
          setUseTidalForUnowned(settings.useTidalForUnowned);
        }
        if (settings.modules) {
          setModules(settings.modules);
        }
        if (settings.playerColorMode !== undefined) {
          setPlayerColorMode(settings.playerColorMode);
        }
        if (settings.userTheme) {
          setUserTheme(settings.userTheme);
        }
      }
    } catch (e) {
      console.warn('Failed to load settings', e);
    }
  };

  const loadPlayerState = async () => {
    try {
      const fileInfo = await FileSystem.getInfoAsync(PLAYER_STATE_FILE);
      if (fileInfo.exists) {
        const json = await FileSystem.readAsStringAsync(PLAYER_STATE_FILE);
        const state = JSON.parse(json || '{}');

        if (state.currentTrack) {
          // Don't auto-play when restoring session
          setShouldAutoPlay(false);
          setCurrentTrack(state.currentTrack);
          if (state.currentQueue) setCurrentQueue(state.currentQueue);
          if (state.currentQueueIndex !== undefined) setCurrentQueueIndex(state.currentQueueIndex);
        }
      }
    } catch (e) {
      console.warn('Failed to load player state', e);
    }
  };

  const savePlayerState = async (state) => {
    try {
      await FileSystem.writeAsStringAsync(PLAYER_STATE_FILE, JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save player state', e);
    }
  };

  // Auto-save player state
  useEffect(() => {
    if (currentTrack) {
      savePlayerState({
        currentTrack,
        currentQueue,
        currentQueueIndex
      });
    }
  }, [currentTrack, currentQueue, currentQueueIndex]);

  const saveSettings = async (partialSettings) => {
    try {
      let currentSettings = {};
      const fileInfo = await FileSystem.getInfoAsync(SETTINGS_FILE);
      if (fileInfo.exists) {
        const json = await FileSystem.readAsStringAsync(SETTINGS_FILE);
        currentSettings = JSON.parse(json || '{}');
      }
      const updatedSettings = { ...currentSettings, ...partialSettings };
      await FileSystem.writeAsStringAsync(SETTINGS_FILE, JSON.stringify(updatedSettings));
    } catch (e) {
      console.warn('Failed to save settings', e);
    }
  };

  const clearAllData = async () => {
    try {
      setLibrary([]);
      setLibraryArtists([]);
      setPlaylists([]);
      setAlbums([]);
      setTracks([]);
      setArtists([]);

      // Delete the library folder (metadata)
      await FileSystem.deleteAsync(LIBRARY_DIR, { idempotent: true });
      await FileSystem.makeDirectoryAsync(LIBRARY_DIR, { intermediates: true });

      // Delete media files in the root document directory
      const files = await FileSystem.readDirectoryAsync(FileSystem.documentDirectory);
      for (const file of files) {
        if (file !== 'library' && file !== 'RCTAsyncLocalStorage_V1') { // Skip system/library folders
          const fileUri = FileSystem.documentDirectory + file;
          const info = await FileSystem.getInfoAsync(fileUri);
          if (!info.isDirectory) {
            await FileSystem.deleteAsync(fileUri, { idempotent: true });
          }
        }
      }

      // Clear Async Storage
      await AsyncStorage.clear();

      // Clear Cache Directory
      try {
        if (FileSystem.cacheDirectory) {
          await FileSystem.deleteAsync(FileSystem.cacheDirectory, { idempotent: true });
          await FileSystem.makeDirectoryAsync(FileSystem.cacheDirectory, { intermediates: true });
        }
      } catch (err) {
        console.warn('Failed to clear cache directory', err);
      }

      // Clear Artwork Cache
      try {
        await clearArtworkCacheManually();
      } catch (err) {
        console.warn('Failed to clear artwork cache', err);
      }

      Alert.alert('Success', 'All data has been cleared. The app is now empty.');
    } catch (e) {
      console.warn('Failed to clear data', e);
      Alert.alert('Error', 'Failed to clear data.');
    }
  };

  const toggleTidalForUnowned = async (value) => {
    setUseTidalForUnowned(value);
    await saveSettings({ useTidalForUnowned: value });
  };

  const toggleModule = async (moduleId) => {
    setModules(prev => {
      const next = {
        ...prev,
        [moduleId]: {
          ...prev[moduleId],
          enabled: !prev[moduleId].enabled
        }
      };
      saveSettings({ modules: next });
      return next;
    });
  };

  const updatePlayerColorMode = async (mode) => {
    setPlayerColorMode(mode);
    await saveSettings({ playerColorMode: mode });
  };

  const updateUserTheme = async (mode) => {
    setUserTheme(mode);
    await saveSettings({ userTheme: mode });
  };

  const savePlaylists = async (newPlaylists) => {
    try {
      await FileSystem.writeAsStringAsync(PLAYLISTS_FILE, JSON.stringify(newPlaylists));
    } catch (e) {
      console.warn('Failed to save playlists', e);
    }
  };

  const addPlaylist = (playlist) => {
    setPlaylists((prev) => {
      const next = [...prev, playlist];
      savePlaylists(next);
      return next;
    });
  };

  const deletePlaylist = (playlistId) => {
    setPlaylists((prev) => {
      const next = prev.filter((p) => p.id !== playlistId);
      savePlaylists(next);
      return next;
    });
  };

  const updatePlaylist = (updatedPlaylist) => {
    setPlaylists((prev) => {
      const next = prev.map((p) => (p.id === updatedPlaylist.id ? updatedPlaylist : p));
      savePlaylists(next);
      return next;
    });
  };

  const addTrackToPlaylist = (playlistId, track) => {
    setPlaylists((prev) => {
      const next = prev.map((p) => {
        if (p.id === playlistId) {
          const trackExists = p.tracks && p.tracks.some(t =>
            (t.uri && track.uri && t.uri === track.uri) ||
            (t.id && track.id && t.id === track.id) ||
            (t.name === track.name && (t.artist === track.artist || t.artist?.name === track.artist?.name))
          );

          if (trackExists) return p;

          return {
            ...p,
            tracks: [...(p.tracks || []), track],
            updatedAt: new Date().toISOString(),
          };
        }
        return p;
      });
      savePlaylists(next);
      return next;
    });
  };

  useEffect(() => {
    const configureAudio = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      } catch (e) {
        console.warn('Failed to configure audio', e);
      }
    };
    configureAudio();
    loadSettings(); // Load settings on app start
    loadPlayerState(); // Restore player state
    loadLibrary();
    loadPlaylists();
  }, []);

  // Reload library when switching to library tab
  useEffect(() => {
    if (currentTab === 'library') {
      loadLibrary();
      loadPlaylists();
    }
  }, [currentTab]);

  const saveLibrary = async (tracks) => {
    try {
      await FileSystem.writeAsStringAsync(LIBRARY_FILE, JSON.stringify(tracks));
    } catch (e) {
      console.warn('Failed to save library', e);
    }
  };

  const addToLibrary = async (track, sourceUri, originalName) => {
    try {
      const safeName = encodeURIComponent(originalName || track.name || `track-${Date.now()}`);
      let destUri = null;

      if (sourceUri) {
        destUri = `${LIBRARY_DIR}/${safeName}`;
        // Copy the picked file into our app library dir so it survives picker cache cleanup
        await FileSystem.copyAsync({ from: sourceUri, to: destUri });
      }

      // Prepare the new entry data
      const baseEntry = {
        ...track,
        uri: destUri || track.uri, // Use new local URI if available, otherwise keep existing
      };

      setLibrary((prev) => {
        // Helper to safely get artist name for comparison
        const getArtistName = (t) => {
          if (!t) return '';
          return (t.artist && t.artist.name) || t.artist || '';
        };

        // Find existing track by URI or Metadata (Name + Artist + Album)
        const existingIndex = prev.findIndex(t => {
          // 1. Check URI match
          const uriMatch = (baseEntry.uri && t.uri === baseEntry.uri);
          if (uriMatch) return true;

          // 2. Check Metadata match (Name + Artist + Album)
          const nameMatch = t.name === baseEntry.name;
          const artistMatch = getArtistName(t) === getArtistName(baseEntry);

          // Helper for loose album matching (handling "Single" suffix)
          const isSameAlbum = (a, b) => {
            if (a === b) return true;
            if (!a || !b) return false;
            const normalize = (s) => s.toLowerCase().replace(/ - single$/i, '').replace(/ \(single\)$/i, '').trim();
            return normalize(a) === normalize(b);
          };

          const albumMatch = isSameAlbum(t.album, baseEntry.album);

          return nameMatch && artistMatch && albumMatch;
        });

        let nextLibrary;

        if (existingIndex >= 0) {
          // Update existing entry (merge)
          const existing = prev[existingIndex];
          const mergedEntry = {
            ...existing,      // Keep existing IDs, stats, etc.
            ...baseEntry,     // Overwrite with new info (e.g. new URI, better metadata)
            // Explicitly preserve accumulated stats if baseEntry is missing them
            favorite: existing.favorite !== undefined ? existing.favorite : baseEntry.favorite,
            playCount: Math.max(existing.playCount || 0, baseEntry.playCount || 0),
            lastPlayed: Math.max(existing.lastPlayed || 0, baseEntry.lastPlayed || 0),
            dateAdded: existing.dateAdded || Date.now(), // Keep original add date
          };

          nextLibrary = [...prev];
          nextLibrary[existingIndex] = mergedEntry;
        } else {
          // Add new entry
          const newEntry = {
            ...baseEntry,
            dateAdded: Date.now(),
          };
          nextLibrary = [...prev, newEntry];
        }

        saveLibrary(nextLibrary);
        return nextLibrary;
      });
    } catch (e) {
      console.warn('Failed to add track to library', e);
    }
  };

  const deleteTrack = async (trackToDelete) => {
    try {
      // Remove file from filesystem
      if (trackToDelete.uri && trackToDelete.uri.startsWith('file://')) {
        await FileSystem.deleteAsync(trackToDelete.uri, { idempotent: true });
      }

      setLibrary((prev) => {
        const next = prev.filter((t) => t.uri !== trackToDelete.uri);
        saveLibrary(next);
        return next;
      });
    } catch (e) {
      console.warn('Failed to delete track', e);
    }
  };

  const updateTrack = async (originalTrack, newMetadata) => {
    setLibrary((prev) => {
      const next = prev.map((t) => {
        if (t.uri === originalTrack.uri) {
          return { ...t, ...newMetadata };
        }
        return t;
      });
      saveLibrary(next);
      return next;
    });
  };

  const toggleFavorite = (track) => {
    if (!track) return;

    setLibrary((prev) => {
      const existingIndex = prev.findIndex(t =>
        (t.uri && track.uri && t.uri === track.uri) ||
        (t.name === track.name && (t.artist === track.artist || t.artist?.name === track.artist?.name))
      );

      let next;
      if (existingIndex >= 0) {
        // Update existing
        next = [...prev];
        next[existingIndex] = {
          ...next[existingIndex],
          favorite: !next[existingIndex].favorite
        };
      } else {
        // Add new with favorite=true
        const newTrack = {
          ...track,
          favorite: true,
          dateAdded: Date.now(),
        };
        next = [...prev, newTrack];
      }
      saveLibrary(next);
      return next;
    });
  };

  // Derived state for current track favorite status
  const isCurrentTrackFavorite = useMemo(() => {
    if (!currentTrack || !library) return false;
    const found = library.find(t =>
      (t.uri && currentTrack.uri && t.uri === currentTrack.uri) ||
      (t.name === currentTrack.name && (t.artist === currentTrack.artist || t.artist?.name === currentTrack.artist?.name))
    );
    return found ? !!found.favorite : false;
  }, [currentTrack, library]);

  const deleteAlbum = async (albumName) => {
    try {
      const tracksToDelete = library.filter(t => t.album === albumName);

      // Delete files
      for (const track of tracksToDelete) {
        if (track.uri && track.uri.startsWith('file://')) {
          await FileSystem.deleteAsync(track.uri, { idempotent: true });
        }
      }

      setLibrary((prev) => {
        const next = prev.filter((t) => t.album !== albumName);
        saveLibrary(next);
        return next;
      });
    } catch (e) {
      console.warn('Failed to delete album', e);
    }
  };

  const updateAlbum = async (oldName, newName) => {
    setLibrary((prev) => {
      const next = prev.map((t) => {
        if (t.album === oldName) {
          return { ...t, album: newName };
        }
        return t;
      });
      saveLibrary(next);
      return next;
    });
  };

  const pickLocalAudio = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/flac', 'audio/x-flac', 'audio/*'],
        copyToCacheDirectory: true,
        multiple: true,
      });

      if (!result || result.canceled || result.type === 'cancel') return;

      const files = result.assets ?? [result];

      setLoading(true);
      setIsImporting(true);
      setImportProgress(0);
      let lastTrack = null;
      const totalFiles = files.length;

      try {
        // Process all selected files
        for (let i = 0; i < totalFiles; i++) {
          const file = files[i];
          let baseTrack = null;
          try {
            const metadata = await getAudioMetadata(file.uri);

            baseTrack = {
              name: metadata.title || file.name || 'Local audio',
              artist: metadata.artist || 'Local Artist',
              album: metadata.album,
              albumArtist: metadata.albumArtist,
              trackNumber: metadata.trackNumber,
              discNumber: metadata.discNumber,
              genre: metadata.genre,
              year: metadata.year,
              mbid: `local-${file.uri}`,
              image: metadata.image ? [{ '#text': metadata.image, size: 'extralarge' }] : [],
              uri: file.uri,
              isLocal: true,
            };
          } catch (err) {
            console.warn('Metadata extraction failed for', file.name, err);
            // Fallback to basic info
            baseTrack = {
              name: file.name || 'Local audio',
              artist: 'Local Artist',
              mbid: `local-${file.uri}`,
              image: [],
              uri: file.uri,
              isLocal: true,
            };
          }

          // Smart Match: If metadata is missing (no artist or default name), try to find it on Spotify
          if (
            !baseTrack.artist ||
            baseTrack.artist === 'Local Artist' ||
            !baseTrack.name ||
            baseTrack.name === 'Local audio' ||
            baseTrack.name === file.name // if name is just filename
          ) {
            try {
              const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
              let results = [];
              let expectedArtist = null;

              // Strategy 1: Check for "Artist - Song" pattern (using " - " as separator)
              if (nameWithoutExt.includes(" - ")) {
                const parts = nameWithoutExt.split(" - ");
                expectedArtist = parts[0].trim();
                const track = parts.slice(1).join(" - ").trim();

                if (expectedArtist && track) {
                  try {
                    // 1a. Specific search using Spotify field filters
                    results = await searchLastfmTracks(`artist:${expectedArtist} track:${track}`, { limit: 1 });

                    // 1b. If no results, try cleaning the track name (remove parens/brackets)
                    if (!results || results.length === 0) {
                      const cleanTrack = track.replace(/\s*[\(\[].*?[\)\]]/g, '').trim();
                      if (cleanTrack !== track) {
                        results = await searchLastfmTracks(`artist:${expectedArtist} track:${cleanTrack}`, { limit: 1 });
                      }
                    }
                  } catch (e) {
                    console.warn('Specific search failed', e);
                  }
                }
              }

              // Strategy 2: Fallback to general search if Strategy 1 didn't apply or returned no results
              if (!results || results.length === 0) {
                const cleanName = nameWithoutExt
                  .replace(/[_-]/g, " ") // replace separators with spaces
                  .replace(/\s+/g, " ") // collapse spaces
                  .trim();
                results = await searchLastfmTracks(cleanName, { limit: 1 });
              }

              if (results && results.length > 0) {
                const match = results[0];

                // Verification: If we parsed an artist from the filename, ensure the match's artist is similar.
                // This prevents "Artist A - Song" matching "Song" by "Artist B".
                let isMatchValid = true;
                if (expectedArtist) {
                  const matchArtist = (match.artist?.name || match.artist || '').toLowerCase();
                  const targetArtist = expectedArtist.toLowerCase();
                  // Simple check: one should contain the other
                  if (!matchArtist.includes(targetArtist) && !targetArtist.includes(matchArtist)) {
                    isMatchValid = false;
                    console.log(`Smart match rejected: expected artist '${expectedArtist}' but got '${matchArtist}'`);
                  }
                }

                if (isMatchValid) {
                  // Merge match data, but keep local URI and isLocal flag
                  baseTrack = {
                    ...baseTrack,
                    name: match.name,
                    artist: match.artist, // This might be a string or object depending on API
                    album: match.album, // API now returns album name directly
                    image: match.image,
                    mbid: match.mbid || baseTrack.mbid, // Use Spotify ID if available
                  };
                }
              }
            } catch (searchErr) {
              console.warn('Smart match failed for', file.name, searchErr);
            }
          }

          await addToLibrary(baseTrack, file.uri, file.name);
          lastTrack = baseTrack;
          setImportProgress((i + 1) / totalFiles);
        }

      } finally {
        setLoading(false);
        setIsImporting(false);
        setImportProgress(0);
      }
    } catch (e) {
      console.warn('Error picking audio file', e);
      setError(e.message ?? 'Error picking audio file');
    }
  };


  const clearRecentSearches = () => {
    setRecentSearches([]);
  };

  const onSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);

    // Add to recent searches
    addToRecentSearches(query);

    try {
      const result = await detectIntent(query.trim());
      setArtists(result.artists);
      setAlbums(result.albums);
      setTracks(result.tracks);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  const [navigationRef, setNavigationRef] = useState(null);
  const [currentRoute, setCurrentRoute] = useState('MainTabs');
  const [tabBarAnim] = useState(new Animated.Value(0)); // 0 = visible, 1 = hidden

  // Animate tab bar when route changes or player expands
  useEffect(() => {
    const isSettingsPage = ['Settings', 'Appearance', 'PlayerColors', 'Cache', 'AdvancedCatalog', 'SelfHostedCollection', 'Modules', 'ImportSpotifyPlaylist', 'About'].includes(currentRoute);
    const shouldHide = isSettingsPage || isPlayerExpanded;

    Animated.timing(tabBarAnim, {
      toValue: shouldHide ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [currentRoute, isPlayerExpanded]);



  const openArtistPage = (artist) => {
    navigationRef.navigate('Artist', {
      artist,
      theme,
      onTrackPress: openTrackPlayer,
      library,
      libraryArtists,
      openAlbumPage,
      addToLibrary,
    });
  };

  const openArtistByName = async (artistName) => {
    if (!artistName) return;

    setLoading(true);
    setError(null);

    try {
      const artistResults = await searchLastfmArtists(artistName, { limit: 1 });
      if (artistResults && artistResults.length > 0) {
        const artist = artistResults[0];
        await openArtistPage(artist);
      } else {
        setError('Artist not found on Spotify');
      }
    } catch (e) {
      setError(e.message ?? 'Error searching for artist');
    } finally {
      setLoading(false);
    }
  };

  const updateTrackLastPlayed = (track) => {
    if (!track) return;
    setLibrary((prev) => {
      let found = false;
      const next = prev.map(t => {
        if ((t.uri && track.uri && t.uri === track.uri) ||
          (t.name === track.name && (t.artist === track.artist || t.artist?.name === track.artist))) {
          found = true;
          return { ...t, lastPlayed: Date.now() };
        }
        return t;
      });

      if (found) {
        saveLibrary(next);
        return next;
      }
      return prev;
    });
  };

  const reloadArtwork = async (albumTitle, artistName) => {
    console.log(`[App] Reloading artwork for: ${albumTitle} by ${artistName}`);
    // Find a sample track to base the search on
    const track = library.find(t =>
      (t.album === albumTitle || t.album?.title === albumTitle) &&
      (t.artist === artistName || t.artist?.name === artistName)
    );

    if (!track) {
      console.warn('[App] No track found for album reload:', albumTitle);
      return;
    }

    try {
      // Use a slight delay to prevent rapid-fire reloads if multiple images fail at once
      const newArtwork = await getArtworkWithFallback({
        name: track.name,
        artist: artistName,
        album: albumTitle
      }, true); // Force refresh

      if (newArtwork && newArtwork.length > 0) {
        const imageUrl = pickImageUrl(newArtwork, 'extralarge');
        if (imageUrl) {
          console.log('[App] Found new artwork:', imageUrl);
          // Update all tracks in this album
          setLibrary(prev => {
            const next = prev.map(t => {
              const tAlbum = t.album?.title || t.album;
              const tArtist = t.artist?.name || t.artist;
              // Match album and artist (handling string vs object)
              if (tAlbum === albumTitle && (tArtist === artistName || (typeof t.artist === 'object' && t.artist.name === artistName))) {
                return { ...t, image: newArtwork };
              }
              return t;
            });
            saveLibrary(next);
            return next;
          });
        }
      }
    } catch (e) {
      console.warn('[App] Failed to reload artwork', e);
    }
  };

  const openTrackPlayer = (track, queue = null, index = 0, expandPlayer = true) => {
    if (!track) return;

    // Check if modules are disabled and track is not owned
    const isTidalEnabled = modules?.tidal?.enabled ?? true;
    if (!useTidalForUnowned || !isTidalEnabled) {
      // Check if track is owned (has isLocal flag or exists in library)
      const isOwned = track.isLocal || library.some(libTrack => {
        const trackName = (track.name || '').toLowerCase().trim();
        const libName = (libTrack.name || '').toLowerCase().trim();
        const trackArtist = (track.artist?.name || track.artist || '').toLowerCase().trim();
        const libArtist = (libTrack.artist?.name || libTrack.artist || '').toLowerCase().trim();
        return trackName === libName && trackArtist === libArtist && libTrack.isLocal;
      });

      if (!isOwned) {
        // Show notification that track is not imported
        showQueueNotification("You don't have this track imported!", 'error');
        return; // Prevent playback
      }
    }

    // Update last played
    updateTrackLastPlayed(track);

    setShouldAutoPlay(true); // Ensure auto-play is enabled for user-initiated playback
    setCurrentTrack(track);
    if (queue && Array.isArray(queue)) {
      setCurrentQueue(queue);
      setCurrentQueueIndex(index);
    } else {
      setCurrentQueue([]);
      setCurrentQueueIndex(0);
    }
    if (expandPlayer) {
      setIsPlayerExpanded(true);
    }
  };

  // Handle playing tracks from search results with proper matching
  const handleSearchTrackPress = async (rawTrack) => {
    if (!useTidalForUnowned) {
      console.log('[Search] Streaming is disabled');
      showQueueNotification("You don't have this track imported!", 'error');
      return;
    }

    try {
      console.log('[Search] Attempting to play track:', rawTrack.name);

      // Format track from Last.fm search result
      const formattedTrack = {
        name: rawTrack.name,
        artist: typeof rawTrack.artist === 'string' ? rawTrack.artist : (rawTrack.artist?.name || 'Unknown Artist'),
        album: rawTrack.album || 'Unknown Album',
        duration: rawTrack.duration || 0,
        image: pickImageUrl(rawTrack.image, 'extralarge'),
        isFetching: true,
      };

      // Open player immediately with loading state
      openTrackPlayer(formattedTrack, [formattedTrack], 0);

      // Resolve playable track with proper matching
      const playableTrack = await getPlayableTrack(formattedTrack, useTidalForUnowned);

      // Update with resolved track
      if (playableTrack && (playableTrack.uri || playableTrack.tidalId)) {
        console.log('[Search] Successfully resolved track stream');
        openTrackPlayer(playableTrack, [playableTrack], 0, false); // Don't re-expand player
      } else {
        console.warn('[Search] Could not find stream for track:', rawTrack.name);
        showQueueNotification("Could not find stream for this track", 'error');
      }
    } catch (error) {
      console.error('[Search] Error playing track:', error);
      showQueueNotification("Error playing track", 'error');
    }
  };

  const handleTrackChange = (newTrack, newIndex, newQueue = null) => {
    setShouldAutoPlay(true); // Ensure auto-play continues for queue changes
    setCurrentTrack(newTrack);
    setCurrentQueueIndex(newIndex);
    if (newQueue && Array.isArray(newQueue)) {
      setCurrentQueue(newQueue);
    }
  };

  const handleQueueReorder = (newQueue, newIndex) => {
    setCurrentQueue(newQueue);
    setCurrentQueueIndex(newIndex);
    setCurrentTrack(newQueue[newIndex]);
  };

  const showQueueNotification = (message, type = 'success') => {
    // Clear existing timer
    if (queueNotificationTimer.current) {
      clearTimeout(queueNotificationTimer.current);
    }

    // Show notification with type
    setQueueNotification({ message, type });

    // Animate in (slide up + fade in)
    Animated.spring(queueNotificationAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start();

    // Hide after 2 seconds with animation
    queueNotificationTimer.current = setTimeout(() => {
      // Animate out (slide down + fade out)
      Animated.timing(queueNotificationAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        setQueueNotification(null);
      });
    }, 2000);
  };

  const addToQueue = (track) => {
    if (!track) return;

    // Haptic feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // If no track is currently playing, start playing this track
    if (!currentTrack) {
      openTrackPlayer(track, [track], 0);
      showQueueNotification(`Playing "${track.name}"`);
    } else {
      // Add to the end of the current queue
      const newQueue = [...currentQueue, track];
      setCurrentQueue(newQueue);
      showQueueNotification(`Added "${track.name}" to queue`);
    }
  };

  const addAlbumToQueue = (tracks, playImmediately = false) => {
    if (!tracks || tracks.length === 0) return;

    // Haptic feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // If no track is currently playing, start playing the album
    if (!currentTrack) {
      openTrackPlayer(tracks[0], tracks, 0);
      showQueueNotification(`Playing album (${tracks.length} songs)`);
    } else {
      // Add all tracks to the end of the current queue
      const newQueue = [...currentQueue, ...tracks];
      setCurrentQueue(newQueue);

      if (playImmediately) {
        const newIndex = currentQueue.length; // Index of the first added track
        setCurrentTrack(tracks[0]);
        setCurrentQueueIndex(newIndex);
        setShouldAutoPlay(true);
        setIsPlayerExpanded(true);
        showQueueNotification(`Playing "${tracks[0].name}"`);
      } else {
        showQueueNotification(`Added ${tracks.length} songs to queue`);
      }
    }
  };

  const minimizePlayer = () => {
    setIsPlayerExpanded(false);
  };

  const closeTrackPlayer = () => {
    setCurrentTrack(null);
    setIsPlayerExpanded(false);
  };

  const openAlbumPage = async (album) => {
    if (!album) return;

    setLoading(true);
    setError(null);

    try {
      // Get album info with tracks from Last.fm
      const albumInfo = await getAlbumInfo({
        artist: getArtistName(album.artist),
        album: album.name,
        mbid: album.mbid,
      });

      const albumTracks = albumInfo?.tracks?.track ?? [];

      // Process tracks to ensure consistent artist format
      const processedTracks = albumTracks.map(track => ({
        ...track,
        artist: getArtistName(track.artist), // Ensure artist is always a string
      }));

      // Navigate to existing LibraryAlbum page
      if (navigationRef) {
        navigationRef.navigate('LibraryAlbum', {
          album: {
            name: album.name,
            title: album.name, // LibraryAlbumPage expects 'title' property
            artist: getArtistName(album.artist), // Ensure album artist is always a string
            image: album.image,
            artwork: pickImageUrl(album.image, 'extralarge') || pickImageUrl(album.image, 'large'), // Add artwork for display
            mbid: album.mbid,
            tracks: processedTracks,
            key: `search-album-${album.mbid || album.name}`, // Add unique key
          },
          theme,
          onTrackPress: openTrackPlayer,
          libraryAlbums,
          library, // Pass the full library for ownership checking
          openArtistByName,
          deleteTrack,
          updateTrack,
          addToQueue,
          addAlbumToQueue,
          currentTrack,
          isPlaying: playerControls.isPlaying,
          togglePlay: playerControls.togglePlay,
          useTidalForUnowned,
          addToLibrary,
          showNotification: showQueueNotification,
          reloadArtwork,
        });
      }
    } catch (e) {
      setError(e.message ?? 'Error loading album');
    } finally {
      setLoading(false);
    }
  };


  const handleTabPress = (tab) => {
    setCurrentTab(tab);
    // If we are deep in the stack (index > 0), pop to top to close all stacked pages with animation.
    // This ensures we are at the "bottom" layer of the tab and it matches the swipe-back behavior.
    if (navigationRef) {
      const state = navigationRef.getRootState();
      if (state && state.index > 0) {
        navigationRef.dispatch(StackActions.popToTop());
      }
    }
  };

  const renderSearchTab = () => (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={styles.searchHeader}>
        <Text style={[styles.searchTitle, { color: theme.primaryText }]}>Search</Text>
      </View>

      <View style={styles.searchBarContainer}>
        <View style={[styles.searchBar, { backgroundColor: theme.card }]}>
          <Ionicons name="search" size={20} color={theme.secondaryText} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: theme.primaryText }]}
            placeholder="Search for songs, albums, artists..."
            placeholderTextColor={theme.secondaryText}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            onSubmitEditing={() => addToRecentSearches(query)}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} style={styles.clearButton}>
              <Ionicons name="close-circle" size={18} color={theme.secondaryText} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.resultsContent}>
        {query.length === 0 ? (
          <>
            {recentSearches.length > 0 && (
              <View style={styles.sectionContainer}>
                <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>Recent</Text>
                <View style={styles.recentSearches}>
                  {recentSearches.map((search, index) => (
                    <Pressable
                      key={index}
                      style={styles.recentSearchItem}
                      onPress={() => {
                        setQuery(search);
                        addToRecentSearches(search);
                      }}
                    >
                      <Ionicons name="time-outline" size={20} color={theme.secondaryText} />
                      <Text style={[styles.recentSearchText, { color: theme.primaryText }]}>{search}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </>
        ) : (
          <>
            {/* Loading State */}
            {loading && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.primaryText} />
                <Text style={[styles.loadingText, { color: theme.secondaryText }]}>Searching...</Text>
              </View>
            )}

            {/* Error State */}
            {error && (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle-outline" size={48} color={theme.error} />
                <Text style={[styles.errorText, { color: theme.error }]}>{error}</Text>
              </View>
            )}

            {/* Search Results */}
            {!loading && !error && searchData.length > 0 && (
              <View style={styles.resultsContainer}>
                {searchData.map((item, index) => renderSearchResultRow(item, index))}
              </View>
            )}

            {/* No Results */}
            {!loading && !error && searchData.length === 0 && query.length > 0 && (
              <View style={styles.noResultsContainer}>
                <Ionicons name="search-outline" size={64} color={theme.secondaryText} style={{ opacity: 0.3 }} />
                <Text style={[styles.noResultsTitle, { color: theme.primaryText }]}>No results found</Text>
                <Text style={[styles.noResultsSubtitle, { color: theme.secondaryText }]}>
                  Try searching for something else
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );

  const renderLibraryTab = () => {
    return (
      <LibraryHomeScreen
        navigation={navigationRef}
        route={{
          params: {
            theme,
            libraryAlbums,
            libraryArtists,
            library,
            playlists,
            addPlaylist,
            deletePlaylist,
            updatePlaylist,
            showNotification: showQueueNotification,
            pickLocalAudio,
            deleteAlbum,
            updateAlbum,
            openTrackPlayer,
            openArtistPage,
            addAlbumToQueue,
            addToQueue,
            currentTrack,
            insets,
            deleteTrack,
            updateTrack,
            addToLibrary,
            useTidalForUnowned,
            playerControls,
            clearAllData,
            reloadArtwork,
          },
        }}
      />
    );
  };

  const renderHomeTab = () => (
    <HomeScreen
      route={{
        params: {
          theme,
          libraryAlbums,
          playlists,
          libraryArtists,
          navigation: navigationRef,
          onTrackPress: openTrackPlayer,
          openArtistPage,
          pickLocalAudio,
          isLibraryLoaded,
        },
      }}
    />
  );

  // Search tab = API results.
  // Library tab = Local library.

  const searchData = useMemo(() => {
    const artistItems = artists.map((a, index) => ({
      key: `artist-${a.mbid || a.name}-${index}`,
      type: 'artist',
      item: a,
    }));
    const albumItems = albums.map((a, index) => ({
      key: `album-${a.mbid || a.name}-${index}`,
      type: 'album',
      item: a,
    }));
    const trackItems = tracks.map((t, index) => ({
      key: `track-${t.mbid || t.name}-${index}`,
      type: 'track',
      item: t,
    }));

    if (intent === 'artist') return [...artistItems, ...albumItems, ...trackItems];
    if (intent === 'album') return [...albumItems, ...trackItems, ...artistItems];
    if (intent === 'track') return [...trackItems, ...artistItems, ...albumItems];
    return [...artistItems, ...albumItems, ...trackItems];
  }, [artists, albums, tracks, intent]);

  // Helper function to safely get artist name
  const getArtistName = (artist) => {
    if (!artist) return 'Unknown Artist';
    if (typeof artist === 'string') return artist;
    if (typeof artist === 'object' && artist.name) return artist.name;
    return 'Unknown Artist';
  };

  // Modern search result renderer
  const renderSearchResultRow = (item, index) => {
    const { type, item: raw } = item;

    // Create a unique animation value for this item
    // We use useRef to persist the value, but we need it to be unique per item/index
    // A simple way is to use a new Animated.Value for each render if we don't care about recycling,
    // but for performance in a list, we should ideally use a declarative animation or a hook.
    // Given this is a map inside a ScrollView (not FlatList), we can use a hook if we extract the component,
    // OR we can just create the value here and animate it on mount.
    // Since we can't easily extract to a component without major refactor, let's use an inline component wrapper.

    return (
      <SearchResultItem
        key={item.key || index}
        item={item}
        index={index}
        theme={theme}
        onPressArtist={() => { addToRecentSearches(query); openArtistPage(raw); }}
        onPressAlbum={() => { addToRecentSearches(query); openAlbumPage(raw); }}
        onPressTrack={() => { addToRecentSearches(query); handleSearchTrackPress(raw); }}
      />
    );
  };

  // Extracted component for animation
  const SearchResultItem = ({ item, index, theme, onPressArtist, onPressAlbum, onPressTrack }) => {
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const translateY = useRef(new Animated.Value(20)).current;

    useEffect(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 400,
          delay: index * 50, // Stagger effect
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          friction: 8,
          tension: 50,
          delay: index * 50,
          useNativeDriver: true,
        }),
      ]).start();
    }, []);

    const { type, item: raw } = item;

    if (type === 'artist') {
      const imageUrl = pickImageUrl(raw.image, 'large');
      return (
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY }] }}>
          <Pressable
            style={styles.modernSearchResultItem}
            onPress={onPressArtist}
          >
            <View style={styles.modernResultImageContainer}>
              {imageUrl ? (
                <Image source={{ uri: imageUrl }} style={styles.modernResultImageCircle} />
              ) : (
                <View style={[styles.modernResultImageCircle, { backgroundColor: theme.card }]}>
                  <Ionicons name="person" size={24} color={theme.secondaryText} />
                </View>
              )}
            </View>
            <View style={styles.modernResultTextContainer}>
              <Text style={[styles.modernResultTitle, { color: theme.primaryText }]} numberOfLines={1}>
                {raw.name}
              </Text>
              <Text style={[styles.modernResultSubtitle, { color: theme.secondaryText }]} numberOfLines={1}>
                Artist • {raw.listeners ? `${Number(raw.listeners).toLocaleString()} listeners` : 'Music'}
              </Text>
            </View>
            <View style={styles.modernResultTypeContainer}>
              <Ionicons name="person-outline" size={16} color={theme.secondaryText} />
            </View>
          </Pressable>
        </Animated.View>
      );
    }

    if (type === 'album') {
      const imageUrl = pickImageUrl(raw.image, 'large');
      return (
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY }] }}>
          <Pressable
            style={styles.modernSearchResultItem}
            onPress={onPressAlbum}
          >
            <View style={styles.modernResultImageContainer}>
              {imageUrl ? (
                <Image source={{ uri: imageUrl }} style={styles.modernResultImageSquare} />
              ) : (
                <View style={[styles.modernResultImageSquare, { backgroundColor: theme.card }]}>
                  <Ionicons name="albums" size={24} color={theme.secondaryText} />
                </View>
              )}
            </View>
            <View style={styles.modernResultTextContainer}>
              <Text style={[styles.modernResultTitle, { color: theme.primaryText }]} numberOfLines={1}>
                {raw.name}
              </Text>
              <Text style={[styles.modernResultSubtitle, { color: theme.secondaryText }]} numberOfLines={1}>
                Album • {getArtistName(raw.artist)}
              </Text>
            </View>
            <View style={styles.modernResultTypeContainer}>
              <Ionicons name="albums-outline" size={16} color={theme.secondaryText} />
            </View>
          </Pressable>
        </Animated.View>
      );
    }

    // Track
    const imageUrl = pickImageUrl(raw.image, 'large');
    return (
      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY }] }}>
        <Pressable
          style={styles.modernSearchResultItem}
          onPress={onPressTrack}
        >
          <View style={styles.modernResultImageContainer}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={styles.modernResultImageSquare} />
            ) : (
              <View style={[styles.modernResultImageSquare, { backgroundColor: theme.card }]}>
                <Ionicons name="musical-note" size={24} color={theme.secondaryText} />
              </View>
            )}
          </View>
          <View style={styles.modernResultTextContainer}>
            <Text style={[styles.modernResultTitle, { color: theme.primaryText }]} numberOfLines={1}>
              {raw.name}
            </Text>
            <Text style={[styles.modernResultSubtitle, { color: theme.secondaryText }]} numberOfLines={1}>
              Song • {getArtistName(raw.artist)}
            </Text>
          </View>
          <View style={styles.modernResultTypeContainer}>
            <Ionicons name="musical-note-outline" size={16} color={theme.secondaryText} />
          </View>
        </Pressable>
      </Animated.View>
    );
  };

  // Legacy renderer (keeping for compatibility)
  const renderRow = ({ item }) => {
    const { type, item: raw } = item;

    if (type === 'artist') {
      const imageUrl = pickImageUrl(raw.image, 'extralarge') || pickImageUrl(raw.image, 'large');
      return (
        <Pressable onPress={() => openArtistPage(raw)}>
          <View style={[styles.row, { borderBottomColor: theme.border }]}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={styles.avatarCircleLarge} />
            ) : (
              <View style={[styles.avatarCircleLarge, { backgroundColor: theme.card }]} />
            )}
            <View style={styles.rowText}>
              <Text style={[styles.primaryText, { color: theme.primaryText }]} numberOfLines={1}>
                {raw.name}
              </Text>
              {raw.listeners ? (
                <Text style={[styles.secondaryText, { color: theme.secondaryText }]} numberOfLines={1}>
                  {Number(raw.listeners).toLocaleString()} listeners
                </Text>
              ) : null}
            </View>
            <Text style={[styles.pill, { color: theme.pillText, borderColor: theme.pillBorder, backgroundColor: theme.pillBackground }]}>Artist</Text>
          </View>
        </Pressable>
      );
    }

    if (type === 'album') {
      const imageUrl = pickImageUrl(raw.image, 'large');
      return (
        <View style={[styles.row, { borderBottomColor: theme.border }]}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.squareThumb} />
          ) : (
            <View style={[styles.squareThumb, { backgroundColor: theme.card }]} />
          )}
          <View style={styles.rowText}>
            <Text style={[styles.primaryText, { color: theme.primaryText }]} numberOfLines={1}>
              {raw.name}
            </Text>
            <Text style={[styles.secondaryText, { color: theme.secondaryText }]} numberOfLines={1}>
              {getArtistName(raw.artist)}
            </Text>
          </View>
          <Text style={[styles.pill, { color: theme.pillText, borderColor: theme.pillBorder, backgroundColor: theme.pillBackground }]}>Album</Text>
        </View>
      );
    }

    if (type === 'library') {
      const imageUrl = pickImageUrl(raw.image, 'large');
      return (
        <Pressable onPress={() => handleSearchTrackPress(raw)}>
          <View style={[styles.row, { borderBottomColor: theme.border }]}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={styles.squareThumbSmall} />
            ) : (
              <View style={[styles.squareThumbSmall, { backgroundColor: theme.card }]} />
            )}
            <View style={styles.rowText}>
              <Text style={[styles.primaryText, { color: theme.primaryText }]} numberOfLines={1}>
                {raw.name}
              </Text>
              <Text style={[styles.secondaryText, { color: theme.secondaryText }]} numberOfLines={1}>
                {getArtistName(raw.artist)}
              </Text>
            </View>
            <Text style={[styles.pill, { color: theme.pillText, borderColor: theme.pillBorder, backgroundColor: theme.pillBackground }]}>Library</Text>
          </View>
        </Pressable>
      );
    }

    // track
    const imageUrl = pickImageUrl(raw.image, 'large');
    return (
      <Pressable onPress={() => handleSearchTrackPress(raw)}>
        <View style={[styles.row, { borderBottomColor: theme.border }]}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.squareThumbSmall} />
          ) : (
            <View style={[styles.squareThumbSmall, { backgroundColor: theme.card }]} />
          )}
          <View style={styles.rowText}>
            <Text style={[styles.primaryText, { color: theme.primaryText }]} numberOfLines={1}>
              {raw.name}
            </Text>
            <Text style={[styles.secondaryText, { color: theme.secondaryText }]} numberOfLines={1}>
              {getArtistName(raw.artist)}
            </Text>
          </View>
          <Text style={[styles.pill, { color: theme.pillText, borderColor: theme.pillBorder, backgroundColor: theme.pillBackground }]}>Song</Text>
        </View>
      </Pressable>
    );
  };

  const miniImageUrl = currentTrack?.image
    ? pickImageUrl(currentTrack.image, 'large')
    : null;

  const handlePlayerArtistPress = (artistName) => {
    minimizePlayer();
    // Small delay to allow player animation to start/finish smoothly before navigation transition
    setTimeout(() => {
      openArtistByName(artistName);
    }, 300);
  };

  return (
    <DownloadProvider addToLibrary={addToLibrary} useTidalForUnowned={useTidalForUnowned}>
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <NavigationContainer
          ref={setNavigationRef}
          onStateChange={() => {
            if (navigationRef) {
              const route = navigationRef.getCurrentRoute();
              setCurrentRoute(route?.name || 'MainTabs');
            }
          }}
        >
          <RootStack.Navigator
            screenOptions={{
              headerShown: false,
              animation: 'slide_from_right',
              gestureEnabled: true,
            }}
          >
            <RootStack.Screen name="MainTabs">
              {() => {
                if (currentTab === 'home') return renderHomeTab();
                if (currentTab === 'search') return renderSearchTab();
                if (currentTab === 'library') return renderLibraryTab();
                return renderHomeTab();
              }}
            </RootStack.Screen>
            <RootStack.Screen name="LibraryAlbum">
              {(props) => (
                <LibraryAlbumPage
                  {...props}
                  route={{
                    ...props.route,
                    params: {
                      ...props.route.params,
                      libraryAlbums,
                      openArtistByName,
                      deleteTrack,
                      updateTrack,
                      addToQueue,
                      addAlbumToQueue,
                      currentTrack,
                      isPlaying: playerControls.isPlaying,
                      togglePlay: playerControls.togglePlay,
                      useTidalForUnowned,
                      playlists,
                      addTrackToPlaylist,
                      reloadArtwork,
                    },
                  }}
                />
              )}
            </RootStack.Screen>
            <RootStack.Screen name="Artist" component={ArtistPage} />
            <RootStack.Screen name="Settings" component={SettingsPage} />
            <RootStack.Screen
              name="Appearance"
              children={(props) => (
                <AppearancePage
                  {...props}
                  route={{
                    ...props.route,
                    params: {
                      ...props.route.params,
                      playerColorMode,
                      setPlayerColorMode: updatePlayerColorMode,
                      userTheme,
                      setUserTheme: updateUserTheme,
                    },
                  }}
                />
              )}
            />
            <RootStack.Screen
              name="PlayerColors"
              children={(props) => (
                <PlayerColorsPage
                  {...props}
                  route={{
                    ...props.route,
                    params: {
                      ...props.route.params,
                      playerColorMode,
                      setPlayerColorMode: updatePlayerColorMode,
                    },
                  }}
                />
              )}
            />
            <RootStack.Screen name="Cache" component={CachePage} />
            <RootStack.Screen name="AdvancedCatalog" component={AdvancedCatalogPage} />
            <RootStack.Screen name="SelfHostedCollection" component={SelfHostedCollectionPage} />
            <RootStack.Screen name="About" component={AboutPage} />
            <RootStack.Screen name="Donate" component={DonatePage} />
            <RootStack.Screen
              name="Modules"
              children={(props) => (
                <ModulesPage
                  {...props}
                  route={{
                    ...props.route,
                    params: {
                      ...props.route.params,
                      openTrackPlayer,
                      useTidalForUnowned,
                      toggleTidalForUnowned,
                      modules,
                      toggleModule,
                    },
                  }}
                />
              )}
            />
            <RootStack.Screen name="LibraryArtists" component={LibraryArtists} />
            <RootStack.Screen name="LibraryAlbums">
              {(props) => (
                <LibraryAlbums
                  {...props}
                  route={{
                    ...props.route,
                    params: {
                      ...props.route.params,
                      theme,
                      libraryAlbums,
                      onTrackPress: openTrackPlayer,
                      reloadArtwork,
                    },
                  }}
                />
              )}
            </RootStack.Screen>
            <RootStack.Screen name="LibrarySongs" component={LibrarySongs} />
            <RootStack.Screen name="LibraryPlaylists" component={LibraryPlaylists} />
            <RootStack.Screen name="PlaylistPage" component={PlaylistPage} />
            <RootStack.Screen name="AddPlaylist" component={AddPlaylist} />
            <RootStack.Screen name="ImportExternalPlaylist" component={ImportExternalPlaylist} />
          </RootStack.Navigator>
        </NavigationContainer>

        {/* Queue Notification Banner */}
        {queueNotification && (
          <Animated.View
            style={[
              styles.queueNotification,
              {
                backgroundColor: theme.card,
                borderColor: theme.border,
                opacity: queueNotificationAnim,
                transform: [
                  {
                    translateY: queueNotificationAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [20, 0],
                    }),
                  },
                ],
              }
            ]}
          >
            <Ionicons
              name={queueNotification.type === 'error' ? 'alert-circle' : 'checkmark-circle'}
              size={20}
              color={queueNotification.type === 'error' ? theme.error : theme.primaryText}
            />
            <Text style={[styles.queueNotificationText, { color: theme.primaryText }]} numberOfLines={1}>
              {queueNotification.message}
            </Text>
          </Animated.View>
        )}

        {/* Import Progress Bar */}
        {isImporting && (
          <View style={[styles.importProgressContainer, { top: insets.top + 60, backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.importProgressHeader}>
              <Text style={[styles.importProgressTitle, { color: theme.primaryText }]}>Importing Songs</Text>
              <Text style={[styles.importProgressPercent, { color: theme.secondaryText }]}>{Math.round(importProgress * 100)}%</Text>
            </View>
            <View style={[styles.importProgressBarBackground, { backgroundColor: theme.border }]}>
              <View
                style={[
                  styles.importProgressBarFill,
                  {
                    backgroundColor: theme.accent,
                    width: `${importProgress * 100}%`
                  }
                ]}
              />
            </View>
          </View>
        )}




        {/* Bottom tab bar - animated slide down */}
        <Animated.View
          pointerEvents={['Settings', 'Appearance', 'AdvancedCatalog', 'SelfHostedCollection', 'Modules', 'ImportSpotifyPlaylist', 'About'].includes(currentRoute) ? 'none' : 'auto'}
          style={[
            styles.tabBar,
            {
              backgroundColor: theme.card,
              borderTopColor: theme.border,
              paddingBottom: Math.max(8, insets.bottom + 2),
              transform: [{
                translateY: tabBarAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 100], // Slide down 100px when hiding
                })
              }],
              opacity: tabBarAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0], // Fade out when hiding
              })
            }
          ]}
        >
          <Pressable
            style={styles.tabItem}
            onPress={() => handleTabPress('home')}
          >
            <Ionicons
              name={currentTab === 'home' ? 'home' : 'home-outline'}
              size={28}
              color={currentTab === 'home' ? theme.primaryText : theme.secondaryText}
              style={styles.tabIcon}
            />
            <Text
              style={[
                styles.tabLabel,
                { color: currentTab === 'home' ? theme.primaryText : theme.secondaryText },
              ]}
            >
              Home
            </Text>
          </Pressable>

          <Pressable
            style={styles.tabItem}
            onPress={() => handleTabPress('search')}
          >
            <Ionicons
              name={currentTab === 'search' ? 'search' : 'search-outline'}
              size={28}
              color={currentTab === 'search' ? theme.primaryText : theme.secondaryText}
              style={styles.tabIcon}
            />
            <Text
              style={[
                styles.tabLabel,
                { color: currentTab === 'search' ? theme.primaryText : theme.secondaryText },
              ]}
            >
              Search
            </Text>
          </Pressable>

          <Pressable
            style={styles.tabItem}
            onPress={() => handleTabPress('library')}
          >
            <Ionicons
              name={currentTab === 'library' ? 'library' : 'library-outline'}
              size={28}
              color={currentTab === 'library' ? theme.primaryText : theme.secondaryText}
              style={styles.tabIcon}
            />
            <Text
              style={[
                styles.tabLabel,
                { color: currentTab === 'library' ? theme.primaryText : theme.secondaryText },
              ]}
            >
              Library
            </Text>
          </Pressable>
        </Animated.View>

        {/* Full-screen Song Player */}
        {currentTrack && (
          <SongPlayer
            track={currentTrack}
            queue={currentQueue}
            queueIndex={currentQueueIndex}
            onClose={minimizePlayer}
            onKill={closeTrackPlayer}
            onOpen={() => setIsPlayerExpanded(true)}
            onTrackChange={handleTrackChange}
            onQueueReorder={handleQueueReorder}
            theme={theme}
            setPlayerControls={setPlayerControls}
            onArtistPress={handlePlayerArtistPress}
            isVisible={isPlayerExpanded}
            toggleFavorite={toggleFavorite}
            isFavorite={isCurrentTrackFavorite}
            shouldPlay={shouldAutoPlay}
            zIndex={isPlayerExpanded ? 2000 : 1}
            shouldHide={['Settings', 'Appearance', 'PlayerColors', 'Cache', 'AdvancedCatalog', 'SelfHostedCollection', 'Modules', 'ImportSpotifyPlaylist', 'About'].includes(currentRoute)}
            playerColorMode={playerColorMode}
          />
        )}
      </View>
    </DownloadProvider>
  );
}

import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppContent />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 0,
    paddingHorizontal: 0,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 8,
  },
  loading: {
    marginVertical: 8,
  },
  error: {
    marginVertical: 4,
  },
  results: {
    marginTop: 12,
  },
  resultsContent: {
    paddingBottom: 130,
  },
  libraryGridContent: {
    paddingTop: 12,
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarCircleLarge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginRight: 12,
  },
  squareThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    marginRight: 12,
  },
  squareThumbSmall: {
    width: 40,
    height: 40,
    borderRadius: 6,
    marginRight: 12,
  },
  rowText: {
    flex: 1,
  },
  primaryText: {
    fontSize: 16,
    fontWeight: '500',
  },
  secondaryText: {
    fontSize: 12,
  },
  pill: {
    fontSize: 11,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
    overflow: 'hidden',
  },
  queueNotification: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 180, // clearly above mini player
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
    zIndex: 2,
  },
  queueNotificationText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 10,
    flex: 1,
  },
  miniPlayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 100, // sits clearly above the tab bar with more spacing
    marginHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    // subtle floating shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 1,
  },
  miniArtwork: {
    width: 40,
    height: 40,
    borderRadius: 6,
    marginRight: 10,
  },
  miniTextContainer: {
    flex: 1,
  },
  miniMainArea: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  miniPlayButton: {
    marginLeft: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  miniArtist: {
    fontSize: 12,
    marginTop: 2,
  },
  libraryGridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 4,
    marginBottom: 16,
  },
  libraryCard: {
    width: '100%',
    marginBottom: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    padding: 4,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  libraryArtwork: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  libraryCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
    width: '100%',
  },
  libraryCardArtist: {
    fontSize: 12,
    textAlign: 'center',
    opacity: 0.7,
    width: '100%',
  },
  sectionHeader: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
    marginTop: 8,
    width: '100%',
  },
  emptyLibrary: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    marginTop: 60,
  },
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 4,
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    zIndex: 2,
    minHeight: 50,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  tabIcon: {
    marginTop: 6,
  },
  tabLabel: {
    fontSize: 11,
    marginTop: 1,
  },
  albumContextMenu: {
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
    marginBottom: 20,
    fontSize: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
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
  libraryNavContainer: {
    marginHorizontal: 16,
    marginBottom: 20,
    borderRadius: 16,
    overflow: 'hidden',
  },
  libraryNavButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  libraryNavButtonFirst: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  libraryNavButtonLast: {
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  libraryNavIconContainer: {
    width: 28,
    marginRight: 12,
  },
  libraryNavText: {
    flex: 1,
    fontSize: 17,
    fontWeight: '400',
  },
  // Modern Search Styles
  searchHeader: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  searchTitle: {
    fontSize: 34,
    fontWeight: '700',
  },
  searchBarContainer: {
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '400',
  },
  clearButton: {
    padding: 4,
    marginLeft: 8,
  },
  sectionContainer: {
    paddingHorizontal: 16,
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
  },
  recentSearches: {
    gap: 12,
  },
  recentSearchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  recentSearchText: {
    fontSize: 16,
    fontWeight: '400',
    marginLeft: 12,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    fontSize: 16,
    marginTop: 12,
  },
  errorContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 32,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 12,
  },
  noResultsContainer: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  noResultsTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  noResultsSubtitle: {
    fontSize: 16,
    marginTop: 8,
    textAlign: 'center',
  },
  resultsContainer: {
    paddingHorizontal: 16,
  },
  modernSearchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  modernResultImageContainer: {
    marginRight: 12,
  },
  modernResultImageCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modernResultImageSquare: {
    width: 56,
    height: 56,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modernResultTextContainer: {
    flex: 1,
  },
  modernResultTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  modernResultSubtitle: {
    fontSize: 14,
    opacity: 0.7,
  },
  modernResultTypeContainer: {
    marginLeft: 12,
    opacity: 0.5,
  },
  // Settings Page Styles
  settingsPageContainer: {
    flex: 1,
    zIndex: 10, // Above tab bar
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  settingsPageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
  },
  backButtonContainer: {
    marginRight: 8,
    marginLeft: -8,
  },
  settingsPageTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  settingsSection: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingsRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingsRowText: {
    fontSize: 17,
    fontWeight: '500',
  },
  importProgressContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    zIndex: 2005,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  importProgressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  importProgressTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  importProgressPercent: {
    fontSize: 14,
    fontWeight: '500',
  },
  importProgressBarBackground: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    width: '100%',
  },
  importProgressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
});
