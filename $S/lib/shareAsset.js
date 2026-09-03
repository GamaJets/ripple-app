"use strict";
// The shareable asset a coach can actually make tonight: a card built from
// figures that are true, and a caption to go with it.
//
// ── What this replaced, and why the replacement is smaller ──────────────────
//
// This module exists because the thing above it used to be `publishToSocials`,
// which named four networks, showed a "connected" dot beside each of them and
// uploaded nothing to any of them, ever. There was no OAuth session, no token,
// no upload endpoint and no Integrations screen to reach one from — the check
// behind the green dot was `!!process.env.EXPO_PUBLIC_YOUTUBE_CLIENT_ID`, a
// build-time string that says nothing about whether an account is linked.
//
// The OS share sheet, by contrast, is real, is already in the binary, and
// reaches every network the coach has installed plus the ones that have not
// been invented yet. So the honest version of "help me market my coaching" is
// not a publish button. It is: compose something worth posting, hand it to the
// share sheet, and let the coach post it themselves in two taps. That is what
// this builds — the composing half, kept pure so it can be tested.
//
// Nothing here touches react-native, expo, or the network. It takes figures and
// returns text and layout. `src/lib/social.ts` does the file write and the
// hand-off; `app/(trainer)/share-kit.tsx` draws the card.
//
// ── The three rules this module enforces, none of them cosmetic ─────────────
//
// 1. A FIGURE THAT WAS NOT READ IS NEVER PUBLISHED AS ZERO.
//    This is the repo's oldest bug class (scripts/check-reads.mjs is the whole
//    essay) and it gets worse the moment the output leaves the phone. A
//    dashboard that says "0 sessions" because the read failed is wrong for as
//    long as the coach is looking at it. A post that says "0 sessions this
//    week" is wrong on Instagram for ever, under the coach's own name, to the
//    audience they are trying to win. So `null` drops the line entirely, and a
//    card with nothing true left on it refuses to build — with a reason that
//    distinguishes "we could not read this" from "this genuinely has not
//    happened yet", because those two need different sentences and only one of
//    them is the coach's fault.
//
// 2. NOTHING IDENTIFYING A CLIENT LEAVES WITHOUT AN IN-THE-MOMENT CHOICE.
//    A coach is not entitled to consent on their client's behalf. So a result
//    card carries no name unless the coach affirms, at the moment of sharing,
//    that this particular client agreed — and `scrubName` below takes the name
//    back out of the coach's own typed caption AND out of their typed headline
//    when they have not, because free text is where it actually slips through.
//
//    This module used to say a second thing here: that `ShareCard` had no image
//    field at all, and that there was "deliberately no shape here that could
//    carry one". That was the right answer while the only consent this app held
//    was a tick a COACH put in a box, because a coach ticking a box about their
//    client's body is not that client agreeing to anything. It is no longer the
//    only consent there is. supabase/parts/331 gives the client a per-photo
//    permission to PUBLISH, written by them, unwritable by the coach, and dying
//    with the photo and with the coaching relationship — so the card can now
//    carry an image on a permission that came from the person in it.
//
//    The shape below therefore admits an image, and admits it only through
//    `PublishConsent`. Read `src/lib/photoPublish.ts` before touching it: a
//    coach being able to SEE a progress photo is not permission to post it, the
//    two grants are separate rows for that reason, and 'unknown' — a consent
//    read that failed — is not consent. A card with no photo on it looks exactly
//    like a card that was never going to have one; there is deliberately no
//    placeholder, because a gap captioned "a photo was withheld" is itself a
//    statement about a client made without asking them.
//
//    The COACH'S OWN LOGO is the easy case and is handled beside it. It is
//    theirs, it identifies nobody else, and it needs no permission from anyone.
//
// 3. TEXT THAT WILL NOT FIT IS WRAPPED HERE, NOT DISCOVERED ON THE CARD.
//    SVG has no line box. `<Text>` in react-native-svg draws one line and lets
//    it run off the edge of the image — silently, in the exported PNG, which is
//    the one artefact nobody looks at again before it is posted. `wrapLines`
//    is therefore not a nicety; it is the only thing standing between a long
//    gym name and a graphic with half a word hanging off it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.num = exports.LOGO_SET_NOT_FETCHED = exports.BRAND_UNREAD_NOTE = exports.cardSize = exports.CARD_SIZES = void 0;
exports.charsPerLine = charsPerLine;
exports.wrapLines = wrapLines;
exports.scrubName = scrubName;
exports.hoursLabel = hoursLabel;
exports.weekCard = weekCard;
exports.resultCard = resultCard;
exports.firstName = firstName;
exports.assetFilename = assetFilename;
exports.lower = lower;
const photoPublish_1 = require("./photoPublish");
exports.CARD_SIZES = [
    { key: 'post', label: 'Post', note: '4:5 — feed', w: 1080, h: 1350 },
    { key: 'story', label: 'Story', note: '9:16 — stories, Reels, TikTok', w: 1080, h: 1920 },
];
const cardSize = (shape) => exports.CARD_SIZES.find((s) => s.key === shape) ?? exports.CARD_SIZES[0];
exports.cardSize = cardSize;
/**
 * Why a card cannot be composed while the coach's gym is unknown.
 *
 * app/(trainer)/share-kit.tsx took its brand as `tenant?.name || authUser?.name`
 * with the tenant provider's `status` not even destructured. One of those two
 * strings is a BUSINESS and the other is whatever the person typed when they
 * signed up for an app, and a dropped connection for one second silently swaps
 * one for the other. What comes out is a PNG the coach posts to a public feed
 * with their own legal name across it instead of their gym's — not a rendering
 * fault, but publishing a private detail, permanently, on their behalf.
 *
 * `tenant === null` under a WHOLE read is a different and correct answer: an
 * independent coach has no gym and their own name is the brand. The refusal is
 * only for not knowing which of the two situations this is.
 */
