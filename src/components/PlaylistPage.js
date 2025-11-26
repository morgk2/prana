import React, { useState, useRef } from 'react';
import {
    StyleSheet,
    Text,
    View,
    Image,
    ScrollView,
    Pressable,
    Animated,
    Alert,
    ActivityIndicator,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import SwipeableTrackRow from './SwipeableTrackRow';
import { getPlayableTrack } from '../utils/tidalStreamHelper';
import { useDownload } from '../context/DownloadContext';

function pickImageUrl(images, preferredSize = 'large') {
    if (!Array.isArray(images)) return null;
    const preferred = images.find((img) => img.size === preferredSize && img['#text']);
    if (preferred) return preferred['#text'];
    const any = images.find((img) => img['#text']);
    return any ? any['#text'] : null;
}

export default function PlaylistPage({ route, navigation }) {
    const { playlist: initialPlaylist, theme = {}, onTrackPress, isPlaying, currentTrack, togglePlay, addToQueue, addAlbumToQueue, deletePlaylist, updatePlaylist, showNotification, library, useTidalForUnowned } = route.params;

    const { playlists } = route.params;

    const playlist = React.useMemo(() => {
        const playlistFromList = playlists?.find(p => p.id === initialPlaylist.id);
        if (!playlistFromList) return initialPlaylist;

        // If timestamps are available, use the most recent one
        if (initialPlaylist.updatedAt && playlistFromList.updatedAt) {
            return new Date(playlistFromList.updatedAt) > new Date(initialPlaylist.updatedAt)
                ? playlistFromList
                : initialPlaylist;
        }

        // If one has a timestamp and the other doesn't, prefer the one with timestamp
        if (initialPlaylist.updatedAt) return initialPlaylist;
        if (playlistFromList.updatedAt) return playlistFromList;

        // Default to the one from the list if no timestamps (preserves existing behavior)
        return playlistFromList;
    }, [initialPlaylist, playlists]);

    const { startAlbumDownload, albumDownloads, downloadedTracks, activeDownloads, handleDownloadTrack, recentDownloads } = useDownload();

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

    const handleUnownedTrackPress = async (track, index, shouldQueuePlaylist) => {
        if (!useTidalForUnowned) {
            console.log('[PlaylistPage] Tidal streaming is disabled');
            return;
        }

        try {
            console.log('[PlaylistPage] Attempting to stream unowned track:', track.name);

            const enrichedTrack = {
                ...playlist.tracks[index],
                isFetching: true,
                artist: track.artist?.name || track.artist, // Ensure string artist
                album: playlist.name,
                image: track.image ? track.image : (playlist.image ? [{ '#text': playlist.image, size: 'extralarge' }] : [])
            };

            const queue = shouldQueuePlaylist ? playlist.tracks.map(t => ({
                ...t,
                artist: t.artist?.name || t.artist,
                album: playlist.name,
                image: t.image ? t.image : (playlist.image ? [{ '#text': playlist.image, size: 'extralarge' }] : [])
            })) : [enrichedTrack];
            
            const qIndex = shouldQueuePlaylist ? index : 0;

            if (onTrackPress) {
                onTrackPress(enrichedTrack, queue, qIndex);
            }

            const playableTrack = await getPlayableTrack(enrichedTrack, useTidalForUnowned);

            if (playableTrack && (playableTrack.uri || playableTrack.tidalId) && onTrackPress) {
                const updatedQueue = shouldQueuePlaylist ? queue : [playableTrack];
                onTrackPress(playableTrack, updatedQueue, qIndex);
            } else {
                console.warn('[PlaylistPage] Could not find stream for track:', track.name);
            }
        } catch (error) {
            console.error('[PlaylistPage] Error streaming track:', error);
        }
    };

    const confirmAndPlayTrack = (track, index, isLocal) => {
        // TEMPORARILY DISABLED: Always play single track only (no queue prompt)
        if (isLocal) {
            if (onTrackPress) onTrackPress(track, [track], 0);
        } else {
            handleUnownedTrackPress(track, index, false);
        }
        
        /* ORIGINAL CODE - RE-ENABLE LATER
        Alert.alert(
            "Play Track",
            "Add the rest of the playlist to the queue?",
            [
                {
                    text: "No",
                    onPress: () => {
                        if (isLocal) {
                            if (onTrackPress) onTrackPress(track, [track], 0);
                        } else {
                            handleUnownedTrackPress(track, index, false);
                        }
                    }
                },
                {
                    text: "Yes",
                    onPress: () => {
                        if (isLocal) {
                            if (addAlbumToQueue) {
                                // Add clicked track + all tracks after it (not before)
                                const tracksToAdd = playlist.tracks.slice(index);
                                addAlbumToQueue(tracksToAdd, true);
                            } else if (onTrackPress) {
                                onTrackPress(track, playlist.tracks, index);
                            }
                        } else {
                            if (addAlbumToQueue) {
                                // Add clicked track + all tracks after it (not before)
                                const tracksToAdd = playlist.tracks.slice(index);
                                addAlbumToQueue(tracksToAdd, true);
                            } else {
                                handleUnownedTrackPress(track, index, true);
                            }
                        }
                    }
                },
                {
                    text: "Cancel",
                    style: "cancel"
                }
            ]
        );
        */
    };

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

    const handleDownloadPlaylist = async () => {
        if (!useTidalForUnowned) return;
        closePlaylistMenu();

        const tracksToDownload = playlist.tracks.filter(t => {
            // Check if we have a local file URI
            return !t.uri || !t.uri.startsWith('file://');
        });

        if (tracksToDownload.length === 0) {
            alert('All tracks are already downloaded');
            return;
        }

        startAlbumDownload(playlist.id, tracksToDownload);
    };

    const renderProgressCircle = () => {
        const progressData = albumDownloads[playlist.id];
        const progress = progressData ? progressData.progress : 0;

        const size = 24;
        const strokeWidth = 3;
        const center = size / 2;
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const strokeDashoffset = circumference - (progress * circumference);

        return (
            <View style={{ width: size + 16, height: size + 16, justifyContent: 'center', alignItems: 'center' }}>
                <Svg width={size} height={size}>
                    <Circle
                        stroke={theme.secondaryText}
                        cx={center}
                        cy={center}
                        r={radius}
                        strokeWidth={strokeWidth}
                        opacity={0.3}
                    />
                    <Circle
                        stroke={theme.primaryText}
                        cx={center}
                        cy={center}
                        r={radius}
                        strokeWidth={strokeWidth}
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                        rotation="-90"
                        origin={`${center}, ${center}`}
                    />
                </Svg>
            </View>
        );
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
                        ) : playlist?.isDefault ? (
                            <View style={[styles.playlistArtwork, { backgroundColor: theme.primary }]}>
                                <Ionicons name="star" size={100} color="#000000" />
                            </View>
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
                    ) : playlist?.isDefault ? (
                        <View style={[styles.playlistArtwork, { backgroundColor: theme.primary }]}>
                            <Ionicons name="star" size={100} color="#000000" />
                        </View>
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

                        const libraryTrack = library?.find(t =>
                            (t.uri && track.uri && t.uri === track.uri) ||
                            (t.name === track.name && (t.artist?.name || t.artist) === (track.artist?.name || track.artist))
                        );
                        
                        const isDownloaded = downloadedTracks.has(track.id) || downloadedTracks.has(track.name) || (track.uri && downloadedTracks.has(track.uri));
                        const recentUri = recentDownloads ? (recentDownloads[track.id] || recentDownloads[track.name]) : null;
                        
                        // Determine if track is local (either in library with file URI, or downloaded)
                        const isLocal = (!!libraryTrack && libraryTrack.uri && libraryTrack.uri.startsWith('file://')) || isDownloaded || !!recentUri || (track.uri && track.uri.startsWith('file://'));

                        return (
                            <Animated.View
                                key={`playlist-track-${index}`}
                                ref={(ref) => { if (ref) trackRefs.current[trackKey] = ref; }}
                                collapsable={false}
                                style={{
                                    transform: [{ scale: trackScaleAnims.current[trackKey] }],
                                    opacity: isLocal ? 1 : (useTidalForUnowned ? 0.7 : 0.5)
                                }}
                            >
                                {isLocal ? (
                                    <SwipeableTrackRow
                                        theme={theme}
                                        onSwipeLeft={() => {
                                            if (addToQueue) {
                                                addToQueue(track);
                                            }
                                        }}
                                    >
                                        <Pressable
                                            onPress={() => confirmAndPlayTrack(track, index, true)}
                                            onLongPress={() => openContextMenu(track, trackKey)}
                                            style={[
                                                styles.trackRow,
                                                {
                                                    borderBottomColor: theme.border,
                                                    backgroundColor: theme.background,
                                                }
                                            ]}
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

                                            {libraryTrack?.favorite ? (
                                                <Ionicons name="star" size={16} color={theme.primaryText} style={{ marginRight: 8 }} />
                                            ) : null}

                                            <Pressable onPress={() => openContextMenu(track, trackKey)} hitSlop={10}>
                                                <Ionicons name="ellipsis-horizontal" size={20} color={theme.secondaryText} />
                                            </Pressable>
                                        </Pressable>
                                    </SwipeableTrackRow>
                                ) : (
                                    <Pressable
                                        onPress={() => confirmAndPlayTrack(track, index, false)}
                                        onLongPress={() => useTidalForUnowned && openContextMenu(track, trackKey)}
                                        style={[
                                            styles.trackRow,
                                            {
                                                borderBottomColor: theme.border,
                                                backgroundColor: theme.background
                                            }
                                        ]}
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

                                        {useTidalForUnowned && (
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                                {activeDownloads[track.id || track.name] !== undefined ? (
                                                    <View style={{ width: 40, height: 40, justifyContent: 'center', alignItems: 'center' }}>
                                                        <ActivityIndicator size="small" color={theme.accent || theme.primaryText} />
                                                    </View>
                                                ) : (
                                                    <Pressable
                                                        onPress={() => handleDownloadTrack(track)}
                                                        style={({ pressed }) => ({
                                                            opacity: pressed ? 0.5 : 1,
                                                            padding: 10,
                                                            margin: -10,
                                                        })}
                                                        hitSlop={16}
                                                    >
                                                        <Ionicons name="download-outline" size={22} color={theme.secondaryText} />
                                                    </Pressable>
                                                )}
                                            </View>
                                        )}
                                    </Pressable>
                                )}
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
                {albumDownloads[playlist.id]?.isDownloading ? (
                    renderProgressCircle()
                ) : (
                    <Pressable
                        ref={playlistMenuButtonRef}
                        onPress={openPlaylistMenu}
                        style={{ padding: 8 }}
                        hitSlop={16}
                    >
                        <Ionicons name="ellipsis-horizontal" size={24} color={theme.primaryText} />
                    </Pressable>
                )}
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
                        {!playlist.isDefault && (
                            <>
                                <Pressable style={styles.contextMenuItem} onPress={handleEditPlaylist}>
                                    <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Edit Playlist</Text>
                                    <Ionicons name="pencil-outline" size={20} color={theme.primaryText} />
                                </Pressable>
                                <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
                                {useTidalForUnowned && (
                                    <>
                                        <Pressable style={styles.contextMenuItem} onPress={handleDownloadPlaylist}>
                                            <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Make available offline</Text>
                                            <Ionicons name="download-outline" size={20} color={theme.primaryText} />
                                        </Pressable>
                                        <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
                                    </>
                                )}
                                <Pressable style={styles.contextMenuItem} onPress={handleDeletePlaylist}>
                                    <Text style={[styles.contextMenuText, { color: theme.error }]}>Delete Playlist</Text>
                                    <Ionicons name="trash-outline" size={20} color={theme.error} />
                                </Pressable>
                            </>
                        )}
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
        paddingBottom: 180,
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
