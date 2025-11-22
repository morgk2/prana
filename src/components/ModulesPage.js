import React, { useState } from 'react';
import { View, Text, TextInput, FlatList, Pressable, Image, ActivityIndicator, StyleSheet, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { searchTracks, getTrackStreamUrl } from '../services/tidalApi';
import { getArtworkWithFallback } from '../utils/artworkFallback';

export default function ModulesPage({ route, navigation }) {
  const { theme, openTrackPlayer, useTidalForUnowned, toggleTidalForUnowned } = route.params;
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [artworkCache, setArtworkCache] = useState({});

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setLoading(true);
    setError(null);
    setArtworkCache({}); // Clear cache on new search
    
    try {
      const response = await searchTracks(searchQuery);
      const tracks = response.tracks || [];
      setSearchResults(tracks);
      
      // Preload artwork for tracks without Tidal covers (in background)
      tracks.forEach(track => {
        if (!track.albumCover) {
          loadArtworkForTrack(track);
        }
      });
    } catch (err) {
      const errorMessage = err.message || 'Failed to search Tidal';
      
      // Provide helpful error messages
      if (errorMessage.includes('Server error') || errorMessage.includes('500')) {
        setError('Tidal servers are temporarily unavailable. Please try again in a few moments.');
      } else if (errorMessage.includes('All Tidal servers failed')) {
        setError('Unable to connect to Tidal. Please check your internet connection and try again.');
      } else {
        setError(errorMessage);
      }
      
      console.error('Tidal search error:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadArtworkForTrack = async (track) => {
    // Skip if already cached
    if (artworkCache[track.id]) return;
    
    try {
      const artwork = await getArtworkWithFallback(track);
      if (artwork && artwork.length > 0) {
        setArtworkCache(prev => ({
          ...prev,
          [track.id]: artwork[0]['#text'], // Store the URL
        }));
      }
    } catch (err) {
      console.warn('[ModulesPage] Failed to load artwork for track:', track.id, err);
    }
  };

  const handlePlayTrack = async (track) => {
    try {
      // Get the stream URL
      const response = await getTrackStreamUrl(track.id, 'LOSSLESS');
      
      if (!response || !response.streamUrl) {
        throw new Error('Could not get stream URL');
      }
      
      const streamUrl = response.streamUrl;

      // Get artwork with Spotify fallback
      console.log('[ModulesPage] Fetching artwork with fallback for:', track.title);
      const artwork = await getArtworkWithFallback(track);

      // Format track for SongPlayer
      const formattedTrack = {
        name: track.title,
        artist: typeof track.artist === 'string' ? track.artist : (track.artist?.name || 'Unknown Artist'),
        album: track.album || 'Unknown Album',
        duration: track.duration,
        uri: streamUrl, // SongPlayer uses 'uri' for audio source
        image: artwork,
        source: 'tidal',
        tidalId: track.id,
      };

      // Open the track player
      openTrackPlayer(formattedTrack);
    } catch (err) {
      console.error('Error playing track:', err);
      setError(err.message || 'Failed to play track');
    }
  };

  const renderTrackItem = ({ item }) => {
    // Use Tidal artwork, or fallback to cached Spotify artwork
    const artworkUrl = item.albumCover || artworkCache[item.id];
    
    return (
      <Pressable
        style={[styles.trackItem, { backgroundColor: theme.card, borderBottomColor: theme.border }]}
        onPress={() => handlePlayTrack(item)}
      >
        {artworkUrl ? (
          <Image source={{ uri: artworkUrl }} style={styles.trackArtwork} />
        ) : (
          <View style={[styles.trackArtwork, { backgroundColor: theme.inputBackground }]}>
            <Ionicons name="musical-notes" size={24} color={theme.secondaryText} />
          </View>
        )}
      
      <View style={styles.trackInfo}>
        <Text style={[styles.trackTitle, { color: theme.primaryText }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[styles.trackArtist, { color: theme.secondaryText }]} numberOfLines={1}>
          {typeof item.artist === 'string' ? item.artist : (item.artist?.name || 'Unknown Artist')}
        </Text>
        {item.album && (
          <Text style={[styles.trackAlbum, { color: theme.secondaryText }]} numberOfLines={1}>
            {item.album}
          </Text>
        )}
      </View>

      <View style={styles.trackMeta}>
        <Text style={[styles.trackQuality, { color: theme.accent }]}>
          {item.audioQuality || 'LOSSLESS'}
        </Text>
        <Ionicons name="play-circle" size={24} color={theme.accent} />
      </View>
    </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backButton}>
          <Ionicons name="chevron-back" size={32} color={theme.primaryText} />
        </Pressable>
        <Text style={[styles.title, { color: theme.primaryText }]}>Modules</Text>
      </View>

      {/* Toggle for Unowned Media */}
      <View style={[styles.toggleSection, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <View style={styles.toggleLeft}>
          <Ionicons name="cloud-download-outline" size={24} color={theme.primaryText} />
          <View style={styles.toggleTextContainer}>
            <Text style={[styles.toggleTitle, { color: theme.primaryText }]}>
              Use to play unimported media
            </Text>
            <Text style={[styles.toggleDescription, { color: theme.secondaryText }]}>
              Stream unowned tracks from Tidal
            </Text>
          </View>
        </View>
        <Switch
          value={useTidalForUnowned}
          onValueChange={toggleTidalForUnowned}
          trackColor={{ false: theme.border, true: theme.accent + '80' }}
          thumbColor={useTidalForUnowned ? theme.accent : theme.secondaryText}
        />
      </View>

      {/* Tidal Search Section */}
      <View style={styles.searchSection}>
        <View style={styles.sectionHeader}>
          <Ionicons name="musical-note" size={20} color={theme.accent} />
          <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>Tidal Music</Text>
        </View>

        {/* Search Bar */}
        <View style={[styles.searchBar, { backgroundColor: theme.inputBackground }]}>
          <Ionicons name="search" size={20} color={theme.secondaryText} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: theme.primaryText }]}
            placeholder="Search for songs..."
            placeholderTextColor={theme.secondaryText}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={10}>
              <Ionicons name="close-circle" size={20} color={theme.secondaryText} />
            </Pressable>
          )}
        </View>

        {/* Search Button */}
        <Pressable
          style={[styles.searchButton, { backgroundColor: theme.accent }]}
          onPress={handleSearch}
          disabled={loading || !searchQuery.trim()}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.searchButtonText}>Search</Text>
          )}
        </Pressable>
      </View>

      {/* Error Message */}
      {error && (
        <View style={[styles.errorContainer, { backgroundColor: theme.card }]}>
          <Ionicons name="alert-circle" size={20} color="#ff4444" />
          <Text style={[styles.errorText, { color: '#ff4444' }]}>{error}</Text>
        </View>
      )}

      {/* Results */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={[styles.loadingText, { color: theme.secondaryText }]}>Searching Tidal...</Text>
        </View>
      ) : searchResults.length > 0 ? (
        <FlatList
          data={searchResults}
          renderItem={renderTrackItem}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.resultsList}
        />
      ) : searchQuery && !loading ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="search" size={48} color={theme.secondaryText} />
          <Text style={[styles.emptyText, { color: theme.secondaryText }]}>No results found</Text>
        </View>
      ) : (
        <View style={styles.emptyContainer}>
          <Ionicons name="musical-notes" size={48} color={theme.secondaryText} />
          <Text style={[styles.emptyText, { color: theme.secondaryText }]}>
            Search for music on Tidal
          </Text>
        </View>
      )}
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
    marginRight: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  toggleSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  toggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  toggleTextContainer: {
    flex: 1,
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 2,
  },
  toggleDescription: {
    fontSize: 13,
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  searchButton: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 16,
  },
  resultsList: {
    paddingBottom: 100,
  },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  trackArtwork: {
    width: 56,
    height: 56,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackInfo: {
    flex: 1,
    gap: 2,
  },
  trackTitle: {
    fontSize: 16,
    fontWeight: '500',
  },
  trackArtist: {
    fontSize: 14,
  },
  trackAlbum: {
    fontSize: 12,
  },
  trackMeta: {
    alignItems: 'flex-end',
    gap: 4,
  },
  trackQuality: {
    fontSize: 10,
    fontWeight: '600',
  },
});
