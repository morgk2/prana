import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  ScrollView,
  Pressable,
  Dimensions,
  Animated,
  PanResponder,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { getTrendingTracks } from '../services/DeezerService';

import { getNewReleases, getSpotifyAlbumDetails, scrapeFeaturedPlaylist, getPlaylistDetails as getSpotifyPlaylistDetails } from '../services/SpotifyService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COVER_SIZE = 180;
const SPACING = 140; // Distance between covers

function pickImageUrl(images, preferredSize = 'large') {
  if (!Array.isArray(images)) return null;
  const preferred = images.find((img) => img.size === preferredSize && img['#text']);
  if (preferred) return preferred['#text'];
  const any = images.find((img) => img['#text']);
  return any ? any['#text'] : null;
}

export default function HomeScreen({ route }) {
  const {
    theme,
    libraryAlbums,
    playlists = [],
    libraryArtists = [],
    navigation,
    onTrackPress,
    pickLocalAudio,
    openArtistPage,
    isLibraryLoaded,
  } = route.params;

  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const isInitializedRef = useRef(false);
  const prevIndexRef = useRef(0);
  const [viewMode, setViewMode] = useState('collection'); // 'collection' or 'discover'
  const [discoverData, setDiscoverData] = useState({ albums: [], tracks: [], playlists: [], charts: [], featured: null });
  const [loadingDiscover, setLoadingDiscover] = useState(false);

  useEffect(() => {
    if (viewMode === 'discover' && discoverData.albums.length === 0) {
      fetchDiscoverData();
    }
  }, [viewMode]);

  const fetchDiscoverData = async () => {
    setLoadingDiscover(true);
    try {
      // Fetch New Releases, Trending Tracks (Deezer), Scrape Featured Playlist, and Trending Charts Playlist
      const [albums, tracks, featuredAlbum, chartsPlaylist] = await Promise.all([
        getNewReleases(),
        getTrendingTracks(),
        scrapeFeaturedPlaylist('37i9dQZF1DX0gcho56Immm'),
        getSpotifyPlaylistDetails('3QSmfNR2XtpoADu0QPGVJK') // Trending Charts Playlist
      ]);

      // Extract albums from the charts playlist tracks
      const chartAlbums = chartsPlaylist?.tracks?.items
        ?.map(item => item.track?.album)
        .filter((album, index, self) =>
          album &&
          self.findIndex(a => a.id === album.id) === index // Deduplicate by ID
        ) || [];

      setDiscoverData({
        albums,
        tracks,
        playlists: [],
        charts: chartAlbums,
        featured: featuredAlbum
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDiscover(false);
    }
  };

  const handleDiscoverAlbumPress = async (album) => {
    try {
      // Fetch full details including tracks from Spotify
      const details = await getSpotifyAlbumDetails(album.id);

      // Map Spotify album to app album format
      const mappedAlbum = {
        title: details ? details.name : album.name,
        artist: details ? details.artists[0].name : album.artists[0].name,
        artwork: details ? details.images[0]?.url : album.images[0]?.url,
        key: `spotify-${album.id}`,
        tracks: details?.tracks?.items?.map((t, index) => ({
          name: t.name,
          track_number: t.track_number || index + 1,
          artist: t.artists[0].name,
          album: details.name,
          image: [{ '#text': details.images[0]?.url, size: 'extralarge' }],
          uri: t.preview_url, // Preview or use Tidal
          id: `spotify-${t.id}`
        })) || []
      };

      navigation.navigate('LibraryAlbum', {
        album: mappedAlbum,
        theme,
        onTrackPress,
        libraryAlbums,
        useTidalForUnowned: true // Ensure we can play it
      });
    } catch (e) {
      console.error('Failed to open album', e);
    }
  };

  const handleSpotifyPlaylistPress = async (playlist) => {
    try {
      const details = await getSpotifyPlaylistDetails(playlist.id);
      if (details) {
        const mappedPlaylist = {
          id: `spotify-${details.id}`,
          name: details.name,
          image: details.images[0]?.url,
          description: details.description || `By ${details.owner?.display_name}`,
          tracks: details.tracks?.items?.map(item => {
            const t = item.track;
            if (!t) return null;
            return {
              name: t.name,
              artist: t.artists[0].name,
              album: t.album.name,
              image: [{ '#text': t.album.images[0]?.url, size: 'extralarge' }],
              uri: t.preview_url,
              id: `spotify-${t.id}`
            };
          }).filter(Boolean) || []
        };

        navigation.navigate('PlaylistPage', {
          playlist: mappedPlaylist,
          theme,
          onTrackPress,
          useTidalForUnowned: true
        });
      }
    } catch (e) {
      console.error('Failed to open playlist', e);
    }
  };

  const handleDiscoverTrackPress = (track) => {
    const mappedTrack = {
      name: track.title,
      artist: track.artist.name,
      album: track.album.title,
      image: [{ '#text': track.album.cover_xl, size: 'extralarge' }],
      uri: track.preview,
      id: `deezer-${track.id}`
    };
    // Play single track
    onTrackPress(mappedTrack, [mappedTrack], 0);
  };

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const switchView = (mode) => {
    if (viewMode !== mode) {
      Haptics.selectionAsync();
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setViewMode(mode);
    }
  };

  // Handle Swipe Gestures
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dx) > 10,
      onPanResponderGrant: () => {
        scrollX.stopAnimation();
        scrollX.extractOffset();
        setScrollEnabled(false);
      },
      onPanResponderMove: (_, gestureState) => {
        scrollX.setValue(-gestureState.dx / 150);
      },
      onPanResponderRelease: (_, gestureState) => {
        scrollX.flattenOffset();

        // Calculate momentum based on velocity
        const velocityFactor = -gestureState.vx * 1.5;
        let targetIndex = Math.round(scrollX._value + velocityFactor);

        targetIndex = Math.max(0, Math.min(targetIndex, libraryAlbums.length - 1));

        setCurrentIndex(targetIndex);

        Animated.spring(scrollX, {
          toValue: targetIndex,
          useNativeDriver: false,
          friction: 6,
          tension: 50,
        }).start();
        setScrollEnabled(true);
      },
    })
  ).current;

  // Initialize to center when libraryAlbums loads for the first time
  useEffect(() => {
    if (libraryAlbums.length > 0 && !isInitializedRef.current) {
      const centerIndex = Math.floor(libraryAlbums.length / 2);
      // Ensure offset is cleared and value is set cleanly
      scrollX.flattenOffset(); // Flatten any existing offset
      scrollX.setValue(centerIndex); // Set the value directly
      scrollX.setOffset(0); // Explicitly set offset to 0
      prevIndexRef.current = centerIndex;
      setCurrentIndex(centerIndex);
      isInitializedRef.current = true;
    }
  }, [libraryAlbums.length]);

  // Animate to the new index when currentIndex changes (user interaction only)
  useEffect(() => {
    // Only animate if index actually changed and we're initialized
    if (
      libraryAlbums.length > 0 &&
      !isNaN(currentIndex) &&
      isInitializedRef.current &&
      prevIndexRef.current !== currentIndex
    ) {
      prevIndexRef.current = currentIndex;
      Animated.spring(scrollX, {
        toValue: currentIndex,
        useNativeDriver: false,
        friction: 7,
        tension: 40,
      }).start();
    }
  }, [currentIndex]);

  const next = () => {
    if (libraryAlbums.length === 0) return;
    setCurrentIndex(prev => (prev + 1) % libraryAlbums.length);
  };

  const prev = () => {
    if (libraryAlbums.length === 0) return;
    setCurrentIndex(prev => (prev - 1 + libraryAlbums.length) % libraryAlbums.length);
  };

  const jumpTo = (index) => setCurrentIndex(index);

  const renderRecentAlbumCard = (album, index) => {
    return (
      <Pressable
        key={`recent-${index}`}
        style={[styles.recentCard, { backgroundColor: theme.card }]}
        onPress={() => {
          if (navigation) {
            navigation.navigate('LibraryAlbum', {
              album,
              theme,
              onTrackPress,
              libraryAlbums,
            });
          }
        }}
      >
        <View style={styles.recentCardContent}>
          {album.artwork ? (
            <Image source={{ uri: album.artwork }} style={styles.recentCardImage} />
          ) : (
            <View style={[styles.recentCardImage, { backgroundColor: theme.inputBackground }]}>
              <Ionicons name="disc-outline" size={24} color={theme.secondaryText} />
            </View>
          )}
          <View style={styles.recentCardText}>
            <Text style={[styles.recentCardTitle, { color: theme.primaryText }]} numberOfLines={1}>
              {album.title}
            </Text>
            <Text style={[styles.recentCardArtist, { color: theme.secondaryText }]} numberOfLines={1}>
              {album.artist}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  };

  const recentAlbums = libraryAlbums.slice(0, 6);
  const favoriteAlbums = [...libraryAlbums].sort(() => 0.5 - Math.random()).slice(0, 10);

  const renderAlbumCarouselItem = ({ item }) => (
    <Pressable style={styles.carouselItem} onPress={() => {
      if (navigation) {
        navigation.navigate('LibraryAlbum', {
          album: item,
          theme,
          onTrackPress,
          libraryAlbums,
        });
      }
    }}>
      {item.artwork ? (
        <Image source={{ uri: item.artwork }} style={styles.carouselImage} />
      ) : (
        <View style={[styles.carouselImage, { backgroundColor: theme.inputBackground, justifyContent: 'center', alignItems: 'center' }]}>
          <Ionicons name="disc-outline" size={40} color={theme.secondaryText} />
        </View>
      )}
      <Text style={[styles.carouselItemText, { color: theme.primaryText }]} numberOfLines={1}>{item.title}</Text>
    </Pressable>
  );

  const renderPlaylistItem = ({ item }) => (
    <Pressable style={styles.carouselItem} onPress={() => navigation.navigate('PlaylistPage', { playlist: item, theme, ...route.params })}>
      {item.image ? (
        <Image source={{ uri: item.image }} style={styles.carouselImage} />
      ) : (
        <View style={[styles.carouselImage, { backgroundColor: theme.card, justifyContent: 'center', alignItems: 'center' }]}>
          <Ionicons name="musical-notes" size={40} color={theme.secondaryText} />
        </View>
      )}
      <Text style={[styles.carouselItemText, { color: theme.primaryText }]} numberOfLines={1}>{item.name}</Text>
    </Pressable>
  );

  const renderArtistItem = ({ item }) => {
    const imageUrl = pickImageUrl(item.image, 'large');
    return (
      <Pressable style={styles.artistItem} onPress={() => openArtistPage(item)}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.artistImage} />
        ) : (
          <View style={[styles.artistImage, { backgroundColor: theme.card, justifyContent: 'center', alignItems: 'center' }]}>
            <Ionicons name="person" size={60} color={theme.secondaryText} />
          </View>
        )}
        <Text style={[styles.carouselItemText, { color: theme.primaryText }]} numberOfLines={1}>
          {item.name}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={scrollEnabled}
      >
        {/* Header */}
        <View style={[styles.header, viewMode === 'discover' && { marginBottom: 0, paddingBottom: 20 }]}>
          <View>
            <Image
              source={require('../../assets/expandedLogo.png')}
              style={{ width: 300, height: 75, resizeMode: 'contain', marginLeft: -90, tintColor: theme.primaryText }}
            />
          </View>

          {viewMode === 'discover' && (
            <View style={{ position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center', top: 65, pointerEvents: 'none', flexDirection: 'row' }}>
              <Text style={{
                color: theme.primaryText,
                fontSize: 22,
                fontWeight: '300',
                opacity: 0.4,
                textAlign: 'center',
                marginRight: 6,
              }}>
                from
              </Text>
              <Text style={{
                color: theme.primaryText,
                fontSize: 22,
                fontWeight: '800',
                opacity: 0.9,
                textAlign: 'center',
              }}>
                Cph+
              </Text>
            </View>
          )}

          <TouchableOpacity
            onPress={() => switchView(viewMode === 'collection' ? 'discover' : 'collection')}
            style={styles.switcherButton}
            activeOpacity={0.7}
          >
            {viewMode === 'collection' ? (
              <>
                <Ionicons name="compass" size={24} color={theme.primaryText} />
                <Text style={[styles.switcherText, { color: theme.primaryText }]}>Discover</Text>
              </>
            ) : (
              <>
                <Ionicons name="disc" size={24} color={theme.primaryText} />
                <Text style={[styles.switcherText, { color: theme.primaryText }]}>Collection</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {viewMode === 'collection' ? (
          libraryAlbums.length > 0 ? (
            <>
              {/* 3D Cover Flow Scene */}
              <View style={styles.scene} {...panResponder.panHandlers}>
                {libraryAlbums.map((album, index) => {
                  const isActive = index === currentIndex;
                  const inputRange = [index - 2, index - 1, index, index + 1, index + 2];
                  const scale = scrollX.interpolate({ inputRange, outputRange: [0.8, 0.8, 1, 0.8, 0.8], extrapolate: 'clamp' });
                  const rotateY = scrollX.interpolate({ inputRange, outputRange: ['-75deg', '-75deg', '0deg', '75deg', '75deg'], extrapolate: 'clamp' });
                  const translateX = scrollX.interpolate({ inputRange, outputRange: [130, 100, 0, -100, -130], extrapolate: 'clamp' });
                  const opacity = scrollX.interpolate({ inputRange, outputRange: [1, 1, 1, 1, 1], extrapolate: 'clamp' });
                  const zIndex = 100 - Math.abs(currentIndex - index);
                  const reflectionOpacity = scrollX.interpolate({ inputRange, outputRange: [0.1, 0.3, 0.5, 0.3, 0.1], extrapolate: 'clamp' });

                  return (
                    <Animated.View
                      key={album.key || index}
                      style={[styles.coverContainer, { zIndex, opacity, transform: [{ perspective: 800 }, { translateX }, { rotateY }, { scale }] }]}
                    >
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => {
                          if (isActive) {
                            if (navigation) {
                              navigation.navigate('LibraryAlbum', { album, theme, onTrackPress, libraryAlbums });
                            }
                          } else {
                            jumpTo(index);
                          }
                        }}
                        style={styles.touchableCover}
                      >
                        {album.artwork ? (
                          <Image source={{ uri: album.artwork }} style={styles.coverImage} />
                        ) : (
                          <View style={[styles.coverImage, styles.placeholderAlbum, { backgroundColor: theme.card }]}>
                            <Ionicons name="disc-outline" size={60} color={theme.secondaryText} />
                          </View>
                        )}

                        <Animated.View style={[styles.reflectionContainer, { opacity: reflectionOpacity }]}>
                          {album.artwork ? (
                            <Image source={{ uri: album.artwork }} style={[styles.coverImage, styles.reflectionImage]} />
                          ) : (
                            <View style={[styles.coverImage, styles.reflectionImage, styles.placeholderAlbum, { backgroundColor: theme.card }]}>
                              <Ionicons name="disc-outline" size={60} color={theme.secondaryText} />
                            </View>
                          )}
                          <LinearGradient colors={['rgba(0,0,0,0)', theme.background]} locations={[0, 0.8]} style={StyleSheet.absoluteFill} />
                        </Animated.View>
                      </TouchableOpacity>
                    </Animated.View>
                  );
                })}
              </View>

              {/* Album Info */}
              <View style={styles.infoContainer}>
                <Text style={[styles.albumTitle, { color: theme.primaryText }]} numberOfLines={1}>
                  {libraryAlbums[currentIndex]?.title}
                </Text>
                <Text style={[styles.albumArtist, { color: theme.secondaryText }]} numberOfLines={1}>
                  {libraryAlbums[currentIndex]?.artist}
                </Text>
              </View>

              {/* Recent Albums Grid */}
              <View style={styles.recentSection}>
                <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>
                  Recent Albums
                </Text>
                <View style={styles.recentGrid}>
                  <View style={styles.recentColumn}>
                    {recentAlbums.filter((_, i) => i % 2 === 0).map((album, i) => renderRecentAlbumCard(album, i * 2))}
                  </View>
                  <View style={styles.recentColumn}>
                    {recentAlbums.filter((_, i) => i % 2 === 1).map((album, i) => renderRecentAlbumCard(album, i * 2 + 1))}
                  </View>
                </View>
              </View>

              {/* Your Playlists */}
              {playlists && playlists.length > 0 && (
                <View style={styles.carouselSection}>
                  <Text style={[styles.sectionTitle, { color: theme.primaryText, paddingHorizontal: 20 }]}>
                    Your Playlists
                  </Text>
                  <FlatList
                    horizontal
                    data={playlists}
                    renderItem={renderPlaylistItem}
                    keyExtractor={item => item.id}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingLeft: 20, paddingRight: 5 }}
                  />
                </View>
              )}

              {/* Your Favorite Albums */}
              {favoriteAlbums && favoriteAlbums.length > 0 && (
                <View style={styles.carouselSection}>
                  <Text style={[styles.sectionTitle, { color: theme.primaryText, paddingHorizontal: 20 }]}>
                    Your Favorite Albums
                  </Text>
                  <FlatList
                    horizontal
                    data={favoriteAlbums}
                    renderItem={renderAlbumCarouselItem}
                    keyExtractor={item => item.key}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingLeft: 20, paddingRight: 5 }}
                  />
                </View>
              )}

              {/* Your Favorite Artists */}
              {libraryArtists && libraryArtists.length > 0 && (
                <View style={styles.carouselSection}>
                  <Text style={[styles.sectionTitle, { color: theme.primaryText, paddingHorizontal: 20 }]}>
                    Your Favorite Artists
                  </Text>
                  <FlatList
                    horizontal
                    data={libraryArtists}
                    renderItem={renderArtistItem}
                    keyExtractor={item => item.name}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingLeft: 20, paddingRight: 5 }}
                  />
                </View>
              )}
            </>
          ) : !isLibraryLoaded ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color={theme.primaryText} />
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Ionicons
                name="musical-notes-outline"
                size={80}
                color={theme.secondaryText}
                style={{ opacity: 0.3, marginBottom: 16 }}
              />
              <Text style={[styles.emptyTitle, { color: theme.primaryText }]}>
                No Music Yet
              </Text>
              <Text style={[styles.emptySubtitle, { color: theme.secondaryText }]}>
                Import songs to start building your collection
              </Text>
              <Pressable
                style={[styles.importButton, { backgroundColor: theme.primaryText }]}
                onPress={pickLocalAudio}
              >
                <Ionicons name="add" size={24} color={theme.background} />
                <Text style={[styles.importButtonText, { color: theme.background }]}>
                  Import Song
                </Text>
              </Pressable>
            </View>
          )) : (
          <View style={{ flex: 1, paddingBottom: 100 }}>
            {loadingDiscover ? (
              <View style={{ height: 300, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color={theme.primaryText} />
              </View>
            ) : (
              <>
                <>
                  {/* Featured Album */}
                  {discoverData.featured && (
                    <Pressable
                      style={styles.featuredContainer}
                      onPress={() => handleDiscoverAlbumPress(discoverData.featured)}
                    >
                      <Image source={{ uri: discoverData.featured.images[0]?.url }} style={styles.featuredImage} blurRadius={10} />
                      <Image source={{ uri: discoverData.featured.images[0]?.url }} style={styles.featuredImageForeground} />

                      {/* Top Gradient for blending with header */}
                      <LinearGradient
                        colors={[theme.background, 'transparent']}
                        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 300 }}
                      />

                      {/* Bottom Gradient for text readability/blending */}
                      <LinearGradient
                        colors={['transparent', theme.background]}
                        style={styles.featuredGradient}
                      />

                      <View style={[styles.featuredContent, { paddingBottom: 10 }]}>
                        <Text style={[styles.featuredTitle, { color: theme.primaryText }]} numberOfLines={2}>
                          {discoverData.featured.name}
                        </Text>
                        <Text style={[styles.featuredArtist, { color: theme.secondaryText }]} numberOfLines={1}>
                          {discoverData.featured.artists[0].name}
                        </Text>
                      </View>
                    </Pressable>
                  )}

                  {/* New Releases (Spotify) */}
                  <View style={styles.carouselSection}>
                    <Text style={[styles.sectionTitle, { color: theme.primaryText, paddingHorizontal: 20 }]}>
                      New Releases
                    </Text>
                    <FlatList
                      horizontal
                      data={discoverData.albums}
                      renderItem={({ item }) => (
                        <Pressable style={styles.carouselItem} onPress={() => handleDiscoverAlbumPress(item)}>
                          <Image source={{ uri: item.images[0]?.url }} style={styles.carouselImage} />
                          <Text style={[styles.carouselItemText, { color: theme.primaryText }]} numberOfLines={1}>{item.name}</Text>
                          <Text style={[styles.carouselItemText, { color: theme.secondaryText, fontSize: 12, marginTop: 2 }]} numberOfLines={1}>{item.artists[0].name}</Text>
                        </Pressable>
                      )}
                      keyExtractor={item => item.id}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ paddingLeft: 20, paddingRight: 5 }}
                    />
                  </View>

                  {/* Trending Charts (Spotify Playlist Albums) */}
                  <View style={styles.carouselSection}>
                    <Text style={[styles.sectionTitle, { color: theme.primaryText, paddingHorizontal: 20 }]}>
                      Trending Charts
                    </Text>
                    <FlatList
                      horizontal
                      data={discoverData.charts}
                      renderItem={({ item }) => (
                        <Pressable style={styles.carouselItem} onPress={() => handleDiscoverAlbumPress(item)}>
                          <Image source={{ uri: item.images[0]?.url }} style={styles.carouselImage} />
                          <Text style={[styles.carouselItemText, { color: theme.primaryText }]} numberOfLines={1}>{item.name}</Text>
                          <Text style={[styles.carouselItemText, { color: theme.secondaryText, fontSize: 12, marginTop: 2 }]} numberOfLines={1}>{item.artists[0].name}</Text>
                        </Pressable>
                      )}
                      keyExtractor={item => item.id}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ paddingLeft: 20, paddingRight: 5 }}
                    />
                  </View>



                  {/* Top Songs (Deezer Global) */}
                  <View style={[styles.carouselSection, { marginBottom: 40 }]}>
                    <Text style={[styles.sectionTitle, { color: theme.primaryText, paddingHorizontal: 20 }]}>
                      Top Songs
                    </Text>
                    <FlatList
                      horizontal
                      data={discoverData.tracks}
                      renderItem={({ item }) => (
                        <Pressable style={styles.carouselItem} onPress={() => handleDiscoverTrackPress(item)}>
                          <Image source={{ uri: item.album.cover_xl }} style={styles.carouselImage} />
                          <Text style={[styles.carouselItemText, { color: theme.primaryText }]} numberOfLines={1}>{item.title}</Text>
                          <Text style={[styles.carouselItemText, { color: theme.secondaryText, fontSize: 12, marginTop: 2 }]} numberOfLines={1}>{item.artist.name}</Text>
                        </Pressable>
                      )}
                      keyExtractor={item => item.id.toString()}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ paddingLeft: 20, paddingRight: 5 }}
                    />
                  </View>
                </>


              </>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 60,
    paddingBottom: 200,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switcherButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 0, // Removed horizontal padding as there is no background
    gap: 8,
  },
  switcherText: {
    fontSize: 16, // Increased font size slightly for better visibility without pill
    fontWeight: '600',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '400',
  },
  scene: {
    height: 350,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'visible',
    marginTop: 20,
    marginBottom: 0,
  },
  coverContainer: {
    position: 'absolute',
    width: COVER_SIZE,
    height: COVER_SIZE + 100,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  touchableCover: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
  },
  coverImage: {
    width: COVER_SIZE,
    height: COVER_SIZE,
    borderRadius: 8,
    backgroundColor: '#333',
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
  },
  placeholderAlbum: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  reflectionContainer: {
    width: COVER_SIZE,
    height: 100,
    marginTop: 2,
    overflow: 'hidden',
  },
  reflectionImage: {
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ scaleY: -1 }],
  },
  infoContainer: {
    alignItems: 'center',
    paddingHorizontal: 30,
    marginTop: -40,
    marginBottom: 50,
  },
  albumTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  albumArtist: {
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  recentSection: {
    paddingHorizontal: 20,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  recentGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  recentColumn: {
    flex: 1,
    gap: 12,
  },
  recentCard: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 0,
  },
  recentCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  recentCardImage: {
    width: 50,
    height: 50,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentCardText: {
    flex: 1,
  },
  recentCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  recentCardArtist: {
    fontSize: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 60,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  importButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 999,
  },
  importButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  carouselSection: {
    marginTop: 30,
  },
  carouselItem: {
    marginRight: 15,
    width: 150,
  },
  carouselImage: {
    width: 150,
    height: 150,
    borderRadius: 8,
    marginBottom: 10,
  },
  carouselItemText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  artistItem: {
    marginRight: 15,
    width: 150,
    alignItems: 'center',
  },
  artistImage: {
    width: 120,
    height: 120,
    borderRadius: 60, // for circle shape
    marginBottom: 10,
  },
  featuredContainer: {
    width: '100%',
    height: 350,
    marginBottom: 20,
    position: 'relative',
    justifyContent: 'flex-end',
  },
  featuredImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  featuredImageForeground: {
    position: 'absolute',
    top: 40,
    alignSelf: 'center',
    width: 200,
    height: 200,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 15,
    zIndex: 10,
  },
  featuredGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  featuredContent: {
    padding: 20,
    alignItems: 'center',
    paddingBottom: 40,
  },
  featuredTitle: {
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  featuredArtist: {
    fontSize: 18,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 16,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  cphButton: {
    backgroundColor: '#fff',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 100,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  cphButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
});