"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_READABLE_IDEOGRAPHS = exports.MIN_READABLE_LETTERS = exports.AREA_TERMS = void 0;
exports.severityRank = severityRank;
exports.segments = segments;
exports.readableLetters = readableLetters;
exports.ideographCount = ideographCount;
exports.documentWasRead = documentWasRead;
exports.looksNonLatin = looksNonLatin;
exports.extractInjuryCandidates = extractInjuryCandidates;
exports.extractFromDocument = extractFromDocument;
exports.outcomeMessage = outcomeMessage;
exports.candidateNote = candidateNote;
exports.candidateToInjury = candidateToInjury;
// Turning a physio report, a scan result or a doctor's note into something the
// client can DISCLOSE — never into a disclosure on its own.
//
// Everything in this file is pure: text in, candidates out. No React, no
// network, no Supabase. That is not tidiness, it is the only way the rules
// below can be argued with in src/lib/injuryExtract.test.ts, and this is
// medical material read by OCR, which is the least reliable input the app has.
//
// ── THE ONE RULE ─────────────────────────────────────────────────────────
//
// A candidate is a QUESTION put to the client, not an answer. Nothing here
// writes an Injury; `candidateToInjury` is a constructor the confirmation
// screen calls once the person has read the proposal and chosen a severity.
// The client stays the author of their own disclosure — the coach, the plan
// and the acknowledgement gate all act on what they said, and they never read
// a word this file guessed.
//
// ── WHAT COUNTS AS A FINDING, AND WHY IT IS TWO THINGS ───────────────────
//
// A candidate needs BOTH, in the same segment:
//
//   1. an ANATOMICAL term — an INJURY_AREAS label ("knee", "lower back",
//      "wrist", "foot") or a clinical synonym for it ("patella", "lumbar",
//      "supraspinatus", "achilles");
//   2. a COMPLAINT — a word that says something is wrong with it ("pain",
//      "tear", "sprain", "tendinopathy", "impingement").
//
// One without the other is not a finding. "Chest x-ray" names a body part and
// reports nothing wrong with it; "reports pain" names a complaint with no site.
// Proposing an injury from either is inventing the half that is missing, and
// on a medical document a plausible invention is worse than nothing at all.
//
// ── WHY INJURY_AREAS.keywords CANNOT PROPOSE ─────────────────────────────
//
// `INJURY_AREAS[].keywords` are EXERCISE names — 'squat', 'deadlift', 'press'.
// They exist so the Train tab can flag a risky movement once an area is known.
// They are useless for finding the area in the first place: 'squat' sits under
// lower_back, knee, hip AND ankle, so a note reading "worse on squatting" would
// pick one of four at random and present it as a reading of the document. So
// keywords never create a candidate. They are attached to one that already
// exists, as `movements` — the client sees which of their lifts the document
// touches, which is the useful half.
//
// ── NEGATION IS DROPPED, NOT DOWNGRADED ──────────────────────────────────
//
// "No evidence of a meniscal tear" contains a site and a complaint and means
// the opposite of a finding. Any negation cue kills its segment outright. The
// unit is the SEGMENT — a line, or a sentence — so a report that rules one
// thing out and finds another still proposes the second. It does cost us real
// findings ("no pain at rest, severe on loading" is dropped whole), and that
// is the trade we want: a miss sends the client to the manual screen that has
// always been there, a false proposal sends them a confident sentence about
// their own body that no one wrote.
//
// ── SEVERITY IS ALLOWED TO BE UNKNOWN ────────────────────────────────────
//
// `severity: null` means the document did not grade it. It is not defaulted to
// 'moderate' — the injury model has no "unknown" severity, and every consumer
// downstream (injuryFlag, severeSummary, the acknowledgement key) treats
// severity as a fact the client stated. So the confirmation screen makes the
// client choose one before it will build an Injury, and `candidateToInjury`
// requires it as an argument rather than filling it in.
const injuries_1 = require("./injuries");
/* ── the vocabulary ───────────────────────────────────────────────────────── */
/**
 * Clinical synonyms, on top of whatever the INJURY_AREAS label already gives.
 * A physio writes "supraspinatus tendinopathy", not "shoulder injury".
 *
 * Deliberately conservative: a term that belongs to two areas is left out
 * rather than assigned to one. Bare "labrum" is both a shoulder and a hip
 * structure, so only the qualified forms are here; bare "disc" is cervical or
 * lumbar, so only "lumbar" is.
 */
