"use strict";
// A coach's own logo: where the bytes live, what may be stored, and how the
// mark is safely put onto a document.
//
// ── Why this file exists at all ────────────────────────────────────────────
//
// app/(trainer)/brand.tsx refused a logo field, and its header says why: "a
// second image column with no uploader behind it is precisely the promise that
// had to be walked back". That refusal is kept by BUILDING the other end rather
// than by leaving the column out. supabase/parts/330 is the column, the bucket
// and the policies; src/ui/coachLogo.ts is the picker and the upload; this is
// the part that has no device, no network and no React in it, so every rule
// below can be asserted under `npm test`.
//
// ── The boundary that is NOT crossed ──────────────────────────────────────
//
// The app's name, its icon and its domain are still refused, and nothing here
// touches them. `src/lib/brands.ts` is the build-time brand axis and a bundle
// id belongs to whoever publishes the app. What this adds is the coach's mark
// on the coach's own paperwork: an invoice they issue, a report they prepare
// and a card they post.
//
// ── The one genuinely dangerous function in here ──────────────────────────
//
// `logoImgHtml` writes an <img> into a document that is otherwise built from
// `escapeHtml`-ed values. A data URI is not escapable — escaping the base64
// would break the picture — so it is VALIDATED instead, against a pattern that
// admits nothing but base64 after one of two literal prefixes. `safeLogoDataUri`
// is the whole of that decision and it is tested against the strings somebody
// would actually use to get out of the attribute.
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOGO_UNREADABLE_NOTE = exports.LOGO_SCOPE_NOTE = exports.LOGO_CSS = exports.MAX_LOGO_DATA_URI = exports.LOGO_MIME_TYPES = exports.LOGO_MAX_PX = exports.MAX_LOGO_BYTES = exports.LOGO_BUCKET = void 0;
exports.logoExtension = logoExtension;
exports.logoContentType = logoContentType;
exports.coachLogoPath = coachLogoPath;
exports.isOwnLogoPath = isOwnLogoPath;
exports.logoRefusal = logoRefusal;
exports.logoDataUri = logoDataUri;
exports.safeLogoDataUri = safeLogoDataUri;
exports.logoImgHtml = logoImgHtml;
exports.base64FromBytes = base64FromBytes;
/* ── the bucket ────────────────────────────────────────────────────────────── */
/** The private bucket from supabase/parts/330. */
exports.LOGO_BUCKET = 'coach-logos';
/**
 * The same 2 MB the bucket is configured with.
 *
 * Said here as well so the app can refuse a file with a sentence BEFORE a byte
 * leaves the phone. Storage answers an over-large object with a 413 that
 * arrives as an opaque failure, which is a coach staring at "could not upload"
 * with nothing to do about it.
 */
exports.MAX_LOGO_BYTES = 2 * 1024 * 1024;
/**
 * The longest edge a logo is stored at.
 *
 * A mark, not a photograph. 512 is comfortably more than the largest it is ever
 * drawn at (the share card's 1080-wide export puts it at about 190px) and small
 * enough that the base64 of it can be embedded in an invoice's HTML without the
 * document becoming something a phone struggles to print.
 */
exports.LOGO_MAX_PX = 512;
/** What the bucket accepts, and what this module will build a data URI for. */
exports.LOGO_MIME_TYPES = ['image/png', 'image/jpeg'];
/**
 * The file extension for a stored logo.
 *
 * PNG is kept as PNG because a mark with a transparent ground is the normal
 * case and JPEG cannot carry one. Anything else has been re-encoded as JPEG by
 * the uploader before it gets here, so 'jpg' is the honest answer rather than a
 * guess: the name and the bytes cannot disagree, which is the property
 * src/lib/injuryDocView.ts depends on for its own files.
 */
function logoExtension(mime) {
    return String(mime ?? '').toLowerCase() === 'image/png' ? 'png' : 'jpg';
}
/** The content type a stored key declares, from its extension. Null when the
 *  name is not one this app ever wrote. */
