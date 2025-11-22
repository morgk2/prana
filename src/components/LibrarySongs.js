import React from 'react';
import { View, Text, ScrollView, Pressable, Image, StyleSheet, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

function pickImageUrl(images, preferredSize = 'large') {
    if (!Array.isArray(images)) return null;
    const preferred = images.find((img) => img.size === preferredSize && img['#text']);
    if (preferred) return preferred['#text'];
    const any = images.find((img) => img['#text']);
    return any ? any['#text'] : null;
}

import SwipeableTrackRow from './SwipeableTrackRow';

// ...

export default function LibrarySongs({ route, navigation }) {
    const { theme, library, onTrackPress, addToQueue } = route.params;

    const renderSongItem = ({ item, index }) => {
        const imageUrl = pickImageUrl(item.image, 'large');
        const artistName = item.artist?.name || item.artist || 'Unknown Artist';

        return (
            <SwipeableTrackRow
                theme={theme}
                onSwipeLeft={() => {
                    if (addToQueue) {
                        addToQueue(item);
                    }
                }}
            >
                <Pressable
                    style={[styles.songItem, { borderBottomColor: theme.border, backgroundColor: theme.background }]}
                    onPress={() => onTrackPress(item, library, index)}
                >
                    {imageUrl ? (
                        <Image source={{ uri: imageUrl }} style={styles.artwork} />
                    ) : (
                        <View style={[styles.artwork, { backgroundColor: theme.card }]}>
                            <Ionicons name="musical-note" size={24} color={theme.secondaryText} />
                        </View>
                    )}
                    <View style={styles.songInfo}>
                        <Text style={[styles.songTitle, { color: theme.primaryText }]} numberOfLines={1}>
                            {item.name}
                        </Text>
                        <Text style={[styles.songArtist, { color: theme.secondaryText }]} numberOfLines={1}>
                            {artistName}
                        </Text>
                    </View>
                    <Pressable style={styles.moreButton} hitSlop={10}>
                        <Ionicons name="ellipsis-horizontal" size={20} color={theme.secondaryText} />
                    </Pressable>
                </Pressable>
            </SwipeableTrackRow>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            <View style={styles.header}>
                <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
                    <Ionicons name="chevron-back" size={32} color={theme.primaryText} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: theme.primaryText }]}>Songs</Text>
            </View>

            <FlatList
                data={library}
                renderItem={renderSongItem}
                keyExtractor={(item, index) => item.uri || `song-${index}`}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <Ionicons name="musical-notes-outline" size={80} color={theme.secondaryText} style={{ opacity: 0.3 }} />
                        <Text style={[styles.emptyText, { color: theme.secondaryText }]}>No songs in library</Text>
                    </View>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingTop: 60,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        marginBottom: 10,
        gap: 10,
    },
    headerTitle: {
        fontSize: 34,
        fontWeight: 'bold',
    },
    listContent: {
        paddingBottom: 100,
    },
    songItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    artwork: {
        width: 50,
        height: 50,
        borderRadius: 4,
        marginRight: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    songInfo: {
        flex: 1,
        justifyContent: 'center',
    },
    songTitle: {
        fontSize: 16,
        fontWeight: '500',
        marginBottom: 4,
    },
    songArtist: {
        fontSize: 14,
    },
    moreButton: {
        padding: 8,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 100,
        gap: 16,
    },
    emptyText: {
        fontSize: 16,
    },
});
