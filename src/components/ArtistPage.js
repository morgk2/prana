
import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  ScrollView,
  Button,
  ActivityIndicator,
  Animated,
  ImageBackground,
  Pressable,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { getArtistTopTracks, getArtistTopAlbums, getAlbumInfo, getArtistInfo, getRelatedArtists } from '../api/lastfm';
import * as FileSystem from 'expo-file-system/legacy';

function pickImageUrl(images, preferredSize = 'large') {
  if (!Array.isArray(images)) return null;
  const preferred = images.find((img) => img.size === preferredSize && img['#text']);
  if (preferred) return preferred['#text'];
  const any = images.find((img) => img['#text']);
  return any ? any['#text'] : null;
}

const HEADER_MAX_HEIGHT = 280;
const HEADER_MIN_HEIGHT = 80;
const HEADER_SCROLL_DISTANCE = HEADER_MAX_HEIGHT - HEADER_MIN_HEIGHT;

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

export default function ArtistPage({ route, navigation }) {
  const { artist, theme, onTrackPress, library = [], libraryArtists = [], loading: initialLoading, openAlbumPage, addToLibrary } = route.params;

  const [topTracks, setTopTracks] = useState([]);
  const [topAlbums, setTopAlbums] = useState([]);
  const [artistInfo, setArtistInfo] = useState(null);
  const [similarArtists, setSimilarArtists] = useState([]);
  const [loading, setLoading] = useState(initialLoading || false);
  const [error, setError] = useState(null);
  const [showOwnedOnly, setShowOwnedOnly] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuType, setContextMenuType] = useState('filter'); // 'filter' | 'remove' | 'album'
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [expandedTracks, setExpandedTracks] = useState(false);

  // Check if artist is already saved in the passed libraryArtists
  const isSavedInitially = libraryArtists.some(a => a.name === artist.name);
  const [isArtistSaved, setIsArtistSaved] = useState(isSavedInitially);

  // Shimmer animation for skeleton
  const shimmerAnim = new Animated.Value(0);
  // Context menu animation (scale + fade)
  const menuAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (loading) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(shimmerAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(shimmerAnim, {
            toValue: 0,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [loading]);

  const openContextMenu = (type = 'filter', item = null) => {
    setContextMenuType(type);
    setShowContextMenu(true);
    if (item) {
      setSelectedAlbum(item);
    }
    menuAnim.setValue(0);
    Animated.timing(menuAnim, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();
  };

  const saveArtistOffline = async () => {
    try {
      const dirInfo = await FileSystem.getInfoAsync(`${FileSystem.documentDirectory}library`);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}library`, { intermediates: true });
      }

      const cacheFile = `${FileSystem.documentDirectory}library/artists.json`;
      let existing = [];
      try {
        const fileInfo = await FileSystem.getInfoAsync(cacheFile);
        if (fileInfo.exists) {
          const json = await FileSystem.readAsStringAsync(cacheFile);
          const parsed = JSON.parse(json || '[]');
          if (Array.isArray(parsed)) existing = parsed;
        }
      } catch (e) {
        console.warn('Failed to read cached artists', e);
      }

      const payload = {
        id: artist.mbid || artist.name,
        name: artist.name,
        listeners: artist.listeners,
        image: artist.image,
        topTracks,
        topAlbums,
        cachedAt: Date.now(),
      };

      const filtered = existing.filter((a) => a.id !== payload.id);
      const next = [...filtered, payload];
      await FileSystem.writeAsStringAsync(cacheFile, JSON.stringify(next));
      setIsArtistSaved(true);
    } catch (e) {
      console.warn('Failed to cache artist offline', e);
    }
  };

  const removeArtistFromLibrary = async () => {
    try {
      const cacheFile = `${FileSystem.documentDirectory}library/artists.json`;
      let existing = [];
      try {
        const fileInfo = await FileSystem.getInfoAsync(cacheFile);
        if (fileInfo.exists) {
          const json = await FileSystem.readAsStringAsync(cacheFile);
          const parsed = JSON.parse(json || '[]');
          if (Array.isArray(parsed)) existing = parsed;
        }
      } catch (e) {
        console.warn('Failed to read cached artists', e);
      }

      const targetId = artist.mbid || artist.name;
      const next = existing.filter((a) => a.id !== targetId);
      await FileSystem.writeAsStringAsync(cacheFile, JSON.stringify(next));
      setIsArtistSaved(false);
      closeContextMenu();
    } catch (e) {
      console.warn('Failed to remove artist from library', e);
    }
  };

  const playOwnedArtistTracks = () => {
    if (!onTrackPress) return;

    const targetName = (artist.name || '').toLowerCase().trim();

    const ownedTracks = library.filter((t) => {
      if (!t || !t.isLocal) return false;
      const artistName = (
        t.albumArtist ||
        (t.artist && t.artist.name) ||
        t.artist ||
        ''
      )
        .toLowerCase()
        .trim();
      return artistName === targetName;
    });

    if (!ownedTracks.length) return;

    const shuffled = [...ownedTracks].sort(() => Math.random() - 0.5);
    const first = shuffled[0];
    onTrackPress(first);
  };

  const closeContextMenu = () => {
    Animated.timing(menuAnim, {
      toValue: 0,
      duration: 140,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setShowContextMenu(false);
        setSelectedAlbum(null);
      }
    });
  };

  const addAlbumToLibrary = async () => {
    if (!selectedAlbum || !addToLibrary) return;
    
    // We need to fetch album tracks first
    // Assuming we can't easily fetch them here without duplicating logic, 
    // let's just open the album page which handles loading tracks, 
    // OR better, create a simplified track object if we don't have tracks yet.
    // But user wants to "Show in library".
    // The best way to "Show in library" is to add it.
    
    // Ideally we would fetch the album tracks here.
    // For now, let's assume we need to open the album page to add it properly,
    // or we just add a placeholder if that's acceptable.
    // But to actually populate the library we need tracks.
    // Let's trigger the openAlbumPage but perhaps auto-add?
    // Or just add the album metadata? Library relies on tracks.
    
    // Strategy: Fetch tracks then add.
    // Reuse the getAlbumInfo logic from App.js? We don't have it here.
    // We only have `addToLibrary`.
    
    // Hack: Just navigate to the album page so the user can see it and download/add it?
    // No, user asked for an option in the menu.
    
    // Let's try to use the same API call as App.js if available.
    // We imported getArtistTopTracks but not getAlbumInfo.
    // Let's import it.
    
    try {
        setLoading(true);
        const albumInfo = await getAlbumInfo({
            artist: selectedAlbum.artist?.name || selectedAlbum.artist,
            album: selectedAlbum.name,
            mbid: selectedAlbum.mbid,
        });
        
        const tracks = albumInfo?.tracks?.track ?? [];
        if (tracks.length > 0) {
            for (const track of tracks) {
                const trackToAdd = {
                    name: track.name,
                    artist: typeof track.artist === 'object' ? track.artist.name : track.artist,
                    album: selectedAlbum.name,
                    image: selectedAlbum.image,
                    mbid: track.mbid,
                    // Add other metadata if needed
                };
                // Add as remote track (no uri yet)
                await addToLibrary(trackToAdd, null, track.name);
            }
            closeContextMenu();
            // Maybe show success toast?
        }
    } catch (e) {
        console.warn('Failed to add album to library', e);
    } finally {
        setLoading(false);
    }
  };

  // Fetch artist data when component mounts
  useEffect(() => {
    const fetchArtistData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [tracks, albums, info, similar] = await Promise.all([
          getArtistTopTracks(artist.name, { limit: 30 }),
          getArtistTopAlbums(artist.name, { limit: 10 }),
          getArtistInfo(artist.name),
          getRelatedArtists(artist.name, { limit: 10 }),
        ]);

        setTopTracks(tracks ?? []);
        setTopAlbums(albums ?? []);
        setArtistInfo(info);
        setSimilarArtists(similar ?? []);
      } catch (e) {
        setError(e.message ?? 'Failed to load artist data');
      } finally {
        setLoading(false);
      }
    };

    fetchArtistData();
  }, [artist.name]);

  // Check if a track is in the library
  const isTrackImported = (track) => {
    return library.some(libTrack => {
      const trackName = (track.name || '').toLowerCase().trim();
      const libName = (libTrack.name || '').toLowerCase().trim();
      const trackArtist = (track.artist?.name || track.artist || '').toLowerCase().trim();
      const libArtist = (libTrack.artist?.name || libTrack.artist || '').toLowerCase().trim();
      return trackName === libName && trackArtist === libArtist;
    });
  };

  // Check if an album is in the library (at least one track from it)
  const isAlbumImported = (album) => {
    const albumName = (album.name || '').toLowerCase().trim();
    const albumArtist = (album.artist?.name || album.artist || '').toLowerCase().trim();

    if (!albumName || albumName === 'unknown album' || !albumArtist || albumArtist === 'unknown artist') {
        return false;
    }

    return library.some(libTrack => {
      const libAlbum = (libTrack.album || '').toLowerCase().trim();
      const libArtist = (libTrack.albumArtist || libTrack.artist?.name || libTrack.artist || '').toLowerCase().trim();
      return albumName === libAlbum && albumArtist === libArtist;
    });
  };

  const scrollY = new Animated.Value(0);

  const headerTranslate = scrollY.interpolate({
    inputRange: [0, HEADER_SCROLL_DISTANCE],
    outputRange: [0, -HEADER_SCROLL_DISTANCE],
    extrapolate: 'clamp',
  });

  // Make the header stretchy when pulling down (negative scroll values)
  const headerHeight = scrollY.interpolate({
    inputRange: [-HEADER_MAX_HEIGHT, 0, HEADER_SCROLL_DISTANCE],
    outputRange: [HEADER_MAX_HEIGHT * 2, HEADER_MAX_HEIGHT, HEADER_MIN_HEIGHT],
    extrapolate: 'clamp',
  });

  const imageOpacity = scrollY.interpolate({
    inputRange: [0, HEADER_SCROLL_DISTANCE / 2],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const imageTranslate = scrollY.interpolate({
    inputRange: [0, HEADER_SCROLL_DISTANCE],
    outputRange: [0, HEADER_MIN_HEIGHT],
    extrapolate: 'clamp',
  });

  const titleScale = scrollY.interpolate({
    inputRange: [0, HEADER_SCROLL_DISTANCE / 2, HEADER_SCROLL_DISTANCE],
    outputRange: [1, 1, 0.8],
    extrapolate: 'clamp',
  });

  const titleTranslate = scrollY.interpolate({
    inputRange: [0, HEADER_SCROLL_DISTANCE / 2, HEADER_SCROLL_DISTANCE],
    outputRange: [0, 0, -8],
    extrapolate: 'clamp',
  });

  // Fade the small app-bar title in only after the header has mostly collapsed
  const titleOpacity = scrollY.interpolate({
    inputRange: [HEADER_SCROLL_DISTANCE / 3, HEADER_SCROLL_DISTANCE],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  // Progressive blur intensity/opacity for the top app bar area
  const blurIntensity = scrollY.interpolate({
    inputRange: [0, HEADER_SCROLL_DISTANCE],
    outputRange: [0, 80],
    extrapolate: 'clamp',
  });

  const blurOpacity = scrollY.interpolate({
    inputRange: [0, HEADER_SCROLL_DISTANCE / 3, HEADER_SCROLL_DISTANCE],
    outputRange: [0, 0.6, 1],
    extrapolate: 'clamp',
  });

  const artistImageUrl =
    pickImageUrl(artist.image, 'extralarge') || pickImageUrl(artist.image, 'large');

  const renderLoadingSkeleton = () => {
    const shimmerOpacity = shimmerAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 0.7],
    });

    const SkeletonBox = ({ width, height, style }) => (
      <Animated.View
        style={[
          {
            width,
            height,
            backgroundColor: theme.card,
            borderRadius: 8,
            opacity: shimmerOpacity,
          },
          style,
        ]}
      />
    );

    return (
      <>
        <View style={styles.section}>
          <SkeletonBox width={180} height={26} style={{ marginBottom: 16 }} />
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <View key={`skeleton-track-${i}`} style={[styles.row, { borderBottomWidth: 0, paddingVertical: 10 }]}>
              <SkeletonBox width={48} height={48} style={{ marginRight: 12 }} />
              <View style={styles.rowText}>
                <SkeletonBox width={`${60 + (i * 5) % 30}%`} height={16} style={{ marginBottom: 8 }} />
                <SkeletonBox width={`${40 + (i * 7) % 25}%`} height={14} />
              </View>
            </View>
          ))}
        </View>
        <View style={styles.section}>
          <SkeletonBox width={120} height={26} style={{ marginBottom: 16 }} />
          {[1, 2, 3, 4].map((i) => (
            <View key={`skeleton-album-${i}`} style={[styles.row, { borderBottomWidth: 0, paddingVertical: 10 }]}>
              <SkeletonBox width={56} height={56} style={{ marginRight: 12 }} />
              <View style={styles.rowText}>
                <SkeletonBox width={`${55 + (i * 6) % 30}%`} height={16} style={{ marginBottom: 8 }} />
                <SkeletonBox width={`${35 + (i * 8) % 25}%`} height={14} />
              </View>
            </View>
          ))}
        </View>
      </>
    );
  };

  // Find exact match in library to play local file if available
  const getLocalTrack = (track) => {
    if (!library) return null;
    const targetName = (track.name || '').toLowerCase().trim();
    const targetArtist = (track.artist?.name || track.artist || '').toLowerCase().trim();

    return library.find(libTrack => {
      const libName = (libTrack.name || '').toLowerCase().trim();
      const libArtist = (libTrack.artist?.name || libTrack.artist || libTrack.albumArtist || '').toLowerCase().trim();
      return libName === targetName && libArtist === targetArtist && libTrack.isLocal;
    });
  };

  const handleTrackPress = (track) => {
    if (!onTrackPress) return;
    const localVersion = getLocalTrack(track);
    onTrackPress(localVersion || track);
  };

  const renderContent = () => {
    if (loading) {
      return renderLoadingSkeleton();
    }
    if (error) {
      return <Text style={[styles.error, { color: theme.error }]}>{error}</Text>;
    }

    // Filter tracks and albums if showOwnedOnly is enabled
    const displayTracks = showOwnedOnly ? topTracks.filter(isTrackImported) : topTracks;
    const displayAlbums = showOwnedOnly ? topAlbums.filter(isAlbumImported) : topAlbums;

    return (
      <>
        {displayTracks.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>Popular Tracks</Text>
            {displayTracks.slice(0, expandedTracks ? undefined : 5).map((t, index) => {
              const imageUrl = pickImageUrl(t.image, 'large');
              const imported = isTrackImported(t);
              return (
                <Pressable
                  key={`artist-track-${t.mbid || t.name}-${index}`}
                  onPress={() => handleTrackPress(t)}
                >
                  <View style={[styles.row, { borderBottomColor: theme.border }]}>
                    {imageUrl ? (
                      <Image source={{ uri: imageUrl }} style={styles.squareThumbSmall} />
                    ) : (
                      <View style={[styles.squareThumbSmall, { backgroundColor: theme.card }]} />
                    )}
                    <View style={styles.rowText}>
                      <Text style={[styles.primaryText, { color: theme.primaryText }]} numberOfLines={1}>
                        {t.name}
                      </Text>
                      <Text style={[styles.secondaryText, { color: theme.secondaryText }]} numberOfLines={1}>
                        {t.artist?.name ?? t.artist}
                      </Text>
                    </View>
                    {(() => {
                        const localTrack = getLocalTrack(t);
                        return localTrack?.favorite ? (
                            <Ionicons name="star" size={16} color={theme.primaryText} style={{ marginLeft: 8 }} />
                        ) : null;
                    })()}
                    {imported && (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={theme.primaryText}
                        style={{ marginLeft: 8 }}
                      />
                    )}
                  </View>
                </Pressable>
              );
            })}
            {!expandedTracks && displayTracks.length > 5 && (
              <Pressable
                style={styles.viewMoreButton}
                onPress={() => setExpandedTracks(true)}
              >
                <Text style={[styles.viewMoreText, { color: theme.secondaryText }]}>View more</Text>
                <Ionicons name="chevron-down" size={16} color={theme.secondaryText} style={{ marginLeft: 4 }} />
              </Pressable>
            )}
          </View>
        )}
        {displayAlbums.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>Albums</Text>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: 16 }}
            >
              {displayAlbums.map((a, index) => {
                const imageUrl = pickImageUrl(a.image, 'extralarge') || pickImageUrl(a.image, 'large');
                const imported = isAlbumImported(a);
                return (
                  <Pressable 
                      key={`artist-album-${a.mbid || a.name}-${index}`}
                      onPress={() => openAlbumPage && openAlbumPage(a)}
                      onLongPress={() => {
                          if (!imported) {
                              openContextMenu('album', a);
                          }
                      }}
                      delayLongPress={200}
                      style={styles.albumCard}
                  >
                    {imageUrl ? (
                      <Image source={{ uri: imageUrl }} style={styles.albumImage} />
                    ) : (
                      <View style={[styles.albumImage, { backgroundColor: theme.card, justifyContent: 'center', alignItems: 'center' }]}>
                        <Ionicons name="musical-note" size={40} color={theme.secondaryText} />
                      </View>
                    )}
                    
                    <Text style={[styles.albumTitle, { color: theme.primaryText }]} numberOfLines={1}>
                      {a.name}
                    </Text>
                    <Text style={[styles.albumSubtitle, { color: theme.secondaryText }]} numberOfLines={1}>
                      {a.artist?.name ?? a.artist}
                    </Text>

                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      {imported && (
                          <Ionicons
                          name="checkmark-circle"
                          size={16}
                          color={theme.primaryText}
                          style={{ marginRight: 8 }}
                          />
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Similar Artists Section (replacing About) */}
        {similarArtists.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>Fans also like</Text>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: 16 }}
            >
              {similarArtists.map((simArtist, index) => {
                const imageUrl = pickImageUrl(simArtist.image, 'large');
                return (
                  <Pressable 
                    key={`similar-${simArtist.mbid || simArtist.name}-${index}`}
                    style={styles.similarArtistCard}
                    onPress={() => {
                       // Recursive navigation: push same screen with new artist
                       navigation.push('ArtistPage', { 
                         artist: simArtist, 
                         theme,
                         library,
                         libraryArtists,
                         onTrackPress, 
                         openAlbumPage, 
                         addToLibrary
                       });
                    }}
                  >
                    {imageUrl ? (
                      <Image source={{ uri: imageUrl }} style={styles.roundArtistImage} />
                    ) : (
                      <View style={[styles.roundArtistImage, { backgroundColor: theme.card, justifyContent: 'center', alignItems: 'center' }]}>
                         <Ionicons name="person" size={40} color={theme.secondaryText} />
                      </View>
                    )}
                    <Text 
                      style={[styles.similarArtistName, { color: theme.primaryText }]} 
                      numberOfLines={2}
                    >
                      {simArtist.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
      </>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Animated.ScrollView
        style={styles.fill}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false }
        )}
      >
        <View style={styles.scrollViewContent}>
          {/* Artist Info Below Header */}
          <View style={styles.artistInfo}>
            <View style={styles.artistNameRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={[styles.artistName, { color: theme.primaryText }]}>{artist.name}</Text>
                <Pressable
                  onPress={() => (showContextMenu ? closeContextMenu() : openContextMenu('filter'))}
                  style={[styles.dropdownButton, { backgroundColor: theme.card }]}
                >
                  <Ionicons
                    name={showContextMenu && contextMenuType === 'filter' ? "chevron-up" : "chevron-down"}
                    size={20}
                    color={theme.primaryText}
                  />
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (isArtistSaved) {
                      showContextMenu ? closeContextMenu() : openContextMenu('remove');
                    } else {
                      saveArtistOffline();
                    }
                  }}
                  style={[styles.iconButton, { backgroundColor: theme.card }]}
                >
                  <Ionicons
                    name={isArtistSaved ? 'checkmark' : 'add'}
                    size={18}
                    color={theme.primaryText}
                  />
                </Pressable>
              </View>
              <Pressable
                onPress={playOwnedArtistTracks}
                style={styles.playButton}
              >
                <Ionicons name="play" size={32} color="#FFFFFF" />
              </Pressable>
            </View>
            {artist.listeners && (
              <Text style={[styles.artistStats, { color: theme.secondaryText }]}>
                {Number(artist.listeners).toLocaleString()} listeners
              </Text>
            )}

            {/* Context Menu */}
            {showContextMenu && (
              <Animated.View
                style={[
                  styles.contextMenu,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.border,
                    opacity: menuAnim,
                    transform: [
                      {
                        scale: menuAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.9, 1],
                        }),
                      },
                      {
                        translateY: menuAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [-6, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
                {contextMenuType === 'filter' && (
                  <Pressable
                    style={styles.contextMenuItem}
                    onPress={() => {
                      setShowOwnedOnly(!showOwnedOnly);
                      closeContextMenu();
                    }}
                  >
                    <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>
                      Show owned songs only
                    </Text>
                    {showOwnedOnly && (
                      <Ionicons name="checkmark" size={20} color={theme.primaryText} />
                    )}
                  </Pressable>
                )}
                
                {contextMenuType === 'remove' && (
                  <Pressable
                    style={styles.contextMenuItem}
                    onPress={removeArtistFromLibrary}
                  >
                    <Text style={[styles.contextMenuText, { color: theme.error }]}>
                      Remove from library
                    </Text>
                    <Ionicons name="trash-outline" size={20} color={theme.error} />
                  </Pressable>
                )}

                {contextMenuType === 'album' && (
                  <Pressable
                    style={styles.contextMenuItem}
                    onPress={addAlbumToLibrary}
                  >
                    <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>
                      Show in library
                    </Text>
                    <Ionicons name="library-outline" size={20} color={theme.primaryText} />
                  </Pressable>
                )}
              </Animated.View>
            )}
          </View>

          {renderContent()}
        </View>
      </Animated.ScrollView>

      {/* Stretchy Banner Header */}
      <Animated.View
        style={[
          styles.header,
          {
            height: headerHeight,
            transform: [{ translateY: headerTranslate }],
          },
        ]}
      >
        {artistImageUrl ? (
          <Animated.Image
            style={[
              styles.bannerImage,
              {
                height: headerHeight,
                opacity: imageOpacity,
              },
            ]}
            source={{ uri: artistImageUrl }}
          />
        ) : (
          <Animated.View
            style={[
              styles.bannerImage,
              {
                height: headerHeight,
                backgroundColor: theme.card,
                justifyContent: 'center',
                alignItems: 'center',
              },
            ]}
          >
            <Ionicons name="person" size={80} color={theme.secondaryText} />
          </Animated.View>
        )}
      </Animated.View>

      {/* Back Button */}
      <Pressable onPress={() => navigation.goBack()} style={[styles.backButton, { backgroundColor: theme.backButton }]}>
        <Ionicons name="chevron-back" size={24} color={theme.backButtonText} />
      </Pressable>
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    zIndex: 1,
  },
  bannerImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    width: '100%',
    resizeMode: 'cover',
  },
  backButton: {
    position: 'absolute',
    top: 40,
    left: 16,
    padding: 8,
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  scrollViewContent: {
    paddingTop: HEADER_MAX_HEIGHT,
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  artistInfo: {
    marginTop: 16,
    marginBottom: 24,
    position: 'relative',
    zIndex: 5,
  },
  artistNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  artistName: {
    fontSize: 32,
    fontWeight: 'bold',
    marginRight: 12,
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  dropdownButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artistStats: {
    fontSize: 14,
  },
  contextMenu: {
    position: 'absolute',
    top: 40,
    left: 0,
    minWidth: 230,
    borderRadius: 14,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 10,
    zIndex: 10,
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
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
  },
  primaryText: {
    fontSize: 16,
    fontWeight: '500',
  },
  secondaryText: {
    fontSize: 14,
  },
  squareThumb: {
    width: 50,
    height: 50,
    borderRadius: 6,
    marginRight: 16,
  },
  squareThumbSmall: {
    width: 40,
    height: 40,
    borderRadius: 6,
    marginRight: 16,
  },
  loading: {
    marginTop: 50,
  },
  error: {
    textAlign: 'center',
    marginTop: 50,
    fontSize: 16,
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  viewMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  viewMoreText: {
    fontSize: 14,
    fontWeight: '600',
  },
  albumCard: {
    width: 150,
    marginRight: 16,
  },
  albumImage: {
    width: 150,
    height: 150,
    borderRadius: 12,
    marginBottom: 8,
  },
  albumTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  albumSubtitle: {
    fontSize: 12,
  },
  similarArtistCard: {
    width: 100,
    marginRight: 16,
    alignItems: 'center',
  },
  roundArtistImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 8,
  },
  similarArtistName: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
