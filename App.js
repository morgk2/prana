import { DownloadProvider } from './src/context/DownloadContext';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TextInput, Button, ActivityIndicator, Image, FlatList, ScrollView, Pressable, useColorScheme, Animated, Modal } from 'react-native';
import { useState, useEffect, useMemo, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
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
import SongPlayer from './src/components/SongPlayer';
import HomeScreen from './src/components/HomeScreen';
import ModulesPage from './src/components/ModulesPage';
import { colors } from './src/theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';

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

const LibraryStack = createNativeStackNavigator();
const RootStack = createNativeStackNavigator();

async function detectIntent(query) {
  const q = query.trim();
  const qLower = q.toLowerCase();
  if (!q) {
    return { intent: 'mixed', artists: [], albums: [], tracks: [] };
  }

  const [artistResults, albumResults, trackResults] = await Promise.all([
    searchLastfmArtists(q, { limit: 3 }),
    searchLastfmAlbums(q, { limit: 3 }),
    searchLastfmTracks(q, { limit: 3 }),
  ]);

  const topArtist = artistResults[0];
  const topAlbum = albumResults[0];
  const topTrack = trackResults[0];

  // 1) exact equality
  if (topArtist && topArtist.name.toLowerCase() === qLower) {
    return { intent: 'artist', artists: artistResults, albums: albumResults, tracks: trackResults };
  }
  if (topAlbum && topAlbum.name.toLowerCase() === qLower) {
    return { intent: 'album', artists: artistResults, albums: albumResults, tracks: trackResults };
  }
  if (topTrack && topTrack.name.toLowerCase() === qLower) {
    return { intent: 'track', artists: artistResults, albums: albumResults, tracks: trackResults };
  }

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
    return { intent: 'artist', artists: artistResults, albums: albumResults, tracks: trackResults };
  }

  if (
    albumScore === maxScore &&
    albumScore > dominance * artistScore &&
    albumScore > dominance * trackScore
  ) {
    return { intent: 'album', artists: artistResults, albums: albumResults, tracks: trackResults };
  }

  if (
    trackScore === maxScore &&
    trackScore > dominance * artistScore &&
    trackScore > dominance * albumScore
  ) {
    return { intent: 'track', artists: artistResults, albums: albumResults, tracks: trackResults };
  }

  // 3) pattern hints
  if (qLower.includes(' - ') || qLower.includes(' by ')) {
    return { intent: 'track', artists: artistResults, albums: albumResults, tracks: trackResults };
  }
  if (
    qLower.includes(' album') ||
    qLower.includes(' ep') ||
    qLower.includes(' lp')
  ) {
    return { intent: 'album', artists: artistResults, albums: albumResults, tracks: trackResults };
  }

  return { intent: 'mixed', artists: artistResults, albums: albumResults, tracks: trackResults };
}