exports.BRAND_UNREAD_NOTE = 'Your gym could not be read, so this card has no name to carry. It is not made rather than made with the wrong one — '
    + 'a card that went out with your own account name where your gym\'s should be cannot be taken back. Pull to refresh and it will build.';
/**
 * The logo is set, and the picture of it did not arrive.
 *
 * Two different nulls arrive at `logo.dataUri`: no logo, and a logo whose file
 * would not download. app/(trainer)/brand.tsx already draws the distinction;
 * the screen that PUBLISHES did not, so the coach had done the work, the record
 * said the logo was set, and the card that went out under their name was
 * unbranded — invisible on the one surface where it is permanent.
 */
exports.LOGO_SET_NOT_FETCHED = 'Your logo is set and the picture of it could not be fetched, so this card is being prepared without it. '
    + 'Pull to refresh before you post if you want it on there.';
/* ── word wrap ─────────────────────────────────────────────────────────────── */
/**
 * Roughly how many characters of `fontPx` fit across `widthPx`.
 *
 * An approximation and openly so: the exact answer needs the font's metrics,
 * which are not available to a pure module and differ between iOS and Android
 * anyway. 0.55 em is a conservative average advance for a sans-serif at these
 * weights — it under-fills a line slightly rather than over-filling it, which
 * is the right way to be wrong when the failure mode is text running off the
 * side of an image somebody is about to post.
 */
function charsPerLine(widthPx, fontPx) {
    if (!(widthPx > 0) || !(fontPx > 0))
        return 0;
    return Math.max(1, Math.floor(widthPx / (fontPx * 0.55)));
}
/**
 * Greedy word wrap into at most `maxLines` lines of at most `perLine`
 * characters, with an ellipsis when the text does not fit.
 *
 * SVG draws one <Text> per line and does not wrap, so this is the layout. Three
 * cases it has to get right and one it deliberately does not try to:
 *
 *   · a word longer than the line (a URL, a hashtag, a German compound) is hard
 *     broken rather than allowed to overhang;
 *   · overflow truncates the LAST line and marks it, so the reader can see that
 *     something was cut instead of reading a sentence that just stops;
 *   · an empty or whitespace-only string is no lines at all, not one empty one,
 *     because an empty <Text> still reserves its line height and the card's
 *     spacing is computed from the count.
 *
 * It does not hyphenate. A wrong hyphen is worse than a hard break.
 */
