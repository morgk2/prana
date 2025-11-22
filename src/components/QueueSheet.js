import React, { useState, useRef, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Image,
  Pressable,
  ScrollView,
  Animated,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { getArtworkWithFallback } from '../utils/artworkFallback';

function pickImageUrl(images, preferredSize = 'extralarge') {
  if (!Array.isArray(images)) return null;
  const preferred = images.find((img) => img.size === preferredSize && img['#text']);
  if (preferred) return preferred['#text'];
  const any = images.find((img) => img['#text']);
  return any ? any['#text'] : null;
}

const ROW_HEIGHT = 64;

export default function QueueSheet({ visible, onClose, queue, currentIndex, onReorder, onTrackSelect }) {
  const insets = useSafeAreaInsets();
  const [localQueue, setLocalQueue] = useState(queue);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [draggedOverIndex, setDraggedOverIndex] = useState(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const itemOffsets = useRef({}).current;
  const [isShuffling, setIsShuffling] = useState(false);
  const shuffleOpacity = useRef(new Animated.Value(1)).current;
  const [trackArtwork, setTrackArtwork] = useState({});

  // keep a ref so PanResponder always sees latest queue
  const localQueueRef = useRef(localQueue);
  useEffect(() => {
    localQueueRef.current = localQueue;
  }, [localQueue]);

  // refs so PanResponder callbacks always see latest indices
  const draggedIndexRef = useRef(null);
  const draggedOverIndexRef = useRef(null);
  useEffect(() => {
    draggedIndexRef.current = draggedIndex;
  }, [draggedIndex]);
  useEffect(() => {
    draggedOverIndexRef.current = draggedOverIndex;
  }, [draggedOverIndex]);

  // Update local queue when prop changes (but not while dragging)
  useEffect(() => {
    if (draggedIndex === null) {
      setLocalQueue(queue);
    }
  }, [queue, draggedIndex]);

  // Fetch artwork for tracks that don't have valid images
  useEffect(() => {
    if (!visible || !localQueue || localQueue.length === 0) return;

    const fetchArtworkForTracks = async () => {
      for (const track of localQueue) {
        const trackKey = track.uri || track.mbid || track.name || track.id;
        if (!trackKey) continue;

        // Check if track already has valid artwork
        const hasValidImage = track.image && Array.isArray(track.image) && track.image.some(img => img['#text'] && (img['#text'].startsWith('http') || img['#text'].startsWith('file:')));

        // Skip if already cached or has valid image
        if (trackArtwork[trackKey] || hasValidImage) continue;

        try {
          const artwork = await getArtworkWithFallback(track);
          if (artwork && artwork.length > 0) {
            setTrackArtwork(prev => ({ ...prev, [trackKey]: artwork }));
          }
        } catch (error) {
          console.warn('[QueueSheet] Failed to fetch artwork for track:', track.name, error);
        }
      }
    };

    fetchArtworkForTracks();
  }, [visible, localQueue]);

  // Animate items when draggedOverIndex changes
  useEffect(() => {
    if (draggedIndex === null) {
      // Reset all offsets when not dragging
      Object.keys(itemOffsets).forEach((key) => {
        Animated.spring(itemOffsets[key], {
          toValue: 0,
          useNativeDriver: false,
          tension: 300,
          friction: 25,
        }).start();
      });
      return;
    }

    // Animate items to their new positions
    localQueue.forEach((track, index) => {
      if (index === draggedIndex) return;

      const trackKey = track.uri || track.mbid || track.name || `track-${index}`;

      if (!itemOffsets[trackKey]) {
        itemOffsets[trackKey] = new Animated.Value(0);
      }

      let targetOffset = 0;
      if (draggedIndex < draggedOverIndex) {
        // Dragging down: items between original and target move up
        if (index > draggedIndex && index <= draggedOverIndex) {
          targetOffset = -ROW_HEIGHT;
        }
      } else if (draggedIndex > draggedOverIndex) {
        // Dragging up: items between target and original move down
        if (index >= draggedOverIndex && index < draggedIndex) {
          targetOffset = ROW_HEIGHT;
        }
      }

      Animated.spring(itemOffsets[trackKey], {
        toValue: targetOffset,
        useNativeDriver: false,
        tension: 300,
        friction: 25,
      }).start();
    });
  }, [draggedIndex, draggedOverIndex, localQueue, itemOffsets]);

  const handleReorder = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const newQueue = [...localQueueRef.current];
    const [removed] = newQueue.splice(fromIndex, 1);
    newQueue.splice(toIndex, 0, removed);

    // Adjust currentIndex if needed
    let newCurrentIndex = currentIndex;
    if (fromIndex === currentIndex) {
      newCurrentIndex = toIndex;
    } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
      newCurrentIndex--;
    } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
      newCurrentIndex++;
    }

    setLocalQueue(newQueue);
    onReorder(newQueue, newCurrentIndex);
  };

  const startDrag = (index) => {
    setDraggedIndex(index);
    setDraggedOverIndex(index);
    draggedIndexRef.current = index;
    draggedOverIndexRef.current = index;
    dragY.setValue(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  };
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => draggedIndexRef.current !== null,
      onPanResponderMove: (_evt, gestureState) => {
        const currentDraggedIndex = draggedIndexRef.current;
        if (currentDraggedIndex === null) return;
        const { dy } = gestureState;
        dragY.setValue(dy);

        // estimate target index from drag distance
        const offset = Math.round(dy / ROW_HEIGHT);
        let newIndex = currentDraggedIndex + offset;
        if (newIndex < 0) newIndex = 0;
        const maxIndex = localQueueRef.current.length - 1;
        if (newIndex > maxIndex) newIndex = maxIndex;

        if (newIndex !== draggedOverIndexRef.current) {
          setDraggedOverIndex(newIndex);
          draggedOverIndexRef.current = newIndex;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      },
      onPanResponderRelease: () => {
        const from = draggedIndexRef.current;
        const to = draggedOverIndexRef.current;
        if (from !== null && to !== null && from !== to) {
          handleReorder(from, to);
        }

        // Clear all offsets
        Object.keys(itemOffsets).forEach((key) => {
          delete itemOffsets[key];
        });

        // Don't reset dragY to 0 here to avoid visual glitch (snap back) before re-render
        setDraggedIndex(null);
        setDraggedOverIndex(null);
        draggedIndexRef.current = null;
        draggedOverIndexRef.current = null;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => {
        // Clear all offsets
        Object.keys(itemOffsets).forEach((key) => {
          delete itemOffsets[key];
        });

        dragY.setValue(0);
        setDraggedIndex(null);
        setDraggedOverIndex(null);
        draggedIndexRef.current = null;
      },
    })
  ).current;

  const renderTrack = (track, index) => {
    const isCurrentTrack = index === currentIndex;
    const isDragging = draggedIndex === index;

    // Use track URI as stable key
    const trackKey = track.uri || track.mbid || track.name || track.id;

    // Get artwork from cache or track.image
    const images = trackArtwork[trackKey] || track.image;
    const imageUrl = images
      ? (pickImageUrl(images, 'large') || pickImageUrl(images, 'medium'))
      : null;

    // Initialize animated offset for this item if it doesn't exist
    if (!itemOffsets[trackKey]) {
      itemOffsets[trackKey] = new Animated.Value(0);
    }

    return (
      <View key={`queue-track-${index}-${trackKey}`}>
        <Animated.View
          {...panResponder.panHandlers}
          style={{
            opacity: isDragging ? 0.9 : 1,
            transform: [
              {
                translateY: isDragging ? dragY : itemOffsets[trackKey],
              },
              { scale: isDragging ? 1.02 : 1 },
            ],
          }}
        >
          <Pressable
            onPress={() => {
              if (draggedIndex === null) {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onTrackSelect(track, index);
              }
            }}
            onLongPress={() => startDrag(index)}
            delayLongPress={300}
            style={[
              styles.queueTrack,
              isCurrentTrack && styles.currentTrack,
              isDragging && styles.draggingTrack,
            ]}
          >
            {/* Album Art */}
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={styles.queueArtwork} />
            ) : (
              <View style={[styles.queueArtwork, styles.placeholderArtwork]}>
                <Ionicons name="musical-note" size={20} color="rgba(255,255,255,0.3)" />
              </View>
            )}

            {/* Track Info */}
            <View style={styles.queueTrackInfo}>
              <Text
                style={[
                  styles.queueTrackName,
                  isCurrentTrack && styles.currentTrackText,
                ]}
                numberOfLines={1}
              >
                {track.name}
              </Text>
              <Text style={styles.queueTrackArtist} numberOfLines={1}>
                {track.artist?.name ?? track.artist}
              </Text>
            </View>

            {/* Current Playing Indicator */}
            {isCurrentTrack && (
              <View style={styles.nowPlayingIndicator}>
                <Ionicons name="volume-high" size={18} color="#fff" />
              </View>
            )}

            {/* Drag Handle */}
            <View style={styles.dragHandle}>
              <Ionicons name="reorder-three" size={24} color="rgba(255,255,255,0.5)" />
            </View>
          </Pressable>
        </Animated.View>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View
        style={[styles.container, { paddingTop: insets.top }]}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.closeButton} hitSlop={16}>
            <Ionicons name="chevron-down" size={28} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Queue</Text>
          <View style={styles.placeholder} />
        </View>

        {/* Queue Info */}
        <View style={styles.queueInfo}>
          <Text style={styles.queueCount}>
            {localQueue.length} {localQueue.length === 1 ? 'song' : 'songs'}
          </Text>
        </View>

        {/* Now Playing Section */}
        {currentIndex >= 0 && currentIndex < localQueue.length && (
          <View style={styles.nowPlayingSection}>
            <Text style={styles.sectionTitle}>Now Playing</Text>
            {renderTrack(localQueue[currentIndex], currentIndex)}
          </View>
        )}

        {/* Next Up Section */}
        {currentIndex < localQueue.length - 1 && (
          <Animated.View style={[styles.nextUpSection, { opacity: shuffleOpacity }]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Next Up</Text>
              {localQueue.length > 1 && (
                <Pressable
                  style={styles.shuffleIconButton}
                  onPress={() => {
                    if (localQueue.length <= 1 || isShuffling) return;

                    setIsShuffling(true);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

                    // Animate out
                    Animated.timing(shuffleOpacity, {
                      toValue: 0,
                      duration: 200,
                      useNativeDriver: true,
                    }).start(() => {
                      // Shuffle the queue
                      const currentTrack = localQueue[currentIndex];
                      const otherTracks = localQueue.filter((_, idx) => idx !== currentIndex);

                      // Fisher-Yates shuffle
                      for (let i = otherTracks.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [otherTracks[i], otherTracks[j]] = [otherTracks[j], otherTracks[i]];
                      }

                      // Put current track at the beginning
                      const shuffledQueue = [currentTrack, ...otherTracks];

                      setLocalQueue(shuffledQueue);
                      onReorder(shuffledQueue, 0);

                      // Animate back in
                      Animated.spring(shuffleOpacity, {
                        toValue: 1,
                        useNativeDriver: true,
                        tension: 100,
                        friction: 10,
                      }).start(() => {
                        setIsShuffling(false);
                      });
                    });
                  }}
                  disabled={isShuffling}
                >
                  <Ionicons name="shuffle" size={20} color="rgba(255,255,255,0.6)" />
                </Pressable>
              )}
            </View>
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              scrollEnabled={draggedIndex === null}
            >
              {localQueue.slice(currentIndex + 1).map((track, idx) =>
                renderTrack(track, currentIndex + 1 + idx)
              )}
            </ScrollView>
          </Animated.View>
        )}

        {/* Previous Section (if any) */}
        {currentIndex > 0 && (
          <View style={styles.previousSection}>
            <Pressable
              style={styles.showPreviousButton}
              onPress={() => {
                // Could expand to show previous tracks
              }}
            >
              <Text style={styles.showPreviousText}>
                {currentIndex} previous {currentIndex === 1 ? 'song' : 'songs'}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  closeButton: {
    padding: 8,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  placeholder: {
    width: 44,
  },
  queueInfo: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  queueCount: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
  },
  nowPlayingSection: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  nextUpSection: {
    flex: 1,
    paddingHorizontal: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  shuffleIconButton: {
    padding: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  queueTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 4,
  },
  currentTrack: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  draggingTrack: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  queueArtwork: {
    width: 50,
    height: 50,
    borderRadius: 4,
  },
  placeholderArtwork: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  queueTrackInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  queueTrackName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 4,
  },
  currentTrackText: {
    color: '#fff',
    fontWeight: '600',
  },
  queueTrackArtist: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
  },
  nowPlayingIndicator: {
    marginRight: 8,
  },
  dragHandle: {
    padding: 8,
  },
  dropIndicator: {
    height: 3,
    backgroundColor: '#fff',
    marginVertical: 4,
    marginHorizontal: 8,
    borderRadius: 2,
  },
  previousSection: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  showPreviousButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  showPreviousText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '500',
  },
});
