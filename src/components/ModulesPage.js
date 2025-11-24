import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, FlatList, Pressable, Image, ActivityIndicator, StyleSheet, Switch, Alert, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
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

  // Disclaimer Modal state
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);

  // Help Modal state
  const [showHelpModal, setShowHelpModal] = useState(false);

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

  const handlePickModuleFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/javascript',
        copyToCacheDirectory: true
      });

      if (result.canceled) return;
      
      const file = result.assets[0];
      if (!file.name.endsWith('.js')) {
        Alert.alert('Error', 'Please select a .js file');
        return;
      }

      const fileContent = await FileSystem.readAsStringAsync(file.uri);
      setInstallCode(fileContent);
      Alert.alert(
        'File Loaded',
        `Loaded code from ${file.name}. Review and click Install.`,
        [{ text: 'OK' }]
      );
    } catch (err) {
      console.error('File pick error:', err);
      Alert.alert('Error', 'Failed to read selected file');
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
        <Pressable 
          onPress={() => setShowHelpModal(true)} 
          hitSlop={10} 
          style={styles.helpButton}
        >
          <Ionicons name="help-circle-outline" size={24} color={theme.primaryText} />
        </Pressable>
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
            onPress={() => setShowDisclaimerModal(true)}
          >
            <Ionicons name="add-circle-outline" size={24} color={theme.accent} />
            <Text style={[styles.installButtonText, { color: theme.primaryText }]}>Install Module</Text>
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
            
            <Pressable
              style={[styles.quickInstallButton, { backgroundColor: theme.card, borderColor: theme.accent, marginBottom: 20 }]}
              onPress={handlePickModuleFile}
            >
              <Ionicons name="document-text-outline" size={24} color={theme.accent} />
              <Text style={[styles.quickInstallText, { color: theme.accent, fontSize: 16 }]}>Select .js File</Text>
            </Pressable>

            <Text style={[styles.modalLabel, { color: theme.secondaryText }]}>Or paste module code:</Text>
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
            
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.defaultModulesRow}>
              <Pressable
                  style={[styles.quickInstallButton, { backgroundColor: theme.card, borderColor: theme.accent, marginRight: 10 }]}
                  onPress={() => handleInstallModule(TIDAL_MODULE_CODE)}
                >
                   <Ionicons name="download-outline" size={20} color={theme.accent} />
                   <Text style={[styles.quickInstallText, { color: theme.accent }]}>Tidal</Text>
                </Pressable>

              <Pressable
                  style={[styles.quickInstallButton, { backgroundColor: theme.card, borderColor: theme.accent }]}
                  onPress={() => handleInstallModule(YTDL_MODULE_CODE)}
                >
                   <Ionicons name="logo-youtube" size={20} color={theme.accent} />
                   <Text style={[styles.quickInstallText, { color: theme.accent }]}>YTDL</Text>
                </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Disclaimer Modal */}
      <Modal
        visible={showDisclaimerModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowDisclaimerModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setShowDisclaimerModal(false)}>
              <Text style={{ color: theme.secondaryText, fontSize: 16 }}>Cancel</Text>
            </Pressable>
            <Text style={[styles.modalTitle, { color: theme.primaryText, fontSize: 18 }]}>You wouldn't steal a car</Text>
            <Pressable onPress={() => {
              setShowDisclaimerModal(false);
              setShowInstallModal(true);
            }}>
              <Text style={{ color: theme.accent, fontSize: 16, fontWeight: '600' }}>I Agree</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={[styles.helpText, { color: theme.secondaryText, fontSize: 16, lineHeight: 24 }]}>
              By proceeding to install a custom module, you acknowledge and agree to the following terms:
              {"\n\n"}
              <Text style={{ fontWeight: 'bold', color: theme.primaryText }}>1. Ownership and Legality:</Text> You confirm that any music or media accessed through this module belongs to you or that you have purchased it legally. Prana is a tool designed for personal media management and does not endorse or facilitate copyright infringement.
              {"\n\n"}
              <Text style={{ fontWeight: 'bold', color: theme.primaryText }}>2. Supporting Artists:</Text> Music is an art form that requires time, effort, and resources to create. We strongly advise and encourage all users to support artists by purchasing their music through official channels. Stealing music hurts the creators you love.
              {"\n\n"}
              <Text style={{ fontWeight: 'bold', color: theme.primaryText }}>3. User Responsibility:</Text> The Prana team takes no responsibility for the misuse of this advanced feature. You, the user, are solely responsible for ensuring that your use of this app complies with all applicable laws and regulations regarding copyright and intellectual property.
              {"\n\n"}
              <Text style={{ fontWeight: 'bold', color: theme.primaryText }}>4. Enforcement:</Text> Prana actively monitors and takes down any public modules distributed on the internet that violate these terms. We are committed to maintaining a legal and ethical ecosystem for all users ;)
              {"\n\n"}
              <Text style={{ fontWeight: 'bold', fontSize: 20, color: theme.primaryText, textAlign: 'center' }}>You wouldn't steal a car ;)</Text>
              {"\n\n"}
              <Text style={{ fontWeight: 'bold', color: theme.primaryText, fontStyle: 'italic' }}>I, morgk the developer of this app hate pirating media and i will hate you if you pirate media!! i hate illegal stuff >:( !!!!</Text>
              {"\n\n"}
              By clicking "I Agree", you certify that you understand these terms and will use Prana's module engine responsibly and legally.
            </Text>
            <View style={{ height: 50 }} />
          </ScrollView>
        </View>
      </Modal>

      {/* Help Modal */}
      <Modal
        visible={showHelpModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowHelpModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.primaryText }]}>Module Engine Guide</Text>
            <Pressable onPress={() => setShowHelpModal(false)}>
              <Ionicons name="close" size={28} color={theme.primaryText} />
            </Pressable>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={[styles.helpSectionTitle, { color: theme.primaryText }]}>How it works</Text>
            <Text style={[styles.helpText, { color: theme.secondaryText }]}>
              We understand that advanced users often host their personal music collections in the cloud or have specific preferences for accessing their purchased albums on the go. Prana's module engine is designed to bridge this gap, allowing you to seamlessly connect to your external libraries. By installing custom JavaScript modules, you can stream and download your favorite tracks directly within the app, ensuring your music is always accessible, wherever you are.
            </Text>

            <Text style={[styles.helpSectionTitle, { color: theme.primaryText }]}>Creating a Module</Text>
            <Text style={[styles.helpText, { color: theme.secondaryText }]}>
              A module is a simple JavaScript file (.js) that returns an object defining its capabilities. The file content is executed as a function body.
            </Text>

            <View style={[styles.codeBlock, { backgroundColor: theme.inputBackground }]}>
              <Text style={[styles.codeText, { color: theme.primaryText }]}>
{`return {
  id: "my-module",
  name: "My Service",
  version: "1.0.0",
  
  // Search for tracks
  searchTracks: async (query) => {
    // Return array of tracks
    return { tracks: [...] };
  },

  // Get stream URL
  getTrackStreamUrl: async (id) => {
    return { streamUrl: "https://..." };
  }
}`}
              </Text>
            </View>

            <Text style={[styles.helpSectionTitle, { color: theme.primaryText }]}>Installing a Module</Text>
            <Text style={[styles.helpText, { color: theme.secondaryText }]}>
              1. Tap the "Install Module" button on the Modules page.{"\n"}
              2. Tap "Select .js File" to pick a module file from your device.{"\n"}
              3. Alternatively, you can paste the module code directly into the text area.{"\n"}
              4. Tap "Install" to add the module to your library.
            </Text>
            
            <View style={{ height: 50 }} />
          </ScrollView>
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
  backButton: { marginRight: 8, zIndex: 1 },
  helpButton: { marginLeft: 8, zIndex: 1 },
  title: { fontSize: 20, fontWeight: '600', flex: 1, textAlign: 'center' },
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
  divider: { height: 1, backgroundColor: '#ccc', marginVertical: 20, opacity: 0.2 },
  defaultModulesRow: { flexDirection: 'row', paddingBottom: 20 },
  helpSectionTitle: { fontSize: 18, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  helpText: { fontSize: 14, lineHeight: 22, marginBottom: 16 },
  codeBlock: { padding: 12, borderRadius: 8, marginBottom: 16 },
  codeText: { fontFamily: 'monospace', fontSize: 12 },
});
