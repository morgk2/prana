import React, { useState, useMemo, useRef, useEffect } from 'react';
import { View, Text, TextInput, Pressable, Image, StyleSheet, ScrollView, Modal, FlatList, Animated, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

function pickImageUrl(images, preferredSize = 'large') {
    if (!Array.isArray(images)) return null;
    const preferred = images.find((img) => img.size === preferredSize && img['#text']);
    if (preferred) return preferred['#text'];
    const any = images.find((img) => img['#text']);
    return any ? any['#text'] : null;
}

const ROW_HEIGHT = 72; // Bigger row height for better touch target and artwork

export default function AddPlaylist({ route, navigation }) {
    const { theme, library, addPlaylist, updatePlaylist, showNotification, playlistToEdit } = route.params;
    const insets = useSafeAreaInsets();

    const [name, setName] = useState(playlistToEdit?.name || '');
    const [description, setDescription] = useState(playlistToEdit?.description || '');
    const [image, setImage] = useState(playlistToEdit?.image || null);
    const [selectedTracks, setSelectedTracks] = useState(playlistToEdit?.tracks || []);
    const [isMusicSheetVisible, setIsMusicSheetVisible] = useState(false);

    // Drag and Drop State
    const [draggedIndex, setDraggedIndex] = useState(null);
    const [draggedOverIndex, setDraggedOverIndex] = useState(null);
    const dragY = useRef(new Animated.Value(0)).current;
    const itemOffsets = useRef({}).current;

    // Refs for PanResponder
    const selectedTracksRef = useRef(selectedTracks);
    const draggedIndexRef = useRef(null);
    const draggedOverIndexRef = useRef(null);

    useEffect(() => {
        selectedTracksRef.current = selectedTracks;
    }, [selectedTracks]);

    useEffect(() => {
        draggedIndexRef.current = draggedIndex;
    }, [draggedIndex]);

    useEffect(() => {
        draggedOverIndexRef.current = draggedOverIndex;
    }, [draggedOverIndex]);

    // Animate items when draggedOverIndex changes
    useEffect(() => {
        if (draggedIndex === null) {
            Object.keys(itemOffsets).forEach((key) => {
                Animated.spring(itemOffsets[key], {
                    toValue: 0,
                    useNativeDriver: false,
                    tension: 300,
                    friction: 25,
                }).start();
            });
            return;
        }

        selectedTracks.forEach((track, index) => {
            if (index === draggedIndex) return;

            const trackKey = track.uri || track.mbid || track.name || `track-${index}`;
            if (!itemOffsets[trackKey]) {
                itemOffsets[trackKey] = new Animated.Value(0);
            }

            let targetOffset = 0;
            if (draggedIndex < draggedOverIndex) {
                if (index > draggedIndex && index <= draggedOverIndex) {
                    targetOffset = -ROW_HEIGHT;
                }
            } else if (draggedIndex > draggedOverIndex) {
                if (index >= draggedOverIndex && index < draggedIndex) {
                    targetOffset = ROW_HEIGHT;
                }
            }

            Animated.spring(itemOffsets[trackKey], {
                toValue: targetOffset,
                useNativeDriver: false,
                tension: 300,
                friction: 25,
            }).start();
        });
    }, [draggedIndex, draggedOverIndex, selectedTracks, itemOffsets]);

    const handleReorder = (fromIndex, toIndex) => {
        if (fromIndex === toIndex) return;

        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        const newTracks = [...selectedTracksRef.current];
        const [removed] = newTracks.splice(fromIndex, 1);
        newTracks.splice(toIndex, 0, removed);

        setSelectedTracks(newTracks);
    };

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => false,
            onMoveShouldSetPanResponder: () => draggedIndexRef.current !== null,
            onPanResponderMove: (_evt, gestureState) => {
                const currentDraggedIndex = draggedIndexRef.current;
                if (currentDraggedIndex === null) return;
                const { dy } = gestureState;
                dragY.setValue(dy);

                const offset = Math.round(dy / ROW_HEIGHT);
                let newIndex = currentDraggedIndex + offset;
                if (newIndex < 0) newIndex = 0;
                const maxIndex = selectedTracksRef.current.length - 1;
                if (newIndex > maxIndex) newIndex = maxIndex;

                if (newIndex !== draggedOverIndexRef.current) {
                    setDraggedOverIndex(newIndex);
                    draggedOverIndexRef.current = newIndex;
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
            },
            onPanResponderRelease: () => {
                const from = draggedIndexRef.current;
                const to = draggedOverIndexRef.current;
                if (from !== null && to !== null && from !== to) {
                    handleReorder(from, to);
                }

                Object.keys(itemOffsets).forEach((key) => {
                    delete itemOffsets[key];
                });

                setDraggedIndex(null);
                setDraggedOverIndex(null);
                draggedIndexRef.current = null;
                draggedOverIndexRef.current = null;
            },
            onPanResponderTerminate: () => {
                Object.keys(itemOffsets).forEach((key) => {
                    delete itemOffsets[key];
                });
                dragY.setValue(0);
                setDraggedIndex(null);
                setDraggedOverIndex(null);
                draggedIndexRef.current = null;
            },
        })
    ).current;

    const startDrag = (index) => {
        setDraggedIndex(index);
        setDraggedOverIndex(index);
        draggedIndexRef.current = index;
        draggedOverIndexRef.current = index;
        dragY.setValue(0);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    };

    const pickImage = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 1,
        });

        if (!result.canceled) {
            setImage(result.assets[0].uri);
        }
    };

    const handleAddTrack = (track) => {
        if (selectedTracks.find(t => t.uri === track.uri)) {
            setSelectedTracks(prev => prev.filter(t => t.uri !== track.uri));
        } else {
            setSelectedTracks(prev => [...prev, track]);
        }
    };

    const handleSave = () => {
        if (!name.trim()) {
            alert('Please enter a playlist name');
            return;
        }

        const playlistData = {
            id: playlistToEdit?.id || Date.now().toString(),
            name,
            description,
            image,
            tracks: selectedTracks,
            createdAt: playlistToEdit?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        if (playlistToEdit && updatePlaylist) {
            updatePlaylist(playlistData);
            if (showNotification) {
                showNotification(`Playlist "${name}" updated`);
            }
        } else if (addPlaylist) {
            addPlaylist(playlistData);
            if (showNotification) {
                showNotification(`Playlist "${name}" created`);
            }
        }
        navigation.goBack();
    };

    const renderSelectedTrackItem = (track, index) => {
        const isDragging = draggedIndex === index;
        const imageUrl = pickImageUrl(track.image, 'large');
        const trackKey = track.uri || track.mbid || track.name || `track-${index}`;

        if (!itemOffsets[trackKey]) {
            itemOffsets[trackKey] = new Animated.Value(0);
        }

        return (
            <View key={`selected-track-${index}-${trackKey}`} style={{ zIndex: isDragging ? 100 : 1 }}>
                <Animated.View
                    {...panResponder.panHandlers}
                    style={{
                        transform: [
                            { translateY: isDragging ? dragY : itemOffsets[trackKey] },
                            { scale: isDragging ? 1.02 : 1 },
                        ],
                        opacity: isDragging ? 0.9 : 1,
                        backgroundColor: isDragging ? theme.card : 'transparent',
                        borderRadius: isDragging ? 12 : 0,
                    }}
                >
                    <Pressable
                        style={[styles.selectedTrackItem, { borderBottomColor: theme.border }]}
                        onLongPress={() => startDrag(index)}
                        delayLongPress={200}
                    >
                        {/* Delete Button (Left) */}
                        <Pressable
                            onPress={() => handleAddTrack(track)}
                            hitSlop={10}
                            style={styles.deleteButton}
                        >
                            <Ionicons name="remove-circle" size={24} color={theme.error} />
                        </Pressable>

                        {/* Artwork */}
                        {imageUrl ? (
                            <Image source={{ uri: imageUrl }} style={styles.selectedTrackArtwork} />
                        ) : (
                            <View style={[styles.selectedTrackArtwork, { backgroundColor: theme.card }]}>
                                <Ionicons name="musical-note" size={24} color={theme.secondaryText} />
                            </View>
                        )}

                        {/* Info */}
                        <View style={styles.selectedTrackInfo}>
                            <Text style={[styles.selectedTrackTitle, { color: theme.primaryText }]} numberOfLines={1}>
                                {track.name}
                            </Text>
                            <Text style={[styles.selectedTrackArtist, { color: theme.secondaryText }]} numberOfLines={1}>
                                {track.artist?.name || track.artist}
                            </Text>
                        </View>

                        {/* Drag Handle */}
                        <View style={styles.dragHandle}>
                            <Ionicons name="reorder-three" size={24} color={theme.secondaryText} />
                        </View>
                    </Pressable>
                </Animated.View>
            </View>
        );
    };

    const renderTrackItem = ({ item }) => {
        const isSelected = selectedTracks.some(t => t.uri === item.uri);
        const imageUrl = pickImageUrl(item.image, 'large');
        const artistName = item.artist?.name || item.artist || 'Unknown Artist';

        return (
            <Pressable
                style={[styles.trackItem, { borderBottomColor: theme.border }]}
                onPress={() => handleAddTrack(item)}
            >
                <View style={styles.checkContainer}>
                    <Ionicons
                        name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                        size={24}
                        color={isSelected ? theme.primaryText : theme.secondaryText}
                    />
                </View>
                {imageUrl ? (
                    <Image source={{ uri: imageUrl }} style={styles.trackArtwork} />
                ) : (
                    <View style={[styles.trackArtwork, { backgroundColor: theme.card }]}>
                        <Ionicons name="musical-note" size={20} color={theme.secondaryText} />
                    </View>
                )}
                <View style={styles.trackInfo}>
                    <Text style={[styles.trackTitle, { color: theme.primaryText }]} numberOfLines={1}>
                        {item.name}
                    </Text>
                    <Text style={[styles.trackArtist, { color: theme.secondaryText }]} numberOfLines={1}>
                        {artistName}
                    </Text>
                </View>
            </Pressable>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top }]}>
            {/* Header */}
            <View style={styles.header}>
                <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
                    <Text style={[styles.cancelText, { color: theme.primaryText }]}>Cancel</Text>
                </Pressable>
                <Text style={[styles.headerTitle, { color: theme.primaryText }]}>
                    {playlistToEdit ? 'Edit Playlist' : 'New Playlist'}
                </Text>
                <Pressable onPress={handleSave} hitSlop={10} disabled={!name.trim()}>
                    <Text style={[styles.doneText, { color: name.trim() ? theme.primaryText : theme.secondaryText }]}>Done</Text>
                </Pressable>
            </View>

            <ScrollView
                style={styles.content}
                scrollEnabled={draggedIndex === null}
            >
                <View style={styles.imageContainer}>
                    <Pressable onPress={pickImage} style={[styles.imagePlaceholder, { backgroundColor: theme.card }]}>
                        {image ? (
                            <Image source={{ uri: image }} style={styles.playlistImage} />
                        ) : (
                            <Ionicons name="camera-outline" size={40} color={theme.secondaryText} />
                        )}
                    </Pressable>
                </View>

                <View style={[styles.inputContainer, { backgroundColor: theme.card }]}>
                    <TextInput
                        style={[styles.input, { color: theme.primaryText, borderBottomColor: theme.border }]}
                        placeholder="Playlist Name"
                        placeholderTextColor={theme.secondaryText}
                        value={name}
                        onChangeText={setName}
                    />
                    <TextInput
                        style={[styles.input, { color: theme.primaryText, borderBottomWidth: 0 }]}
                        placeholder="Description"
                        placeholderTextColor={theme.secondaryText}
                        value={description}
                        onChangeText={setDescription}
                    />
                </View>

                <Pressable
                    style={[styles.addMusicButton, { backgroundColor: theme.card }]}
                    onPress={() => setIsMusicSheetVisible(true)}
                >
                    <Ionicons name="add-circle-outline" size={24} color={theme.primaryText} />
                    <Text style={[styles.addMusicText, { color: theme.primaryText }]}>Add Music</Text>
                </Pressable>

                {selectedTracks.length > 0 && (
                    <View style={styles.selectedTracksContainer}>
                        <Text style={[styles.sectionTitle, { color: theme.secondaryText }]}>
                            {selectedTracks.length} Songs Added
                        </Text>
                        {selectedTracks.map((track, index) => renderSelectedTrackItem(track, index))}
                    </View>
                )}
            </ScrollView>

            {/* Add Music Sheet */}
            <Modal
                visible={isMusicSheetVisible}
                animationType="slide"
                presentationStyle="pageSheet"
                onRequestClose={() => setIsMusicSheetVisible(false)}
            >
                <View style={[styles.sheetContainer, { backgroundColor: theme.background }]}>
                    <View style={styles.sheetHeader}>
                        <Text style={[styles.sheetTitle, { color: theme.primaryText }]}>Add Music</Text>
                        <Pressable onPress={() => setIsMusicSheetVisible(false)}>
                            <Text style={[styles.doneText, { color: theme.primaryText }]}>Done</Text>
                        </Pressable>
                    </View>
                    <FlatList
                        data={library}
                        renderItem={renderTrackItem}
                        keyExtractor={(item, index) => item.uri || `sheet-track-${index}`}
                        contentContainerStyle={styles.sheetList}
                    />
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingTop: 20,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '600',
    },
    cancelText: {
        fontSize: 17,
    },
    doneText: {
        fontSize: 17,
        fontWeight: '600',
    },
    content: {
        flex: 1,
    },
    imageContainer: {
        alignItems: 'center',
        marginVertical: 24,
    },
    imagePlaceholder: {
        width: 200,
        height: 200,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    playlistImage: {
        width: '100%',
        height: '100%',
    },
    inputContainer: {
        marginHorizontal: 16,
        borderRadius: 12,
        paddingLeft: 16,
    },
    input: {
        paddingVertical: 16,
        fontSize: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    addMusicButton: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 24,
        marginHorizontal: 16,
        padding: 16,
        borderRadius: 12,
        gap: 12,
    },
    addMusicText: {
        fontSize: 16,
        fontWeight: '500',
    },
    selectedTracksContainer: {
        marginTop: 24,
        paddingHorizontal: 16,
        paddingBottom: 40,
    },
    sectionTitle: {
        fontSize: 14,
        marginBottom: 8,
        textTransform: 'uppercase',
    },
    selectedTrackItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        height: ROW_HEIGHT,
    },
    deleteButton: {
        marginRight: 12,
    },
    selectedTrackArtwork: {
        width: 50,
        height: 50,
        borderRadius: 4,
        marginRight: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    selectedTrackInfo: {
        flex: 1,
        justifyContent: 'center',
    },
    selectedTrackTitle: {
        fontSize: 16,
        fontWeight: '500',
        marginBottom: 2,
    },
    selectedTrackArtist: {
        fontSize: 14,
    },
    dragHandle: {
        padding: 8,
    },
    sheetContainer: {
        flex: 1,
    },
    sheetHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#ccc',
    },
    sheetTitle: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    sheetList: {
        paddingBottom: 40,
    },
    trackItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    checkContainer: {
        marginRight: 12,
    },
    trackArtwork: {
        width: 40,
        height: 40,
        borderRadius: 4,
        marginRight: 12,
    },
    trackInfo: {
        flex: 1,
    },
    trackTitle: {
        fontSize: 16,
        fontWeight: '500',
    },
    trackArtist: {
        fontSize: 14,
    },
});