function wrapLines(text, perLine, maxLines) {
    const words = String(text ?? '').split(/\s+/).filter(Boolean);
    if (!words.length || perLine < 1 || maxLines < 1)
        return [];
    const lines = [];
    let line = '';
    const push = () => { if (line) {
        lines.push(line);
        line = '';
    } };
    for (const word of words) {
        let w = word;
        // A word wider than the whole line. Fill the current line, then keep
        // breaking. Without this the greedy loop below would put it on a line of
        // its own and it would still be too long — the overhang just moves.
        while (w.length > perLine) {
            const room = perLine - (line ? line.length + 1 : 0);
            if (room > 1) {
                line = line ? `${line} ${w.slice(0, room)}` : w.slice(0, room);
                w = w.slice(room);
            }
            push();
            if (lines.length >= maxLines)
                return truncateLast(lines, perLine, maxLines);
            if (w.length > perLine) {
                lines.push(w.slice(0, perLine));
                w = w.slice(perLine);
            }
            if (lines.length >= maxLines)
                return truncateLast(lines, perLine, maxLines);
        }
        if (!line) {
            line = w;
            continue;
        }
        if (line.length + 1 + w.length <= perLine) {
            line = `${line} ${w}`;
            continue;
        }
        push();
        if (lines.length >= maxLines) {
            line = w;
            break;
        }
        line = w;
    }
    push();
    return truncateLast(lines, perLine, maxLines);
}
/**
 * Cut to `maxLines` and mark the cut.
 *
 * The ellipsis replaces a character rather than being appended, because
 * appending it to a line that was already at the limit is how the overhang gets
 * back in through the door it was just thrown out of.
 */
function truncateLast(lines, perLine, maxLines) {
    if (lines.length <= maxLines)
        return lines;
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = last.length >= perLine ? `${last.slice(0, Math.max(1, perLine - 1))}…` : `${last}…`;
    return kept;
}
/* ── the privacy gate ──────────────────────────────────────────────────────── */
/**
 * Take a client's name back out of text the coach typed.
 *
 * This is the leak that would actually happen. The card itself is built from
 * fields this module controls, so keeping a name off it is easy — but the
 * caption is free text, and a coach writing about a client's twelve weeks will
 * write their name in it without thinking, because they are writing about
 * somebody they know. If they have not said the client agreed to be named, the
 * name must not go out, and the place it goes out from is here.
 *
 * What it handles:
 *   · the full name first, so "Sarah Jones" does not become "my client Jones";
 *   · then each part, so "Sarah" alone is caught too;
 *   · case-insensitively, on word boundaries, so "Sam" does not maul "Same"
 *     and the possessive "Sarah's" becomes "my client's" rather than surviving;
 *   · capitalisation by position, so a sentence still starts with a capital.
 *
 * What it does not claim: this is not anonymisation. A coach who writes "my
 * client, the one who owns the bakery on Al Wasl Road" has identified somebody
 * and no string function can help. It removes the name, which is the specific
 * thing it says it removes, and the screen above still asks the coach to look
 * at what they wrote.
 */
