"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COACHED_MODE_NOTE_COACH = exports.COACHING_MODE_NOTE = exports.COACHING_MODE_LABEL = exports.COACHED_MODE_SHORT = exports.COACHED_MODES = void 0;
exports.booksInPerson = booksInPerson;
exports.coachedRemotely = coachedRemotely;
exports.readCoachedMode = readCoachedMode;
exports.readCoachedModeOrNull = readCoachedModeOrNull;
exports.readCoachingMode = readCoachingMode;
exports.readDiet = readDiet;
exports.COACHED_MODES = ['online', 'inperson', 'hybrid'];
/** For a coach's own surfaces, where the subject is the client, not the reader. */
exports.COACHED_MODE_SHORT = {
    online: 'Online',
    inperson: 'In-person',
    hybrid: 'Hybrid',
};
exports.COACHING_MODE_LABEL = {
    online: 'Online Coach',
    inperson: 'In-Person Coach',
    hybrid: 'Hybrid Coach',
    solo: 'On My Own',
};
/** One line, in the client's own voice, saying what picking this changes. It
 *  travels with the option everywhere it is offered — "Hybrid" on its own is
 *  a word, not a choice anybody can make. */
exports.COACHING_MODE_NOTE = {
    online: 'Your coach programs and checks in remotely — no sessions to book.',
    inperson: 'Your coach trains you in the room — book sessions with them.',
    hybrid: 'Both — book sessions with them, and check in for the weeks you train alone.',
    solo: 'No coach. AI plans and tools, and nothing sent to anybody.',
};
/** The same three, in the coach's voice, for the add-client and invite sheets. */
exports.COACHED_MODE_NOTE_COACH = {
    online: 'You program and check in remotely. They get no booking calendar.',
    inperson: 'You train them in the room. They can book your open slots.',
    hybrid: 'Both — they book your slots, and check in for the weeks they train alone.',
};
/** Whether this person has sessions with their coach to book. The booking
 *  calendar is in-person by construction (see the header of calendar.tsx), so
 *  an online-only client has nothing there to book. */
function booksInPerson(m) {
    return m === 'inperson' || m === 'hybrid';
}
/** Whether their coach is working with them at a distance, and therefore only
 *  learns how the week went if the client writes it down. */
function coachedRemotely(m) {
    return m === 'online' || m === 'hybrid';
}
/** Tolerant read of a `mode` column, for the surfaces that must show something.
 *  Anything unrecognised settles on 'online', which is the column's own default. */
function readCoachedMode(v) {
    return v === 'inperson' || v === 'hybrid' ? v : 'online';
}
/** The same read for surfaces that can say "we do not know". A coach's roster
 *  is one: reporting an unclassified client as Online tells them somebody is
 *  remote on the strength of an empty column. */
function readCoachedModeOrNull(v) {
    return v === 'online' || v === 'inperson' || v === 'hybrid' ? v : null;
}
function readCoachingMode(v, fallback = 'online') {
    return v === 'online' || v === 'inperson' || v === 'hybrid' || v === 'solo' ? v : fallback;
}
/**
 * Tolerant read of a `diet` column.
 *
 * `Diet` is a five-member union in this file and a plain `text` column in the
 * database, and src/ui/clientData.tsx was casting the column straight to the
 * union: `setDiet(r.diet as Diet)`. A row holding anything else — an older
 * vocabulary, a value a coach or an import wrote, a typo — then reached
 * `mealAt` in src/lib/meals.ts, where the component pools for that diet are
 * EMPTY and the meal is assembled by dereferencing them. The whole nutrition
 * screen throws a TypeError out of render.
 *
 * 'meat' is the fallback because it is the state's own default in that provider
 * and the widest pool: it excludes nothing the other four exclude, so an
 * unrecognised value degrades to more choice rather than to a plan built around
 * a restriction nobody chose. The member's own setting is one tap away and
 * writing this back is what the next save does.
 */
function readDiet(v, fallback = 'meat') {
    return v === 'meat' || v === 'vegetarian' || v === 'vegan' || v === 'paleo' || v === 'keto' ? v : fallback;
}
