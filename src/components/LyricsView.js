
import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ActivityIndicator,
    FlatList,
    Pressable,
    Animated,
    Easing,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { getLyrics } from '../api/lrclib';
import { parseLrc } from '../utils/lrcParser';
import { fetchAndCacheLyrics } from '../utils/lyricsCache';

const LyricLine = ({ item, isActive, onPress }) => {
    const animValue = useRef(new Animated.Value(isActive ? 1 : 0)).current;

    useEffect(() => {
        Animated.timing(animValue, {
            toValue: isActive ? 1 : 0,
            duration: 300,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [isActive]);

    return (
        <Pressable onPress={onPress} style={styles.line}>
            <Animated.Text
                style={[
                    styles.lineText,
                    {
                        opacity: animValue.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.5, 1],
                        }),
                        transform: [
                            {
                                scale: animValue.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [1, 1.05],
                                }),
                            },
                            {
                                translateX: animValue.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0, 10], // Slight shift right for active
                                }),
                            }
                        ],
                        textShadowColor: 'rgba(0,0,0,0.3)',
                        textShadowOffset: { width: 0, height: 2 },
                        textShadowRadius: 4,
                    },
                ]}
            >
                {item.text}
            </Animated.Text>
        </Pressable>
    );
};

export default function LyricsView({ track, currentTime, duration, onSeek, onInteraction, style, backgroundColor = '#202020' }) {
    const [loading, setLoading] = useState(false);
    const [lyricsData, setLyricsData] = useState(null);
    const [parsedLyrics, setParsedLyrics] = useState([]);
    const [error, setError] = useState(null);
    const flatListRef = useRef(null);
    const [activeIndex, setActiveIndex] = useState(-1);
    const isUserScrolling = useRef(false);
    const scrollTimeout = useRef(null);

    // Fetch lyrics when track changes
    useEffect(() => {
        let isMounted = true;
        
        const fetchLyrics = async () => {
            if (!track) return;
            
            setLoading(true);
            setError(null);
            
            try {
                // Check if track has embedded lyrics
                if (track.lyrics) {
                    console.log('[LyricsView] Using embedded lyrics');
                    if (track.lyrics.includes('[00:')) {
                        setLyricsData({ syncedLyrics: track.lyrics, plainLyrics: track.lyrics });
                    } else {
                        setLyricsData({ plainLyrics: track.lyrics });
                    }
                    setLoading(false);
                    return;
                }

                // Use caching system
                console.log('[LyricsView] Fetching from cache/API');
                const cachedLyrics = await fetchAndCacheLyrics(track);
                console.log('[LyricsView] Fetch result:', cachedLyrics ? 'Found' : 'Not found');

                if (isMounted) {
                    if (cachedLyrics) {
                        if (cachedLyrics.includes('[00:')) {
                            console.log('[LyricsView] Setting synced lyrics');
                            setLyricsData({ syncedLyrics: cachedLyrics, plainLyrics: cachedLyrics });
                        } else {
                            console.log('[LyricsView] Setting plain lyrics');
                            setLyricsData({ plainLyrics: cachedLyrics });
                        }
                    } else {
                        console.log('[LyricsView] No lyrics found, setting error');
                        setError('No lyrics found');
                    }
                }
            } catch (e) {
                console.error('[LyricsView] Error fetching lyrics:', e);
                if (isMounted) setError('Failed to load lyrics');
            } finally {
                if (isMounted) {
                    console.log('[LyricsView] Setting loading to false');
                    setLoading(false);
                }
            }
        };

        fetchLyrics();

        return () => {
            isMounted = false;
        };
    }, [track?.id, track?.uri, track?.name, track?.artist]);

    // Parse lyrics when data is available
    useEffect(() => {
        if (lyricsData?.syncedLyrics) {
            let parsed = parseLrc(lyricsData.syncedLyrics);

            // Process for instrumental breaks / gaps
            if (parsed.length > 0) {
                const withFillers = [];
                const GAP_THRESHOLD = 10; // seconds
                const START_THRESHOLD = 5; // seconds

                // Check for intro gap
                if (parsed[0].time > START_THRESHOLD) {
                    withFillers.push({ time: 0, text: '...' });
                }

                for (let i = 0; i < parsed.length; i++) {
                    const currentLine = parsed[i];
                    withFillers.push(currentLine);

                    // Check gap to next line
                    if (i < parsed.length - 1) {
                        const nextLine = parsed[i + 1];
                        const gap = nextLine.time - currentLine.time;
                        
                        if (gap > GAP_THRESHOLD) {
                            // Insert filler line shortly after current line
                            // But ensure it's before the next line
                            // A simple heuristic: current line time + 5s (or less if gap is small but > 10)
                            // Let's say we just put it at current + 5s?
                            // Or better: if lyrics are sparse, we want the '...' to appear during the silence.
                            // We'll insert it 3 seconds after the current line starts.
                            // Wait, if the line is long, 3s might be too early.
                            // Lrc lines don't have duration.
                            // Let's assume a line takes ~3-4 seconds.
                            // We'll insert '...' at currentLine.time + 5, ensuring it's < nextLine.time
                            

                            let fillerTime = currentLine.time + 5;
                            if (fillerTime < nextLine.time) {
                                withFillers.push({ time: fillerTime, text: '...' });
                            }
                        }
                    }
                }
                parsed = withFillers;
            }
            
            setParsedLyrics(parsed);
        } else {
            setParsedLyrics([]);
        }
    }, [lyricsData]);

    // Update active index based on currentTime
    useEffect(() => {
        if (!parsedLyrics.length) return;

        // Find the line that corresponds to current time
        // The active line is the last one where time <= currentTime
        let index = -1;
        for (let i = 0; i < parsedLyrics.length; i++) {
            if (parsedLyrics[i].time <= currentTime) {
                index = i;
            } else {
                break;
            }
        }

        // Clamp index
        index = Math.max(0, index);

        if (index !== activeIndex) {
            setActiveIndex(index);
            scrollToIndex(index);
        }
    }, [currentTime, parsedLyrics]);

const scrollToIndex = (index) => {
    if (isUserScrolling.current || !flatListRef.current) return;

    try {
        flatListRef.current.scrollToIndex({
            index,
            animated: true,
            viewPosition: 0, // Position active item at top
        });
    } catch (e) {
        // Ignore scroll errors (e.g. list not ready)
    }
};

const handleScrollBegin = () => {
    if (onInteraction) onInteraction();
    isUserScrolling.current = true;
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
};

const handleScrollEnd = () => {
    // Resume auto-scroll after 2 seconds of inactivity
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
        isUserScrolling.current = false;
        // Snap back to current line
        if (activeIndex >= 0) {
            scrollToIndex(activeIndex);
        }
    }, 2000);
};

