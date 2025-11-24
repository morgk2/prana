import React, { useState, useRef } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert, Image, Animated, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSpotifyPlaylist, getUserPlaylists } from '../api/lastfm';

if (Platform.OS === 'android') {
  if (UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
}

export default function ImportExternalPlaylist({ route, navigation }) {
  const { theme, addPlaylist, showNotification } = route.params;
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewPlaylist, setPreviewPlaylist] = useState(null);
  const [userPlaylists, setUserPlaylists] = useState(null);
  const [expandedPlaylistId, setExpandedPlaylistId] = useState(null);
  const [loadingPlaylistId, setLoadingPlaylistId] = useState(null);
  const playlistDetailsCache = useRef({});

  const extractSpotifyId = (input) => {
    if (input.includes('open.spotify.com/user/')) {
      const parts = input.split('user/');
      const id = parts[1].split('?')[0];
      return { type: 'user', id };
    }
    if (input.includes('spotify:user:')) {
      return { type: 'user', id: input.split(':')[2] };
    }
    if (input.includes('open.spotify.com/playlist/')) {
      const parts = input.split('playlist/');
      const id = parts[1].split('?')[0];
      return { type: 'playlist', id };
    }
    if (input.includes('spotify:playlist:')) {
      return { type: 'playlist', id: input.split(':')[2] };
    }
    return null;
  };

  const handleScan = async () => {
    const result = extractSpotifyId(url);
    if (!result) {
      Alert.alert('Invalid URL', 'Please enter a valid Spotify playlist or user profile URL.');
      return;
    }

    setLoading(true);
    setPreviewPlaylist(null);
    setUserPlaylists(null);
    setExpandedPlaylistId(null);

    try {
      if (result.type === 'user') {
        const playlists = await getUserPlaylists(result.id);
        setUserPlaylists(playlists);
      } else {
        const playlistData = await getSpotifyPlaylist(result.id);
        setPreviewPlaylist(playlistData);
      }
    } catch (error) {
      console.error('Scan failed', error);
      Alert.alert('Error', 'Failed to scan. Please check the URL and try again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpandPlaylist = async (playlist) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

    if (expandedPlaylistId === playlist.id) {
      setExpandedPlaylistId(null);
      return;
    }

    if (!playlistDetailsCache.current[playlist.id]) {
      setLoadingPlaylistId(playlist.id);
      try {
        const fullPlaylist = await getSpotifyPlaylist(playlist.id);
        playlistDetailsCache.current[playlist.id] = fullPlaylist;
        setExpandedPlaylistId(playlist.id);
      } catch (error) {
        console.error('Failed to fetch playlist details', error);
        Alert.alert('Error', 'Failed to load playlist tracks.');
      } finally {
        setLoadingPlaylistId(null);
      }
    } else {
      setExpandedPlaylistId(playlist.id);
    }
  };

  const handleImportPlaylist = (playlistData) => {
    if (!playlistData) return;

    const newPlaylist = {
      id: Date.now().toString() + Math.floor(Math.random() * 1000),
      name: playlistData.name,
      description: playlistData.description,
      image: playlistData.image?.[0]?.['#text'] || null,
      tracks: playlistData.tracks.map(t => ({
        ...t,
        artist: typeof t.artist === 'object' ? t.artist.name : t.artist
      })),
      createdAt: new Date().toISOString(),
    };

    addPlaylist(newPlaylist);
    
    if (showNotification) {
      showNotification(`Imported "${playlistData.name}"`);
    } else {
      Alert.alert('Success', `Imported "${playlistData.name}"`);
    }

    if (previewPlaylist) {
      navigation.goBack();
    }
  };

  const renderPlaylistCard = (playlist, isUserList = false) => {
    const isExpanded = expandedPlaylistId === playlist.id;
    const isLoadingDetails = loadingPlaylistId === playlist.id;
    
    const fullDetails = isUserList && isExpanded ? playlistDetailsCache.current[playlist.id] : playlist;
    const displayTracks = fullDetails?.tracks || [];

    return (
      <View key={playlist.id} style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={styles.cardHeader}>
          {playlist.image?.[0]?.['#text'] ? (
            <Image source={{ uri: playlist.image[0]['#text'] }} style={styles.artwork} />
          ) : (
            <View style={[styles.artwork, { backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center' }]}>
              <Ionicons name="musical-notes" size={30} color={theme.secondaryText} />
            </View>
          )}
          
          <View style={{ flex: 1 }}>
            <Text style={[styles.playlistName, { color: theme.primaryText }]} numberOfLines={1}>{playlist.name}</Text>
            <Text style={[styles.playlistOwner, { color: theme.secondaryText }]} numberOfLines={1}>
              by {playlist.owner} • {isUserList ? `${playlist.trackCount} tracks` : `${playlist.tracks?.length} tracks`}
            </Text>
          </View>

          {isUserList && (
            <Pressable
              style={styles.expandButton}
              onPress={() => toggleExpandPlaylist(playlist)}
              hitSlop={10}
            >
              {isLoadingDetails ? (
                <ActivityIndicator size="small" color={theme.primaryText} />
              ) : (
                <Ionicons 
                  name={isExpanded ? "chevron-up-circle" : "chevron-down-circle-outline"} 
                  size={28} 
                  color={theme.primaryText} 
                />
              )}
            </Pressable>
          )}
        </View>

        {(isExpanded || !isUserList) && (
          <View style={styles.tracksContainer}>
             {!isUserList && <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>Tracks</Text>}
             
             {displayTracks.length > 0 ? (
                displayTracks.map((track, index) => (
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
                ))
             ) : (
                <Text style={{ color: theme.secondaryText, padding: 8 }}>No tracks found</Text>
             )}
          </View>
        )}
        
        <Pressable
          style={[styles.importButton, { backgroundColor: theme.primaryText }]}
          onPress={() => {
            if (isUserList) {
               if (playlistDetailsCache.current[playlist.id]) {
                 handleImportPlaylist(playlistDetailsCache.current[playlist.id]);
               } else {
                 setLoadingPlaylistId(playlist.id);
                 getSpotifyPlaylist(playlist.id).then(full => {
                   playlistDetailsCache.current[playlist.id] = full;
                   handleImportPlaylist(full);
                 }).catch(err => {
                   Alert.alert('Error', 'Failed to fetch playlist details for import.');
                 }).finally(() => setLoadingPlaylistId(null));
               }
            } else {
              handleImportPlaylist(playlist);
            }
          }}
        >
          <Text style={[styles.buttonText, { color: theme.background }]}>Import Playlist</Text>
        </Pressable>

      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backButton}>
          <Ionicons name="chevron-back" size={32} color={theme.primaryText} />
        </Pressable>
        <Text style={[styles.title, { color: theme.primaryText }]}>Import External</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(130, insets.bottom + 100) }]}>
        <View style={[styles.inputContainer, { backgroundColor: theme.card }]}>
          <TextInput
            style={[styles.input, { color: theme.primaryText }]}
            placeholder="Spotify Playlist or Profile Link"
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
          onPress={handleScan}
          disabled={loading || !url}
        >
          {loading ? (
            <ActivityIndicator color={theme.background} />
          ) : (
            <Text style={[styles.buttonText, { color: theme.background }]}>Scan</Text>
          )}
        </Pressable>

        {previewPlaylist && (
          <View style={styles.resultContainer}>
            {renderPlaylistCard(previewPlaylist, false)}
          </View>
        )}

        {userPlaylists && (
          <View style={styles.resultContainer}>
            <Text style={[styles.sectionHeader, { color: theme.primaryText }]}>
              Found {userPlaylists.length} Playlists
            </Text>
            {userPlaylists.map(playlist => renderPlaylistCard(playlist, true))}
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
  resultContainer: {
    gap: 16,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  artwork: {
    width: 60,
    height: 60,
    borderRadius: 6,
  },
  playlistName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  playlistOwner: {
    fontSize: 14,
  },
  expandButton: {
    padding: 4,
  },
  tracksContainer: {
    marginTop: 16,
    marginBottom: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#88888840',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trackIndex: {
    width: 30,
    fontSize: 12,
  },
  trackName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  trackArtist: {
    fontSize: 12,
  },
  importButton: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
