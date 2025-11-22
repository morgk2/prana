import React from 'react';
import { View, Text, ScrollView, Pressable, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

function pickImageUrl(images, preferredSize = 'large') {
    if (!Array.isArray(images)) return null;
    const preferred = images.find((img) => img.size === preferredSize && img['#text']);
    if (preferred) return preferred['#text'];
    const any = images.find((img) => img['#text']);
    return any ? any['#text'] : null;
}

export default function LibraryArtists({ route, navigation }) {
    const { theme, libraryArtists, openArtistPage } = route.params;

    const renderArtistGridItem = (artist, index) => {
        const imageUrl = pickImageUrl(artist.image, 'large');
        return (
            <Pressable
                key={`artist-${index}`}
                style={styles.gridItem}
                onPress={() => openArtistPage(artist)}
            >
                {imageUrl ? (
                    <Image source={{ uri: imageUrl }} style={[styles.artwork, { borderRadius: 100 }]} />
                ) : (
                    <View style={[styles.artwork, { backgroundColor: theme.card, borderRadius: 100 }]}>
                        <Ionicons name="person" size={60} color={theme.secondaryText} />
                    </View>
                )}
                <Text style={[styles.title, { color: theme.primaryText }]} numberOfLines={1}>
                    {artist.name}
                </Text>
                <Text style={[styles.subtitle, { color: theme.secondaryText }]} numberOfLines={1}>
                    {artist.listeners ? `${Number(artist.listeners).toLocaleString()} listeners` : 'Artist'}
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
                <Text style={[styles.headerTitle, { color: theme.primaryText }]}>Artists</Text>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                {libraryArtists.length > 0 ? (
                    <View style={styles.grid}>
                        {libraryArtists.map((artist, index) => (
                            <View key={`grid-artist-${index}`} style={styles.gridItemContainer}>
                                {renderArtistGridItem(artist, index)}
                            </View>
                        ))}
                    </View>
                ) : (
                    <View style={styles.emptyState}>
                        <Ionicons name="people-outline" size={80} color={theme.secondaryText} style={{ opacity: 0.3 }} />
                        <Text style={[styles.emptyText, { color: theme.secondaryText }]}>No artists in library</Text>
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
        alignItems: 'center',
    },
    artwork: {
        width: '100%',
        aspectRatio: 1,
        marginBottom: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: 4,
    },
    subtitle: {
        fontSize: 14,
        textAlign: 'center',
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
