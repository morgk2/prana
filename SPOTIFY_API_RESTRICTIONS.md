# Spotify API Restrictions - Related Artists Endpoint

## Issue Summary
The app is experiencing 404 errors when attempting to fetch related artists from the Spotify API. This is **expected behavior** due to recent API restrictions.

## Background

On **November 27, 2024**, Spotify announced significant changes to their Web API that restrict access to several endpoints for new and development-mode applications.

**Official Announcement:** https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api

## Restricted Endpoints (as of Nov 27, 2024)

The following endpoints are no longer accessible to new and development-mode apps:

1. ❌ **Related Artists** ← Currently causing 404 errors
2. ❌ Recommendations
3. ❌ Audio Features
4. ❌ Audio Analysis
5. ❌ Get Featured Playlists
6. ❌ Get Category's Playlists
7. ❌ 30-second preview URLs
8. ❌ Algorithmic playlists

## Who is Affected

### Apps That CANNOT Access These Endpoints:
- New apps registered on or after November 27, 2024
- Existing apps in **Development Mode** (without extended quota mode)

### Apps That CAN Still Access:
- Apps with **Extended Quota Mode** access (approved before Nov 27, 2024)

## Current App Status

This app uses **Client Credentials Flow** with hardcoded credentials, indicating it's in **Development Mode**. Therefore, the Related Artists endpoint returns 404, which is expected behavior.

## Current Solution (Already Implemented)

The app already includes a **fallback to Last.fm** API:
- When Spotify returns 404, the app automatically fetches similar artists from Last.fm
- This ensures the "Fans also like" section in ArtistPage still works
- Users may see slightly different artist recommendations compared to Spotify's algorithm

### Implementation:
```javascript
// In src/api/lastfm.js
export async function getRelatedArtists(artistName, { limit = 20, artistId = null } = {}) {
  // Try Spotify first
  // If 404 (restricted), fall back to Last.fm
  return getLastfmSimilarArtists(artistName, limit);
}
```

## Options Moving Forward

### Option 1: Continue Using Last.fm Fallback (Recommended)
- ✅ Already implemented and working
- ✅ No additional setup required
- ✅ Free and reliable
- ℹ️ Different recommendation algorithm than Spotify

### Option 2: Apply for Extended Quota Mode
If this is a production app that needs Spotify's related artists:

1. Register your app at https://developer.spotify.com/dashboard
2. Submit for Extended Quota Mode access
3. Explain your use case and how you'll use the API
4. Wait for approval (may take several weeks)
5. Update credentials in the app once approved

**Note:** Spotify is being selective about granting extended access, especially for endpoints they restricted.

### Option 3: Hybrid Approach
- Use Last.fm for related artists (current implementation)
- Keep other Spotify features that still work (top tracks, albums, search)
- Provides the best user experience without requiring approval

## Conclusion

The 404 errors are **not a bug** but rather the result of Spotify's intentional API restrictions. The current fallback to Last.fm is the appropriate solution for development-mode apps and ensures the feature continues to work for users.

## References

- [Spotify's API Changes Announcement](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)
- [TechCrunch Article](https://techcrunch.com/2024/11/27/spotify-cuts-developer-access-to-several-of-its-recommendation-features/)
- [Last.fm API Documentation](https://www.last.fm/api/show/artist.getSimilar)
