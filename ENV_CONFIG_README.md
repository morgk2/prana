# Environment Configuration Guide

## Overview

This project uses a `.env` file to manage API keys and secrets securely. All hardcoded API keys have been removed from the source code and are now stored in environment configuration files.

## ⚠️ Security Important

- **Never commit `.env` to version control** - It's already added to `.gitignore`
- Keep your API keys secure and private
- Don't share your `.env` file with others

## File Structure

```
Prana/
├── .env                          # Your API keys (DO NOT COMMIT)
├── src/
│   └── config/
│       └── envConfig.js          # Auto-generated config module
└── scripts/
    └── sync-env.js               # Script to sync .env to envConfig.js
```

## Setup Instructions

### 1. Update API Keys

Edit `.env` in the root directory and add your API keys:

```env
# Last.fm API Key
LASTFM_API_KEY=your_lastfm_api_key_here

# Spotify API Credentials
SPOTIFY_CLIENT_ID=your_spotify_client_id_here
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here

# PaxSenix API Key (for YTDL)
PAXSENIX_API_KEY=your_paxsenix_api_key_here

# Apple Music Developer Token
APPLE_MUSIC_DEVELOPER_TOKEN=your_apple_music_token_here
```

### 2. Sync Configuration

After updating `.env`, run the sync script to update the config module:

```bash
node scripts/sync-env.js
```

This will automatically generate/update `src/config/envConfig.js` with your API keys.

### 3. Verify Configuration

The sync script will display:
- Number of configuration keys found
- List of all configuration keys
- Success/error messages

## How It Works

1. **`.env`**: Stores your actual API keys (gitignored)
2. **`scripts/sync-env.js`**: Reads `.env` and generates JavaScript config
3. **`src/config/envConfig.js`**: Auto-generated module that exports configuration
4. **Service files**: Import from `envConfig.js` instead of hardcoding keys

## Files Updated

The following files now use environment configuration:

- ✅ `src/api/lastfm.js` - Last.fm and Spotify API
- ✅ `src/services/SpotifyService.js` - Spotify service
- ✅ `src/services/AppleMusicService.js` - Apple Music service
- ✅ `src/services/ytdlModule.js` - YTDL module with PaxSenix

## Getting API Keys

### Last.fm API Key
1. Visit https://www.last.fm/api/account/create
2. Create an application
3. Copy your API key

### Spotify API
1. Visit https://developer.spotify.com/dashboard
2. Create an app
3. Copy your Client ID and Client Secret

### PaxSenix API Key
Contact PaxSenix or check their documentation for API access

### Apple Music Developer Token
1. Generate using `scripts/generate-apple-jwt.js`
2. See Apple Music API documentation

## Troubleshooting

### Missing API Keys Warning

If you see warnings about missing keys:
```
[ENV CONFIG] Missing or placeholder API keys: SPOTIFY_CLIENT_ID, ...
```

1. Check that `.env` exists and has all required keys
2. Make sure keys don't have placeholder values like `YOUR_KEY_HERE`
3. Run `node scripts/sync-env.js` after updating `.env`

### Import Errors

If you get import errors:
1. Ensure `src/config/envConfig.js` exists
2. Run `node scripts/sync-env.js` to regenerate it
3. Check that file paths in imports are correct

## Development Workflow

1. Clone repository
2. Create your own `.env` with your API keys
3. Run `node scripts/sync-env.js`
4. Start development

## Production Deployment

For production deployments:
- Use proper environment variables
- Consider moving secrets to a secure backend
- Never expose client secrets in frontend code
- Use server-side API proxies for sensitive operations

## Notes

- `envConfig.js` is auto-generated - don't edit it manually
- If you need to add new API keys, add them to `.env` first
- Then update the sync script and import statements as needed
- The sync script ensures all keys are properly formatted
