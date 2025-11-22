
import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ActivityIndicator,
    FlatList,
    Pressable,
    Animated,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { getLyrics } from '../api/lrclib';
import { parseLrc } from '../utils/lrcParser';
import { fetchAndCacheLyrics } from '../utils/lyricsCache';

export default function LyricsView({ track, currentTime, duration, onSeek, onInteraction, style }) {
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
        const parsed = parseLrc(lyricsData.syncedLyrics);
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
    let index = parsedLyrics.findIndex(line => line.time > currentTime);

    if (index === -1) {
        // All lines are in the past
        index = parsedLyrics.length - 1;
    } else {
        // The found index is the first future line, so the active one is index - 1
        index = index - 1;
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
            viewPosition: 0.5, // Position active item at center
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
    }, 3000);
};

const handleLinePress = (line) => {
    if (onInteraction) onInteraction();
    if (onSeek) {
        Haptics.selectionAsync();
        onSeek(line.time);
    }
};

const renderItem = ({ item, index }) => {
    const isActive = index === activeIndex;

    return (
        <Pressable
            onPress={() => handleLinePress(item)}
            style={[styles.line, isActive && styles.activeLine]}
        >
            <Text
                style={[
                    styles.lineText,
                    isActive ? styles.activeLineText : styles.inactiveLineText,
                ]}
            >
                {item.text}
            </Text>
        </Pressable>
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
        paddingVertical: '50%', // Large padding to allow scrolling top/bottom lines to center
        paddingHorizontal: 24,
    },
    line: {
        paddingVertical: 12,
        borderRadius: 12,
    },
    activeLine: {
        // transform: [{ scale: 1.05 }], // Optional scale effect
    },
    lineText: {
        fontSize: 24,
        fontWeight: '700',
        textAlign: 'left',
    },
    activeLineText: {
        color: '#ffffff',
        opacity: 1,
        textShadowColor: 'rgba(0,0,0,0.3)',
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 4,
    },
    inactiveLineText: {
        color: '#ffffff',
        opacity: 0.5,
        fontSize: 22,
        fontWeight: '600',
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
