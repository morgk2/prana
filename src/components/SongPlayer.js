import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Image,
  Pressable,
  Platform,
  ActivityIndicator,
  PanResponder,
  Animated,
  Easing,
  ScrollView,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QueueSheet from './QueueSheet';
import LyricsView from './LyricsView';
import { preloadLyrics, preloadQueueLyrics } from '../utils/lyricsCache';
import { getTrackStreamUrl } from '../services/tidalApi';
import { getArtworkWithFallback } from '../utils/artworkFallback';
import { getFreshTidalStream, getPlayableTrack, shouldStreamFromTidal } from '../utils/tidalStreamHelper';

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// Simple string hash -> int for deterministic per-song colors
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const color = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function getSongColors(track) {
  const key = `${track?.name ?? ''}|${track?.artist?.name ?? track?.artist ?? ''}`;
  const hash = hashString(key || 'default');
  const hue = hash % 360;
  const primary = hslToHex(hue, 60, 35);
  const secondary = hslToHex((hue + 40) % 360, 55, 15);
  return {
    primary,
    secondary,
    detail: '#ffffff',
  };
}

function pickImageUrl(images, preferredSize = 'extralarge') {
  if (!Array.isArray(images)) return null;
  const preferred = images.find((img) => img.size === preferredSize && img['#text']);
  if (preferred) return preferred['#text'];
  const any = images.find((img) => img['#text']);
  return any ? any['#text'] : null;
}

function CustomSlider({ value, maximumValue, onSlidingStart, onValueChange, onSlidingComplete, isLoading }) {
  const [width, setWidth] = useState(0);
  const heightAnim = useRef(new Animated.Value(6)).current;
  const pulseAnim = useRef(new Animated.Value(0.3)).current;
  const isDragging = useRef(false);

  useEffect(() => {
    if (isLoading) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: false }),
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: false }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isLoading]);

  const handleTouch = (e, type) => {
    if (width <= 0) return;
    const { locationX } = e.nativeEvent;
    // Clamp 0 to width
    const clampedX = Math.max(0, Math.min(locationX, width));
    const ratio = clampedX / width;
    const newValue = ratio * maximumValue;

    if (type === 'start') {
      isDragging.current = true;
      Animated.timing(heightAnim, { toValue: 16, duration: 150, useNativeDriver: false }).start();
      if (onSlidingStart) onSlidingStart();
      if (onValueChange) onValueChange(newValue);
    } else if (type === 'move') {
      if (onValueChange) onValueChange(newValue);
    } else if (type === 'end') {
      isDragging.current = false;
      Animated.timing(heightAnim, { toValue: 6, duration: 150, useNativeDriver: false }).start();
      if (onSlidingComplete) onSlidingComplete(newValue);
    }
  };

  const progress = maximumValue > 0 ? Math.min(1, Math.max(0, value / maximumValue)) : 0;

  return (
    <View
      style={{ height: 40, justifyContent: 'center' }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onTouchStart={(e) => !isLoading && handleTouch(e, 'start')}
      onTouchMove={(e) => !isLoading && handleTouch(e, 'move')}
      onTouchEnd={(e) => !isLoading && handleTouch(e, 'end')}
      onTouchCancel={(e) => !isLoading && handleTouch(e, 'end')}
    >
      <View style={{ height: 16, justifyContent: 'center', backgroundColor: 'transparent' }}>
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: heightAnim,
            backgroundColor: 'rgba(255,255,255,0.3)',
            borderRadius: 999,
          }}
        />
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            width: isLoading ? '100%' : `${progress * 100}%`,
            height: heightAnim,
            backgroundColor: '#ffffff',
            borderRadius: 999,
            opacity: isLoading ? pulseAnim : 1,
          }}
        />
      </View>
    </View>
  );
}

