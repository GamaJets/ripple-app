"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildIcs = buildIcs;
// Pure iCalendar (.ics) builder — no React Native imports, so it unit-tests in
// plain node. The share/file-write side lives in exportShare.ts (needs RN).
//
// The one import is src/lib/brands.ts, which is also RN-free (it is loaded by
// app.config.ts in Node) and supplies the three brand-owned strings below.
const brands_1 = require("./brands");
// ── The three places this file named Repple, and why a UID is not cosmetic ──
//
// An .ics file is written by one product and read by somebody else's calendar
// for years afterwards, so every identifier in it is a claim about who made it.
// All three of these were the literal word "Repple" or the domain `repple.app`,
// and Repple is white-labelled: a chain's member exporting their sessions from
// THEIR app got a calendar file that named a company they have never heard of,
// in the one artefact of this product that outlives the app on their phone and
// that they may forward to somebody else.
//
// `repple.app` was the worst of the three. It appears nowhere else in this
// repo, at all — not in app.config.ts, not in the brand registry, not on the
// marketing site — so the UID domain of every event this app has ever exported
// pointed at a host nothing here owns. RFC 5545 asks for the right-hand side of
// a UID to be a domain the generator is actually responsible for, precisely so
// that two products cannot mint the same UID and have a calendar treat two
// different events as one. `BRAND.webOrigin`'s host is a domain each brand does
// own, and it is the same string the reset-password link already trusts.
//
// This does change the UIDs Repple mints, from `…@repple.app` to
// `…@repplefitness.com`, and that is worth being explicit about: a person who
// exported the same session before and after gets two entries rather than one
// updated entry. The exposure is small — the UID also carries the event's index
// in the exported list, so it already changed whenever the list did — and the
// alternative is keeping every brand's calendar entries permanently stamped
// with a domain nobody here holds.
const UID_HOST = brands_1.BRAND.webOrigin.replace(/^https?:\/\//, '').replace(/[\/?#].*$/, '');
// The identifier of the software that produced the file, per RFC 5545 §3.7.3.
// Calendars show it in file inspectors and some sync tools log it.
const PRODID = `-//${brands_1.BRAND.label}//Sessions//EN`;
const icsStamp = (iso) => {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};
const icsEsc = (s) => (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// `calName` defaults to the brand's own family name rather than the literal
// 'Repple'. It is what the calendar app writes above the imported events, so a
// caller that passes nothing was naming the supplier in the member's calendar.
// Two of the three callers pass their own string already; app/(trainer)/
// calendar.tsx passes the literal 'Repple — Coaching schedule' and app/(client)/
// bookings.tsx passes the device-local app name, neither of which this file can
// reach — see docs/WHITE-LABEL.md §11.
function buildIcs(events, calName = brands_1.BRAND.label, nowMs = Date.now()) {
    const stamp = icsStamp(new Date(nowMs).toISOString());
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEsc(calName)}`];
    events.forEach((e, i) => {
        const start = new Date(e.start);
        const end = new Date(start.getTime() + (e.durationMin || 60) * 60000);
        lines.push('BEGIN:VEVENT', `UID:${brands_1.BRAND.id}-${icsStamp(e.start)}-${i}@${UID_HOST}`, `DTSTAMP:${stamp}`, `DTSTART:${icsStamp(e.start)}`, `DTEND:${icsStamp(end.toISOString())}`, `SUMMARY:${icsEsc(e.title)}`);
        if (e.location)
            lines.push(`LOCATION:${icsEsc(e.location)}`);
        if (e.notes)
            lines.push(`DESCRIPTION:${icsEsc(e.notes)}`);
        lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
}
