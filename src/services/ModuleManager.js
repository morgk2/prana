import AsyncStorage from '@react-native-async-storage/async-storage';

class ModuleManagerService {
    constructor() {
        this.modules = new Map();
        this.activeModuleId = null;
    }

    async init() {
        try {
            // Load installed modules from storage
            const storedModules = await AsyncStorage.getItem('user_modules');
            if (storedModules) {
                const parsedModules = JSON.parse(storedModules);
                for (const moduleData of parsedModules) {
                    this.loadModule(moduleData.code);
                }
            }
            
            // If no modules, we might want to prompt user or just be empty.
            // The requirement is "ship with no modules", but "tidal 100% functional if it becomes installable".
            // I'll handle the "install default" externally or via a debug trigger for now.
            
        } catch (error) {
            console.error('[ModuleManager] Failed to init:', error);
        }
    }

    loadModule(code) {
        try {
            // robust wrapper to allow the script to return the module object
            // We wrap in an IIFE or just new Function
            const createModule = new Function(code);
            const moduleInstance = createModule();
            
            if (!moduleInstance || !moduleInstance.id) {
                throw new Error('Module must return an object with an id');
            }

            this.modules.set(moduleInstance.id, moduleInstance);
            console.log(`[ModuleManager] Loaded module: ${moduleInstance.name} (${moduleInstance.id})`);
            
            // Auto-select first loaded module if none active
            if (!this.activeModuleId) {
                this.activeModuleId = moduleInstance.id;
            }
            
            return moduleInstance;
        } catch (error) {
            console.error('[ModuleManager] Failed to load module:', error);
            throw error;
        }
    }

    async installModule(code) {
        try {
            const moduleInstance = this.loadModule(code);
            
            // Persist
            const storedModules = await AsyncStorage.getItem('user_modules');
            const modulesList = storedModules ? JSON.parse(storedModules) : [];
            
            // Update or add
            const existingIndex = modulesList.findIndex(m => m.id === moduleInstance.id);
            if (existingIndex >= 0) {
                modulesList[existingIndex] = { id: moduleInstance.id, code };
            } else {
                modulesList.push({ id: moduleInstance.id, code });
            }
            
            await AsyncStorage.setItem('user_modules', JSON.stringify(modulesList));
            return moduleInstance;
        } catch (error) {
            throw error;
        }
    }

    async uninstallModule(moduleId) {
        this.modules.delete(moduleId);
        if (this.activeModuleId === moduleId) {
            this.activeModuleId = this.modules.keys().next().value || null;
        }
        
        const storedModules = await AsyncStorage.getItem('user_modules');
        if (storedModules) {
            const modulesList = JSON.parse(storedModules);
            const filtered = modulesList.filter(m => m.id !== moduleId);
            await AsyncStorage.setItem('user_modules', JSON.stringify(filtered));
        }
    }

    getModule(moduleId) {
        return this.modules.get(moduleId);
    }

    getActiveModule() {
        if (!this.activeModuleId) return null;
        return this.modules.get(this.activeModuleId);
    }

    getAllModules() {
        return Array.from(this.modules.values());
    }

    // --- Proxy Methods ---

    async searchTracks(query, limit) {
        const module = this.getActiveModule();
        if (!module) throw new Error('No active music module installed');
        if (!module.searchTracks) throw new Error(`Module ${module.name} does not support searchTracks`);
        return module.searchTracks(query, limit);
    }

    async getTrackStreamUrl(trackId, quality) {
        // If trackId contains module info (e.g. "tidal:123"), route to that module
        // For now assuming active module or passed explicitly?
        // We'll stick to active module for simple search->play flow
        const module = this.getActiveModule();
        if (!module) throw new Error('No active music module installed');
        return module.getTrackStreamUrl(trackId, quality);
    }
    
    async getAlbum(albumId) {
        const module = this.getActiveModule();
        if (!module) throw new Error('No active music module');
        return module.getAlbum(albumId);
    }

    async getArtist(artistId) {
        const module = this.getActiveModule();
        if (!module) throw new Error('No active music module');
        return module.getArtist(artistId);
    }
}

export const ModuleManager = new ModuleManagerService();
