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
  LayoutAnimation,
  UIManager,
  useWindowDimensions,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

if (Platform.OS === 'android') {
  if (UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
}
import { Audio } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QueueSheet from './QueueSheet';
import LyricsView from './LyricsView';
import { preloadLyrics, preloadQueueLyrics } from '../utils/lyricsCache';
import { getArtworkWithFallback } from '../utils/artworkFallback';
import { getFreshTidalStream, getPlayableTrack, shouldStreamFromTidal } from '../utils/tidalStreamHelper';
import { useDownload } from '../context/DownloadContext';

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

function CustomSlider({ value, maximumValue, onSlidingStart, onValueChange, onSlidingComplete, isLoading, trackColor = 'rgba(255,255,255,0.3)', progressColor = '#ffffff' }) {
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
            backgroundColor: trackColor,
            borderRadius: 999,
          }}
        />
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            width: isLoading ? '100%' : `${progress * 100}%`,
            height: heightAnim,
            backgroundColor: progressColor,
            borderRadius: 999,
            opacity: isLoading ? pulseAnim : 1,
          }}
        />
      </View>
    </View>
  );
}

function AnimatedControl({ onPress, children, style, disabled }) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.92,
      useNativeDriver: true,
      speed: 50,
      bounciness: 10,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 10,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}


