import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, FlatList, Pressable, Image, ActivityIndicator, StyleSheet, Switch, Alert, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { ModuleManager } from '../services/ModuleManager';
import { getArtworkWithFallback } from '../utils/artworkFallback';
import { TIDAL_MODULE_CODE } from '../services/defaultTidalModule';
import { YTDL_MODULE_CODE } from '../services/ytdlModule';
import { SPARTDL_MODULE_CODE } from '../services/spartdlModule';
import { SUBSONIC_MODULE_CODE } from '../services/subsonicModule';
import { HIFI_MORGK_MODULE_CODE } from '../services/hifiMorgkModule';

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

  // Installation loading state
  const [installingModule, setInstallingModule] = useState(null);

  // Subsonic configuration state
  const [showSubsonicConfig, setShowSubsonicConfig] = useState(false);
  const [subsonicServer, setSubsonicServer] = useState('');
  const [subsonicUsername, setSubsonicUsername] = useState('');
  const [subsonicPassword, setSubsonicPassword] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);

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

  const handleInstallDefaultModule = async (module, openAfterInstall = false) => {
    try {
      setInstallingModule(module.id);
      await ModuleManager.installModule(module.moduleCode);
      await loadModules(); // Wait for modules to reload

      Alert.alert('Success', 'Module installed successfully');

      if (openAfterInstall) {
        // Find the installed module and open it
        const installedModules = ModuleManager.getAllModules();
        const installedModule = installedModules.find(m => m.id === module.id);
        if (installedModule) {
          setActiveModule(installedModule);
          setCurrentView('module_details');
        }
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to install module: ' + err.message);
    } finally {
      setInstallingModule(null);
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

  const handleTestSubsonicConnection = async () => {
    if (!subsonicServer || !subsonicUsername || !subsonicPassword) {
      Alert.alert('Missing Information', 'Please fill in all fields');
      return;
    }

    setTestingConnection(true);
    try {
      // Create a temporary module instance to test connection
      const testCode = SUBSONIC_MODULE_CODE + `\nconst module = arguments[0];\nmodule.configure('${subsonicServer}', '${subsonicUsername}', '${subsonicPassword}');\nreturn module.ping();`;
      const testFunc = new Function(testCode);
      const module = testFunc();

      const isConnected = await module;

      if (isConnected) {
        Alert.alert('Success!', 'Connection to Subsonic server successful');
      } else {
        Alert.alert('Connection Failed', 'Could not connect to Subsonic server');
      }
    } catch (error) {
      Alert.alert('Connection Failed', error.message || 'Could not connect to Subsonic server');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleInstallSubsonic = async () => {
    if (!subsonicServer || !subsonicUsername || !subsonicPassword) {
      Alert.alert('Missing Information', 'Please fill in all fields');
      return;
    }

    try {
      setInstallingModule('subsonic');

      // Inject configuration into the module code
      const configuredCode = SUBSONIC_MODULE_CODE.replace(
        "let SUBSONIC_SERVER_URL = '';",
        `let SUBSONIC_SERVER_URL = '${subsonicServer}';`
      ).replace(
        "let SUBSONIC_USERNAME = '';",
        `let SUBSONIC_USERNAME = '${subsonicUsername}';`
      ).replace(
        "let SUBSONIC_PASSWORD = '';",
        `let SUBSONIC_PASSWORD = '${subsonicPassword}';`
      );

      await ModuleManager.installModule(configuredCode);
      await loadModules();

      setShowSubsonicConfig(false);
      setSubsonicServer('');
      setSubsonicUsername('');
      setSubsonicPassword('');

      Alert.alert('Success', 'Subsonic module installed successfully');
    } catch (err) {
      Alert.alert('Error', 'Failed to install module: ' + err.message);
    } finally {
      setInstallingModule(null);
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

      // Prefer metadata from response if available (e.g. SpartDL updates duration)
      const responseTrack = response.track || {};

      const formattedTrack = {
        name: responseTrack.title || track.title,
        artist: responseTrack.artist || (typeof track.artist === 'string' ? track.artist : (track.artist?.name || 'Unknown Artist')),
        album: responseTrack.album || track.album || 'Unknown Album',
        duration: responseTrack.duration || track.duration,
        uri: streamUrl,
        image: responseTrack.albumCover || artwork, // Use high-res cover if available in response
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

  const renderDefaultModuleCard = (module) => (
    <Pressable
      key={module.id}
      style={[styles.moduleCard, { backgroundColor: theme.card, borderColor: theme.border }]}
      onPress={() => {
        if (installingModule === module.id) return;
        if (module.requiresConfig && module.id === 'subsonic') {
          setShowSubsonicConfig(true);
        } else {
          handleInstallDefaultModule(module, false);
        }
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
        Default module ready to install.
      </Text>

      {/* Module Labels */}
      {module.labels && module.labels.length > 0 && (
        <View style={styles.moduleLabels}>
          {module.labels.map((label, index) => (
            <View key={index} style={[styles.labelTag, { backgroundColor: theme.accent + '20', borderColor: theme.accent }]}>
              <Text style={[styles.labelText, { color: theme.accent }]}>{label}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.moduleActions}>
        {module.requiresConfig && module.id === 'subsonic' ? (
          <Pressable
            style={[styles.actionButton, { backgroundColor: theme.accent, flex: 2 }]}
            onPress={() => setShowSubsonicConfig(true)}
          >
            <Ionicons name="settings-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
            <Text style={[styles.actionButtonText, { color: '#fff' }]}>Configure & Install</Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              style={[styles.actionButton, { backgroundColor: installingModule === module.id ? theme.border : theme.accent }]}
              onPress={() => {
                if (installingModule === module.id) return;
                handleInstallDefaultModule(module, false);
              }}
              disabled={installingModule === module.id}
            >
              {installingModule === module.id ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : (
                <Text style={[styles.actionButtonText, { color: '#fff' }]}>Install</Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.actionButton, styles.uninstallButton, { backgroundColor: installingModule === module.id ? theme.border : theme.border }]}
              onPress={() => {
                if (installingModule === module.id) return;
                handleInstallDefaultModule(module, true);
              }}
              disabled={installingModule === module.id}
            >
              {installingModule === module.id ? (
                <ActivityIndicator size="small" color={theme.secondaryText} />
              ) : (
                <Text style={[styles.actionButtonText, { color: theme.primaryText }]}>Install & Open</Text>
              )}
            </Pressable>
          </>
        )}
      </View>
    </Pressable>
  );

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

      {/* Module Labels */}
      {module.labels && module.labels.length > 0 && (
        <View style={styles.moduleLabels}>
          {module.labels.map((label, index) => (
            <View key={index} style={[styles.labelTag, { backgroundColor: theme.accent + '20', borderColor: theme.accent }]}>
              <Text style={[styles.labelText, { color: theme.accent }]}>{label}</Text>
            </View>
          ))}
        </View>
      )}

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
          {/* Toggle Card */}
          <View style={[styles.toggleCard, { backgroundColor: theme.card }]}>
            <View style={styles.toggleLeft}>
              <Ionicons name="musical-notes" size={24} color={theme.primaryText} />
              <View style={styles.toggleTextContainer}>
                <Text style={[styles.toggleTitle, { color: theme.primaryText }]}>
                  Use modules to play music on the go
                </Text>
                <Text style={[styles.toggleDescription, { color: theme.secondaryText }]}>
                  Stream unowned tracks using installed modules
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

          <Text style={[styles.sectionTitle, { color: theme.primaryText, marginBottom: 16, paddingHorizontal: 16 }]}>
            Installed Modules
          </Text>

          {modulesList.length > 0 ? (
            modulesList.map(renderModuleCard)
          ) : (
            <View style={styles.modulesListContainer}>
              {/* Default Module Cards */}
              {renderDefaultModuleCard({
                id: 'hifi-morgk',
                name: 'HIFI MORGK',
                version: '1.0.0',
                labels: ['PERFECT', 'LOSSLESS', 'STREAM & DOWNLOAD'],
                moduleCode: HIFI_MORGK_MODULE_CODE,
                installed: false
              })}

              {renderDefaultModuleCard({
                id: 'tidal',
                name: 'Tidal Music',
                version: '1.0.0',
                labels: ['LOSSLESS quality', 'Great for downloading'],
                moduleCode: TIDAL_MODULE_CODE,
                installed: false
              })}

              {renderDefaultModuleCard({
                id: 'ytdl',
                name: 'YTDL (Spotify Search)',
                version: '1.6.0',
                labels: ['Fast', 'Perfect for streaming'],
                moduleCode: YTDL_MODULE_CODE,
                installed: false
              })}

              {renderDefaultModuleCard({
                id: 'spartdl',
                name: 'SpartDL (Spotify Downloads)',
                version: '1.2.1',
                labels: ["I'm hosting it on a potato", "Great for downloading"],
                moduleCode: SPARTDL_MODULE_CODE,
                installed: false
              })}

              {renderDefaultModuleCard({
                id: 'subsonic',
                name: 'Subsonic Server',
                version: '1.0.0',
                labels: ['Self-hosted', 'LOSSLESS quality', 'Local library'],
                moduleCode: SUBSONIC_MODULE_CODE,
                installed: false,
                requiresConfig: true
              })}
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
          {/* Module Info Card */}
          <View style={[styles.moduleDetailsCard, { backgroundColor: theme.card }]}>
            <View style={styles.moduleDetailsHeader}>
              <View style={[styles.moduleDetailsIcon, { backgroundColor: theme.accent + '20' }]}>
                <Ionicons name="cube" size={48} color={theme.accent} />
              </View>
              <View style={styles.moduleDetailsInfo}>
                <Text style={[styles.moduleDetailsName, { color: theme.primaryText }]}>
                  {activeModule?.name || 'Module'}
                </Text>
                <Text style={[styles.moduleDetailsVersion, { color: theme.secondaryText }]}>
                  Version {activeModule?.version || '1.0.0'}
                </Text>
                <Text style={[styles.moduleDetailsAuthor, { color: theme.secondaryText }]}>
                  by Morg
                </Text>
              </View>
            </View>

            {/* Module Labels */}
            {activeModule?.labels && activeModule.labels.length > 0 && (
              <View style={styles.moduleDetailsLabels}>
                {activeModule.labels.map((label, index) => (
                  <View key={index} style={[styles.moduleDetailLabel, { backgroundColor: theme.accent + '15', borderColor: theme.accent + '30' }]}>
                    <Text style={[styles.moduleDetailLabelText, { color: theme.accent }]}>{label}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Module Description */}
            <Text style={[styles.moduleDetailsDescription, { color: theme.secondaryText }]}>
              Connect to external music sources and stream your favorite tracks directly within 8SPINE.
            </Text>
          </View>

          {/* Toggle Section */}
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

          {/* Search Section */}
          <View style={styles.searchSection}>
            <View style={styles.sectionHeader}>
              <Ionicons name="search" size={20} color={theme.accent} />
              <Text style={[styles.sectionTitle, { color: theme.primaryText }]}>Test the Module</Text>
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
          <ScrollView style={styles.modalContent}>

            {/* Server Connection Illustration */}
            <View style={styles.illustrationContainer}>
              <View style={styles.illustrationRow}>
                <View style={[styles.serverIcon, { backgroundColor: theme.accent + '20' }]}>
                  <Ionicons name="server-outline" size={48} color={theme.accent} />
                </View>
                <Ionicons name="arrow-forward" size={32} color={theme.accent} />
                <View style={[styles.phoneIcon, { backgroundColor: theme.accent + '20' }]}>
                  <Ionicons name="phone-portrait-outline" size={48} color={theme.accent} />
                </View>
              </View>
            </View>

            {/* Select Module File Button */}
            <Pressable
              style={[styles.selectFileButton, { backgroundColor: theme.card, borderColor: theme.accent }]}
              onPress={handlePickModuleFile}
            >
              <Ionicons name="document-text-outline" size={28} color={theme.accent} />
              <Text style={[styles.selectFileText, { color: theme.accent }]}>Select a Module File</Text>
            </Pressable>

            {/* Bundled Modules Section */}
            <View style={styles.bundledSection}>
              <Text style={[styles.bundledTitle, { color: theme.primaryText }]}>Morg's Bundled Modules</Text>

              <Pressable
                style={[styles.bundledModuleCard, { backgroundColor: theme.card, borderColor: theme.border }]}
                onPress={() => handleInstallModule(HIFI_MORGK_MODULE_CODE)}
              >
                <View style={[styles.bundledIconContainer, { backgroundColor: theme.accent + '15' }]}>
                  <Ionicons name="server" size={32} color={theme.accent} />
                </View>
                <View style={styles.bundledModuleInfo}>
                  <Text style={[styles.bundledModuleName, { color: theme.primaryText }]}>HIFI MORGK</Text>
                  <Text style={[styles.bundledModuleDesc, { color: theme.secondaryText }]}>PERFECT • LOSSLESS • STREAM & DOWNLOAD</Text>
                </View>
                <Ionicons name="download-outline" size={24} color={theme.accent} />
              </Pressable>

              <Pressable
                style={[styles.bundledModuleCard, { backgroundColor: theme.card, borderColor: theme.border }]}
                onPress={() => handleInstallModule(TIDAL_MODULE_CODE)}
              >
                <View style={[styles.bundledIconContainer, { backgroundColor: theme.accent + '15' }]}>
                  <Ionicons name="musical-notes" size={32} color={theme.accent} />
                </View>
                <View style={styles.bundledModuleInfo}>
                  <Text style={[styles.bundledModuleName, { color: theme.primaryText }]}>Tidal Music</Text>
                  <Text style={[styles.bundledModuleDesc, { color: theme.secondaryText }]}>LOSSLESS quality • Great for downloading</Text>
                </View>
                <Ionicons name="download-outline" size={24} color={theme.accent} />
              </Pressable>

              <Pressable
                style={[styles.bundledModuleCard, { backgroundColor: theme.card, borderColor: theme.border }]}
                onPress={() => handleInstallModule(YTDL_MODULE_CODE)}
              >
                <View style={[styles.bundledIconContainer, { backgroundColor: theme.accent + '15' }]}>
                  <Ionicons name="logo-youtube" size={32} color={theme.accent} />
                </View>
                <View style={styles.bundledModuleInfo}>
                  <Text style={[styles.bundledModuleName, { color: theme.primaryText }]}>YTDL (Spotify Search)</Text>
                  <Text style={[styles.bundledModuleDesc, { color: theme.secondaryText }]}>Fast • Perfect for streaming</Text>
                </View>
                <Ionicons name="download-outline" size={24} color={theme.accent} />
              </Pressable>

              <Pressable
                style={[styles.bundledModuleCard, { backgroundColor: theme.card, borderColor: theme.border }]}
                onPress={() => handleInstallModule(SPARTDL_MODULE_CODE)}
              >
                <View style={[styles.bundledIconContainer, { backgroundColor: theme.accent + '15' }]}>
                  <Ionicons name="cloud-download-outline" size={32} color={theme.accent} />
                </View>
                <View style={styles.bundledModuleInfo}>
                  <Text style={[styles.bundledModuleName, { color: theme.primaryText }]}>SpartDL (Spotify Downloads)</Text>
                  <Text style={[styles.bundledModuleDesc, { color: theme.secondaryText }]}>I'm hosting it on a potato • Great for downloading</Text>
                </View>
                <Ionicons name="download-outline" size={24} color={theme.accent} />
              </Pressable>
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
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
              <Text style={{ fontWeight: 'bold', color: theme.primaryText }}>1. Ownership and Legality:</Text> You confirm that any music or media accessed through this module belongs to you or that you have purchased it legally. 8SPINE is a tool designed for personal media management and does not endorse or facilitate copyright infringement.
              {"\n\n"}
              <Text style={{ fontWeight: 'bold', color: theme.primaryText }}>2. Supporting Artists:</Text> Music is an art form that requires time, effort, and resources to create. We strongly advise and encourage all users to support artists by purchasing their music through official channels. Stealing music hurts the creators you love.
              {"\n\n"}
              <Text style={{ fontWeight: 'bold', color: theme.primaryText }}>3. User Responsibility:</Text> The 8SPINE team takes no responsibility for the misuse of this advanced feature. You, the user, are solely responsible for ensuring that your use of this app complies with all applicable laws and regulations regarding copyright and intellectual property.
              {"\n\n"}
              <Text style={{ fontWeight: 'bold', color: theme.primaryText }}>4. Enforcement:</Text> 8SPINE actively monitors and takes down any public modules distributed on the internet that violate these terms. We are committed to maintaining a legal and ethical ecosystem for all users ;)
              {"\n\n"}
              <Text style={{ fontWeight: 'bold', fontSize: 20, color: theme.primaryText, textAlign: 'center' }}>You wouldn't steal a car ;)</Text>
              {"\n\n"}
              <Text style={{ fontWeight: 'bold', color: theme.primaryText, fontStyle: 'italic' }}>I, morgk the developer of this app hate pirating media and i will hate you if you pirate media!! i hate illegal stuff &gt;:( !!!!</Text>
              {"\n\n"}
              By clicking "I Agree", you certify that you understand these terms and will use 8SPINE's module engine responsibly and legally.
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
              We understand that advanced users often host their personal music collections in the cloud or have specific preferences for accessing their purchased albums on the go. 8SPINE's module engine is designed to bridge this gap, allowing you to seamlessly connect to your external libraries. By installing custom JavaScript modules, you can stream and download your favorite tracks directly within the app, ensuring your music is always accessible, wherever you are.
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

      {/* Subsonic Configuration Modal */}
      <Modal
        visible={showSubsonicConfig}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowSubsonicConfig(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setShowSubsonicConfig(false)}>
              <Text style={{ color: theme.secondaryText, fontSize: 16 }}>Cancel</Text>
            </Pressable>
            <Text style={[styles.modalTitle, { color: theme.primaryText, fontSize: 18 }]}>Configure Subsonic</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalContent}>
            {/* Server Icon */}
            <View style={styles.illustrationContainer}>
              <View style={[styles.serverIcon, { backgroundColor: theme.accent + '20' }]}>
                <Ionicons name="server-outline" size={48} color={theme.accent} />
              </View>
            </View>

            <Text style={[styles.helpText, { color: theme.secondaryText, marginBottom: 24, textAlign: 'center' }]}>
              Connect to your personal Subsonic music server
            </Text>

            {/* Server URL Input */}
            <View style={{ marginBottom: 16 }}>
              <Text style={[styles.modalLabel, { color: theme.primaryText, marginBottom: 8 }]}>
                Server URL
              </Text>
              <TextInput
                style={[styles.codeInput, {
                  backgroundColor: theme.inputBackground,
                  color: theme.primaryText,
                  height: 48,
                  fontFamily: undefined
                }]}
                placeholder="https://music.example.com"
                placeholderTextColor={theme.secondaryText}
                value={subsonicServer}
                onChangeText={setSubsonicServer}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </View>

            {/* Username Input */}
            <View style={{ marginBottom: 16 }}>
              <Text style={[styles.modalLabel, { color: theme.primaryText, marginBottom: 8 }]}>
                Username
              </Text>
              <TextInput
                style={[styles.codeInput, {
                  backgroundColor: theme.inputBackground,
                  color: theme.primaryText,
                  height: 48,
                  fontFamily: undefined
                }]}
                placeholder="username"
                placeholderTextColor={theme.secondaryText}
                value={subsonicUsername}
                onChangeText={setSubsonicUsername}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Password Input */}
            <View style={{ marginBottom: 24 }}>
              <Text style={[styles.modalLabel, { color: theme.primaryText, marginBottom: 8 }]}>
                Password
              </Text>
              <TextInput
                style={[styles.codeInput, {
                  backgroundColor: theme.inputBackground,
                  color: theme.primaryText,
                  height: 48,
                  fontFamily: undefined
                }]}
                placeholder="password"
                placeholderTextColor={theme.secondaryText}
                value={subsonicPassword}
                onChangeText={setSubsonicPassword}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
            </View>

            {/* Test Connection Button */}
            <Pressable
              style={[styles.modalInstallButton, {
                backgroundColor: theme.border,
                marginBottom: 12
              }]}
              onPress={handleTestSubsonicConnection}
              disabled={testingConnection}
            >
              {testingConnection ? (
                <ActivityIndicator color={theme.accent} />
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="checkmark-circle-outline" size={20} color={theme.primaryText} />
                  <Text style={[styles.modalInstallButtonText, { color: theme.primaryText }]}>
                    Test Connection
                  </Text>
                </View>
              )}
            </Pressable>

            {/* Install Button */}
            <Pressable
              style={[styles.modalInstallButton, { backgroundColor: theme.accent }]}
              onPress={handleInstallSubsonic}
              disabled={installingModule === 'subsonic'}
            >
              {installingModule === 'subsonic' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="download-outline" size={20} color="#fff" />
                  <Text style={styles.modalInstallButtonText}>Install Module</Text>
                </View>
              )}
            </Pressable>

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
  moduleLabels: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  labelTag: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  labelText: { fontSize: 11, fontWeight: '500' },
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
  illustrationContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    marginBottom: 16,
  },
  illustrationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  serverIcon: {
    width: 80,
    height: 80,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneIcon: {
    width: 80,
    height: 80,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectionLine: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  selectFileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    borderRadius: 16,
    borderWidth: 2,
    gap: 12,
    marginBottom: 32,
  },
  selectFileText: {
    fontSize: 18,
    fontWeight: '600',
  },
  bundledSection: {
    gap: 12,
  },
  bundledTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  bundledModuleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 16,
    marginBottom: 12,
  },
  bundledIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bundledModuleInfo: {
    flex: 1,
    gap: 4,
  },
  bundledModuleName: {
    fontSize: 16,
    fontWeight: '600',
  },
  bundledModuleDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  moduleDetailsCard: {
    margin: 16,
    padding: 20,
    borderRadius: 16,
    gap: 16,
  },
  moduleDetailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  moduleDetailsIcon: {
    width: 80,
    height: 80,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleDetailsInfo: {
    flex: 1,
    gap: 4,
  },
  moduleDetailsName: {
    fontSize: 22,
    fontWeight: '700',
  },
  moduleDetailsVersion: {
    fontSize: 14,
    fontWeight: '500',
  },
  moduleDetailsAuthor: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  moduleDetailsLabels: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  moduleDetailLabel: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  moduleDetailLabelText: {
    fontSize: 12,
    fontWeight: '600',
  },
  moduleDetailsDescription: {
    fontSize: 14,
    lineHeight: 20,
  },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 20,
    borderRadius: 16,
  },
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