const SYNONYMS = {
    lower_back: ['lumbar', 'lumbosacral', 'l4', 'l5', 's1', 'si joint', 'sacroiliac', 'erector spinae', 'quadratus lumborum'],
    knee: ['patella', 'patellar', 'patellofemoral', 'acl', 'mcl', 'pcl', 'lcl', 'meniscus', 'meniscal', 'chondromalacia', 'anterior cruciate', 'medial collateral'],
    shoulder: ['rotator cuff', 'supraspinatus', 'infraspinatus', 'subscapularis', 'subacromial', 'ac joint', 'acromioclavicular', 'glenohumeral', 'glenoid labrum', 'deltoid', 'scapula', 'scapular'],
    elbow: ['epicondylitis', 'epicondylalgia', 'tennis elbow', "golfer's elbow", 'golfers elbow', 'olecranon', 'ulnar nerve'],
    wrist: ['carpal tunnel', 'carpal', 'scaphoid', 'thumb', 'finger', 'de quervain', 'tfcc'],
    hip: ['gluteal', 'glute', 'trochanteric', 'acetabular', 'psoas', 'groin', 'adductor', 'piriformis', 'femoroacetabular'],
    ankle: ['achilles', 'plantar fascia', 'plantar fasciitis', 'calf', 'gastrocnemius', 'soleus', 'peroneal', 'metatarsal', 'atfl'],
    hamstring: ['biceps femoris', 'semitendinosus', 'semimembranosus', 'posterior thigh'],
    neck: ['cervical', 'whiplash', 'trapezius', 'c5', 'c6', 'c7'],
    chest_rib: ['costal', 'costochondritis', 'sternum', 'sternal', 'pectoral', 'intercostal'],
};
/**
 * Every anatomical term we will look for, longest first so "lower back" is
 * reported as the match rather than a shorter term inside it.
 *
 * 'other' is excluded on purpose: its label is the word "other", which appears
 * in ordinary prose, and it carries no groups or keywords, so a candidate for
 * it would say nothing the plan could act on. The client can still select it
 * by hand on the confirmation screen.
 */
exports.AREA_TERMS = injuries_1.INJURY_AREAS
    .filter((a) => a.id !== 'other')
    .flatMap((a) => {
    // "Wrist / Hand" and "Ankle / Foot" are two terms wearing one label.
    const fromLabel = a.label.toLowerCase().split('/').map((s) => s.trim()).filter(Boolean);
    const terms = Array.from(new Set([...fromLabel, ...(SYNONYMS[a.id] ?? [])]));
    return terms.map((term) => ({
        area: a.id,
        term,
        // Tolerates a plural and a possessive, and nothing else. A prefix match
        // here would let "hip" find "hippocampus".
        re: new RegExp(`\\b${esc(term)}(?:s|es|'s)?\\b`, 'i'),
    }));
})
    .sort((x, y) => y.term.length - x.term.length);