export default function SongPlayer({ isVisible = true, track, onClose, theme, setPlayerControls, onArtistPress, queue = [], queueIndex = 0, onTrackChange, onQueueReorder }) {
  const insets = useSafeAreaInsets();
  const colors = {
    primary: '#000000',
    secondary: '#202020',
    detail: '#ffffff',
  };
  const [sound, setSound] = useState(null);
  const [playback, setPlayback] = useState({
    positionMillis: 0,
    durationMillis: 0,
    isPlaying: false,
  });
  const [isScrubbing, setIsScrubbing] = useState(false);
  const isScrubbingRef = useRef(false);
  const [repeatMode, setRepeatMode] = useState(0); // 0: Off, 1: Queue, 2: Song
  const [localArtwork, setLocalArtwork] = useState(null);
  const [isResolvingTidal, setIsResolvingTidal] = useState(false);

  // Fetch artwork if missing
  useEffect(() => {
    setLocalArtwork(null); 
    const hasValidImage = track?.image && Array.isArray(track.image) && track.image.some(img => img['#text'] && (img['#text'].startsWith('http') || img['#text'].startsWith('file:')));

    if (track && !hasValidImage) {
      const fetchArtwork = async () => {
        try {
          const artwork = await getArtworkWithFallback(track);
          if (artwork && artwork.length > 0) {
            setLocalArtwork(artwork);
          }
        } catch (error) {
          console.warn('[SongPlayer] Failed to fetch fallback artwork:', error);
        }
      };
      fetchArtwork();
    }
  }, [track?.id, track?.name, track?.artist]);

  // Refs for accessing latest state in callbacks
  const queueRef = useRef(queue);
  const currentIndexRef = useRef(queueIndex);
  const repeatModeRef = useRef(repeatMode);
  const onTrackChangeRef = useRef(onTrackChange);

  useEffect(() => {
    queueRef.current = queue;
    currentIndexRef.current = queueIndex;
    repeatModeRef.current = repeatMode;
    onTrackChangeRef.current = onTrackChange;
  }, [queue, queueIndex, repeatMode, onTrackChange]);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const [queueVisible, setQueueVisible] = useState(false);
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [isImmersive, setIsImmersive] = useState(false);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const controlsTranslateY = useRef(new Animated.Value(0)).current;
  const headerTranslateY = useRef(new Animated.Value(0)).current;
  const lyricsOpacity = useRef(new Animated.Value(0)).current;
  const immersiveTimeout = useRef(null);

  const setScrubbing = (value) => {
    isScrubbingRef.current = value;
    setIsScrubbing(value);
  };

  const resetImmersiveTimer = useCallback(() => {
    if (!showLyrics) return;

    setIsImmersive(false);
    Animated.parallel([
      Animated.timing(controlsOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(controlsTranslateY, { toValue: 0, duration: 300, useNativeDriver: true }),
      Animated.timing(headerTranslateY, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();

    if (immersiveTimeout.current) clearTimeout(immersiveTimeout.current);
    immersiveTimeout.current = setTimeout(() => {
      setIsImmersive(true);
      Animated.parallel([
        Animated.timing(controlsOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(controlsTranslateY, { toValue: 50, duration: 500, useNativeDriver: true }),
        Animated.timing(headerTranslateY, { toValue: -50, duration: 500, useNativeDriver: true }),
      ]).start();
    }, 6000);
  }, [showLyrics]);

  useEffect(() => {
    if (showLyrics) {
      Animated.parallel([
        Animated.timing(lyricsOpacity, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(controlsOpacity, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(controlsTranslateY, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(headerTranslateY, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start(() => resetImmersiveTimer());
    } else {
      Animated.parallel([
        Animated.timing(lyricsOpacity, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(controlsOpacity, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(controlsTranslateY, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(headerTranslateY, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
      if (immersiveTimeout.current) clearTimeout(immersiveTimeout.current);
      setIsImmersive(false);
    }
    return () => {
      if (immersiveTimeout.current) clearTimeout(immersiveTimeout.current);
    };
  }, [showLyrics, resetImmersiveTimer]);

  const toggleShuffle = () => {
    resetImmersiveTimer();
    const newShuffleState = !isShuffleEnabled;
    setIsShuffleEnabled(newShuffleState);
    if (newShuffleState && queue.length > 1) {
      const currentTrack = queue[queueIndex];
      const otherTracks = queue.filter((_, idx) => idx !== queueIndex);
      for (let i = otherTracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [otherTracks[i], otherTracks[j]] = [otherTracks[j], otherTracks[i]];
      }
      const shuffledQueue = [currentTrack, ...otherTracks];
      if (onQueueReorder) {
        onQueueReorder(shuffledQueue, 0);
      }
    }
  };

  useEffect(() => {
    if (!queue || queue.length === 0) return;
    const prefetch = async () => {
      const PREFETCH_COUNT = 3;
      const startIndex = queueIndex + 1;
      const endIndex = Math.min(startIndex + PREFETCH_COUNT, queue.length);
      for (let i = startIndex; i < endIndex; i++) {
        const nextTrack = queue[i];
        if (shouldStreamFromTidal(nextTrack, true)) {
          if (!nextTrack.uri || nextTrack.uri.startsWith('http')) {
             await getPlayableTrack(nextTrack, true);
          }
        }
      }
    };
    const timer = setTimeout(prefetch, 1000);
    return () => clearTimeout(timer);
  }, [queue, queueIndex]);

  const [activeUri, setActiveUri] = useState(null);

  useEffect(() => {
    setActiveUri(track?.uri ?? track?.previewUrl ?? null);
  }, [track?.uri, track?.previewUrl, track?.id]);

  useEffect(() => {
    let soundObj = null;
    let cancelled = false;
    
    async function load() {
      let currentUri = track?.uri ?? track?.previewUrl ?? null;
      let workingTidalId = track?.tidalId;
      
      if (!currentUri && shouldStreamFromTidal(track, true)) {
         try {
             setIsResolvingTidal(true);
             const playable = await getPlayableTrack(track, true);
             if (playable) {
                 if (playable.uri) {
                    currentUri = playable.uri;
                    if (!cancelled) setActiveUri(currentUri);
                 }
                 if (playable.tidalId) {
                    workingTidalId = playable.tidalId;
                 }
             }
         } catch (e) {
             console.warn('[SongPlayer] Failed to resolve track:', e);
         } finally {
             if (!cancelled) setIsResolvingTidal(false);
         }
      }

      const loadSound = async (uri) => {
        try {
          const { sound } = await Audio.Sound.createAsync(
            { uri },
            { shouldPlay: true },
            (status) => {
              if (!status.isLoaded) return;

              if (status.didJustFinish) {
                const mode = repeatModeRef.current;
                const q = queueRef.current;
                const idx = currentIndexRef.current;
                const changeTrack = onTrackChangeRef.current;

                if (mode === 2) { 
                  sound.replayAsync();
                } else if (mode === 1) { 
                  if (q && q.length > 0 && changeTrack) {
                    const nextIndex = (idx + 1) % q.length;
                    changeTrack(q[nextIndex], nextIndex);
                  }
                } else { 
                  if (q && q.length > 0 && changeTrack && idx < q.length - 1) {
                    const nextIndex = idx + 1;
                    changeTrack(q[nextIndex], nextIndex);
                  }
                }
              }

              setPlayback((prev) => ({
                positionMillis: isScrubbingRef.current ? prev.positionMillis : (status.positionMillis ?? 0),
                durationMillis: status.durationMillis ?? 0,
                isPlaying: status.isPlaying ?? false,
              }));
            },
          );
          return sound;
        } catch (e) {
          throw e;
        }
      };

      try {
        if (currentUri) {
          soundObj = await loadSound(currentUri);
          if (cancelled) {
            await soundObj.unloadAsync().catch(() => { });
            return;
          }
          setSound(soundObj);
        } else if (workingTidalId && track?.source === 'tidal') {
          throw new Error('No URI for Tidal track');
        }
      } catch (initialError) {
        console.warn('[SongPlayer] Initial load failed:', initialError.message);
        
        if (workingTidalId && (track?.source === 'tidal' || shouldStreamFromTidal(track, true))) {
          if (!cancelled) setIsResolvingTidal(true);
          try {
             const freshTrack = await getFreshTidalStream(workingTidalId);
             if (freshTrack && freshTrack.uri) {
               currentUri = freshTrack.uri;
               if (!cancelled) setActiveUri(currentUri);
               if (cancelled) return;
               soundObj = await loadSound(currentUri);
               if (cancelled) {
                await soundObj.unloadAsync().catch(() => { });
                return;
               }
               setSound(soundObj);
             }
          } catch (retryError) {
             console.warn('[SongPlayer] Retry failed:', retryError);
          } finally {
             if (!cancelled) setIsResolvingTidal(false);
          }
        }
      }
    }

    setSound(null); 
    load();

    return () => {
      cancelled = true;
      if (soundObj) {
        soundObj.unloadAsync().catch(() => { });
      }
      setSound(null);
      setPlayback({ positionMillis: 0, durationMillis: 0, isPlaying: false });
    };
  }, [track?.uri, track?.previewUrl, track?.id, track?.name]);

  useEffect(() => {
    if (track) {
      preloadLyrics(track);
    }
    if (queue && queue.length > 0) {
      preloadQueueLyrics(queue, queueIndex, 3);
    }
  }, [track, queue, queueIndex]);

  const positionSec = (playback.positionMillis || 0) / 1000;
  const durationSec = (playback.durationMillis || 0) / 1000;
  const isPlaying = playback.isPlaying;

  const togglePlay = useCallback(async () => {
    if (!sound) return;
    try {
      if (isPlaying) {
        await sound.pauseAsync();
      } else {
        await sound.playAsync();
      }
    } catch (e) {
      console.warn('Error toggling playback', e);
    }
  }, [sound, isPlaying]);

  const skipNext = useCallback(() => {
    if (!onTrackChange || !queue || queue.length === 0) return;
    const nextIndex = queueIndex + 1;
    if (nextIndex < queue.length) {
      Animated.timing(slideAnim, { toValue: -1, duration: 300, useNativeDriver: true }).start(() => {
        onTrackChange(queue[nextIndex], nextIndex);
        slideAnim.setValue(1);
        Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
      });
    }
  }, [onTrackChange, queue, queueIndex, slideAnim]);

  const skipPrevious = useCallback(() => {
    if (!onTrackChange || !queue || queue.length === 0) return;
    const prevIndex = queueIndex - 1;
    if (prevIndex >= 0) {
      Animated.timing(slideAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start(() => {
        onTrackChange(queue[prevIndex], prevIndex);
        slideAnim.setValue(-1);
        Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
      });
    }
  }, [onTrackChange, queue, queueIndex, slideAnim]);

  const canSkipNext = queue && queue.length > 0 && queueIndex < queue.length - 1;
  const canSkipPrevious = queue && queue.length > 0 && queueIndex > 0;

  useEffect(() => {
    if (setPlayerControls) {
      setPlayerControls({ togglePlay, isPlaying });
    }
  }, [setPlayerControls, togglePlay, isPlaying]);

  if (!track) return null;

  const hasValidImage = track.image && Array.isArray(track.image) && track.image.some(img => img['#text'] && (img['#text'].startsWith('http') || img['#text'].startsWith('file:')));
  const images = localArtwork || (hasValidImage ? track.image : (track.source === 'tidal' ? null : track.image));
  const imageUrl = images ? (pickImageUrl(images, 'extralarge') || pickImageUrl(images, 'large')) : null;

  const onSeekStart = () => {
    setScrubbing(true);
  };

  const onSeekUpdate = (val) => {
    setPlayback((prev) => ({ ...prev, positionMillis: val * 1000 }));
  };

  const onSeekComplete = async (val) => {
    if (!sound || !playback.durationMillis) {
      setScrubbing(false);
      return;
    }
    try {
      const newPositionMillis = val * 1000;
      await sound.setPositionAsync(newPositionMillis);
      setPlayback((prev) => ({ ...prev, positionMillis: newPositionMillis }));
    } catch (e) {
      console.warn('Error seeking', e);
    } finally {
      setTimeout(() => setScrubbing(false), 200);
    }
  };

  const isLoading = (track?.isFetching || isResolvingTidal) && !activeUri;

  return (
    <Modal visible={isVisible} animationType="slide" transparent>
      <LinearGradient
        colors={[colors.primary, colors.secondary]}
        style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
        onTouchStart={resetImmersiveTimer}
      >
        <Animated.View style={[styles.header, { transform: [{ translateY: headerTranslateY }], opacity: controlsOpacity }]}>
          <Pressable onPress={onClose} style={styles.iconButton} hitSlop={16}>
            <Ionicons name="chevron-down" size={28} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>NOW PLAYING</Text>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <Pressable hitSlop={16} onPress={() => setShowLyrics(!showLyrics)}>
              <Ionicons name="chatbox-ellipses" size={24} color={showLyrics ? "#fff" : "rgba(255,255,255,0.7)"} />
            </Pressable>
            <Pressable onPress={() => setQueueVisible(true)}>
              <Ionicons name="list" size={24} color="#fff" />
            </Pressable>
          </View>
        </Animated.View>

        {showLyrics ? (
          <Animated.View style={[styles.lyricsContainer, isImmersive && styles.lyricsContainerImmersive, { opacity: lyricsOpacity }]}>
            <LyricsView
              track={track}
              currentTime={positionSec}
              duration={durationSec}
              onSeek={onSeekComplete}
              onInteraction={resetImmersiveTimer}
            />
          </Animated.View>
        ) : (
          <Animated.View style={[
            styles.artworkContainer,
            {
              transform: [
                { perspective: 1200 },
                { translateX: slideAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: [-350, 0, 350] }) },
                { rotateY: slideAnim.interpolate({ inputRange: [-1, -0.5, 0, 0.5, 1], outputRange: ['60deg', '25deg', '0deg', '-25deg', '-60deg'] }) },
                { scale: slideAnim.interpolate({ inputRange: [-1, -0.5, 0, 0.5, 1], outputRange: [0.7, 0.88, 1, 0.88, 0.7] }) },
              ],
              opacity: Animated.multiply(
                slideAnim.interpolate({ inputRange: [-1, -0.4, 0, 0.4, 1], outputRange: [0, 0.6, 1, 0.6, 0] }),
                lyricsOpacity.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })
              ),
            },
          ]}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={styles.artwork} />
            ) : (
              <View style={[styles.artwork, { backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' }]}>
                <Ionicons name="musical-note" size={80} color="rgba(255,255,255,0.3)" />
              </View>
            )}
          </Animated.View>
        )}

        <Animated.View style={[
          styles.trackInfo,
          {
            transform: [{ translateX: slideAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: [-100, 0, 100] }) }, { translateY: controlsTranslateY }],
            opacity: Animated.multiply(
              slideAnim.interpolate({ inputRange: [-1, -0.3, 0, 0.3, 1], outputRange: [0, 0.4, 1, 0.4, 0] }),
              controlsOpacity
            ),
          },
        ]}>
          <Text style={styles.title} numberOfLines={1}>{track.name}</Text>
          <Pressable onPress={() => onArtistPress && onArtistPress(track.artist?.name ?? track.artist)}>
            <Text style={styles.artist} numberOfLines={1}>{track.artist?.name ?? track.artist}</Text>
          </Pressable>
        </Animated.View>

        <Animated.View style={[styles.progressContainer, { opacity: controlsOpacity, transform: [{ translateY: controlsTranslateY }] }]}>
          <CustomSlider
            value={positionSec}
            maximumValue={durationSec || 1}
            onSlidingStart={onSeekStart}
            onValueChange={onSeekUpdate}
            onSlidingComplete={onSeekComplete}
            isLoading={isLoading}
          />
          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{formatTime(positionSec)}</Text>
            <Text style={styles.timeText}>{formatTime(durationSec)}</Text>
          </View>
        </Animated.View>

        <Animated.View style={[styles.controls, { opacity: controlsOpacity, transform: [{ translateY: controlsTranslateY }] }]}>
          <Pressable style={styles.controlButton} onPress={toggleShuffle}>
            <Ionicons name="shuffle" size={24} color={isShuffleEnabled ? "#fff" : "rgba(255,255,255,0.6)"} />
            {isShuffleEnabled && <View style={styles.activeIndicatorDot} />}
          </Pressable>
          <Pressable style={styles.controlButton} onPress={skipPrevious} disabled={!canSkipPrevious}>
            <Ionicons name="play-skip-back" size={32} color={canSkipPrevious ? "#fff" : "rgba(255,255,255,0.3)"} />
          </Pressable>

          <Pressable onPress={togglePlay} style={styles.playPauseButton}>
            <Ionicons name={isPlaying ? "pause" : "play"} size={40} color="#000" />
          </Pressable>

          <Pressable style={styles.controlButton} onPress={skipNext} disabled={!canSkipNext}>
            <Ionicons name="play-skip-forward" size={32} color={canSkipNext ? "#fff" : "rgba(255,255,255,0.3)"} />
          </Pressable>
          <Pressable style={styles.controlButton} onPress={() => {
             const modes = [0, 1, 2];
             const nextMode = modes[(repeatMode + 1) % modes.length];
             setRepeatMode(nextMode);
          }}>
            <View style={{ alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="repeat" size={24} color={repeatMode !== 0 ? "#fff" : "rgba(255,255,255,0.6)"} />
              {repeatMode === 2 && <View style={[styles.activeIndicatorDot, { position: 'absolute', bottom: -8 }]} />}
            </View>
          </Pressable>
        </Animated.View>
        
        <QueueSheet
          visible={queueVisible}
          onClose={() => setQueueVisible(false)}
          queue={queue}
          currentIndex={queueIndex}
          onTrackSelect={onTrackChange}
          onReorder={onQueueReorder}
        />
      </LinearGradient>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 60,
    zIndex: 10,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    opacity: 0.8,
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    zIndex: -1,
  },
  iconButton: {
    padding: 8,
    margin: -8,
  },
  artworkContainer: {
    width: 350,
    height: 350,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  artwork: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
    backgroundColor: '#333',
  },
  trackInfo: {
    width: '100%',
    paddingHorizontal: 30,
    alignItems: 'flex-start',
    marginTop: 24,
    marginBottom: 4,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'left',
    marginBottom: 4,
  },
  artist: {
    color: '#fff',
    fontSize: 18,
    opacity: 0.8,
    textAlign: 'left',
  },
  progressContainer: {
    width: '100%',
    paddingHorizontal: 30,
    marginTop: 8,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  timeText: {
    color: '#fff',
    fontSize: 12,
    opacity: 0.7,
    fontVariant: ['tabular-nums'],
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 30,
    marginBottom: 40,
    marginTop: 0,
  },
  controlButton: {
    padding: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playPauseButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeIndicatorDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#fff',
    position: 'absolute',
    bottom: 4,
  },
  lyricsContainer: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 20,
    overflow: 'hidden',
  },
  lyricsContainerImmersive: {
    position: 'absolute',
    top: 100,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    backgroundColor: 'transparent',
  },
});
