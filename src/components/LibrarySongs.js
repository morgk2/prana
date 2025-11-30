import React, { useState, useRef, useEffect } from 'react';
import { View, Text, Pressable, Image, StyleSheet, FlatList, Animated, useWindowDimensions, Modal, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useDownload } from '../context/DownloadContext';

import SwipeableTrackRow from './SwipeableTrackRow';
import ExplicitBadge from './ExplicitBadge';

function pickImageUrl(images, preferredSize = 'large') {
    if (!Array.isArray(images)) return null;
    const preferred = images.find((img) => img.size === preferredSize && img['#text']);
    if (preferred) return preferred['#text'];
    const any = images.find((img) => img['#text']);
    return any ? any['#text'] : null;
}

export default function LibrarySongs({ route, navigation }) {
    const { theme, library, onTrackPress, addToQueue, deleteTrack, updateTrack, playlists, addTrackToPlaylist, showNotification, openArtistPage, libraryAlbums } = route.params;
    const { downloadedTracks } = useDownload();
    const { height: screenHeight } = useWindowDimensions();

    // State for Context Menu
    const [contextMenuTrack, setContextMenuTrack] = useState(null);
    const [selectedTrackKey, setSelectedTrackKey] = useState(null);
    const [menuAnim] = useState(new Animated.Value(0));
    const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
    
    // State for Edit Modal
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [editTrackName, setEditTrackName] = useState('');
    const [editTrackArtist, setEditTrackArtist] = useState('');
    const [editTrackAlbum, setEditTrackAlbum] = useState('');

    // State for Playlist Sheet
    const [playlistSheetVisible, setPlaylistSheetVisible] = useState(false);
    const [selectedTrackForPlaylist, setSelectedTrackForPlaylist] = useState(null);
    const [selectedPlaylists, setSelectedPlaylists] = useState(new Set());
    const sheetAnim = useRef(new Animated.Value(0)).current;

    const trackRefs = useRef({});
    const trackScaleAnims = useRef({});

    // Animate sheet
    useEffect(() => {
        if (playlistSheetVisible) {
            Animated.timing(sheetAnim, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true,
            }).start();
        } else {
            Animated.timing(sheetAnim, {
                toValue: 0,
                duration: 250,
                useNativeDriver: true,
            }).start();
        }
    }, [playlistSheetVisible]);

    const openContextMenu = (track, trackKey, isLastItem = false) => {
        const ref = trackRefs.current[trackKey];
        if (ref) {
            // Trigger haptic feedback
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

            ref.measure((x, y, width, height, pageX, pageY) => {
                const MENU_HEIGHT = 320; // Approximate height of the menu (increased for new items)
                const OFFSET = 60; // Overlap offset
                
                // Default position (below with overlap)
                let finalY = pageY + height - OFFSET;
                
                // If menu would go off screen bottom OR it's the last item, show above instead
                if (isLastItem || (finalY + MENU_HEIGHT > screenHeight - 20)) { // 20px buffer
                    finalY = pageY - MENU_HEIGHT + OFFSET;
                }

                setMenuPosition({ x: pageX, y: finalY });
                setContextMenuTrack(track);
                setSelectedTrackKey(trackKey);

                // Animate menu
                Animated.spring(menuAnim, {
                    toValue: 1,
                    useNativeDriver: true,
                    tension: 100,
                    friction: 10,
                }).start();

                // Animate track scale up
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

        // Animate menu out
        Animated.timing(menuAnim, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
        }).start(() => {
            setContextMenuTrack(null);
            setSelectedTrackKey(null);
        });

        // Animate track scale back down
        if (currentTrackKey && trackScaleAnims.current[currentTrackKey]) {
            Animated.spring(trackScaleAnims.current[currentTrackKey], {
                toValue: 1,
                useNativeDriver: true,
                tension: 100,
                friction: 10,
            }).start();
        }
    };

    const handleEditTrack = () => {
        setEditTrackName(contextMenuTrack.name);
        setEditTrackArtist(typeof contextMenuTrack.artist === 'object' ? contextMenuTrack.artist?.name : contextMenuTrack.artist || '');
        setEditTrackAlbum(contextMenuTrack.album || '');
        setEditModalVisible(true);
        closeContextMenu();
    };

    const handleDeleteTrack = async () => {
        if (contextMenuTrack && deleteTrack) {
            await deleteTrack(contextMenuTrack);
            closeContextMenu();
        }
    };

    const handleAddToQueue = () => {
        if (contextMenuTrack && addToQueue) {
            addToQueue(contextMenuTrack);
            closeContextMenu();
        }
    };

    const handleGoToArtist = () => {
        if (!openArtistPage) {
            console.warn('openArtistPage function not available');
            closeContextMenu();
            return;
        }
        if (contextMenuTrack) {
            const artistName = contextMenuTrack.artist?.name || contextMenuTrack.artist || 'Unknown Artist';
            // Create a minimal artist object for navigation
            const artist = {
                name: artistName,
                image: contextMenuTrack.image || []
            };
            openArtistPage(artist);
            closeContextMenu();
        }
    };

    const handleGoToAlbum = () => {
        if (!libraryAlbums || !navigation) {
            console.warn('libraryAlbums or navigation not available');
            closeContextMenu();
            return;
        }
        if (contextMenuTrack) {
            const albumName = contextMenuTrack.album || 'Unknown Album';
            const artistName = contextMenuTrack.artist?.name || contextMenuTrack.artist || 'Unknown Artist';
            
            // Find the album in libraryAlbums
            const album = libraryAlbums.find(a => 
                (a.title || '').toLowerCase().trim() === albumName.toLowerCase().trim() &&
                (a.artist || '').toLowerCase().trim() === artistName.toLowerCase().trim()
            );
            
            if (album) {
                navigation.navigate('LibraryAlbum', {
                    album,
                    theme,
                    onTrackPress,
                    libraryAlbums,
                    library,
                    deleteTrack,
                    updateTrack,
                    addToQueue,
                    playlists,
                    addTrackToPlaylist,
                    showNotification,
                    openArtistPage
                });
                closeContextMenu();
            } else {
                console.warn('Album not found in library');
                closeContextMenu();
            }
        }
    };

    const saveTrackEdit = async () => {
        if (contextMenuTrack && updateTrack && editTrackName.trim()) {
            await updateTrack(contextMenuTrack, {
                name: editTrackName.trim(),
                artist: editTrackArtist.trim(),
                album: editTrackAlbum.trim(),
            });
            setEditModalVisible(false);
            setEditTrackName('');
            setEditTrackArtist('');
            setEditTrackAlbum('');
        }
    };

    // Playlist Sheet Handlers
    const togglePlaylistSelection = (playlistId) => {
        setSelectedPlaylists(prev => {
            const newSet = new Set(prev);
            if (newSet.has(playlistId)) {
                newSet.delete(playlistId);
            } else {
                newSet.add(playlistId);
            }
            return newSet;
        });
    };

    const handleAddToSelectedPlaylists = () => {
        if (selectedTrackForPlaylist && selectedPlaylists.size > 0 && addTrackToPlaylist) {
            selectedPlaylists.forEach(playlistId => {
                addTrackToPlaylist(playlistId, selectedTrackForPlaylist);
            });
            if (showNotification) {
                showNotification(`Added to ${selectedPlaylists.size} playlist${selectedPlaylists.size > 1 ? 's' : ''}`);
            }
        }
        setPlaylistSheetVisible(false);
        setSelectedTrackForPlaylist(null);
        setSelectedPlaylists(new Set());
    };

    const closePlaylistSheet = () => {
        setPlaylistSheetVisible(false);
        setSelectedTrackForPlaylist(null);
        setSelectedPlaylists(new Set());
    };

    const renderSongItem = ({ item, index }) => {
        const imageUrl = pickImageUrl(item.image, 'large');
        const artistName = item.artist?.name || item.artist || 'Unknown Artist';
        const trackKey = `song-${index}`;
        
        // Check if song is available locally
        const isLocal = item.isLocal || 
                       (item.uri && item.uri.startsWith('file://')) || 
                       (downloadedTracks && (downloadedTracks.has(item.id || item.name) || downloadedTracks.has(item.uri)));

        // Initialize scale animation if needed
        if (!trackScaleAnims.current[trackKey]) {
            trackScaleAnims.current[trackKey] = new Animated.Value(1);
        }

        const content = (
            <Pressable
                style={[
                    styles.songItem, 
                    { borderBottomColor: theme.border, backgroundColor: theme.background },
                    !isLocal && { opacity: 0.5 }
                ]}
                onPress={() => onTrackPress(item, [item], 0)}
                // TEMPORARILY DISABLED: Was onTrackPress(item, library, index) to play all songs as queue
            >
                {imageUrl ? (
                    <Image source={{ uri: imageUrl }} style={styles.artwork} />
                ) : (
                    <View style={[styles.artwork, { backgroundColor: theme.card }]}>
                        <Ionicons name="musical-note" size={24} color={theme.secondaryText} />
                    </View>
                )}
                <View style={styles.songInfo}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1, paddingRight: 8 }}>
                        <Text style={[styles.songTitle, { color: theme.primaryText, flexShrink: 1, marginBottom: 0 }]} numberOfLines={1}>
                            {item.name}
                        </Text>
                        {item.explicit && <ExplicitBadge theme={theme} />}
                    </View>
                    <Text style={[styles.songArtist, { color: theme.secondaryText, marginTop: 4 }]} numberOfLines={1}>
                        {artistName}
                    </Text>
                </View>
                {item.favorite && (
                    <Ionicons name="star" size={16} color={theme.primaryText} style={{ marginRight: 4 }} />
                )}
                {isLocal && (
                    <Pressable 
                        style={styles.moreButton} 
                        hitSlop={10}
                        onPress={() => openContextMenu(item, trackKey, index === library.length - 1)}
                    >
                        <Ionicons name="ellipsis-horizontal" size={20} color={theme.secondaryText} />
                    </Pressable>
                )}
            </Pressable>
        );

        return (
            <Animated.View
                ref={(ref) => { if (ref) trackRefs.current[trackKey] = ref; }}
                collapsable={false}
                style={{
                    transform: [{ scale: trackScaleAnims.current[trackKey] }],
                }}
            >
                {isLocal ? (
                    <SwipeableTrackRow
                        theme={theme}
                        onSwipeLeft={() => {
                            if (addToQueue) {
                                addToQueue(item);
                            }
                        }}
                    >
                        {content}
                    </SwipeableTrackRow>
                ) : (
                    content
                )}
            </Animated.View>
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
                                top: menuPosition.y,
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
                        {openArtistPage && (
                            <>
                                <Pressable style={styles.contextMenuItem} onPress={handleGoToArtist}>
                                    <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Go to Artist</Text>
                                    <Ionicons name="person-outline" size={20} color={theme.primaryText} />
                                </Pressable>
                                <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
                            </>
                        )}
                        {libraryAlbums && navigation && (
                            <>
                                <Pressable style={styles.contextMenuItem} onPress={handleGoToAlbum}>
                                    <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Go to Album</Text>
                                    <Ionicons name="albums-outline" size={20} color={theme.primaryText} />
                                </Pressable>
                                <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
                            </>
                        )}
                        <Pressable style={styles.contextMenuItem} onPress={handleAddToQueue}>
                            <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Add to Queue</Text>
                            <Ionicons name="list-outline" size={20} color={theme.primaryText} />
                        </Pressable>
                        <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
                        <Pressable style={styles.contextMenuItem} onPress={() => {
                            const track = contextMenuTrack;
                            setContextMenuTrack(null);
                            setSelectedTrackForPlaylist(track);
                            setSelectedPlaylists(new Set());
                            setPlaylistSheetVisible(true);
                        }}>
                            <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Add to Playlist</Text>
                            <Ionicons name="add-outline" size={20} color={theme.primaryText} />
                        </Pressable>
                        <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
                        <Pressable style={styles.contextMenuItem} onPress={handleEditTrack}>
                            <Text style={[styles.contextMenuText, { color: theme.primaryText }]}>Edit</Text>
                            <Ionicons name="pencil-outline" size={20} color={theme.primaryText} />
                        </Pressable>
                        <View style={[styles.contextMenuDivider, { backgroundColor: theme.border }]} />
                        <Pressable style={styles.contextMenuItem} onPress={handleDeleteTrack}>
                            <Text style={[styles.contextMenuText, { color: theme.error }]}>Delete</Text>
                            <Ionicons name="trash-outline" size={20} color={theme.error} />
                        </Pressable>
                    </Animated.View>
                </>
            )}

            {/* Edit Track Modal */}
            <Modal
                visible={editModalVisible}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setEditModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
                        <Text style={[styles.modalTitle, { color: theme.primaryText }]}>Edit Track</Text>
                        <TextInput
                            style={[
                                styles.modalInput,
                                {
                                    backgroundColor: theme.inputBackground,
                                    borderColor: theme.inputBorder,
                                    color: theme.primaryText,
                                },
                            ]}
                            placeholder="Track name"
                            placeholderTextColor={theme.secondaryText}
                            value={editTrackName}
                            onChangeText={setEditTrackName}
                        />
                        <TextInput
                            style={[
                                styles.modalInput,
                                {
                                    backgroundColor: theme.inputBackground,
                                    borderColor: theme.inputBorder,
                                    color: theme.primaryText,
                                },
                            ]}
                            placeholder="Artist"
                            placeholderTextColor={theme.secondaryText}
                            value={editTrackArtist}
                            onChangeText={setEditTrackArtist}
                        />
                        <TextInput
                            style={[
                                styles.modalInput,
                                {
                                    backgroundColor: theme.inputBackground,
                                    borderColor: theme.inputBorder,
                                    color: theme.primaryText,
                                },
                            ]}
                            placeholder="Album"
                            placeholderTextColor={theme.secondaryText}
                            value={editTrackAlbum}
                            onChangeText={setEditTrackAlbum}
                        />
                        <View style={styles.modalButtons}>
                            <Pressable
                                style={[styles.modalButton, { backgroundColor: theme.inputBackground }]}
                                onPress={() => setEditModalVisible(false)}
                            >
                                <Text style={[styles.modalButtonText, { color: theme.primaryText }]}>Cancel</Text>
                            </Pressable>
                            <Pressable
                                style={[styles.modalButton, { backgroundColor: theme.primaryText }]}
                                onPress={saveTrackEdit}
                            >
                                <Text style={[styles.modalButtonText, { color: theme.background }]}>Save</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Playlist Selection Bottom Sheet */}
            <Modal
                visible={playlistSheetVisible}
                transparent={true}
                animationType="none"
                onRequestClose={closePlaylistSheet}
            >
                <Pressable 
                    style={styles.sheetBackdrop}
                    onPress={closePlaylistSheet}
                >
                    <Animated.View
                        style={[
                            styles.playlistSheet,
                            {
                                backgroundColor: theme.card,
                                transform: [{
                                    translateY: sheetAnim.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [1000, 0],
                                    })
                                }]
                            }
                        ]}
                    >
                        <Pressable style={{ flex: 1 }} onPress={() => {}}>
                            <View style={[styles.sheetHandle, { backgroundColor: theme.secondaryText, opacity: 0.3 }]} />
                            
                            <View style={styles.sheetHeader}>
                                <Pressable onPress={closePlaylistSheet} style={styles.sheetHeaderButton} hitSlop={10}>
                                    <Text style={[styles.sheetHeaderButtonText, { color: theme.accent }]}>Cancel</Text>
                                </Pressable>
                                <Text style={[styles.sheetTitle, { color: theme.primaryText }]}>
                                    Add to Playlist
                                </Text>
                                <Pressable 
                                    onPress={handleAddToSelectedPlaylists} 
                                    disabled={selectedPlaylists.size === 0}
                                    style={[styles.sheetHeaderButton, { opacity: selectedPlaylists.size > 0 ? 1 : 0.3 }]}
                                    hitSlop={10}
                                >
                                    <Text style={[styles.sheetHeaderButtonText, { color: theme.accent, fontWeight: '600' }]}>Done</Text>
                                </Pressable>
                            </View>
                            
                            <ScrollView
                                style={styles.playlistsScrollView}
                                contentContainerStyle={{ paddingBottom: 40 }}
                                showsVerticalScrollIndicator={false}
                            >
                                <Pressable
                                    style={[styles.playlistItem, { borderBottomColor: theme.border }]}
                                    onPress={() => {
                                        closePlaylistSheet();
                                        navigation.navigate('AddPlaylist', {
                                            theme,
                                            showNotification,
                                        });
                                    }}
                                >
                                    <View style={[styles.createPlaylistIcon, { backgroundColor: theme.accent }]}>
                                        <Ionicons name="add" size={24} color={theme.background} />
                                    </View>
                                    <Text style={[styles.createPlaylistText, { color: theme.primaryText }]}>
                                        Create New Playlist
                                    </Text>
                                </Pressable>

                                {playlists && playlists.length > 0 ? (
                                    playlists.map((playlist, index) => {
                                        const isSelected = selectedPlaylists.has(playlist.id);
                                        return (
                                            <Pressable
                                                key={playlist.id || index}
                                                style={[styles.playlistItem, { borderBottomColor: theme.border }]}
                                                onPress={() => togglePlaylistSelection(playlist.id)}
                                            >
                                                <Image
                                                    source={playlist.image ? { uri: playlist.image } : require('../../assets/adaptive-icon.png')}
                                                    style={styles.playlistImage}
                                                />
                                                
                                                <View style={styles.playlistInfo}>
                                                    <Text style={[styles.playlistName, { color: theme.primaryText }]} numberOfLines={1}>
                                                        {playlist.name}
                                                    </Text>
                                                    <Text style={[styles.playlistTrackCount, { color: theme.secondaryText }]}>
                                                        {playlist.tracks ? playlist.tracks.length : 0} tracks
                                                    </Text>
                                                </View>
                                                
                                                {isSelected ? (
                                                    <Ionicons name="checkmark-circle" size={24} color={theme.accent} />
                                                ) : (
                                                    <View style={[styles.circleOutline, { borderColor: theme.secondaryText }]} />
                                                )}
                                            </Pressable>
                                        );
                                    })
                                ) : (
                                    <View style={styles.emptyPlaylists}>
                                        <Text style={[styles.emptyText, { color: theme.secondaryText }]}>
                                            No playlists found
                                        </Text>
                                    </View>
                                )}
                            </ScrollView>
                        </Pressable>
                    </Animated.View>
                </Pressable>
            </Modal>
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
    // Context Menu Styles
    trackContextMenu: {
        position: 'absolute',
        width: 200,
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
    // Modal Styles
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContent: {
        width: '80%',
        borderRadius: 16,
        padding: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: '700',
        marginBottom: 16,
    },
    modalInput: {
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 12,
        fontSize: 16,
    },
    modalButtons: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 8,
    },
    modalButton: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    modalButtonText: {
        fontSize: 16,
        fontWeight: '600',
    },
    // Playlist Sheet Styles
    sheetBackdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        zIndex: 1000,
    },
    playlistSheet: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: '92%',
        height: '92%',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 16,
        zIndex: 1001,
        paddingBottom: 34,
    },
    sheetHandle: {
        width: 36,
        height: 5,
        borderRadius: 3,
        alignSelf: 'center',
        marginTop: 8,
        marginBottom: 8,
    },
    sheetHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(128,128,128,0.2)',
        height: 50,
    },
    sheetHeaderButton: {
        padding: 8,
        minWidth: 60,
    },
    sheetHeaderButtonText: {
        fontSize: 17,
        fontWeight: '400',
    },
    sheetTitle: {
        fontSize: 17,
        fontWeight: '600',
        textAlign: 'center',
        flex: 1,
    },
    playlistsScrollView: {
        flex: 1,
    },
    playlistItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    createPlaylistIcon: {
        width: 48,
        height: 48,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    createPlaylistText: {
        fontSize: 17,
        fontWeight: '500',
    },
    playlistImage: {
        width: 48,
        height: 48,
        borderRadius: 6,
        marginRight: 16,
    },
    playlistInfo: {
        flex: 1,
        marginRight: 12,
    },
    playlistName: {
        fontSize: 17,
        fontWeight: '500',
        marginBottom: 2,
    },
    playlistTrackCount: {
        fontSize: 15,
    },
    circleOutline: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 2,
        opacity: 0.3,
    },
    emptyPlaylists: {
        alignItems: 'center',
        paddingVertical: 60,
    },
});