function esc(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Something is wrong with it. Half of every candidate — see the header.
 * Written as prefixes ("strain" catches "strained", "strains") because OCR
 * gives us whatever tense the clinician wrote in.
 */
const COMPLAINT = /\b(pain\w*|injur\w*|strain\w*|sprain\w*|tear\w*|torn|ruptur\w*|fractur\w*|tendin\w*|tendon\w*|bursitis|impinge\w*|inflam\w*|sciatica|herniat\w*|prolapse\w*|bulg\w*|discomfort|ache|aches|aching|sore|soreness|stiff\w*|instabilit\w*|unstable|disloc\w*|sublux\w*|spasm\w*|lesion\w*|degenerat\w*|arthritis|arthropath\w*|chondromalacia|fasciitis|epicondylitis|epicondylalgia|whiplash|contusion|radiculopath\w*|swell\w*|swollen|arthroscop\w*|reconstruction|carpal tunnel|de quervain)\b/i;
/**
 * The document saying this is NOT a finding. Kills its segment outright, and
 * the header explains why that is the safe direction to fail in.
 */
const NEGATION = /\b(no evidence of|no evidence|no signs? of|ruled out|negative for|denies|unremarkable|pain[- ]free|no pain|without pain|no acute|resolved|no longer)\b/i;
/**
 * How badly. Tried strongest-first, which is also what keeps "grade iii" from
 * being read by the "grade i" pattern — the severe test runs first and wins.
 */
const SEVERITY_CUES = [
    { severity: 'severe', re: /\b(severe|severely|grade\s*(?:3|iii|three)\b|complete tear|full[- ]thickness|ruptur\w*|fractur\w*|high[- ]grade|non[- ]weight[- ]bearing)\b/i },
    { severity: 'moderate', re: /\b(moderate|moderately|grade\s*(?:2|ii|two)\b|partial[- ]thickness|partial tear|significant)\b/i },
    { severity: 'mild', re: /\b(mild|mildly|grade\s*(?:1|i|one)\b|minor|slight|low[- ]grade|minimal)\b/i },
];
function severityRank(s) {
    return s === 'severe' ? 3 : s === 'moderate' ? 2 : s === 'mild' ? 1 : 0;
}
/* ── reading the text ─────────────────────────────────────────────────────── */
/**
 * The unit a finding is judged in: a line, or a sentence within a line.
 *
 * Sentence-splitting is done by rewriting the terminator to a newline rather
 * than with a lookbehind — this module is bundled into the app as well as run
 * under node, and a regex engine that does not support lookbehind fails at
 * PARSE time, which takes the whole screen down rather than one match.
 */
function segments(text) {
    return String(text ?? '')
        .replace(/([.;])\s+/g, '$1\n')
        .split(/\r?\n+/)
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}
/**
 * Letters, not characters. A page of OCR noise is mostly punctuation, and
 * `text.length` counts that as having read something.
 *
 * This was `/[a-z]/gi`, which is not "letters" — it is the letters of one
 * alphabet. A Greek, Cyrillic, Hebrew, Arabic or CJK report that OCR read
 * perfectly scored ZERO and was reported to the member as a photograph we could
 * not read, on the one screen in this app that touches a medical document. They
 * were told to take a straighter, brighter photo of a page that had been read
 * fine.
 *
 * `\p{L}` with the `u` flag is the Unicode letter property: it counts a letter
 * in any script, and it counts a Han ideograph and a Hangul syllable as one
 * each. That last part is why `MIN_READABLE_TOKENS` is not simply 24 — see
 * below.
 */
function readableLetters(text) {
    return (String(text ?? '').match(/\p{L}/gu) || []).length;
}
/**
 * Characters that carry a whole word or syllable rather than a sound.
 *
 * CJK Unified Ideographs, Hiragana, Katakana and Hangul syllables. A Japanese
 * or Chinese clinic letter says in eight characters what an English one takes
 * forty to say, so a floor of 24 written for an alphabet rejects a page that is
 * unambiguously a document.
 *
 * Written as code-point ranges rather than `\p{Script=Han}`: a script property
 * escape is a newer regex feature than the letter property, and a regex that
 * fails at PARSE time takes down the screen rather than one match — the same
 * reasoning the sentence splitter above gives for avoiding lookbehind.
 */
function ideographCount(text) {
    return (String(text ?? '').match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) || []).length;
}
/** Below this, we say we could not read the document rather than that the
 *  document holds nothing. Those are different sentences to a client. */
