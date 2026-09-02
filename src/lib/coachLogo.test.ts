// A coach's logo: the path it may occupy, and the attribute it is written into.
//
// The second half is the one worth the file. `logoImgHtml` puts a string into
// `src="…"` in a document otherwise built entirely from escaped values, so the
// pattern in `safeLogoDataUri` is the only thing standing between a stored
// column and arbitrary markup on an invoice a coach hands to a client.
import {
  LOGO_BUCKET, LOGO_CSS, LOGO_SCOPE_NOTE, LOGO_UNREADABLE_NOTE, MAX_LOGO_BYTES,
  coachLogoPath, isOwnLogoPath, logoContentType, logoDataUri, logoExtension,
  logoImgHtml, logoRefusal, safeLogoDataUri, base64FromBytes,
} from './coachLogo';
import { coachInvoiceDoc, type CoachInvoiceInput } from './coachInvoice';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const COACH = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';

/* ── the key ──────────────────────────────────────────────────────────────── */

eq(LOGO_BUCKET, 'coach-logos', 'the bucket name matches supabase/parts/330');

const key = coachLogoPath(COACH, 1_756_000_000_000, 'AbC12!', 'png');
ok(key.startsWith(`${COACH}/`), 'the key sits in the coach’s own folder, which is what the storage policy reads');
ok(key.endsWith('.png'), 'and keeps the extension it was given');
ok(!/[!]/.test(key), 'a token with punctuation in it does not reach the key');
// Two uploads a millisecond apart must not collide: the bucket has no UPDATE
// policy, so an upsert-shaped key would be an upload that silently fails.
ok(coachLogoPath(COACH, 1, 'aaa', 'jpg') !== coachLogoPath(COACH, 2, 'aaa', 'jpg'),
  'the timestamp makes every upload a new object');
eq(coachLogoPath(COACH, 5, '', 'jpg'), `${COACH}/5-logo.jpg`, 'an empty token still produces a usable name');

eq(logoExtension('image/png'), 'png', 'PNG stays PNG, because a transparent ground cannot survive JPEG');
eq(logoExtension('image/jpeg'), 'jpg', 'JPEG is jpg');
eq(logoExtension('image/heic'), 'jpg', 'anything else has been re-encoded as JPEG before it got here');
eq(logoExtension(null), 'jpg', 'and so has a file whose type the picker did not report');

eq(logoContentType('a/b.png'), 'image/png', 'the stored name declares its own type');
eq(logoContentType('a/b.JPEG'), 'image/jpeg', 'case-insensitively');
eq(logoContentType('a/b.svg'), null, 'a name this app never writes has no content type rather than a guessed one');

/* ── the folder rule, which is the column constraint in TypeScript ────────── */

ok(isOwnLogoPath(COACH, `${COACH}/1-a.png`), 'a coach’s own key is accepted');
ok(!isOwnLogoPath(COACH, `${OTHER}/1-a.png`), 'another coach’s key is not, whatever the column says');
ok(!isOwnLogoPath(COACH, `${COACH}/nested/1-a.png`), 'and neither is a deeper path, which foldername()[1] would have accepted');
ok(!isOwnLogoPath(COACH, `${COACH}/../${OTHER}/1.png`), 'traversal is refused rather than normalised');
ok(!isOwnLogoPath(COACH, `${COACH}/`), 'a folder is not a file');
ok(!isOwnLogoPath(COACH, null), 'a column nobody has written is not a path');
ok(!isOwnLogoPath(null, `${COACH}/1.png`), 'and a path with nobody to compare it to is not one either');
ok(!isOwnLogoPath(COACH, `${COACH}/${'a'.repeat(300)}.png`), 'over the column’s length limit is refused here too');

/* ── the size refusal ─────────────────────────────────────────────────────── */

eq(logoRefusal(1000), null, 'a small file is fine');
eq(logoRefusal(MAX_LOGO_BYTES), null, 'the limit itself is allowed, matching the bucket');
ok(logoRefusal(MAX_LOGO_BYTES + 1) !== null, 'one byte over is refused before anything is uploaded');
ok((logoRefusal(3_250_000) ?? '').includes('3.1 MB'), 'and the refusal says how big the file actually is');
ok(logoRefusal(0) !== null, 'a zero-length read is a failure, not an empty logo');
ok(logoRefusal(Number.NaN) !== null, 'and neither is a size that could not be measured');

/* ── the data URI, and the attribute it goes into ─────────────────────────── */

const PNG64 = 'iVBORw0KGgoAAAANSUhEUg==';
eq(logoDataUri(PNG64, 'image/png'), `data:image/png;base64,${PNG64}`, 'a data URI is composed in one place');
eq(logoDataUri(PNG64, 'image/svg+xml'), null, 'a type the bucket does not accept produces nothing');
eq(logoDataUri('', 'image/png'), null, 'and neither does an empty read');

ok(safeLogoDataUri(`data:image/png;base64,${PNG64}`) !== null, 'a real PNG data URI passes');
ok(safeLogoDataUri(`data:image/jpeg;base64,${PNG64}`) !== null, 'and a JPEG one');

