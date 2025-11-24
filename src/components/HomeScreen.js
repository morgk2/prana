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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

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

  const [currentIndex, setCurrentIndex] = useState(libraryAlbums.length > 0 ? Math.floor(libraryAlbums.length / 2) : 0);
  const scrollX = useRef(new Animated.Value(libraryAlbums.length > 0 ? Math.floor(libraryAlbums.length / 2) : 0)).current;

  // Handle Swipe Gestures
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dx) > 20,
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > 50) {
          prev();
        } else if (gestureState.dx < -50) {
          next();
        }
      },
    })
  ).current;

  useEffect(() => {
    // Animate to the new index whenever state changes
    if (libraryAlbums.length > 0 && !isNaN(currentIndex)) {
      Animated.spring(scrollX, {
        toValue: currentIndex,
        useNativeDriver: true,
        friction: 7,
        tension: 40,
      }).start();
    }
  }, [currentIndex, libraryAlbums.length]);

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
      >
        {/* Header */}
        <View style={styles.header}>
          <Image
            source={require('../../assets/expandedLogo.png')}
            style={{ width: 300, height: 75, resizeMode: 'contain', marginLeft: -90 }}
          />
        </View>

        {libraryAlbums.length > 0 ? (
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
                    style={[ styles.coverContainer, { zIndex, opacity, transform: [{ perspective: 800 }, { translateX }, { rotateY }, { scale }] } ]}
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
    paddingBottom: 100,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 20,
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
});