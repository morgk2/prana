import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, FlatList, Pressable, Image, ActivityIndicator, StyleSheet, Switch, Alert, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ModuleManager } from '../services/ModuleManager';
import { getArtworkWithFallback } from '../utils/artworkFallback';
import { TIDAL_MODULE_CODE } from '../services/defaultTidalModule';
import { YTDL_MODULE_CODE } from '../services/ytdlModule';

export default function ModulesPage({ route, navigation }) {
  const { theme, openTrackPlayer, useTidalForUnowned, toggleTidalForUnowned } = route.params;

  const [currentView, setCurrentView] = useState('list'); // 'list' or 'module_details'
  const [activeModule, setActiveModule] = useState(null);
  const [modulesList, setModulesList] = useState([]);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [artworkCache, setArtworkCache] = useState({});

  // Install Modal state
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installCode, setInstallCode] = useState('');

  useEffect(() => {
    loadModules();
  }, []);

  const loadModules = () => {
    setModulesList(ModuleManager.getAllModules());
  };

  const handleBack = () => {
    if (currentView !== 'list') {
      setCurrentView('list');
      setActiveModule(null);
    } else {
      navigation.goBack();
    }
  };

  const handleInstallModule = async (code) => {
    try {
      await ModuleManager.installModule(code);
      loadModules();
      setShowInstallModal(false);
      setInstallCode('');
      Alert.alert('Success', 'Module installed successfully');
    } catch (err) {
      Alert.alert('Error', 'Failed to install module: ' + err.message);
    }
  };

  const handleUninstallModule = async (moduleId) => {
    try {
      await ModuleManager.uninstallModule(moduleId);
      loadModules();
      if (activeModule?.id === moduleId) {
        handleBack();
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to uninstall module');
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError(null);
    setArtworkCache({});

    try {
      // Use ModuleManager for search
      const response = await ModuleManager.searchTracks(searchQuery);
      const tracks = response.tracks || [];
      setSearchResults(tracks);

      tracks.forEach(track => {
        if (!track.albumCover) {
          loadArtworkForTrack(track);
        }
      });
    } catch (err) {
      setError(err.message || 'Failed to search');
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadArtworkForTrack = async (track) => {
    if (artworkCache[track.id]) return;
    try {
      const artwork = await getArtworkWithFallback(track);
      if (artwork && artwork.length > 0) {
        setArtworkCache(prev => ({
          ...prev,
          [track.id]: artwork[0]['#text'],
        }));
      }
    } catch (err) {
      console.warn('[ModulesPage] Failed to load artwork:', err);
    }
  };

  const handlePlayTrack = async (track) => {
    try {
      // Use ModuleManager to get stream
      const response = await ModuleManager.getTrackStreamUrl(track.id, 'LOSSLESS');

      if (!response || !response.streamUrl) {
        throw new Error('Could not get stream URL');
      }

      const streamUrl = response.streamUrl;
      const artwork = await getArtworkWithFallback(track);

      const formattedTrack = {
        name: track.title,
        artist: typeof track.artist === 'string' ? track.artist : (track.artist?.name || 'Unknown Artist'),
        album: track.album || 'Unknown Album',
        duration: track.duration,
        uri: streamUrl,
        image: artwork,
        source: 'module', // Generic source
        moduleId: activeModule?.id || 'unknown',
        originalId: track.id,
      };

      openTrackPlayer(formattedTrack);
    } catch (err) {
      console.error('Error playing track:', err);
      setError(err.message || 'Failed to play track');
    }
  };

  const renderTrackItem = ({ item }) => {
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
            {item.audioQuality || 'HQ'}
          </Text>
          <Ionicons name="play-circle" size={24} color={theme.accent} />
        </View>
      </Pressable>
    );
  };

  const renderModuleCard = (module) => (
    <Pressable
      key={module.id}
      style={[styles.moduleCard, { backgroundColor: theme.card, borderColor: theme.border }]}
      onPress={() => {
        setActiveModule(module);
        setCurrentView('module_details');
      }}
    >
      <View style={styles.moduleHeaderRow}>
        <View style={[styles.moduleIconContainer, { backgroundColor: theme.inputBackground }]}>
          <Ionicons name="cube-outline" size={32} color={theme.accent} />
        </View>
        <View style={styles.moduleInfo}>
          <Text style={[styles.moduleName, { color: theme.primaryText }]}>{module.name}</Text>
          <Text style={[styles.moduleAuthor, { color: theme.secondaryText }]}>v{module.version}</Text>
        </View>
      </View>

      <Text style={[styles.moduleDescription, { color: theme.secondaryText }]}>
        Installed user module.
      </Text>

      <View style={styles.moduleActions}>
        <Pressable
          style={[styles.actionButton, styles.uninstallButton, { backgroundColor: theme.border }]}
          onPress={() => Alert.alert('Uninstall', `Uninstall ${module.name}?`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Uninstall', style: 'destructive', onPress: () => handleUninstallModule(module.id) }
          ])}
        >
          <Text style={[styles.actionButtonText, { color: theme.secondaryText }]}>Uninstall</Text>
        </Pressable>
        <Pressable
          style={[styles.actionButton, { backgroundColor: theme.accent }]}
          onPress={() => {
            setActiveModule(module);
            setCurrentView('module_details');
          }}
        >
          <Text style={[styles.actionButtonText, { color: '#fff' }]}>Open</Text>
        </Pressable>
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} hitSlop={10} style={styles.backButton}>
          <Ionicons name="chevron-back" size={32} color={theme.primaryText} />
        </Pressable>
        <Text style={[styles.title, { color: theme.primaryText }]}>
          {currentView === 'list' ? 'Modules' : activeModule?.name || 'Module'}
        </Text>
      </View>

      {currentView === 'list' ? (
        <ScrollView contentContainerStyle={styles.modulesListContainer}>
          <Text style={[styles.sectionTitle, { color: theme.primaryText, marginBottom: 16, paddingHorizontal: 16 }]}>
            Installed Modules
          </Text>

          {modulesList.length > 0 ? (
            modulesList.map(renderModuleCard)
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="cube-outline" size={48} color={theme.secondaryText} />
              <Text style={[styles.emptyText, { color: theme.secondaryText }]}>No modules installed</Text>
              
              {/* Quick Install for Tidal */}
              <Pressable
                style={[styles.quickInstallButton, { backgroundColor: theme.card, borderColor: theme.accent }]}
                onPress={() => handleInstallModule(TIDAL_MODULE_CODE)}
              >
                 <Ionicons name="download-outline" size={20} color={theme.accent} />
                 <Text style={[styles.quickInstallText, { color: theme.accent }]}>Install Tidal Music</Text>
              </Pressable>

              {/* Quick Install for YTDL */}
              <Pressable
                style={[styles.quickInstallButton, { backgroundColor: theme.card, borderColor: theme.accent }]}
                onPress={() => handleInstallModule(YTDL_MODULE_CODE)}
              >
                 <Ionicons name="logo-youtube" size={20} color={theme.accent} />
                 <Text style={[styles.quickInstallText, { color: theme.accent }]}>Install YTDL (Spotify)</Text>
              </Pressable>
            </View>
          )}

          <Pressable
            style={[styles.installButton, { backgroundColor: theme.inputBackground }]}
            onPress={() => setShowInstallModal(true)}
          >
            <Ionicons name="add-circle-outline" size={24} color={theme.accent} />
            <Text style={[styles.installButtonText, { color: theme.primaryText }]}>Install Custom Module</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <>
          <View style={[styles.toggleSection, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
            <View style={styles.toggleLeft}>
              <Ionicons name="cloud-download-outline" size={24} color={theme.primaryText} />
              <View style={styles.toggleTextContainer}>
                <Text style={[styles.toggleTitle, { color: theme.primaryText }]}>
                  Use for unowned media
                </Text>
                <Text style={[styles.toggleDescription, { color: theme.secondaryText }]}>
                  Stream unowned tracks using this module
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

          <View style={styles.searchSection}>
            <View style={styles.sectionHeader}>
              <Ionicons name="search" size={20} color={theme.accent} />
              <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>Search {activeModule?.name}</Text>
            </View>

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

          {error && (
            <View style={[styles.errorContainer, { backgroundColor: theme.card }]}>
              <Ionicons name="alert-circle" size={20} color="#ff4444" />
              <Text style={[styles.errorText, { color: '#ff4444' }]}>{error}</Text>
            </View>
          )}

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.accent} />
              <Text style={[styles.loadingText, { color: theme.secondaryText }]}>Searching...</Text>
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
                Search for music
              </Text>
            </View>
          )}
        </>
      )}

      {/* Install Modal */}
      <Modal
        visible={showInstallModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowInstallModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.primaryText }]}>Install Module</Text>
            <Pressable onPress={() => setShowInstallModal(false)}>
              <Ionicons name="close" size={28} color={theme.primaryText} />
            </Pressable>
          </View>
          <View style={styles.modalContent}>
            <Text style={[styles.modalLabel, { color: theme.secondaryText }]}>Paste module code:</Text>
            <TextInput
              style={[styles.codeInput, { backgroundColor: theme.inputBackground, color: theme.primaryText }]}
              multiline
              placeholder="// Paste code here..."
              placeholderTextColor={theme.secondaryText}
              value={installCode}
              onChangeText={setInstallCode}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              style={[styles.modalInstallButton, { backgroundColor: theme.accent, opacity: installCode.trim() ? 1 : 0.5 }]}
              onPress={() => handleInstallModule(installCode)}
              disabled={!installCode.trim()}
            >
              <Text style={styles.modalInstallButtonText}>Install</Text>
            </Pressable>
            
            <View style={styles.divider} />
            
            <Pressable
                style={[styles.quickInstallButton, { backgroundColor: theme.card, borderColor: theme.accent }]}
                onPress={() => handleInstallModule(TIDAL_MODULE_CODE)}
              >
                 <Ionicons name="download-outline" size={20} color={theme.accent} />
                 <Text style={[styles.quickInstallText, { color: theme.accent }]}>Load Default Tidal Module</Text>
              </Pressable>

            <Pressable
                style={[styles.quickInstallButton, { backgroundColor: theme.card, borderColor: theme.accent }]}
                onPress={() => handleInstallModule(YTDL_MODULE_CODE)}
              >
                 <Ionicons name="logo-youtube" size={20} color={theme.accent} />
                 <Text style={[styles.quickInstallText, { color: theme.accent }]}>Load YTDL Module</Text>
              </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
  },
  backButton: { marginRight: 8 },
  title: { fontSize: 20, fontWeight: '600' },
  modulesListContainer: { padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  moduleCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    marginBottom: 16,
  },
  moduleHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  moduleIconContainer: {
    width: 56, height: 56, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  moduleInfo: { flex: 1, gap: 4 },
  moduleName: { fontSize: 18, fontWeight: '600' },
  moduleAuthor: { fontSize: 14 },
  moduleDescription: { fontSize: 14, lineHeight: 20 },
  moduleActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  actionButton: {
    flex: 1, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  uninstallButton: { borderWidth: 1, borderColor: 'transparent' },
  actionButtonText: { fontSize: 14, fontWeight: '600' },
  installButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    padding: 16, borderRadius: 12, marginTop: 8, gap: 8,
  },
  installButtonText: { fontSize: 16, fontWeight: '600' },
  emptyState: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  emptyText: { fontSize: 16 },
  quickInstallButton: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      padding: 12, borderRadius: 12, borderWidth: 1, gap: 8, marginTop: 8
  },
  quickInstallText: { fontWeight: '600' },
  toggleSection: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1,
  },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  toggleTextContainer: { flex: 1 },
  toggleTitle: { fontSize: 16, fontWeight: '500', marginBottom: 2 },
  toggleDescription: { fontSize: 13 },
  searchSection: { paddingHorizontal: 16, paddingVertical: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 16 },
  searchButton: {
    borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
  },
  searchButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  errorContainer: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: 16,
    marginBottom: 16, padding: 12, borderRadius: 8, gap: 8,
  },
  errorText: { flex: 1, fontSize: 14 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  resultsList: { paddingBottom: 100 },
  trackItem: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingVertical: 12, borderBottomWidth: 1, gap: 12,
  },
  trackArtwork: {
    width: 56, height: 56, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
  },
  trackInfo: { flex: 1, gap: 2 },
  trackTitle: { fontSize: 16, fontWeight: '500' },
  trackArtist: { fontSize: 14 },
  trackAlbum: { fontSize: 12 },
  trackMeta: { alignItems: 'flex-end', gap: 4 },
  trackQuality: { fontSize: 10, fontWeight: '600' },
  modalContainer: { flex: 1, paddingTop: 50 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 16,
  },
  modalTitle: { fontSize: 20, fontWeight: '600' },
  modalContent: { flex: 1, padding: 16 },
  modalLabel: { fontSize: 14, marginBottom: 8 },
  codeInput: {
    flex: 1, borderRadius: 8, padding: 12, fontSize: 14,
    textAlignVertical: 'top', fontFamily: 'monospace',
  },
  modalInstallButton: {
    borderRadius: 12, paddingVertical: 16, alignItems: 'center',
    marginTop: 16,
  },
  modalInstallButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#ccc', marginVertical: 20, opacity: 0.2 }
});
