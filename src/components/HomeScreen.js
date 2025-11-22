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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COVER_SIZE = 180;
const SPACING = 140; // Distance between covers

export default function HomeScreen({ route }) {
  const {
    theme,
    libraryAlbums,
    navigation,
    onTrackPress,
    pickLocalAudio,
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

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.primaryText }]}>Prana</Text>
          <Text style={[styles.subtitle, { color: theme.secondaryText }]}>
            Your Music Collection
          </Text>
        </View>

        {libraryAlbums.length > 0 ? (
          <>
            {/* 3D Cover Flow Scene */}
            <View style={styles.scene} {...panResponder.panHandlers}>
              {libraryAlbums.map((album, index) => {
                const isActive = index === currentIndex;

                // We look at 2 items to the left and 2 items to the right
                // to create a proper "stack" effect
                const inputRange = [index - 2, index - 1, index, index + 1, index + 2];

                // 1. SCALE: Active is 1, neighbors are smaller (0.8)
                const scale = scrollX.interpolate({
                  inputRange,
                  outputRange: [0.8, 0.8, 1, 0.8, 0.8],
                  extrapolate: 'clamp',
                });

                // 2. ROTATION: Reversed angles to curve inwards
                // Left items face left (negative), Right items face right (positive)
                const rotateY = scrollX.interpolate({
                  inputRange,
                  outputRange: ['-75deg', '-75deg', '0deg', '75deg', '75deg'],
                  extrapolate: 'clamp',
                });

                // 3. TRANSLATION (The Stacking Magic)
                // We use non-linear values to pull the "wings" tight together.
                // Center: 0
                // +/- 1: Shifted by 100 (Move out to clear the center image)
                // +/- 2: Shifted by 130 (Only 30px more than neighbor -> Creates the stack/overlap)
                const translateX = scrollX.interpolate({
                  inputRange,
                  outputRange: [130, 100, 0, -100, -130], 
                  extrapolate: 'clamp',
                });

                // 4. OPACITY: Fade out items deeper in the stack
                const opacity = scrollX.interpolate({
                  inputRange,
                  outputRange: [0.3, 0.6, 1, 0.6, 0.3],
                  extrapolate: 'clamp',
                });

                // Z-Index matches your original logic (Center is on top)
                const zIndex = 100 - Math.abs(currentIndex - index);

                return (
                  <Animated.View
                    key={album.key || index}
                    style={[
                      styles.coverContainer,
                      {
                        zIndex,
                        opacity,
                        transform: [
                          { perspective: 800 }, // Lower perspective = more dramatic 3D effect
                          { translateX },
                          { rotateY },
                          { scale },
                        ],
                      }
                    ]}
                  >
                    <TouchableOpacity 
                      activeOpacity={0.9} 
                      onPress={() => {
                        if (isActive) {
                          if (navigation) {
                            navigation.navigate('LibraryAlbum', {
                              album,
                              theme,
                              onTrackPress,
                              libraryAlbums,
                            });
                          }
                        } else {
                          jumpTo(index);
                        }
                      }}
                      style={styles.touchableCover}
                    >
                      {/* Main Album Art */}
                      {album.artwork ? (
                        <Image source={{ uri: album.artwork }} style={styles.coverImage} />
                      ) : (
                        <View style={[styles.coverImage, styles.placeholderAlbum, { backgroundColor: theme.card }]}>
                          <Ionicons name="disc-outline" size={60} color={theme.secondaryText} />
                        </View>
                      )}
                      
                      {/* Reflection Effect */}
                      <View style={styles.reflectionContainer}>
                        {album.artwork ? (
                          <Image 
                            source={{ uri: album.artwork }} 
                            style={[styles.coverImage, styles.reflectionImage]} 
                          />
                        ) : (
                          <View style={[styles.coverImage, styles.reflectionImage, styles.placeholderAlbum, { backgroundColor: theme.card }]}>
                            <Ionicons name="disc-outline" size={60} color={theme.secondaryText} />
                          </View>
                        )}
                        <LinearGradient
                          colors={['rgba(0,0,0,0)', theme.background]}
                          locations={[0, 0.8]}
                          style={StyleSheet.absoluteFill}
                        />
                      </View>
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
                  {recentAlbums.filter((_, i) => i % 2 === 0).map((album, i) => 
                    renderRecentAlbumCard(album, i * 2)
                  )}
                </View>
                <View style={styles.recentColumn}>
                  {recentAlbums.filter((_, i) => i % 2 === 1).map((album, i) => 
                    renderRecentAlbumCard(album, i * 2 + 1)
                  )}
                </View>
              </View>
            </View>
          </>
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
    opacity: 0.3,
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
});
