import React from 'react';
import { View, Text, ScrollView, Pressable, Image, StyleSheet, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function LibraryPlaylists({ route, navigation }) {
    const { theme, playlists = [], library = [], onPlaylistPress } = route.params;

    const likedSongs = library.filter(t => t.favorite);
    const likedSongsPlaylist = {
        id: 'liked-songs',
        name: 'Liked Songs',
        tracks: likedSongs,
        description: 'Your favorite tracks',
        isDefault: true
    };

    const renderPlaylistItem = ({ item }) => {
        return (
            <Pressable
                style={[styles.playlistItem, { borderBottomColor: theme.border }]}
                onPress={() => navigation.navigate('PlaylistPage', { playlist: item, theme, ...route.params })}
            >
                {item.image ? (
                    <Image source={{ uri: item.image }} style={styles.artwork} />
                ) : (
                    <View style={[styles.artwork, { backgroundColor: theme.card }]}>
                        <Ionicons name="musical-notes" size={24} color={theme.secondaryText} />
                    </View>
                )}
                <View style={styles.playlistInfo}>
                    <Text style={[styles.playlistTitle, { color: theme.primaryText }]} numberOfLines={1}>
                        {item.name}
                    </Text>
                    <Text style={[styles.playlistSubtitle, { color: theme.secondaryText }]} numberOfLines={1}>
                        {item.tracks ? `${item.tracks.length} songs` : '0 songs'}
                    </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
            </Pressable>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            <View style={styles.header}>
                <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
                    <Ionicons name="chevron-back" size={32} color={theme.primaryText} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: theme.primaryText }]}>Playlists</Text>
                <Pressable
                    style={styles.addButton}
                    onPress={() => navigation.navigate('AddPlaylist', { ...route.params })}
                >
                    <Ionicons name="add" size={28} color={theme.primaryText} />
                </Pressable>
            </View>

            <Pressable
                style={[styles.playlistItem, { borderBottomColor: theme.border }]}
                onPress={() => navigation.navigate('PlaylistPage', { playlist: likedSongsPlaylist, theme, ...route.params })}
            >
                <View style={[styles.artwork, { backgroundColor: theme.primary }]}>
                    <Ionicons name="star" size={24} color="#000000" />
                </View>
                <View style={styles.playlistInfo}>
                    <Text style={[styles.playlistTitle, { color: theme.primaryText }]} numberOfLines={1}>
                        Liked Songs
                    </Text>
                    <Text style={[styles.playlistSubtitle, { color: theme.secondaryText }]} numberOfLines={1}>
                        {likedSongs.length} songs
                    </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
            </Pressable>

            <FlatList
                data={playlists}
                renderItem={renderPlaylistItem}
                keyExtractor={(item, index) => item.id || `playlist-${index}`}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <Ionicons name="list-outline" size={80} color={theme.secondaryText} style={{ opacity: 0.3 }} />
                        <Text style={[styles.emptyText, { color: theme.secondaryText }]}>No playlists yet</Text>
                        <Pressable
                            style={[styles.createButton, { backgroundColor: theme.primaryText }]}
                            onPress={() => navigation.navigate('AddPlaylist', { ...route.params })}
                        >
                            <Text style={[styles.createButtonText, { color: theme.background }]}>Create Playlist</Text>
                        </Pressable>
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
        justifyContent: 'space-between',
    },
    headerTitle: {
        fontSize: 34,
        fontWeight: 'bold',
        flex: 1,
        marginLeft: 10,
    },
    addButton: {
        padding: 4,
    },
    listContent: {
        paddingBottom: 100,
    },
    playlistItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    artwork: {
        width: 60,
        height: 60,
        borderRadius: 4,
        marginRight: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    playlistInfo: {
        flex: 1,
        justifyContent: 'center',
    },
    playlistTitle: {
        fontSize: 16,
        fontWeight: '500',
        marginBottom: 4,
    },
    playlistSubtitle: {
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
    createButton: {
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 8,
        marginTop: 16,
    },
    createButtonText: {
        fontSize: 16,
        fontWeight: '600',
    }
});