function scrubName(text, name, replacement = 'my client') {
    const src = String(text ?? '');
    const full = String(name ?? '').trim();
    if (!src || !full)
        return src;
    // Longest first: the full name before its parts, and a two-part surname
    // before a one-part first name. Otherwise the shorter match eats the front of
    // the longer one and leaves the rest stranded.
    const parts = full.split(/\s+/).filter((p) => p.length >= 2);
    const targets = [full, ...parts].filter((t, i, a) => t.length >= 2 && a.indexOf(t) === i)
        .sort((a, b) => b.length - a.length);
    let out = src;
    for (const target of targets) {
        out = out.replace(nameRegex(target), (_m, offset) => (startsSentence(out, offset) ? capitalise(replacement) : replacement));
    }
    // "Sarah Jones" matched as a whole and then "Sarah" and "Jones" matched
    // nothing — but a caption naming the same person twice in a row ("Sarah,
    // Sarah!") collapses to a stutter. One replacement is the honest rendering.
    return out.replace(new RegExp(`\\b(${escapeRe(replacement)})(\\s+${escapeRe(replacement)})+\\b`, 'gi'), (m) => m.slice(0, replacement.length));
}
/**
 * The name as a pattern, with a word boundary on each end that is only applied
 * where a word boundary can exist.
 *
 * `\bJ.\b` never matches "J. was great". `\b` sits between a word character and
 * a non-word one, and the full stop and the space that follows it are both
 * non-word — so the trailing boundary fails and a client initialled "J. R."
 * keeps their name in every caption. The name is not always a word: it can end
 * in a full stop, start with an apostrophe, be hyphenated. So the boundary is
 * attached per end, based on the character that is actually there.
 *
 * Escaping is not optional either, and for the same client: an unescaped "J."
 * compiles the full stop to "any character", which silently redacts "Jo",
 * "Jim" and the first two letters of every word beginning with a J.
 */