// The four strings somebody would actually use to get out of the attribute.
// Every one of them contains a character outside the base64 alphabet, which is
// the whole reason the pattern is written as an allowlist rather than as a
// search for anything dangerous.
eq(safeLogoDataUri('data:image/png;base64,AAA" onerror="alert(1)'), null,
  'a quote cannot close the src attribute, because it is not base64');
eq(safeLogoDataUri('data:image/png;base64,AAA><script>x</script>'), null,
  'nor can an angle bracket end the tag');
eq(safeLogoDataUri('data:image/svg+xml;base64,AAAA'), null,
  'an SVG is refused outright: it is a scriptable document and the bucket does not store one');
eq(safeLogoDataUri('javascript:alert(1)'), null, 'a scheme that is not data: is not a picture');
eq(safeLogoDataUri('https://example.com/logo.png'), null,
  'and neither is a remote URL, which would also be a blank rectangle in an offline export');
eq(safeLogoDataUri(`data:image/png;base64,${'A'.repeat(5_000_000)}`), null,
  'an absurdly long blob is refused rather than embedded in something a phone has to print');
eq(safeLogoDataUri(null), null, 'nothing is not a logo');

eq(logoImgHtml(null), '', 'no logo produces no markup at all, not an empty <img>');
eq(logoImgHtml('data:image/png;base64,AAA"><b>'), '',
  'and neither does anything that failed validation — the fallback is the document as it was');
ok(logoImgHtml(`data:image/png;base64,${PNG64}`).startsWith('<img class="logo" alt=""'),
  'a valid logo is one img with an empty alt, because the heading beside it already names the issuer');

/* ── base64, which is the whole of the download path that can be tested ───── */

const b64 = (s: string) => base64FromBytes(Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0))));
eq(b64(''), '', 'nothing encodes to nothing');
eq(b64('f'), 'Zg==', 'one byte pads with two equals signs');
eq(b64('fo'), 'Zm8=', 'two bytes pad with one');
eq(b64('foo'), 'Zm9v', 'three bytes need no padding at all');
eq(b64('foobar'), 'Zm9vYmFy', 'and the classic vector round-trips');
// The high bytes are where a sign error hides: a PNG is mostly bytes over 127
// and a wrong shift there produces a string that decodes to a corrupt image
// rather than to an error anybody sees.
eq(base64FromBytes(Uint8Array.from([0xff, 0xfe, 0xfd])), '//79', 'bytes above 127 encode unsigned');
eq(base64FromBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), 'iVBORw==', 'a PNG signature encodes to the prefix every PNG data URI starts with');
ok(safeLogoDataUri(`data:image/png;base64,${base64FromBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))}`) !== null,
  'and what this produces is accepted by the validator the document uses');

/* ── the fallback, proved on a real document ──────────────────────────────── */

const issuer = { status: 'ready' as const, name: 'Jo Carter', brand: 'Repple' };
const invoice = {
  id: 'i1', seq: 4, kind: 'requested' as const, billTo: 'Sam Lee', description: 'Ten sessions',
  amountCents: 45000, currency: 'GBP', issuedOn: '2026-08-01', dueOn: null, note: null,
  voidedAt: null, voidReason: null, remindedAt: null, clientId: null, createdAt: null,
};
const withLogo: CoachInvoiceInput = { invoice, issuer: { ...issuer, logoDataUri: `data:image/png;base64,${PNG64}` } };
const noLogo: CoachInvoiceInput = { invoice, issuer };
const badLogo: CoachInvoiceInput = { invoice, issuer: { ...issuer, logoDataUri: 'https://example.com/x.png' } };

ok(coachInvoiceDoc(withLogo).html.includes('<img class="logo"'), 'a coach’s logo reaches their invoice');
ok(coachInvoiceDoc(withLogo).html.includes(LOGO_CSS), 'along with the CSS that sizes it');
ok(!coachInvoiceDoc(noLogo).html.includes('<img'), 'an invoice from a coach with no logo carries no image at all');
ok(!coachInvoiceDoc(badLogo).html.includes('<img'),
  'and one whose logo could not be validated falls back to exactly that document, never to a broken image');
eq(coachInvoiceDoc(withLogo).text, coachInvoiceDoc(noLogo).text,
  'the plain-text fallback is unchanged either way: a logo has no text form and inventing one would be a caveat about nothing');
eq(coachInvoiceDoc(badLogo).complete, true,
  'an unusable logo is not a part of the document that could not be read — the money is what that claim is about');

/* ── the sentences ────────────────────────────────────────────────────────── */

ok(LOGO_SCOPE_NOTE.includes('does not change what your clients see inside the app'),
  'the scope note states the narrow truth, because the read policy is own-folder');
ok(LOGO_UNREADABLE_NOTE.includes('not known'),
  'and a failed read is reported as unknown rather than as a coach who has set no logo');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`coachLogo: ok`);
