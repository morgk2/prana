import React, { useState, useRef } from 'react';
import {
    StyleSheet,
    Text,
    View,
    Image,
    ScrollView,
    Pressable,
    Animated,
    Modal,
    TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import SwipeableTrackRow from './SwipeableTrackRow';

function pickImageUrl(images, preferredSize = 'large') {
    if (!Array.isArray(images)) return null;
    const preferred = images.find((img) => img.size === preferredSize && img['#text']);
    if (preferred) return preferred['#text'];
    const any = images.find((img) => img['#text']);
    return any ? any['#text'] : null;
}

export default function PlaylistPage({ route, navigation }) {
    const { playlist: initialPlaylist, theme, onTrackPress, isPlaying, currentTrack, togglePlay, addToQueue, deletePlaylist, updatePlaylist, showNotification, library } = route.params;

    const { playlists } = route.params;
    const playlist = playlists?.find(p => p.id === initialPlaylist.id) || initialPlaylist;

    const [contextMenuTrack, setContextMenuTrack] = useState(null);
    const [selectedTrackKey, setSelectedTrackKey] = useState(null);
    const [menuAnim] = useState(new Animated.Value(0));
    const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });

    const [playlistMenuVisible, setPlaylistMenuVisible] = useState(false);
    const [playlistMenuPosition, setPlaylistMenuPosition] = useState({ x: 0, y: 0 });
    const playlistMenuAnim = useRef(new Animated.Value(0)).current;
    const playlistMenuButtonRef = useRef(null);

    const trackRefs = useRef({});
    const trackScaleAnims = useRef({});

    const openPlaylistMenu = () => {
        if (playlistMenuButtonRef.current) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            playlistMenuButtonRef.current.measure((x, y, width, height, pageX, pageY) => {
                setPlaylistMenuPosition({ x: pageX, y: pageY + height });
                setPlaylistMenuVisible(true);
                Animated.spring(playlistMenuAnim, {
                    toValue: 1,
                    useNativeDriver: true,
                    tension: 100,
                    friction: 10,
                }).start();
            });
        }
    };

    const closePlaylistMenu = () => {
        Animated.timing(playlistMenuAnim, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
        }).start(() => {
            setPlaylistMenuVisible(false);
        });
    };

    const handleEditPlaylist = () => {
        closePlaylistMenu();
        navigation.navigate('AddPlaylist', {
            theme,
            library,
            playlistToEdit: playlist,
            updatePlaylist,
            showNotification,
        });
    };

    const handleDeletePlaylist = () => {
        if (deletePlaylist) {
            deletePlaylist(playlist.id);
            navigation.goBack();
            if (showNotification) {
                showNotification(`Playlist "${playlist.name}" deleted`);
            }
        }
        closePlaylistMenu();
    };

    const openContextMenu = (track, trackKey) => {
        const ref = trackRefs.current[trackKey];
        if (ref) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

            ref.measure((x, y, width, height, pageX, pageY) => {
                setMenuPosition({ x: pageX, y: pageY + height });
                setContextMenuTrack(track);
                setSelectedTrackKey(trackKey);

                Animated.spring(menuAnim, {
                    toValue: 1,
                    useNativeDriver: true,
                    tension: 100,
                    friction: 10,
                }).start();

                if (!trackScaleAnims.current[trackKey]) {
                    trackScaleAnims.current[trackKey] = new Animated.Value(1);
                }
                Animated.spring(trackScaleAnims.current[trackKey], {
                    toValue: 1.02,
                    useNativeDriver: true,
                    tension: 100,
                    friction: 10,
                }).start();
            });
        }
    };

    const closeContextMenu = () => {
        const currentTrackKey = selectedTrackKey;

        Animated.timing(menuAnim, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
        }).start(() => {
            setContextMenuTrack(null);
            setSelectedTrackKey(null);
        });

        if (currentTrackKey && trackScaleAnims.current[currentTrackKey]) {
            Animated.spring(trackScaleAnims.current[currentTrackKey], {
                toValue: 1,
                useNativeDriver: true,
                tension: 100,
                friction: 10,
            }).start();
        }
    };

    const handleAddToQueue = () => {
        if (contextMenuTrack && addToQueue) {
            addToQueue(contextMenuTrack);
            closeContextMenu();
        }
    };

    const renderContent = () => {
        if (!playlist || !playlist.tracks || playlist.tracks.length === 0) {
            return (
                <View style={styles.emptyContainer}>
                    <View style={styles.artworkContainer}>
                        {playlist?.image ? (
                            <Image style={styles.playlistArtwork} source={{ uri: playlist.image }} />
                        ) : (
                            <View style={[styles.playlistArtwork, { backgroundColor: theme.card }]}>
                                <Ionicons name="musical-notes" size={100} color={theme.secondaryText} />
                            </View>
                        )}
                    </View>
                    <Text style={[styles.playlistTitle, { color: theme.primaryText }]}>{playlist?.name || 'Playlist'}</Text>
                    <Text style={[styles.emptyText, { color: theme.secondaryText }]}>
                        No tracks in this playlist
                    </Text>
                </View>
            );
        }

        return (
            <>
                {/* Playlist Artwork */}
                <View style={styles.artworkContainer}>
                    {playlist?.image ? (
                        <Image
                            style={styles.playlistArtwork}
                            source={{ uri: playlist.image }}
                        />
                    ) : (
                        <View style={[styles.playlistArtwork, { backgroundColor: theme.card }]}>
                            <Ionicons name="musical-notes" size={100} color={theme.secondaryText} />
                        </View>
                    )}
                </View>

                {/* Playlist Info */}
                <View style={styles.playlistInfoSection}>
                    <Text style={[styles.playlistTitle, { color: theme.primaryText }]}>{playlist.name}</Text>
                    {playlist.description ? (
                        <Text style={[styles.playlistDescription, { color: theme.secondaryText }]}>
                            {playlist.description}
                        </Text>
                    ) : null}
                    <Text style={[styles.playlistMeta, { color: theme.secondaryText }]}>
                        {playlist.tracks.length} {playlist.tracks.length === 1 ? 'song' : 'songs'}
                    </Text>
                </View>

                {/* Action Buttons */}
                <View style={styles.actionButtonsContainer}>
                    {(() => {
                        const isPlaylistPlaying = isPlaying && currentTrack && playlist.tracks.some(t => t.uri === currentTrack.uri);
                        return (
                            <Pressable
                                style={[styles.actionButton, styles.playButton, { backgroundColor: theme.primaryText }]}
                                onPress={() => {
                                    if (isPlaylistPlaying) {
                                        if (togglePlay) togglePlay();
                                    } else {
                                        if (playlist.tracks.length > 0 && onTrackPress) {
                                            onTrackPress(playlist.tracks[0], playlist.tracks, 0, false);
                                        }
                                    }
                                }}
                            >
                                <Ionicons name={isPlaylistPlaying ? "stop" : "play"} size={20} color={theme.background} />
                                <Text style={[styles.actionButtonText, { color: theme.background }]}>{isPlaylistPlaying ? "Stop" : "Play"}</Text>
                            </Pressable>
                        );
                    })()}

                    <Pressable
                        style={[styles.actionButton, styles.shuffleButton, { borderColor: theme.border, backgroundColor: theme.card }]}
                        onPress={() => {
                            if (playlist.tracks.length > 0 && onTrackPress) {
                                const shuffled = [...playlist.tracks].sort(() => Math.random() - 0.5);
                                onTrackPress(shuffled[0], shuffled, 0);
                            }
                        }}
                    >
                        <Ionicons name="shuffle" size={20} color={theme.primaryText} />
                        <Text style={[styles.actionButtonText, { color: theme.primaryText }]}>Shuffle</Text>
                    </Pressable>
                </View>

                {/* Track List */}
                <View style={styles.trackListSection}>
                    {playlist.tracks.map((track, index) => {
                        const trackKey = `track-${index}`;
                        const imageUrl = pickImageUrl(track.image, 'large');

                        if (!trackScaleAnims.current[trackKey]) {
                            trackScaleAnims.current[trackKey] = new Animated.Value(1);
                        }

                        return (
                            <Animated.View
                                key={`playlist-track-${index}`}
                                ref={(ref) => { if (ref) trackRefs.current[trackKey] = ref; }}
                                collapsable={false}
                                style={{
                                    transform: [{ scale: trackScaleAnims.current[trackKey] }],
                                }}
                            >
                                <SwipeableTrackRow
                                    theme={theme}
                                    onSwipeLeft={() => {
                                        if (addToQueue) {
                                            addToQueue(track);
                                        }
                                    }}
                                >
                                    <Pressable
                                        onPress={() => {
                                            if (onTrackPress) {
                                                onTrackPress(track, playlist.tracks, index);
                                            }
                                        }}
                                        onLongPress={() => openContextMenu(track, trackKey)}
                                        style={[styles.trackRow, { borderBottomColor: theme.border, backgroundColor: theme.background }]}
                                    >
                                        {/* Track Artwork */}
                                        {imageUrl ? (
                                            <Image source={{ uri: imageUrl }} style={styles.trackArtwork} />
                                        ) : (
                                            <View style={[styles.trackArtwork, { backgroundColor: theme.card }]}>
                                                <Ionicons name="musical-note" size={20} color={theme.secondaryText} />
                                            </View>
                                        )}

                                        <View style={styles.trackInfo}>
                                            <Text style={[styles.trackName, { color: theme.primaryText }]} numberOfLines={1}>
                                                {track.name}
                                            </Text>
                                            <Text style={[styles.trackArtist, { color: theme.secondaryText }]} numberOfLines={1}>
                                                {track.artist?.name || track.artist || 'Unknown Artist'}
                                            </Text>
                                        </View>

                                        <Pressable onPress={() => openContextMenu(track, trackKey)} hitSlop={10}>
                                            <Ionicons name="ellipsis-horizontal" size={20} color={theme.secondaryText} />
                                        </Pressable>
                                    </Pressable>
                                </SwipeableTrackRow>
                            </Animated.View>
                        );
                    })}
                </View>
            </>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            <View style={[styles.header, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
                <Pressable onPress={() => navigation.goBack()} style={[styles.backButton, { backgroundColor: theme.backButton }]}>
                    <Ionicons name="chevron-back" size={24} color={theme.backButtonText} />
                </Pressable>
                <Pressable
                    ref={playlistMenuButtonRef}
                    onPress={openPlaylistMenu}
                    style={{ padding: 8 }}
                    hitSlop={16}
                >
                    <Ionicons name="ellipsis-horizontal" size={24} color={theme.primaryText} />
                </Pressable>
            </View>

            <ScrollView
                style={styles.fill}
                contentContainerStyle={styles.scrollViewContent}
                showsVerticalScrollIndicator={false}
            >
                {renderContent()}
            </ScrollView>

            {/* Playlist Context Menu */}
            {playlistMenuVisible && (
                <>
                    <Pressable
                        style={styles.transparentBackdrop}
                        onPress={closePlaylistMenu}
                    />
                    <Animated.View
                        style={[
                            styles.trackContextMenu,
                            {
                                backgroundColor: theme.card,
                                borderColor: theme.border,
                                right: 16,
                                top: playlistMenuPosition.y + 10,
                                opacity: playlistMenuAnim,
                                transform: [
                                    {
                                        scale: playlistMenuAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [0.95, 1],
                                        }),
                                    },
                                ],
                            },
                        ]}
                    >
                        <Pressable style={styles.contextMenuItem} onPress={handleEditPlaylist}>
                            <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Edit Playlist</Text>
                            <Ionicons name="pencil-outline" size={20} color={theme.primaryText} />
                        </Pressable>
                        <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
                        <Pressable style={styles.contextMenuItem} onPress={handleDeletePlaylist}>
                            <Text style={[styles.contextMenuText, { color: theme.error }]}>Delete Playlist</Text>
                            <Ionicons name="trash-outline" size={20} color={theme.error} />
                        </Pressable>
                    </Animated.View>
                </>
            )}

            {/* Context Menu */}
            {contextMenuTrack && (
                <>
                    <Pressable
                        style={styles.transparentBackdrop}
                        onPress={closeContextMenu}
                    />
                    <Animated.View
                        style={[
                            styles.trackContextMenu,
                            {
                                backgroundColor: theme.card,
                                borderColor: theme.border,
                                right: 16,
                                top: menuPosition.y - 60,
                                opacity: menuAnim,
                                transform: [
                                    {
                                        scale: menuAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [0.95, 1],
                                        }),
                                    },
                                ],
                            },
                        ]}
                    >
                        <Pressable style={styles.contextMenuItem} onPress={handleAddToQueue}>
                            <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Add to Queue</Text>
                            <Ionicons name="list-outline" size={20} color={theme.primaryText} />
                        </Pressable>
                        <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
                        <Pressable style={styles.contextMenuItem} onPress={() => console.log('Remove from Playlist')}>
                            <Text style={[styles.contextMenuText, { color: theme.error }]}>Remove from Playlist</Text>
                            <Ionicons name="trash-outline" size={20} color={theme.error} />
                        </Pressable>
                    </Animated.View>
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    fill: {
        flex: 1,
    },
    header: {
        paddingTop: 40,
        paddingHorizontal: 16,
        paddingBottom: 8,
        zIndex: 10,
    },
    backButton: {
        padding: 8,
        borderRadius: 20,
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'flex-start',
    },
    scrollViewContent: {
        paddingHorizontal: 16,
        paddingBottom: 120,
    },
    artworkContainer: {
        alignItems: 'center',
        marginTop: 8,
        marginBottom: 20,
    },
    playlistArtwork: {
        width: 280,
        height: 280,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 8,
    },
    playlistInfoSection: {
        alignItems: 'center',
        marginBottom: 24,
    },
    playlistTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 6,
    },
    playlistDescription: {
        fontSize: 14,
        textAlign: 'center',
        marginBottom: 4,
        paddingHorizontal: 20,
    },
    playlistMeta: {
        fontSize: 14,
        opacity: 0.6,
    },
    actionButtonsContainer: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 32,
        paddingHorizontal: 8,
    },
    actionButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderRadius: 15,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    playButton: {
    },
    shuffleButton: {
        borderWidth: 1,
    },
    actionButtonText: {
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
    },
    trackListSection: {
        marginTop: 8,
    },
    trackRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    trackArtwork: {
        width: 48,
        height: 48,
        borderRadius: 4,
        marginRight: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    trackInfo: {
        flex: 1,
        marginRight: 12,
    },
    trackName: {
        fontSize: 16,
        fontWeight: '500',
        marginBottom: 2,
    },
    trackArtist: {
        fontSize: 14,
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 20,
    },
    emptyText: {
        textAlign: 'center',
        marginTop: 16,
        fontSize: 16,
    },
    trackContextMenu: {
        position: 'absolute',
        width: 220,
        borderRadius: 10,
        borderWidth: 1,
        padding: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 6,
        zIndex: 1000,
    },
    contextMenuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
        paddingHorizontal: 16,
    },
    contextMenuText: {
        fontSize: 16,
        fontWeight: '500',
    },
    contextMenuDivider: {
        height: StyleSheet.hairlineWidth,
        marginHorizontal: 8,
    },
    transparentBackdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'transparent',
        zIndex: 999,
    },
});
