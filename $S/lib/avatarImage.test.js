"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// What may be written into profiles.avatar, and what a screen may draw from it.
// Compile with tsc, run with node.
//
// The assertion this suite exists for is the one that shipped: a device path is
// not a URL, it means nothing in a row other accounts read, and neither the
// write nor the render may accept one.
const avatarImage_1 = require("./avatarImage");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── the key ───────────────────────────────────────────────────────────── */
const UID = '11111111-2222-3333-4444-555555555555';
eq((0, avatarImage_1.avatarObjectKey)(UID, 'a1b2c3d4e5f6'), `${UID}/a1b2c3d4e5f6.jpg`, 'the first folder is the member’s own id, which is what the storage policy scopes by');
ok(!(0, avatarImage_1.avatarObjectKey)(UID, 'a1b2c3d4e5f6').startsWith('/'), 'and the key is relative — a leading slash makes a folder nobody owns');
let threw = false;
try {
    (0, avatarImage_1.avatarObjectKey)('  ', 'a1b2c3d4e5f6');
}
catch {
    threw = true;
}
ok(threw, 'a key with no signed-in id throws rather than landing at the root of a shared bucket');
threw = false;
try {
    (0, avatarImage_1.avatarObjectKey)(UID, 'x');
}
catch {
    threw = true;
}
ok(threw, 'and a key with no random token throws rather than being guessable');
const a = (0, avatarImage_1.avatarObjectKey)(UID, 'aaaaaaaa11');
const b = (0, avatarImage_1.avatarObjectKey)(UID, 'bbbbbbbb22');
ok(a !== b, 'two uploads by the same member are two objects, never the same key rewritten');
/* ── the size ──────────────────────────────────────────────────────────── */
eq((0, avatarImage_1.avatarRefusal)(120000), null, 'an ordinary photo is accepted');
ok((0, avatarImage_1.avatarRefusal)(avatarImage_1.MAX_AVATAR_BYTES + 1) != null, 'and one over the bucket’s own limit is refused here');
ok(!/413|error/i.test((0, avatarImage_1.avatarRefusal)(avatarImage_1.MAX_AVATAR_BYTES + 1)), 'in a sentence, before a byte leaves — not as a status code afterwards');
ok((0, avatarImage_1.avatarRefusal)(0) != null, 'nothing read off the phone is a refusal, not a zero-byte upload');
ok((0, avatarImage_1.avatarRefusal)(Number.NaN) != null, 'and so is a length nothing could measure');
/* ── the thing that shipped ────────────────────────────────────────────── */
for (const p of [
    'file:///var/mobile/Containers/Data/Application/ABC/tmp/img.jpg',
    'FILE:///var/mobile/x.jpg',
    '  file:///private/var/x.heic  ',
    'content://media/external/images/media/42',
    'ph://8B7A1234-0000-0000-0000-000000000000/L0/001',
    'assets-library://asset/asset.JPG?id=1&ext=JPG',
    '/var/mobile/Containers/Data/Application/ABC/tmp/img.jpg',
    '/data/user/0/com.repple/cache/img.jpg',
    '/storage/emulated/0/DCIM/img.jpg',
]) {
    ok((0, avatarImage_1.isDeviceAvatar)(p), `a device path is recognised as one: ${p}`);
    eq((0, avatarImage_1.avatarSource)(p), null, `and is never drawn as an image: ${p}`);
}
ok(!(0, avatarImage_1.isDeviceAvatar)('https://x.test/storage/v1/object/public/avatars/u/a.jpg'), 'a real URL that merely contains the word storage is not a device path');
ok(!(0, avatarImage_1.isDeviceAvatar)(null) && !(0, avatarImage_1.isDeviceAvatar)('') && !(0, avatarImage_1.isDeviceAvatar)('   '), 'and an empty avatar is not a device path either — it is no avatar');
/* ── what may be drawn ─────────────────────────────────────────────────── */
const url = 'https://proj.supabase.co/storage/v1/object/public/avatars/u/abc.jpg';
eq((0, avatarImage_1.avatarSource)(` ${url} `), url, 'a stored URL is trimmed and drawn');
eq((0, avatarImage_1.avatarSource)('http://proj.test/a.jpg'), 'http://proj.test/a.jpg', 'http is allowed — a self-hosted project is not https everywhere');
eq((0, avatarImage_1.avatarSource)('data:image/jpeg;base64,AAA'), 'data:image/jpeg;base64,AAA', 'and a data URI, which is what an export embeds');
eq((0, avatarImage_1.avatarSource)(null), null, 'no avatar is no avatar');
eq((0, avatarImage_1.avatarSource)('null'), null, 'the STRING null is not an avatar — that is a stringified write, and it would be fetched as a relative path');
eq((0, avatarImage_1.avatarSource)('undefined'), null, 'same for undefined');
eq((0, avatarImage_1.avatarSource)('javascript:alert(1)'), null, 'and nothing that is not an image URL is handed to an <Image> source');
eq((0, avatarImage_1.avatarSource)('/avatars/u/abc.jpg'), null, 'a bare path has no host and cannot be fetched by another account’s app');
/* ── the copy ──────────────────────────────────────────────────────────── */
eq(avatarImage_1.AVATAR_BUCKET, 'avatars', 'the bucket name matches supabase/parts/961');
ok(/blank circle|nobody else/.test(avatarImage_1.DEVICE_AVATAR_NOTE), 'the member is told what actually happened, not merely asked to add a photo');
ok(/not been changed|not uploaded/.test(avatarImage_1.AVATAR_UPLOAD_FAILED_NOTE), 'and a failed upload is never described as saved');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('avatarImage.test.ts — all assertions passed');