exports.MIN_READABLE_LETTERS = 24;
/** The same floor for a script where one character is a word. */
exports.MIN_READABLE_IDEOGRAPHS = 8;
/** Whether enough legible text came back to talk about the document at all. */
function documentWasRead(text) {
    return readableLetters(text) >= exports.MIN_READABLE_LETTERS
        || ideographCount(text) >= exports.MIN_READABLE_IDEOGRAPHS;
}
/**
 * Whether this text is mostly outside the Latin alphabet.
 *
 * Every vocabulary in this file — SYNONYMS, COMPLAINT, NEGATION, SEVERITY_CUES
 * — is English, so a document in another script is one this file provably
 * cannot read a word of. That is a different fact from "we read it and found no
 * injury", and it deserves a different sentence: one says the photo was bad,
 * one says the report describes nothing, and neither is true of a Greek
 * physiotherapy report that scanned perfectly.
 *
 * Two thirds rather than a bare majority, so a Greek report with an English
 * letterhead, or a Cyrillic one quoting an English drug name, still counts as
 * Greek or Cyrillic.
 */
function looksNonLatin(text) {
    const letters = readableLetters(text);
    if (letters === 0)
        return false;
    const latin = (String(text ?? '').match(/[A-Za-z\u00c0-\u024f]/g) || []).length;
    return latin / letters < 0.34;
}
/** The exercise-name keywords for this area that the segment also mentions.
 *  Context attached to a candidate; never a reason one exists. */
function movementsFor(area, lower) {
    const def = injuries_1.INJURY_AREAS.find((a) => a.id === area);
    if (!def)
        return [];
    return def.keywords.filter((k) => lower.includes(k));
}
/** Short enough to read at a glance, long enough to be the evidence. */
function tidy(segment) {
    const s = segment.replace(/\s+/g, ' ').trim();
    return s.length <= 160 ? s : `${s.slice(0, 157).trimEnd()}…`;
}
/**
 * Every proposal in this text, one per area, strongest first.
 *
 * Two lines about the same knee are one candidate — the client is disclosing a
 * knee, not a paragraph — and it keeps the WORST severity the document graded,
 * because a report that says "mild swelling" on one line and "grade 2 tear" on
 * another has said grade 2.
 */
function extractInjuryCandidates(text) {
    const byArea = new Map();
    for (const seg of segments(text)) {
        if (NEGATION.test(seg))
            continue;
        if (!COMPLAINT.test(seg))
            continue;
        const lower = seg.toLowerCase();
        const severity = SEVERITY_CUES.find((c) => c.re.test(seg))?.severity ?? null;
        // One area may be named by several terms in one line ("knee", "ACL"); the
        // first hit wins, and AREA_TERMS is longest-first so it is the most
        // specific one.
        const seenHere = new Set();
        for (const t of exports.AREA_TERMS) {
            if (seenHere.has(t.area))
                continue;
            if (!t.re.test(seg))
                continue;
            seenHere.add(t.area);
            const found = {
                key: `cand_${t.area}`,
                area: t.area,
                severity,
                matched: t.term,
                evidence: tidy(seg),
                movements: movementsFor(t.area, lower),
            };
            const prev = byArea.get(t.area);
            if (!prev) {
                byArea.set(t.area, found);
                continue;
            }
            // Keep the worse grading, and with it the line that graded it — the
            // evidence has to be the sentence that justifies what is shown.
            const better = severityRank(found.severity) > severityRank(prev.severity);
            byArea.set(t.area, {
                ...(better ? found : prev),
                movements: Array.from(new Set([...prev.movements, ...found.movements])),
            });
        }
    }
    const order = injuries_1.INJURY_AREAS.map((a) => a.id);
    return Array.from(byArea.values()).sort((a, b) => {
        const d = severityRank(b.severity) - severityRank(a.severity);
        return d !== 0 ? d : order.indexOf(a.area) - order.indexOf(b.area);
    });
}
/**
 * The whole read, with the three outcomes kept apart.
 *
 * Candidates are looked for BEFORE the readability floor is applied: a scan
 * that yields nothing but "Left knee sprain" is 15 letters and has told us
 * something, and calling that unreadable would throw away the finding to
 * satisfy a threshold meant for noise.
 */