function nameRegex(target) {
    const lead = /^\w/.test(target) ? '\\b' : '';
    const tail = /\w$/.test(target) ? '\\b' : '';
    return new RegExp(`${lead}${escapeRe(target)}${tail}`, 'gi');
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** Whether offset `i` is the first thing in the string or the first thing after
 *  a full stop, question mark, exclamation mark or newline. */
function startsSentence(text, i) {
    for (let k = i - 1; k >= 0; k--) {
        const c = text[k];
        if (c === ' ' || c === '\t' || c === '"' || c === "'")
            continue;
        return c === '.' || c === '!' || c === '?' || c === '\n';
    }
    return true;
}
/* ── figures ───────────────────────────────────────────────────────────────── */
/** A whole number with thousands separators, in the reader's locale. */
const num = (n) => Math.round(n).toLocaleString();
exports.num = num;
/**
 * Minutes as the hours a coach would say out loud.
 *
 * Whole hours have no decimal — "24 hours", not "24.0 hours" — and anything
 * under an hour keeps its minutes rather than rounding to "0 hours", which is
 * the same lie as the zero this module exists to avoid.
 */
function hoursLabel(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0)
        return '';
    if (minutes < 60)
        return `${Math.round(minutes)} min`;
    const h = minutes / 60;
    const rounded = Math.round(h * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded} hrs` : `${rounded.toFixed(1)} hrs`;
}
/**
 * A logo string turned into something the card can carry, or null.
 *
 * One place, so a blank string, a whitespace string and a null cannot each
 * produce a different-shaped card.
 */
function logoImage(uri) {
    const s = String(uri ?? '').trim();
    return s ? { uri: s, source: 'coach-logo' } : null;
}
/**
 * A card about the coach's own week, from their own delivered sessions.
 *
 * The safest thing a coach can post: it is about them, it names nobody, and
 * every figure on it came from a session whose outcome they recorded
 * themselves. No consent question arises because there is nothing here that
 * belongs to anybody else.
 *
 * Every `null` drops its line. If all three are null the read failed and the
 * card refuses; if all three are zero the week genuinely was empty and it also
 * refuses, with the other sentence — a coach posting "0 sessions this week" is
 * not the marketing they came here for, and there is no version of that graphic
 * worth making.
 */
function weekCard(input) {
    const { sessions, minutes, clients } = input;
    if (sessions == null && minutes == null && clients == null) {
        return {
            ok: false, reason: 'unread',
            why: 'Repple could not read your sessions just now, so there are no figures it can honestly put on a card. Try again in a moment — nothing has been posted.',
        };
    }
    // A zero is dropped as well as a null, and for a different reason. All three
    // figures come from the same set of rows, so a genuine zero can only mean the
    // week was empty — but "0 clients" printed beside "5 sessions" would be a
    // contradiction on a graphic that has already left the phone. Dropping it
    // costs nothing true and makes that shape impossible.
    const stats = [];
    if (sessions != null && sessions > 0)
        stats.push({ label: 'Sessions', value: (0, exports.num)(sessions) });
    if (minutes != null && minutes > 0)
        stats.push({ label: 'Coached', value: hoursLabel(minutes) });
    if (clients != null && clients > 0)
        stats.push({ label: 'Clients', value: (0, exports.num)(clients) });
    if (!stats.length) {
        return {
            ok: false, reason: 'empty',
            why: `You have no sessions marked as delivered in ${lower(input.spanLabel)}. Mark a session’s outcome and it will appear here — Repple will not make a card out of a week that has not happened.`,
        };
    }
    const headline = sessions != null && sessions > 0
        ? `${(0, exports.num)(sessions)} ${sessions === 1 ? 'session' : 'sessions'} coached`
        : minutes != null && minutes > 0
            ? `${hoursLabel(minutes)} coached`
            : `${(0, exports.num)(clients ?? 0)} ${clients === 1 ? 'client' : 'clients'} trained`;
    const brand = String(input.brand ?? '').trim() || 'Repple';
    // The headline is always built from the first surviving stat, so the caption
    // lists the rest. Repeating it — "18 sessions coached. 18 sessions · 24 hrs"
    // — reads as a template that was filled in rather than as something a coach
    // wrote, which is the whole difference between a post and an ad.
    const caption = [
        `${headline} — ${lower(input.spanLabel)}.`,
        // `lower()` is for the coach's span label, where "August" has to survive.
        // Stat labels are common nouns this module wrote itself, so they are simply
        // lower-cased — running them through the proper-noun heuristic produced
        // "18 hrs Coached · 11 Clients", which reads like a spreadsheet header.
        stats.slice(1).map((s) => `${s.value} ${s.label.toLowerCase()}`).join(' · '),
    ].filter(Boolean).join('\n');
    return {
        ok: true,
        card: {
            kind: 'week',
            kicker: input.spanLabel,
            headline,
            stats: stats.slice(0, 3),
            footer: brand,
            caption,
            filename: assetFilename('week'),
            logo: logoImage(input.logo),
            // Stated rather than left undefined. A week card is about the coach's own
            // delivered sessions and there is nobody else on it; a field that could
            // be filled in later by a caller who did not read rule 2 is closed here.
            photo: null,
        },
    };
}
/**
 * A card about a client's result — the one a coach most wants to post and the
 * one with somebody else's data on it.
 *
 * It refuses to build at all without `consent.figures`. That is not a warning
 * or a dimmed button that can be tapped anyway: there is no card, so there is
 * nothing to hand to the share sheet. And without `consent.name` the client is
 * "a client I coach" on the card AND their name is scrubbed out of the coach's
 * caption, because the caption is where it would otherwise go out.
 *
 * With `consent.name` it prints the FIRST name only. A surname adds nothing to
 * the post and a great deal to how findable the person is, and a coach ticking
 * a box about a name is not thinking about that. If a client genuinely wants
 * their full name on it, the coach can type it in the note themselves — a
 * deliberate act, which is the standard this module holds everything else to.
 */
function resultCard(input, consent) {
    if (!consent?.figures) {
        return {
            ok: false, reason: 'consent',
            why: 'These are your client’s numbers, not yours to publish. Confirm they have agreed to this being posted and the card will build.',
        };
    }
    const figures = (input.figures ?? []).filter((f) => f && f.value && String(f.value).trim());
    if (!figures.length) {
        return {
            ok: false, reason: 'nothing-picked',
            why: 'Pick at least one figure to put on the card. Repple will not invent one.',
        };
    }
    const named = !!consent?.name;
    const first = firstName(input.clientName);
    // Without name consent the client's name is removed from the coach's own
    // sentence. With it, the note is left exactly as typed — the coach may name
    // them, and second-guessing that would be the app overriding a permission it
    // just asked for.
    const note = named ? String(input.note ?? '').trim() : scrubName(input.note, input.clientName);
    // The SPAN LABEL is free text too, and it was not being scrubbed.
    //
    // It is the biggest type on the card and the first clause of the caption, and
    // a coach typing "Sarah's twelve weeks" into a box labelled "the period, in
    // your words" is not doing anything strange. Every argument `scrubName` makes
    // about the note applies to it more strongly, and the arrival of a photograph
    // beside it is what makes the omission unarguable: a picture of somebody with
    // a first name over it is an identification whatever the box was called.
    const span = named ? String(input.spanLabel ?? '').trim() : scrubName(input.spanLabel, input.clientName);
    // The name — when there is one to print — is the kicker, and the coach's own
    // words for the period are the headline. The other way round ("Sarah's 12
    // weeks in") reads as a caption rather than a card, and it puts the name in
    // the largest type on the graphic, which is the last place it belongs even
    // when it is allowed to be there at all.
    const who = named && first ? first : 'a client I coach';
    const headline = span.trim() || 'Client result';
    const brand = String(input.brand ?? '').trim() || 'Repple';
    const caption = [
        `${capitalise(who)} — ${lower(span)}.`,
        figures.map((f) => `${f.label}: ${f.value}`).join(' · '),
        note,
    ].filter(Boolean).join('\n');
    return {
        ok: true,
        card: {
            kind: 'result',
            kicker: named && first ? first : 'A client I coach',
            headline,
            stats: figures.slice(0, 3),
            footer: brand,
            caption,
            filename: assetFilename('result'),
            logo: logoImage(input.logo),
            // THE gate, and it is one expression on purpose. `mayPublishPhoto` is the
            // only thing in this app that decides whether somebody's body goes on a
            // public card, it takes a value the coach cannot author, and everything
            // else about this card — the two ticks, the figures, the name — has no
            // vote in it.
            //
            // When it says no the field is null and the card is drawn exactly as a
            // card with no photo. There is no placeholder and no marker: a labelled
            // gap would publish the fact that a client was asked, which is a
            // statement about them made without asking them.
            photo: input.photo && (0, photoPublish_1.mayPublishPhoto)(input.photo.consent) && String(input.photo.uri ?? '').trim()
                ? { uri: input.photo.uri.trim(), source: 'client-photo' }
                : null,
        },
    };
}
/** The first name, or null. Never the surname — see `resultCard`. */
function firstName(name) {
    const n = String(name ?? '').trim();
    if (!n)
        return null;
    const first = n.split(/\s+/)[0];
    return first || null;
}
/* ── odds and ends ─────────────────────────────────────────────────────────── */
/**
 * A filename for the exported PNG.
 *
 * Dated so a coach's camera roll and downloads folder do not fill with
 * `image.png`, and stripped to characters every filesystem the share sheet
 * hands this to will accept — a gym name with a slash in it once produced a
 * path, not a file.
 */
function assetFilename(kind, at = new Date()) {
    const d = Number.isFinite(at.getTime()) ? at : new Date();
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    return `repple-${kind}-${stamp}.png`;
}
const pad = (n) => String(n).padStart(2, '0');
/**
 * Lower-case a fragment that is being dropped into the middle of a sentence —
 * unless it starts with something that is a name rather than a word.
 *
 * "Last 7 days" reads badly as "…coached Last 7 days", and lower-casing it
 * fixes that; "August" and "Ramadan" must survive. The test is whether the rest
 * of the first word is already lower case, which is what tells an ordinary
 * capitalised sentence apart from a proper noun about as well as anything can
 * without a dictionary.
 */
function lower(s) {
    const t = String(s ?? '').trim();
    if (!t)
        return '';
    const first = t.split(/\s+/)[0];
    if (/^[A-Z][a-z]+$/.test(first) && !/^(Last|This|The|Since|Over|Past|Next)$/.test(first))
        return t;
    return t.charAt(0).toLowerCase() + t.slice(1);
}
