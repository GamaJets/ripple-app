"use strict";
// Code 39 barcode generator (pure). Turns a member id into bar/space segments a
// gym scanner can read. Code 39 is self-checking, needs no checksum, and covers
// 0-9 A-Z and a few symbols — ideal for membership numbers. Renderer draws the
// returned segments as a row of Views.
Object.defineProperty(exports, "__esModule", { value: true });
exports.code39Segments = code39Segments;
// Canonical Code 39 patterns: 9 elements each (bar,space,bar,…), n=narrow w=wide.
const PATTERNS = {
    '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
    '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
    'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn',
    'F': 'nnwnwwnnn', 'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
    'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww', 'O': 'wnnnwnnwn',
    'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn', 'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn',
    'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw', 'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn',
    'Z': 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
    '$': 'nwnwnwnnn', '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn',
};
/** Encode text as Code 39 segments. narrow width = 1 unit, wide = ratio units. */
function code39Segments(text, ratio = 3) {
    const clean = (text || '').toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '');
    const chars = ('*' + clean + '*').split('');
    const segs = [];
    chars.forEach((ch, ci) => {
        const pat = PATTERNS[ch] || PATTERNS['*'];
        for (let i = 0; i < pat.length; i++) {
            segs.push({ w: pat[i] === 'w' ? ratio : 1, bar: i % 2 === 0 });
        }
        if (ci < chars.length - 1)
            segs.push({ w: 1, bar: false }); // inter-char gap
    });
    return segs;
}