export default function SongPlayer({ isVisible = true, track, onClose, onKill, onOpen, theme, setPlayerControls, onArtistPress, queue = [], queueIndex = 0, onTrackChange, onQueueReorder, toggleFavorite, isFavorite, shouldPlay = true, zIndex = 1000, shouldHide = false, playerColorMode = 'dark' }) {
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { recentDownloads } = useDownload();

  // Set player background colors based on playerColorMode
  const colors = playerColorMode === 'light' ? {
    primary: '#FFFFFF',
    secondary: '#F5F5F5',
    detail: '#000000',
  } : {
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

  // Animation for hiding the player (slide down)
  const hideAnim = useRef(new Animated.Value(shouldHide ? 1 : 0)).current;

  // Animation for dismissing the mini player completely
  const dismissAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(hideAnim, {
      toValue: shouldHide ? 1 : 0,
      duration: 300,
      useNativeDriver: false, // Changed to false to support layout props on the same view
    }).start();
  }, [shouldHide]);

  // ... existing state ...
  const [isScrubbing, setIsScrubbing] = useState(false);
  const isScrubbingRef = useRef(false);
  const [repeatMode, setRepeatMode] = useState(0); // 0: Off, 1: Queue, 2: Song
  const [localArtwork, setLocalArtwork] = useState(null);
  const [isResolvingTidal, setIsResolvingTidal] = useState(false);
  const [modalAnimationType, setModalAnimationType] = useState('slide');

  // Ref to prevent unnecessary artwork refetches if track props change shallowly
  const lastTrackSignature = useRef('');

  const resolvedDownloadUri = React.useMemo(() => {
    if (!track) return null;
    const tid = track.id || track.name;
    return recentDownloads?.[tid] || recentDownloads?.[track.name];
  }, [recentDownloads, track?.id, track?.name]);

  // Fetch artwork if missing
  useEffect(() => {
    const currentArtistName = track?.artist?.name || track?.artist || '';
    const currentSignature = `${track?.id}|${track?.name}|${currentArtistName}`;

    // Only run if the track actually changed (ignoring object ref changes or artist object/string swaps)
    if (lastTrackSignature.current === currentSignature) return;
    lastTrackSignature.current = currentSignature;

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
  const lyricsAnim = useRef(new Animated.Value(0)).current;
  const [showLyrics, setShowLyrics] = useState(false);
  const [isLyricsRendered, setIsLyricsRendered] = useState(false);

  // Button Animations
  const playPauseScale = useRef(new Animated.Value(1)).current;
  const nextTranslate = useRef(new Animated.Value(0)).current;
  const prevTranslate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Pulse animation on play/pause state change
    Animated.sequence([
      Animated.timing(playPauseScale, { toValue: 0.85, duration: 100, useNativeDriver: true }),
      Animated.spring(playPauseScale, { toValue: 1, friction: 5, useNativeDriver: true })
    ]).start();
  }, [isPlaying]);

  const animateSkip = (direction) => {
    const anim = direction === 'next' ? nextTranslate : prevTranslate;
    const value = direction === 'next' ? 15 : -15;

    Animated.sequence([
      Animated.timing(anim, { toValue: value, duration: 150, useNativeDriver: true }),
      Animated.spring(anim, { toValue: 0, friction: 6, useNativeDriver: true })
    ]).start();
  };

  useEffect(() => {
    if (showLyrics) {
      setIsLyricsRendered(true);
      Animated.timing(lyricsAnim, {
        toValue: 1,
        duration: 500,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(lyricsAnim, {
        toValue: 0,
        duration: 500,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setIsLyricsRendered(false);
        }
      });
    }
  }, [showLyrics]);

  const expandAnim = useRef(new Animated.Value(isVisible ? 1 : 0)).current;

  const isVisibleRef = useRef(isVisible);
  const onCloseRef = useRef(onClose);
  const onKillRef = useRef(onKill);
  const queueVisibleRef = useRef(queueVisible);

  useEffect(() => {
    isVisibleRef.current = isVisible;
    onCloseRef.current = onClose;
    onKillRef.current = onKill;
  }, [isVisible, onClose, onKill]);

  useEffect(() => {
    queueVisibleRef.current = queueVisible;
  }, [queueVisible]);

  useEffect(() => {
    if (!isVisible) {
      const timer = setTimeout(() => {
        setShowLyrics(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  useEffect(() => {
    Animated.spring(expandAnim, {
      toValue: isVisible ? 1 : 0,
      useNativeDriver: false,
      friction: 14,
      tension: 100,
    }).start();
  }, [isVisible]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => isVisibleRef.current,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        if (!isVisibleRef.current) return false;
        if (isScrubbingRef.current) return false;
        if (queueVisibleRef.current) return false;
        const isDownwardSwipe = gestureState.dy > 10;
        const isVerticalDominant = Math.abs(gestureState.dy) > Math.abs(gestureState.dx);

        // If lyrics are showing, only allow swipe down from very top (header)
        if (showLyrics) {
          return isDownwardSwipe && evt.nativeEvent.pageY < 100;
        }

        return isDownwardSwipe && isVerticalDominant;
      },
      onPanResponderGrant: () => {
        expandAnim.setOffset(expandAnim._value);
        expandAnim.setValue(0);
      },
      onPanResponderMove: (evt, gestureState) => {
        if (gestureState.dy > 0) {
          const change = gestureState.dy / screenHeight;
          expandAnim.setValue(-change);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        expandAnim.flattenOffset();
        if (gestureState.dy > screenHeight * 0.15 || gestureState.vy > 0.5) {
          if (onCloseRef.current) onCloseRef.current();
        } else {
          Animated.spring(expandAnim, {
            toValue: 1,
            friction: 14,
            tension: 100,
            useNativeDriver: false,
          }).start();
        }
      },
    })
  ).current;

  // PanResponder for mini player dismiss (swipe down to kill)
  const miniPlayerPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !isVisibleRef.current, // Only active when minimized
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        if (isVisibleRef.current) return false; // Not active when expanded
        if (isScrubbingRef.current) return false;
        const isDownwardSwipe = gestureState.dy > 5;
        const isVerticalDominant = Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
        return isDownwardSwipe && isVerticalDominant;
      },
      onPanResponderGrant: () => {
        dismissAnim.setOffset(dismissAnim._value);
        dismissAnim.setValue(0);
      },
      onPanResponderMove: (evt, gestureState) => {
        if (gestureState.dy > 0) {
          // Map dy to 0-1 range for dismiss animation
          const progress = Math.min(gestureState.dy / 150, 1);
          dismissAnim.setValue(progress);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        dismissAnim.flattenOffset();
        // If swiped down more than 80px or fast velocity, kill the player
        if (gestureState.dy > 80 || gestureState.vy > 0.8) {
          // Animate to fully dismissed
          Animated.timing(dismissAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: false,
          }).start(() => {
            // Kill the player
            if (onKillRef.current) {
              onKillRef.current();
            }
          });
        } else {
          // Snap back
          Animated.spring(dismissAnim, {
            toValue: 0,
            friction: 14,
            tension: 100,
            useNativeDriver: false,
          }).start();
        }
      },
    })
  ).current;

  const setScrubbing = (value) => {
    isScrubbingRef.current = value;
    setIsScrubbing(value);
  };

  const toggleLyrics = () => {
    LayoutAnimation.configureNext({
      duration: 300,
      update: {
        type: LayoutAnimation.Types.easeInEaseOut,
      },
    });
    setShowLyrics(!showLyrics);
  };

  const toggleShuffle = () => {
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
      // Check for downloaded file first
      const downloadedUri = resolvedDownloadUri;

      let currentUri = downloadedUri || track?.uri || track?.previewUrl || null;
      let workingTidalId = track?.tidalId;

      if (downloadedUri) {
        console.log('[SongPlayer] Playing from download:', downloadedUri);
      }

      // Always get playable track info if we should stream from Tidal
      // This ensures we have the correct numeric tidalId and freshest cached URI
      if (shouldStreamFromTidal(track, true)) {
        try {
          setIsResolvingTidal(true);
          const playable = await getPlayableTrack(track, true);
          if (playable) {
            // Use cached/resolved URI if available (it might be fresher than track.uri)
            if (playable.uri) {
              currentUri = playable.uri;
              if (!cancelled) setActiveUri(currentUri);
            }
            // Always update tidalId to ensure we have the numeric ID for potential refreshes
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
          // Hack: Append #.mp3 to hint the file type to iOS AVPlayer if it doesn't have an extension
          // This is safe because fragments are not sent to the server, so it won't break the signature
          const uriWithHint = (Platform.OS === 'ios' && !uri.match(/\.[a-zA-Z0-9]{3,4}$/) && !uri.includes('#'))
            ? `${uri}#.mp3`
            : uri;

          const isLocal = uri.startsWith('file://');

          // For local files, try decoding the URI to handle spaces correctly
          // expo-av on iOS sometimes struggles with encoded file:// URIs
          const finalUri = isLocal ? decodeURIComponent(uriWithHint) : uriWithHint;

          if (isLocal) {
            console.log('[SongPlayer] Loading local file:', finalUri);
          }

          const source = { uri: finalUri };
          if (!isLocal) {
            source.headers = {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            };
          }

          const { sound } = await Audio.Sound.createAsync(
            source,
            { shouldPlay: shouldPlay },
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
            console.warn('[SongPlayer] Retry with ID failed:', retryError);
          } finally {
            if (!cancelled) setIsResolvingTidal(false);
          }
        }

        // If we still don't have a sound object and should stream from TIDAL, try name-based search
        if (!soundObj && !currentUri && shouldStreamFromTidal(track, true)) {
          if (!cancelled) setIsResolvingTidal(true);
          try {
            console.log('[SongPlayer] Falling back to name-based TIDAL search for:', track.name);
            const playable = await getPlayableTrack(track, true);
            if (playable && playable.uri) {
              currentUri = playable.uri;
              if (!cancelled) setActiveUri(currentUri);
              if (cancelled) return;
              soundObj = await loadSound(currentUri);
              if (cancelled) {
                await soundObj.unloadAsync().catch(() => { });
                return;
              }
              setSound(soundObj);
            }
          } catch (nameSearchError) {
            console.warn('[SongPlayer] Name-based search also failed:', nameSearchError);
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
  }, [track?.uri, track?.previewUrl, track?.id, track?.name, resolvedDownloadUri]);

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
    animateSkip('next');
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
    animateSkip('prev');
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

  // Mini Player Image
  const miniImageUrl = pickImageUrl(images, 'large');

  // Interpolations
  const containerTop = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [screenHeight - 160, 0] // Adjust 160 based on tab bar + mini player height
  });

  const containerLeft = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0]
  });

  const containerRight = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0]
  });

  const containerHeight = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [60, screenHeight]
  });

  const containerRadius = expandAnim.interpolate({
    inputRange: [0, 0.95, 1],
    outputRange: [40, 40, 0]
  });





  const miniOpacity = expandAnim.interpolate({
    inputRange: [0, 0.2],
    outputRange: [1, 0]
  });

  const fullOpacity = expandAnim.interpolate({
    inputRange: [0, 0.4],
    outputRange: [0, 1]
  });

  const hideTranslateY = hideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 200]
  });

  const hideOpacity = hideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0]
  });

  const mainContentTranslateY = lyricsAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -screenHeight],
  });

  const lyricsTranslateY = lyricsAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [screenHeight, 0],
  });

  // Dismiss animation interpolations for mini player
  const dismissTranslateY = dismissAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 150]
  });

  const dismissOpacity = dismissAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 0.5, 0]
  });

  return (
    <Animated.View
      style={[
        styles.rootContainer,
        {
          top: containerTop,
          left: containerLeft,
          right: containerRight,
          height: containerHeight,
          borderRadius: containerRadius,
          zIndex: zIndex,
          elevation: zIndex > 0 ? 1 : 0,
          transform: [{ translateY: hideTranslateY }],
          opacity: hideOpacity,
        }
      ]}
      {...panResponder.panHandlers}
    >
      {/* Mini Player Content */}
      <Animated.View
        style={[
          styles.miniPlayerContainer,
          {
            opacity: Animated.multiply(miniOpacity, dismissOpacity),
            backgroundColor: theme?.card || '#202020',
            borderRadius: containerRadius,
            elevation: zIndex > 0 ? 6 : 0,
            transform: [{ translateY: dismissTranslateY }]
          }
        ]}
        {...miniPlayerPanResponder.panHandlers}
      >
        <Pressable style={styles.miniMainArea} onPress={onOpen}>
          {miniImageUrl ? (
            <Image source={{ uri: miniImageUrl }} style={styles.miniArtwork} />
          ) : (
            <View style={[styles.miniArtwork, { backgroundColor: '#333' }]} />
          )}
          <View style={styles.miniTextContainer}>
            <Text style={[styles.miniTitle, { color: theme?.primaryText || '#fff' }]} numberOfLines={1}>{track.name}</Text>
            <Text style={[styles.miniArtist, { color: theme?.secondaryText || '#ccc' }]} numberOfLines={1}>{track.artist?.name ?? track.artist}</Text>
          </View>
        </Pressable>
        <Pressable style={styles.miniPlayButton} onPress={togglePlay} hitSlop={10}>
          <Ionicons name={isPlaying ? "pause" : "play"} size={22} color={theme?.primaryText || '#fff'} />
        </Pressable>
      </Animated.View>

      {/* Full Player Content */}
      <Animated.View style={[styles.fullPlayerContainer, { opacity: fullOpacity, borderRadius: containerRadius, overflow: 'hidden' }]} pointerEvents={isVisible ? 'auto' : 'none'}>
        <LinearGradient
          colors={[colors.primary, colors.secondary]}
          style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
        >
          {/* Header - Fixed */}
          <View style={styles.header}>
            <Pressable onPress={onClose} style={styles.iconButton} hitSlop={16}>
              <Ionicons name="chevron-down" size={28} color={colors.detail} />
            </Pressable>
            <Text style={[styles.headerTitle, { color: colors.detail }]}>NOW PLAYING</Text>
            <View style={{ width: 28 }} />
          </View>

          {/* Main Content - Slides Up */}
          <Animated.View style={[styles.mainContentContainer, { transform: [{ translateY: mainContentTranslateY }] }]}>
            <View style={styles.artworkContainerOuter}>
              <Animated.View style={[
                styles.artworkContainer,
                {
                  transform: [
                    { perspective: 1200 },
                    { translateX: slideAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: [-350, 0, 350] }) },
                    { rotateY: slideAnim.interpolate({ inputRange: [-1, -0.5, 0, 0.5, 1], outputRange: ['60deg', '25deg', '0deg', '-25deg', '-60deg'] }) },
                    { scale: slideAnim.interpolate({ inputRange: [-1, -0.5, 0, 0.5, 1], outputRange: [0.7, 0.88, 1, 0.88, 0.7] }) },
                  ],
                  opacity: slideAnim.interpolate({ inputRange: [-1, -0.4, 0, 0.4, 1], outputRange: [0, 0.6, 1, 0.6, 0] }),
                },
              ]}>
                {imageUrl ? (
                  <Image source={{ uri: imageUrl }} style={styles.artwork} />
                ) : (
                  <View style={[styles.artwork, { backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' }]}>
                    <Ionicons name="musical-note" size={80} color={playerColorMode === 'light' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)'} />
                  </View>
                )}
              </Animated.View>
            </View>

            <Animated.View
              style={[
                styles.trackInfo,
                {
                  transform: [{ translateX: slideAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: [-100, 0, 100] }) }],
                  opacity: slideAnim.interpolate({ inputRange: [-1, -0.3, 0, 0.3, 1], outputRange: [0, 0.4, 1, 0.4, 0] }),
                },
              ]}
            >
              <View style={{ flex: 1, marginRight: 16 }}>
                <Text style={[styles.title, { color: colors.detail }]} numberOfLines={1}>{track.name}</Text>
                <Pressable onPress={() => onArtistPress && onArtistPress(track.artist?.name ?? track.artist)}>
                  <Text style={[styles.artist, { color: colors.detail }]} numberOfLines={1}>{track.artist?.name ?? track.artist}</Text>
                </Pressable>
              </View>
              <Pressable
                onPress={() => toggleFavorite && toggleFavorite(track)}
                hitSlop={16}
                style={{ padding: 4 }}
              >
                <Ionicons
                  name={isFavorite ? "star" : "star-outline"}
                  size={24}
                  color={isFavorite ? colors.detail : (playerColorMode === 'light' ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.6)')}
                />
              </Pressable>
            </Animated.View>

            <View style={styles.progressContainer}>
              <CustomSlider
                value={positionSec}
                maximumValue={durationSec || 1}
                onSlidingStart={onSeekStart}
                onValueChange={onSeekUpdate}
                onSlidingComplete={onSeekComplete}
                isLoading={isLoading}
                trackColor={playerColorMode === 'light' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)'}
                progressColor={colors.detail}
              />
              <View style={styles.timeRow}>
                <Text style={[styles.timeText, { color: colors.detail }]}>{formatTime(positionSec)}</Text>
                <Text style={[styles.timeText, { color: colors.detail }]}>{formatTime(durationSec)}</Text>
              </View>
            </View>

            <View style={styles.controls}>
              <AnimatedControl style={styles.controlButton} onPress={toggleShuffle}>
                <Ionicons name="shuffle" size={24} color={isShuffleEnabled ? colors.detail : (playerColorMode === 'light' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)')} />
                {isShuffleEnabled && <View style={[styles.activeIndicatorDot, { backgroundColor: colors.detail }]} />}
              </AnimatedControl>

              <AnimatedControl style={styles.controlButton} onPress={skipPrevious} disabled={!canSkipPrevious}>
                <Animated.View style={{ transform: [{ translateX: prevTranslate }] }}>
                  <Ionicons name="play-skip-back" size={32} color={canSkipPrevious ? colors.detail : (playerColorMode === 'light' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)')} />
                </Animated.View>
              </AnimatedControl>

              <AnimatedControl style={[styles.controlButton, styles.playPauseButton, { backgroundColor: colors.detail }]} onPress={togglePlay}>
                {isLoading ? (
                  <ActivityIndicator color={playerColorMode === 'light' ? '#fff' : '#000'} />
                ) : (
                  <Animated.View style={{ transform: [{ scale: playPauseScale }] }}>
                    <Ionicons name={isPlaying ? "pause" : "play"} size={40} color={playerColorMode === 'light' ? '#fff' : '#000'} style={{ marginLeft: isPlaying ? 0 : 4 }} />
                  </Animated.View>
                )}
              </AnimatedControl>

              <AnimatedControl style={styles.controlButton} onPress={skipNext} disabled={!canSkipNext}>
                <Animated.View style={{ transform: [{ translateX: nextTranslate }] }}>
                  <Ionicons name="play-skip-forward" size={32} color={canSkipNext ? colors.detail : (playerColorMode === 'light' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)')} />
                </Animated.View>
              </AnimatedControl>

              <AnimatedControl style={styles.controlButton} onPress={() => {
                const modes = [0, 1, 2];
                const nextMode = modes[(repeatMode + 1) % modes.length];
                setRepeatMode(nextMode);
              }}>
                <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="repeat" size={24} color={repeatMode !== 0 ? colors.detail : (playerColorMode === 'light' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)')} />
                  {repeatMode === 2 && <View style={[styles.activeIndicatorDot, { position: 'absolute', bottom: -8, backgroundColor: colors.detail }]} />}
                </View>
              </AnimatedControl>
            </View>

            <View style={styles.bottomControls}>
              <Pressable hitSlop={16} onPress={toggleLyrics} style={styles.bottomControlButton}>
                <Ionicons name="chatbox-ellipses" size={24} color={showLyrics ? colors.detail : (playerColorMode === 'light' ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)')} />
              </Pressable>
              <Pressable onPress={() => setQueueVisible(true)} style={styles.bottomControlButton}>
                <Ionicons name="list" size={24} color={colors.detail} />
              </Pressable>
            </View>
          </Animated.View>

          {/* Lyrics Content - Slides In */}
          <Animated.View style={[styles.lyricsPageContainer, { top: insets.top + 60, transform: [{ translateY: lyricsTranslateY }] }]}>
            {isLyricsRendered && (
              <>
                <LyricsView
                  track={track}
                  currentTime={positionSec}
                  duration={durationSec}
                  onSeek={onSeekComplete}
                  backgroundColor={colors.secondary}
                  textColor={colors.detail}
                />
                <View style={styles.lyricsBottomControls}>
                  <Pressable hitSlop={16} onPress={toggleLyrics} style={styles.bottomControlButton}>
                    <Ionicons name="chatbox-ellipses" size={24} color={colors.detail} />
                  </Pressable>
                  <Pressable onPress={() => setQueueVisible(true)} style={styles.bottomControlButton}>
                    <Ionicons name="list" size={24} color={colors.detail} />
                  </Pressable>
                </View>
              </>
            )}
          </Animated.View>

          <QueueSheet
            visible={queueVisible}
            onClose={() => setQueueVisible(false)}
            queue={queue}
            currentIndex={queueIndex}
            onTrackSelect={onTrackChange}
            onReorder={onQueueReorder}
            onDelete={onQueueReorder}
            backgroundColor={colors.secondary}
          />
        </LinearGradient>
      </Animated.View>
    </Animated.View>
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
  artworkContainerOuter: {
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 2,
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
    marginTop: 4,
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
    marginBottom: 10,
    marginTop: 8,
  },
  bottomControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 40,
    marginBottom: 40,
  },
  bottomControlButton: {
    padding: 10,
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
  mainContentContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lyricsPageContainer: {
    position: 'absolute',
    top: 60, // Header height
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  lyricsBottomControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 40,
    marginBottom: 40,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  rootContainer: {
    position: 'absolute',
  },
  fullPlayerContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  miniPlayerContainer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    zIndex: 1,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
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
});
