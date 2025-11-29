import React from 'react';
import { View, Text, ScrollView, Pressable, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function LibraryAlbums({ route, navigation }) {
    const { theme, libraryAlbums, onTrackPress, reloadArtwork, openArtistByName } = route.params;

    const renderAlbumGridItem = (album, index) => {
        return (
            <Pressable
                key={`album-${index}`}
                style={styles.gridItem}
                onPress={() => navigation.navigate('LibraryAlbum', { 
                    ...route.params, 
                    album,
                    openArtistByName // Explicitly pass this to ensure it's available
                })}
            >
                {album.artwork ? (
                    <Image 
                        source={{ uri: album.artwork }} 
                        style={[styles.artwork, { borderRadius: 8 }]} 
                        onError={() => {
                            console.log('[LibraryAlbums] Artwork load error for:', album.title);
                            if (reloadArtwork) reloadArtwork(album.title, album.artist);
                        }}
                    />
                ) : (
                    <View style={[styles.artwork, { backgroundColor: theme.card, borderRadius: 8 }]}>
                        <Ionicons name="disc-outline" size={60} color={theme.secondaryText} />
                    </View>
                )}
                <Text style={[styles.title, { color: theme.primaryText }]} numberOfLines={1}>
                    {album.title}
                </Text>
                <Text style={[styles.subtitle, { color: theme.secondaryText }]} numberOfLines={1}>
                    {album.artist}
                </Text>
            </Pressable>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            <View style={styles.header}>
                <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
                    <Ionicons name="chevron-back" size={32} color={theme.primaryText} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: theme.primaryText }]}>Albums</Text>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                {libraryAlbums.length > 0 ? (
                    <View style={styles.grid}>
                        {libraryAlbums.map((album, index) => (
                            <View key={`grid-album-${index}`} style={styles.gridItemContainer}>
                                {renderAlbumGridItem(album, index)}
                            </View>
                        ))}
                    </View>
                ) : (
                    <View style={styles.emptyState}>
                        <Ionicons name="albums-outline" size={80} color={theme.secondaryText} style={{ opacity: 0.3 }} />
                        <Text style={[styles.emptyText, { color: theme.secondaryText }]}>No albums in library</Text>
                    </View>
                )}
            </ScrollView>
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
        marginBottom: 20,
        gap: 10,
    },
    headerTitle: {
        fontSize: 34,
        fontWeight: 'bold',
    },
    scrollContent: {
        paddingBottom: 100,
        paddingHorizontal: 16,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginHorizontal: -8,
    },
    gridItemContainer: {
        width: '50%',
        padding: 8,
    },
    gridItem: {

    },
    artwork: {
        width: '100%',
        aspectRatio: 1,
        marginBottom: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    subtitle: {
        fontSize: 14,
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