function LibraryHomeScreen({ route, navigation }) {
  const { theme, libraryAlbums, libraryArtists, library, playlists, addPlaylist, deletePlaylist, updatePlaylist, showNotification, pickLocalAudio, deleteAlbum, updateAlbum, openTrackPlayer, openArtistPage, addAlbumToQueue, addToQueue, currentTrack, insets, deleteTrack, updateTrack, addToLibrary, useTidalForUnowned, playerControls } = route.params;

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
        setMenuPosition({ x: pageX, y: pageY + height });
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
            togglePlay: playerControls?.togglePlay
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
            <Pressable onPress={() => navigation.navigate('Settings', { theme })} hitSlop={10}>
              <Ionicons name="settings-outline" size={26} color={theme.primaryText} />
            </Pressable>
            <Pressable onPress={pickLocalAudio} hitSlop={10}>
              <Ionicons name="add" size={28} color={theme.primaryText} />
            </Pressable>
          </View>
        </View>

        {/* Navigation Buttons */}
        <View style={{ marginBottom: 20, paddingHorizontal: 16 }}>
          <Pressable
            style={[styles.libraryNavButton, { backgroundColor: theme.card, borderBottomColor: theme.border }]}
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
              onPlaylistPress: (playlist) => console.log('Open playlist', playlist)
            })}
          >
            <View style={styles.libraryNavIconContainer}>
              <Ionicons name="list" size={22} color={theme.primaryText} />
            </View>
            <Text style={[styles.libraryNavText, { color: theme.primaryText }]}>Playlists</Text>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>

          <Pressable
            style={[styles.libraryNavButton, { backgroundColor: theme.card, borderBottomColor: theme.border }]}
            onPress={() => navigation.navigate('LibraryArtists', { theme, libraryArtists, openArtistPage })}
          >
            <View style={styles.libraryNavIconContainer}>
              <Ionicons name="person" size={22} color={theme.primaryText} />
            </View>
            <Text style={[styles.libraryNavText, { color: theme.primaryText }]}>Artists</Text>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>

          <Pressable
            style={[styles.libraryNavButton, { backgroundColor: theme.card, borderBottomColor: theme.border }]}
            onPress={() => navigation.navigate('LibraryAlbums', { theme, libraryAlbums, onTrackPress: openTrackPlayer })}
          >
            <View style={styles.libraryNavIconContainer}>
              <Ionicons name="albums" size={22} color={theme.primaryText} />
            </View>
            <Text style={[styles.libraryNavText, { color: theme.primaryText }]}>Albums</Text>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>

          <Pressable
            style={[styles.libraryNavButton, { backgroundColor: theme.card, borderBottomWidth: 0 }]}
            onPress={() => navigation.navigate('LibrarySongs', { theme, library, onTrackPress: openTrackPlayer, addToQueue })}
          >
            <View style={styles.libraryNavIconContainer}>
              <Ionicons name="musical-note" size={22} color={theme.primaryText} />
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
                  right: 16,
                  top: menuPosition.y - 60,
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