const handleLinePress = (line, index) => {
    if (onInteraction) onInteraction();
    // Optimistic update
    setActiveIndex(index);
    if (onSeek) {
        Haptics.selectionAsync();
        onSeek(line.time);
    }
};

const renderItem = ({ item, index }) => {
    return (
        <LyricLine
            item={item}
            isActive={index === activeIndex}
            onPress={() => handleLinePress(item, index)}
        />
    );
};

if (loading) {
    return (
        <View style={[styles.container, styles.center, style]}>
            <ActivityIndicator size="large" color="#fff" />
        </View>
    );
}

if (error) {
    return (
        <View style={[styles.container, styles.center, style]}>
            <Text style={styles.messageText}>{error}</Text>
        </View>
    );
}

if (parsedLyrics.length > 0) {
    return (
        <View style={[styles.container, style]}>
            <FlatList
                ref={flatListRef}
                data={parsedLyrics}
                renderItem={renderItem}
                keyExtractor={(_, i) => `line-${i}`}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                onScrollBeginDrag={handleScrollBegin}
                onMomentumScrollEnd={handleScrollEnd}
                onScrollEndDrag={handleScrollEnd}

            />
            <LinearGradient
                colors={['transparent', backgroundColor]}
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: 120,
                }}
                pointerEvents="none"
            />
        </View>
    );
}

// Fallback to plain lyrics
if (lyricsData?.plainLyrics) {
    // Split plain lyrics into lines
    const plainLines = lyricsData.plainLyrics
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map((text, index) => ({ text, index }));

    return (
        <View style={[styles.container, style]}>
            <FlatList
                data={plainLines}
                renderItem={({ item }) => (
                    <Pressable
                        style={styles.line}
                    >
                        <Text style={[styles.lineText, styles.plainLineText]}>
                            {item.text}
                        </Text>
                    </Pressable>
                )}
                keyExtractor={(item) => `plain-${item.index}`}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
            />
            <LinearGradient
                colors={['transparent', backgroundColor]}
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: 120,
                }}
                pointerEvents="none"
            />
        </View>
    );
}

return (
    <View style={[styles.container, styles.center, style]}>
        <Text style={styles.messageText}>No lyrics available</Text>
    </View>
);
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        width: '100%',
    },
    center: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    listContent: {
        paddingTop: 20,
        paddingBottom: '80%',
        paddingHorizontal: 24,
    },
    line: {
        paddingVertical: 12,
        borderRadius: 12,
    },
    activeLine: {
    },
    lineText: {
        fontSize: 24,
        fontWeight: '700',
        textAlign: 'left',
        color: '#ffffff',
    },
    activeLineText: {
    },
    inactiveLineText: {
    },
    plainLineText: {
        color: '#ffffff',
        opacity: 0.7,
        fontSize: 22,
        fontWeight: '600',
    },
    plainText: {
        color: '#ffffff',
        fontSize: 18,
        lineHeight: 32,
        textAlign: 'center',
        fontWeight: '500',
    },
    messageText: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 16,
    },
});