function logoContentType(path) {
    const n = String(path ?? '').toLowerCase();
    if (n.endsWith('.png'))
        return 'image/png';
    if (n.endsWith('.jpg') || n.endsWith('.jpeg'))
        return 'image/jpeg';
    return null;
}
/**
 * Where one coach's logo goes.
 *
 * The first segment is the coach's own id, because that is what the storage
 * policies in part 330 key on and what `trainers_logo_path_own_folder` requires
 * of the column. The timestamp and token make every upload a NEW object: the
 * bucket has no UPDATE policy on purpose, so replacing a logo is an insert
 * followed by a delete rather than a silent overwrite of bytes a document has
 * already been printed with.
 */
function coachLogoPath(coachId, at, token, ext) {
    const safe = String(token ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'logo';
    return `${coachId}/${Math.floor(at)}-${safe}.${ext}`;
}
/**
 * Is this key inside this coach's own folder?
 *
 * The TypeScript half of `trainers_logo_path_own_folder`. Applied to what comes
 * BACK from the database as well as to what goes in: a row is not an object, and
 * a path read out of a column is not evidence that the object behind it is one
 * this coach may open. A regression in either policy then shows up as a logo
 * this app declines to draw rather than as a request it makes and cannot
 * explain.
 */
function isOwnLogoPath(coachId, path) {
    const id = String(coachId ?? '').trim();
    const p = String(path ?? '').trim();
    if (!id || !p || p.length > 200)
        return false;
    if (!p.startsWith(`${id}/`))
        return false;
    // One folder deep, and no traversal. `storage.foldername(name)[1]` would take
    // the first segment of a longer path happily, so the depth is checked here.
    const rest = p.slice(id.length + 1);
    return !!rest && !rest.includes('/') && !rest.includes('..');
}
/**
 * The sentence for a file that is too big, or null when it is not.
 *
 * Says the limit and what to do, because "too large" alone leaves a coach
 * exporting the same file again at the same size.
 */
function logoRefusal(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return 'That file could not be read off your phone, so nothing was uploaded.';
    }
    if (bytes > exports.MAX_LOGO_BYTES) {
        const mb = (bytes / (1024 * 1024)).toFixed(1);
        return `That image is ${mb} MB and the limit is 2 MB. A logo is a small mark rather than a photograph, so a smaller export of it will look the same and fit.`;
    }
    return null;
}
/* ── putting the mark on a document ────────────────────────────────────────── */
/** A data URI built from bytes this app has just read, or null when the type is
 *  not one it stores. Composed rather than concatenated at the call site so
 *  there is one spelling of it to validate against. */
function logoDataUri(base64, mime) {
    const b = String(base64 ?? '').trim();
    const m = String(mime ?? '').toLowerCase();
    if (!b)
        return null;
    if (m !== 'image/png' && m !== 'image/jpeg')
        return null;
    return `data:${m};base64,${b}`;
}
/**
 * A data URI that may be written into an HTML attribute, or null.
 *
 * THE point of this module. `coachInvoiceDoc` and `coachClientReportDoc` build
 * their pages by concatenating strings and every value in them goes through
 * `escapeHtml` — but a data URI cannot be escaped and still be a picture, so it
 * is validated instead.
 *
 * The pattern admits one of two literal prefixes followed by base64 and nothing
 * else. That is what closes the attribute-escape: a quote, an angle bracket, a
 * space, a semicolon and a backslash are all outside the base64 alphabet, so
 * there is no string this returns that can end the `src="…"` it is written
 * into. It also refuses `data:image/svg+xml`, which the bucket does not accept
 * and which would be a scriptable document rendered inside a page this app
 * prints.
 *
 * Length is capped too. A base64 blob is roughly 4/3 of the bytes, so a 2 MB
 * upload is about 2.8 MB of text; the cap is above that and below the size at
 * which an HTML string stops being something a phone can hand to a printer.
 */
