
/**
 * Parses LRC string into an array of objects
 * @param {string} lrcString 
 * @returns {Array<{time: number, text: string}>}
 */
export function parseLrc(lrcString) {
    if (!lrcString) return [];

    const lines = lrcString.split('\n');
    const result = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

    for (const line of lines) {
        const match = timeRegex.exec(line);
        if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const milliseconds = parseInt(match[3].padEnd(3, '0'), 10); // Ensure 3 digits for ms

            const time = minutes * 60 + seconds + milliseconds / 1000;
            const text = line.replace(timeRegex, '').trim();

            result.push({ time, text });
        }
    }

    return result.sort((a, b) => a.time - b.time);
}
