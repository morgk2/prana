const fs = require('fs');
const path = require('path');

const mode = process.argv[2]; // 'enable' or 'disable'

if (mode !== 'enable' && mode !== 'disable') {
    console.error('Usage: node scripts/toggle-player.js [enable|disable]');
    process.exit(1);
}

const projectRoot = path.resolve(__dirname, '..');

const files = {
    index: path.join(projectRoot, 'index.js'),
    setupService: path.join(projectRoot, 'src', 'services', 'SetupService.js'),
    trackPlayerService: path.join(projectRoot, 'src', 'services', 'TrackPlayerService.js'),
    app: path.join(projectRoot, 'App.js'),
};

function replaceInFile(filePath, replacements) {
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        return;
    }

    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    for (const { search, replace, description } of replacements) {
        let matchFound = false;
        if (typeof search === 'string') {
            if (content.includes(search)) {
                content = content.replace(search, replace);
                matchFound = true;
            }
        } else if (search instanceof RegExp) {
            if (search.test(content)) {
                content = content.replace(search, replace);
                matchFound = true;
            }
        }

        if (matchFound) {
            modified = true;
            console.log(`[${path.basename(filePath)}] Applied: ${description}`);
        } else {
            // Check if it looks like it's already applied (heuristic)
            // This is hard to do generically, so we just warn
            console.log(`[${path.basename(filePath)}] Pattern not found (or already applied): ${description}`);
        }
    }

    if (modified) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated ${path.basename(filePath)}`);
    }
}

const replacements = {
    disable: {
        index: [
            {
                search: "import TrackPlayer from 'react-native-track-player';",
                replace: "// import TrackPlayer from 'react-native-track-player';",
                description: "Comment TrackPlayer import"
            },
            {
                search: "TrackPlayer.registerPlaybackService(() => require('./src/services/TrackPlayerService'));",
                replace: "// TrackPlayer.registerPlaybackService(() => require('./src/services/TrackPlayerService'));",
                description: "Comment registerPlaybackService"
            }
        ],
        setupService: [
            {
                search: "import TrackPlayer, { AppKilledPlaybackBehavior, Capability, RepeatMode } from 'react-native-track-player';",
                replace: "// import TrackPlayer, { AppKilledPlaybackBehavior, Capability, RepeatMode } from 'react-native-track-player';",
                description: "Comment TrackPlayer import"
            },
            {
                search: /try\s*\{[\s\S]*?await TrackPlayer\.getActiveTrackIndex\(\);[\s\S]*?\} finally \{[\s\S]*?return isSetup;[\s\S]*?\}/,
                replace: (match) => `/*\n    ${match}\n    */\n    return isSetup;`,
                description: "Comment setupPlayer body"
            }
        ],
        trackPlayerService: [
            {
                search: "import TrackPlayer, { Event } from 'react-native-track-player';",
                replace: "// import TrackPlayer, { Event } from 'react-native-track-player';",
                description: "Comment TrackPlayer import"
            },
            {
                search: /TrackPlayer\.addEventListener\(Event\.RemotePlay[\s\S]*?\}\);/g,
                replace: (match) => `/*\n    ${match}\n    */`,
                description: "Comment event listeners"
            }
        ],
        app: [
            {
                search: "import SongPlayer from './src/components/SongPlayer';",
                replace: "// import SongPlayer from './src/components/SongPlayer';",
                description: "Comment SongPlayer import"
            },
            {
                search: "import SongPlayerV2 from './src/components/SongPlayerV2';",
                replace: "// import SongPlayerV2 from './src/components/SongPlayerV2';",
                description: "Comment SongPlayerV2 import"
            },
            {
                search: "import { setupPlayer } from './src/services/SetupService';",
                replace: "// import { setupPlayer } from './src/services/SetupService';",
                description: "Comment setupPlayer import"
            },
            {
                search: "await setupPlayer();",
                replace: "// await setupPlayer();",
                description: "Comment setupPlayer call"
            },
            {
                search: "{currentTrack && (",
                replace: "{/* {currentTrack && (",
                description: "Comment SongPlayerV2 render start"
            },
            {
                search: /playerColorMode=\{playerColorMode\}\s*\/>\s*\)\}/,
                replace: (match) => `${match} */}`,
                description: "Comment SongPlayerV2 render end"
            }
        ]
    },
    enable: {
        index: [
            {
                search: "// import TrackPlayer from 'react-native-track-player';",
                replace: "import TrackPlayer from 'react-native-track-player';",
                description: "Uncomment TrackPlayer import"
            },
            {
                search: "// TrackPlayer.registerPlaybackService(() => require('./src/services/TrackPlayerService'));",
                replace: "TrackPlayer.registerPlaybackService(() => require('./src/services/TrackPlayerService'));",
                description: "Uncomment registerPlaybackService"
            }
        ],
        setupService: [
            {
                search: "// import TrackPlayer, { AppKilledPlaybackBehavior, Capability, RepeatMode } from 'react-native-track-player';",
                replace: "import TrackPlayer, { AppKilledPlaybackBehavior, Capability, RepeatMode } from 'react-native-track-player';",
                description: "Uncomment TrackPlayer import"
            },
            {
                search: /\/\*\s*(try\s*\{[\s\S]*?await TrackPlayer\.getActiveTrackIndex\(\);[\s\S]*?\} finally \{[\s\S]*?return isSetup;[\s\S]*?\})\s*\*\/\s*return isSetup;/,
                replace: "$1",
                description: "Uncomment setupPlayer body"
            }
        ],
        trackPlayerService: [
            {
                search: "// import TrackPlayer, { Event } from 'react-native-track-player';",
                replace: "import TrackPlayer, { Event } from 'react-native-track-player';",
                description: "Uncomment TrackPlayer import"
            },
            {
                search: /\/\*\s*(TrackPlayer\.addEventListener\(Event\.RemotePlay[\s\S]*?\}\);)\s*\*\//,
                replace: "$1",
                description: "Uncomment event listeners"
            }
        ],
        app: [
            {
                search: "// import SongPlayer from './src/components/SongPlayer';",
                replace: "import SongPlayer from './src/components/SongPlayer';",
                description: "Uncomment SongPlayer import"
            },
            {
                search: "// import SongPlayerV2 from './src/components/SongPlayerV2';",
                replace: "import SongPlayerV2 from './src/components/SongPlayerV2';",
                description: "Uncomment SongPlayerV2 import"
            },
            {
                search: "// import { setupPlayer } from './src/services/SetupService';",
                replace: "import { setupPlayer } from './src/services/SetupService';",
                description: "Uncomment setupPlayer import"
            },
            {
                search: "// await setupPlayer();",
                replace: "await setupPlayer();",
                description: "Uncomment setupPlayer call"
            },
            {
                search: "{/* {currentTrack && (",
                replace: "{currentTrack && (",
                description: "Uncomment SongPlayerV2 render start"
            },
            {
                search: /(playerColorMode=\{playerColorMode\}\s*\/>\s*\)\})\s*\*\/\}/,
                replace: "$1",
                description: "Uncomment SongPlayerV2 render end"
            }
        ]
    }
};

console.log(`Running in ${mode} mode...`);

if (mode === 'disable') {
    replaceInFile(files.index, replacements.disable.index);
    replaceInFile(files.setupService, replacements.disable.setupService);
    replaceInFile(files.trackPlayerService, replacements.disable.trackPlayerService);
    replaceInFile(files.app, replacements.disable.app);
} else {
    replaceInFile(files.index, replacements.enable.index);
    replaceInFile(files.setupService, replacements.enable.setupService);
    replaceInFile(files.trackPlayerService, replacements.enable.trackPlayerService);
    replaceInFile(files.app, replacements.enable.app);
}

console.log('Done.');