// Settings Page
function SettingsPage({ route, navigation }) {
  const { theme } = route.params;

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
            onPress={() => navigation.navigate('AdvancedCatalog', { theme })}
          >
            <View style={styles.settingsRowLeft}>
              <Ionicons name="folder-outline" size={24} color={theme.primaryText} />
              <Text style={[styles.settingsRowText, { color: theme.primaryText }]}>Advanced Catalog</Text>
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

function AppContent() {
  const colorScheme = useColorScheme();
  const theme = colors[colorScheme] || colors.dark;
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('Radiohead');
  const [loading, setLoading] = useState(false);
  const [artists, setArtists] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [error, setError] = useState(null);

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
  const queueNotificationTimer = useRef(null);
  const queueNotificationAnim = useRef(new Animated.Value(0)).current;
  const miniPlayerAnim = useRef(new Animated.Value(0)).current;

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
      }
    } catch (e) {
      console.warn('Failed to load settings', e);
    }
  };

  const saveSettings = async (newSettings) => {
    try {
      await FileSystem.writeAsStringAsync(SETTINGS_FILE, JSON.stringify(newSettings));
    } catch (e) {
      console.warn('Failed to save settings', e);
    }
  };

  const toggleTidalForUnowned = async (value) => {
    setUseTidalForUnowned(value);
    await saveSettings({ useTidalForUnowned: value });
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

      const entry = {
        ...track,
        uri: destUri || track.uri, // Keep existing URI if no new source, or use new dest
        dateAdded: Date.now(),
      };

      setLibrary((prev) => {
        // avoid duplicates by uri if uri exists, or by id/name if remote
        let filtered;
        if (entry.uri) {
            filtered = prev.filter((t) => t.uri !== entry.uri);
        } else {
            // For remote tracks without URI yet, try to dedupe by name+artist
            filtered = prev.filter(t => 
                !((t.name === entry.name) && (t.artist === entry.artist || t.artist?.name === entry.artist?.name))
            );
        }
        
        const next = [...filtered, entry];
        saveLibrary(next);
        return next;
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
      let lastTrack = null;

      try {
        // Process all selected files
        for (const file of files) {
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
        }

        // Set the last imported track as current
        if (lastTrack) {
          setCurrentTrack({ ...lastTrack });
        }
      } finally {
        setLoading(false);
      }
    } catch (e) {
      console.warn('Error picking audio file', e);
      setError(e.message ?? 'Error picking audio file');
    }
  };

  const addToRecentSearches = (searchTerm) => {
    const trimmed = searchTerm.trim();
    if (!trimmed) return;

    setRecentSearches(prev => {
      // Remove if already exists
      const filtered = prev.filter(item => item !== trimmed);
      // Add to beginning, limit to 10 items
      return [trimmed, ...filtered].slice(0, 10);
    });
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

  // Animate tab bar when route changes
  useEffect(() => {
    const isSettingsPage = ['Settings', 'AdvancedCatalog', 'SelfHostedCollection', 'Modules'].includes(currentRoute);
    Animated.timing(tabBarAnim, {
      toValue: isSettingsPage ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [currentRoute]);

  // Animate mini player appearance
  useEffect(() => {
    // Hide mini player on settings pages or when player is expanded
    const isSettingsPage = ['Settings', 'AdvancedCatalog', 'SelfHostedCollection', 'Modules'].includes(currentRoute);
    const shouldShow = currentTrack && !isPlayerExpanded && !isSettingsPage;
    
    Animated.spring(miniPlayerAnim, {
      toValue: shouldShow ? 1 : 0,
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start();
  }, [currentTrack, isPlayerExpanded, currentRoute]);

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

  const openTrackPlayer = (track, queue = null, index = 0, expandPlayer = true) => {
    if (!track) return;
    
    // Update last played
    updateTrackLastPlayed(track);

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

  const handleTrackChange = (newTrack, newIndex, newQueue = null) => {
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

  const showQueueNotification = (message) => {
    // Clear existing timer
    if (queueNotificationTimer.current) {
      clearTimeout(queueNotificationTimer.current);
    }

    // Show notification
    setQueueNotification(message);

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

  const addAlbumToQueue = (tracks) => {
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
      showQueueNotification(`Added ${tracks.length} songs to queue`);
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
        });
      }
    } catch (e) {
      setError(e.message ?? 'Error loading album');
    } finally {
      setLoading(false);
    }
  };

  const renderSearchTab = () => (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Header */}
      <View style={styles.searchHeader}>
        <Text style={[styles.searchTitle, { color: theme.primaryText }]}>Search</Text>
      </View>

      {/* Search Bar */}
      <View style={styles.searchBarContainer}>
        <View style={[styles.searchBar, { backgroundColor: theme.inputBackground }]}>
          <Ionicons name="search" size={20} color={theme.secondaryText} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: theme.primaryText }]}
            placeholder="Artists, songs, lyrics, and more"
            placeholderTextColor={theme.secondaryText}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            onSubmitEditing={onSearch}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} style={styles.clearButton}>
              <Ionicons name="close-circle" size={20} color={theme.secondaryText} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: Math.max(100, insets.bottom + 80) }}
        showsVerticalScrollIndicator={false}
      >
        {query.length === 0 ? (
          <>
            {/* Recent Searches - only show if there are any */}
            {recentSearches.length > 0 && (
              <View style={styles.sectionContainer}>
                <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>Recent searches</Text>
                <View style={styles.recentSearches}>
                  {recentSearches.map((search, index) => (
                    <Pressable
                      key={index}
                      style={styles.recentSearchItem}
                      onPress={() => {
                        setQuery(search);
                        onSearch();
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
          navigation: navigationRef,
          onTrackPress: openTrackPlayer,
          pickLocalAudio,
        },
      }}
    />
  );

  // Search tab = API results.
  // Library tab = Local library.

  const searchData = [
    // artists
    ...artists.map((a, index) => ({
      key: `artist-${a.mbid || a.name}-${index}`,
      type: 'artist',
      item: a,
    })),
    // albums
    ...albums.map((a, index) => ({
      key: `album-${a.mbid || a.name}-${index}`,
      type: 'album',
      item: a,
    })),
    // tracks
    ...tracks.map((t, index) => ({
      key: `track-${t.mbid || t.name}-${index}`,
      type: 'track',
      item: t,
    })),
  ];

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

    if (type === 'artist') {
      const imageUrl = pickImageUrl(raw.image, 'large');
      return (
        <Pressable
          key={index}
          style={styles.modernSearchResultItem}
          onPress={() => openArtistPage(raw)}
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
      );
    }

    if (type === 'album') {
      const imageUrl = pickImageUrl(raw.image, 'large');
      return (
        <Pressable
          key={index}
          style={styles.modernSearchResultItem}
          onPress={() => openAlbumPage(raw)}
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
      );
    }

    // Track
    const imageUrl = pickImageUrl(raw.image, 'large');
    return (
      <Pressable
        key={index}
        style={styles.modernSearchResultItem}
        onPress={() => openTrackPlayer(raw)}
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
        <Pressable onPress={() => openTrackPlayer(raw)}>
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
      <Pressable onPress={() => openTrackPlayer(raw)}>
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
                    addToQueue,
                    addAlbumToQueue,
                    currentTrack,
                    isPlaying: playerControls.isPlaying,
                    togglePlay: playerControls.togglePlay,
                    useTidalForUnowned,
                    playlists,
                    addTrackToPlaylist,
                  },
                }}
              />
            )}
          </RootStack.Screen>
          <RootStack.Screen name="Artist" component={ArtistPage} />
          <RootStack.Screen name="Settings" component={SettingsPage} />
          <RootStack.Screen name="AdvancedCatalog" component={AdvancedCatalogPage} />
          <RootStack.Screen name="SelfHostedCollection" component={SelfHostedCollectionPage} />
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
                  },
                }}
              />
            )}
          />
          <RootStack.Screen name="LibraryArtists" component={LibraryArtists} />
          <RootStack.Screen name="LibraryAlbums" component={LibraryAlbums} />
          <RootStack.Screen name="LibrarySongs" component={LibrarySongs} />
          <RootStack.Screen name="LibraryPlaylists" component={LibraryPlaylists} />
          <RootStack.Screen name="PlaylistPage" component={PlaylistPage} />
          <RootStack.Screen name="AddPlaylist" component={AddPlaylist} />
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
          <Ionicons name="checkmark-circle" size={20} color={theme.primaryText} />
          <Text style={[styles.queueNotificationText, { color: theme.primaryText }]} numberOfLines={1}>
            {queueNotification}
          </Text>
        </Animated.View>
      )}


      {/* Mini player when a track is active but full player is minimized */}
      {currentTrack && !isPlayerExpanded && (() => {
        const miniImageUrl = pickImageUrl(currentTrack.image, 'large');
        return (
          <Animated.View
            style={[
              styles.miniPlayer,
              {
                backgroundColor: theme.card,
                opacity: miniPlayerAnim,
                transform: [
                  {
                    translateY: miniPlayerAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [100, 0],
                    }),
                  },
                ],
              }
            ]}
          >
            <Pressable
              style={styles.miniMainArea}
              onPress={() => setIsPlayerExpanded(true)}
            >
              {miniImageUrl ? (
                <Image source={{ uri: miniImageUrl }} style={styles.miniArtwork} />
              ) : (
                <View style={[styles.miniArtwork, { backgroundColor: theme.inputBackground }]} />
              )}
              <View style={styles.miniTextContainer}>
                <Text style={[styles.miniTitle, { color: theme.primaryText }]} numberOfLines={1}>
                  {currentTrack.name}
                </Text>
                <Text style={[styles.miniArtist, { color: theme.secondaryText }]} numberOfLines={1}>
                  {getArtistName(currentTrack.artist)}
                </Text>
              </View>
            </Pressable>
            <Pressable
              style={styles.miniPlayButton}
              onPress={() => {
                if (playerControls?.togglePlay) {
                  playerControls.togglePlay();
                }
              }}
              hitSlop={10}
            >
              <Ionicons
                name={playerControls?.isPlaying ? 'pause' : 'play'}
                size={22}
                color={theme.primaryText}
              />
            </Pressable>
          </Animated.View>
        );
      })()}

      {/* Bottom tab bar - animated slide down */}
      <Animated.View
        pointerEvents={['Settings', 'AdvancedCatalog', 'SelfHostedCollection', 'Modules'].includes(currentRoute) ? 'none' : 'auto'}
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
          onPress={() => setCurrentTab('home')}
        >
          <Ionicons
            name={currentTab === 'home' ? 'home' : 'home-outline'}
            size={22}
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
          onPress={() => setCurrentTab('search')}
        >
          <Ionicons
            name={currentTab === 'search' ? 'search' : 'search-outline'}
            size={22}
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
          onPress={() => setCurrentTab('library')}
        >
          <Ionicons
            name={currentTab === 'library' ? 'library' : 'library-outline'}
            size={22}
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
          onTrackChange={handleTrackChange}
          onQueueReorder={handleQueueReorder}
          theme={theme}
          setPlayerControls={setPlayerControls}
          isVisible={isPlayerExpanded}
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
    bottom: 136, // above mini player (72 + 64)
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
  libraryNavButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
});
