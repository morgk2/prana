import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getSpotifyPlaylist } from '../api/lastfm';

export default function ImportSpotifyPlaylist({ route, navigation }) {
  const { theme, addPlaylist, showNotification } = route.params;
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewPlaylist, setPreviewPlaylist] = useState(null);

  const extractPlaylistId = (input) => {
    // Supports formats like:
    // https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=...
    // spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
    let id = null;
    if (input.includes('open.spotify.com/playlist/')) {
      const parts = input.split('playlist/');
      id = parts[1].split('?')[0];
    } else if (input.includes('spotify:playlist:')) {
      id = input.split(':')[2];
    }
    return id;
  };

  const handleImport = async () => {
    const id = extractPlaylistId(url);
    if (!id) {
      Alert.alert('Invalid URL', 'Please enter a valid Spotify playlist URL.');
      return;
    }

    setLoading(true);
    setPreviewPlaylist(null);
    try {
      const playlistData = await getSpotifyPlaylist(id);
      setPreviewPlaylist(playlistData);
    } catch (error) {
      console.error('Import failed', error);
      Alert.alert('Error', 'Failed to import playlist. Please check the URL and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (!previewPlaylist) return;

    const newPlaylist = {
      id: Date.now().toString(), // Simple ID generation
      name: previewPlaylist.name,
      description: previewPlaylist.description,
      image: previewPlaylist.image?.[0]?.['#text'] || null, // Use the largest image
      tracks: previewPlaylist.tracks.map(t => ({
        ...t,
        // Ensure format compatibility if needed
        artist: typeof t.artist === 'object' ? t.artist.name : t.artist
      })),
      createdAt: new Date().toISOString(),
    };

    addPlaylist(newPlaylist);
    if (showNotification) {
        showNotification('Playlist imported successfully!');
    } else {
        Alert.alert('Success', 'Playlist imported successfully!');
    }
    navigation.goBack();
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backButton}>
          <Ionicons name="chevron-back" size={32} color={theme.primaryText} />
        </Pressable>
        <Text style={[styles.title, { color: theme.primaryText }]}>Import Playlist</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.inputContainer, { backgroundColor: theme.card }]}>
          <TextInput
            style={[styles.input, { color: theme.primaryText }]}
            placeholder="Paste Spotify Playlist Link"
            placeholderTextColor={theme.secondaryText}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {url.length > 0 && (
              <Pressable onPress={() => setUrl('')} style={styles.clearButton}>
                  <Ionicons name="close-circle" size={20} color={theme.secondaryText} />
              </Pressable>
          )}
        </View>

        <Pressable
          style={[
            styles.button,
            { backgroundColor: theme.primaryText, opacity: loading || !url ? 0.5 : 1 }
          ]}
          onPress={handleImport}
          disabled={loading || !url}
        >
          {loading ? (
            <ActivityIndicator color={theme.background} />
          ) : (
            <Text style={[styles.buttonText, { color: theme.background }]}>Scan Playlist</Text>
          )}
        </Pressable>

        {previewPlaylist && (
          <View style={styles.previewContainer}>
            <View style={styles.playlistInfo}>
                {previewPlaylist.image?.[0]?.['#text'] ? (
                     <Image source={{ uri: previewPlaylist.image[0]['#text'] }} style={styles.artwork} />
                ) : (
                    <View style={[styles.artwork, { backgroundColor: theme.card, justifyContent: 'center', alignItems: 'center' }]}>
                        <Ionicons name="musical-notes" size={40} color={theme.secondaryText} />
                    </View>
                )}
                <View style={{flex: 1}}>
                    <Text style={[styles.playlistName, { color: theme.primaryText }]}>{previewPlaylist.name}</Text>
                    <Text style={[styles.playlistOwner, { color: theme.secondaryText }]}>
                        by {previewPlaylist.owner} • {previewPlaylist.tracks.length} tracks
                    </Text>
                </View>
            </View>

            <Pressable
              style={[styles.saveButton, { backgroundColor: theme.primaryText }]}
              onPress={handleSave}
            >
              <Text style={[styles.buttonText, { color: theme.background }]}>Import to Library</Text>
            </Pressable>

            <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>Tracks</Text>
            {previewPlaylist.tracks.map((track, index) => (
              <View key={index} style={[styles.trackRow, { borderBottomColor: theme.border }]}>
                <Text style={[styles.trackIndex, { color: theme.secondaryText }]}>{index + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.trackName, { color: theme.primaryText }]} numberOfLines={1}>
                    {track.name}
                  </Text>
                  <Text style={[styles.trackArtist, { color: theme.secondaryText }]} numberOfLines={1}>
                    {typeof track.artist === 'object' ? track.artist.name : track.artist}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
  },
  backButton: {
    marginRight: 12,
    marginLeft: -8,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  content: {
    padding: 16,
    paddingBottom: 100,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 16,
    height: 50,
  },
  input: {
    flex: 1,
    fontSize: 16,
    height: '100%',
  },
  clearButton: {
      padding: 4,
  },
  button: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  previewContainer: {
    marginTop: 8,
  },
  playlistInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 24,
      gap: 16,
  },
  artwork: {
      width: 80,
      height: 80,
      borderRadius: 8,
  },
  playlistName: {
      fontSize: 18,
      fontWeight: '700',
      marginBottom: 4,
  },
  playlistOwner: {
      fontSize: 14,
  },
  saveButton: {
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trackIndex: {
    width: 30,
    fontSize: 14,
  },
  trackName: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 2,
  },
  trackArtist: {
    fontSize: 14,
  },
});
