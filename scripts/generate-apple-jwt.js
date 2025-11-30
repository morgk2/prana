const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// INSTRUCTIONS:
// 1. Place your .p8 file in the root or this scripts folder
// 2. Run: node scripts/generate-apple-jwt.js <TEAM_ID> <KEY_ID> <PATH_TO_P8_FILE>
//    Example: node scripts/generate-apple-jwt.js 1A2B3C4D5E ABC1234567 AuthKey_ABC1234567.p8

const args = process.argv.slice(2);

if (args.length < 3) {
    console.error('Usage: node scripts/generate-apple-jwt.js <TEAM_ID> <KEY_ID> <PATH_TO_P8_FILE>');
    process.exit(1);
}

const [teamId, keyId, keyFile] = args;

const keyPath = path.isAbsolute(keyFile) ? keyFile : path.join(process.cwd(), keyFile);

if (!fs.existsSync(keyPath)) {
    console.error(`Error: Key file not found at ${keyPath}`);
    process.exit(1);
}

const privateKey = fs.readFileSync(keyPath, 'utf8');

function signES256(payload, key) {
    try {
        const jwt = require('jsonwebtoken');
        const token = jwt.sign({}, privateKey, {
            algorithm: 'ES256',
            expiresIn: '180d',
            issuer: teamId,
            header: {
                alg: 'ES256',
                kid: keyId
            }
        });
        return token;
    } catch (e) {
        console.error("\n!!! MISSING DEPENDENCY !!!");
        console.error("Please run: npm install jsonwebtoken --save-dev");
        console.error("Then run this script again.\n");
        process.exit(1);
    }
}

console.log('Generating Apple Music Developer Token...');
const token = signES256({}, privateKey);

console.log('\nSUCCESS! Here is your Developer Token (valid for 6 months):\n');
console.log(token);
console.log('\nCopy this token into your src/services/AppleMusicService.js file.\n');