exports.MAX_LOGO_DATA_URI = 4000000;
// It is used for the client photo on a share card as well, which is why the
// rule is here rather than repeated. That one goes into an SVG `href` rather
// than an HTML attribute, so the escape argument does not apply to it — but a
// second copy of a security-relevant pattern is how the two come to differ, and
// the size cap and the scheme check are wanted on both paths anyway.
function safeLogoDataUri(v) {
    const s = String(v ?? '');
    if (!s || s.length > exports.MAX_LOGO_DATA_URI)
        return null;
    return /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(s) ? s : null;
}
/**
 * The coach's mark as an <img>, or the empty string.
 *
 * The empty string is the whole fallback story. Every document this goes into
 * printed a heading before this feature existed and prints the same heading
 * without a logo now: a coach whose logo could not be read gets the document
 * they got yesterday, never a broken image icon and never a box saying a
 * picture is missing.
 *
 * `alt` is deliberately empty. The mark is decoration beside a heading that
 * already names the issuer; alt text would have a screen reader announce a
 * business name twice.
 */
function logoImgHtml(dataUri) {
    const src = safeLogoDataUri(dataUri);
    return src ? `<img class="logo" alt="" src="${src}">` : '';
}
/** The CSS for that <img>, appended to each document's own stylesheet. Height
 *  rather than width, so a wide mark and a square one occupy the same line. */
exports.LOGO_CSS = '.logo{max-height:52px;max-width:180px;object-fit:contain;display:block;margin-bottom:10px}';
/* ── bytes to base64, because this runtime has neither btoa nor Buffer ──────── */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/**
 * Base64 for a byte array.
 *
 * Written out rather than reached for, because React Native has no `Buffer` and
 * its `btoa` is not something to rely on across engines — and the alternative,
 * handing the blob to `FileReader.readAsDataURL`, differs between Hermes on iOS
 * and on Android in exactly the way that produces a logo that appears on one
 * platform and not the other.
 *
 * It is also the only part of the download path that can be tested without a
 * device, which is why it is here and not in src/ui/coachLogo.ts.
 */
function base64FromBytes(bytes) {
    let out = '';
    const n = bytes.length;
    for (let i = 0; i < n; i += 3) {
        const a = bytes[i];
        const b = i + 1 < n ? bytes[i + 1] : 0;
        const c = i + 2 < n ? bytes[i + 2] : 0;
        out += B64[a >> 2];
        out += B64[((a & 3) << 4) | (b >> 4)];
        // The tail is padded rather than truncated. A base64 string whose length is
        // not a multiple of four is one every decoder is entitled to refuse, and
        // `safeLogoDataUri` refuses it here too — so a wrong tail would render as
        // "this coach has no logo" with nothing to say why.
        out += i + 1 < n ? B64[((b & 15) << 2) | (c >> 6)] : '=';
        out += i + 2 < n ? B64[c & 63] : '=';
    }
    return out;
}
/* ── what the coach is told ────────────────────────────────────────────────── */
/**
 * Where the logo appears, said in full on the screen that sets it.
 *
 * Specific rather than reassuring, because the honest scope is narrower than
 * "your branding": part 330 gives the file an own-folder read policy, so the
 * client's app never fetches it and it does not appear in their app chrome. It
 * appears on artefacts the coach's own device builds and hands over.
 */
exports.LOGO_SCOPE_NOTE = 'Your logo goes on the invoices you issue, the client reports you prepare and the cards you share. It does not change what your clients see inside the app, where they see your name and your colour.';
/** What is said when the logo cannot be read. Never a broken image, and never
 *  an assertion that the coach has not set one. */
exports.LOGO_UNREADABLE_NOTE = 'Your logo could not be read just now, so what is set is not known. Anything you make in the meantime is prepared without it, exactly as it was before you added one.';