function extractFromDocument(text) {
    const candidates = extractInjuryCandidates(text);
    if (candidates.length)
        return { outcome: 'candidates', candidates };
    if (!documentWasRead(text))
        return { outcome: 'unreadable', candidates: [] };
    // Read, and in a script none of this file's English vocabulary can touch.
    // Reporting that as "we found no injury in it" is a claim about a document we
    // did not read a word of.
    if (looksNonLatin(text))
        return { outcome: 'unsupported-script', candidates: [] };
    return { outcome: 'nothing-recognised', candidates: [] };
}
/* ── what the screen says, and what it builds ─────────────────────────────── */
/**
 * The copy for each outcome, here rather than in the screen so the wording is
 * covered by the tests too. None of it diagnoses, confirms or contradicts the
 * document — the app is not a medical provider and these sentences are the
 * place that would most easily forget it.
 */
function outcomeMessage(outcome) {
    switch (outcome) {
        case 'unreadable':
            return {
                title: 'We could not read that',
                note: 'No text came back from that image, so this is not the document saying nothing — it is us failing to read it. Try a straighter, brighter photo, or add the injury yourself.',
            };
        case 'unsupported-script':
            return {
                title: 'We can only read English documents',
                note: 'The text came back clearly, and it is not in an alphabet this app can read. Nothing is wrong with your photo or with your document. Type the injury in yourself and it will be treated exactly the same as one we had read.',
            };
        case 'nothing-recognised':
            return {
                title: 'Nothing we could turn into an injury',
                note: 'We read the document but found no body area with a problem described against it. This app only understands English clinical wording, so a report in another language will land here even when it describes an injury plainly. That does not mean it says nothing — it means we could not tell. Add what it says yourself.',
            };
        default:
            return {
                title: 'Check what we found',
                note: 'These are suggestions read off your document, not a diagnosis. Nothing is added to your profile until you confirm it, and you can change any of it first.',
            };
    }
}
/**
 * The note a proposal starts with, and it is EMPTY.
 *
 * It used to be `c.evidence` — the tidied line off the document. That line is
 * the right thing to SHOW on the reading screen, and the wrong thing to seed
 * the note with, because the note is the one part of a confirmed injury that
 * travels: app/(client)/injuries.tsx renders it to the coach and
 * app/(client)/scans.tsx carries it in the handover. So one tap on "Add This"
 * with the field untouched sent the report's own sentence — a diagnosis, a
 * clinician, findings about things that have nothing to do with training — to
 * the coach verbatim, thirty pixels below a notice promising the coach sees
 * only "the injury you confirm below … the same as if you had typed it in
 * yourself". A default nobody has to touch is not a disclosure anybody made.
 *
 * So the field starts as it would have if they HAD typed it in themselves:
 * empty, with "In your own words" in it. The evidence has not been hidden —
 * app/(client)/injury-doc.tsx still prints it above the field, because the
 * member is being asked to agree with a reading of their own document and must
 * see the reading. Copying any of it across is then their act, not the app's.
 *
 * The parameter stays: this is the one place the seed is decided, and a seed
 * made of the APP's words rather than the document's would belong here.
 */
function candidateNote(_c) {
    return '';
}
/**
 * The one way a candidate becomes an Injury, and it takes a severity as an
 * ARGUMENT because the document may not have given one. Everything the plan,
 * the coach and the acknowledgement gate act on comes through here, so nothing
 * this module inferred can reach them without a person having passed it in.
 *
 * `area` is overridable: the client may reasonably move a calf strain from
 * "Ankle / Foot" to somewhere they think fits better, and it is their
 * disclosure to shape.
 */
function candidateToInjury(c, opts) {
    const note = (opts.note ?? '').trim();
    return {
        id: opts.id,
        area: opts.area ?? c.area,
        severity: opts.severity,
        status: 'active',
        note: note || undefined,
        at: opts.at,
    };
}
