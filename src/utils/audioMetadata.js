import { Buffer } from 'buffer';
import jsmediatags from '../../node_modules/jsmediatags/dist/jsmediatags.min.js';

// Polyfill Buffer globally for jsmediatags if needed
global.Buffer = global.Buffer || Buffer;

function parseNumericTag(value) {
  if (value == null) return null;
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }
  const str = String(value).trim();
  if (!str) return null;
  const match = str.match(/^(\d+)/);
  if (match) {
    const num = Number(match[1]);
    return Number.isNaN(num) ? null : num;
  }
  return null;
}

export async function getAudioMetadata(uri) {
  return new Promise((resolve) => {
    // 1. Resolve the URI to a Blob (works with file:// in React Native)
    fetch(uri)
      .then((res) => res.blob())
      .then((blob) => {
        // 2. Use jsmediatags on the Blob
        jsmediatags.read(blob, {
          onSuccess: (tag) => {
            const { tags } = tag;
            const metadata = {
              title: tags.title || null,
              artist: tags.artist || null,
              album: tags.album || null,
              albumArtist: tags.albumartist || tags['album artist'] || tags.band || null,
              trackNumber: parseNumericTag(tags.track || tags.TRCK),
              discNumber: parseNumericTag(tags.part_of_a_set || tags.TPOS),
              genre: tags.genre || null,
              year: tags.year || tags.date || null,
              image: null,
            };

            // 3. Process picture if present
            if (tags.picture) {
              const { data, format } = tags.picture;
              let base64String = '';
              // data is an array of bytes (integers)
              for (let i = 0; i < data.length; i++) {
                base64String += String.fromCharCode(data[i]);
              }
              // Convert binary string to base64
              const base64 = btoa(base64String);
              metadata.image = `data:${format};base64,${base64}`;
            }

            resolve(metadata);
          },
          onError: (error) => {
            console.warn('jsmediatags error:', error);
            resolve({}); // Return empty object on failure to allow fallback
          },
        });
      })
      .catch((err) => {
        console.warn('Fetch blob error for metadata:', err);
        resolve({});
      });
  });
}
