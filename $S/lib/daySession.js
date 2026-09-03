"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clientTap = clientTap;
exports.clientTapLabel = clientTapLabel;
exports.trainingOnDay = trainingOnDay;
exports.dayTrainingCaveat = dayTrainingCaveat;
exports.dayPlanHeading = dayPlanHeading;
exports.dayPlanUnread = dayPlanUnread;
/**
 * THE DAY SHEET'S TWO MISSING ANSWERS: whose hour is this, and what are they
 * due to train in it.
 *
 * ── What the day sheet could do, and what it could not ────────────────────
 *
 * Tapping a date on app/(trainer)/calendar.tsx opens a list of that day's
 * sessions: a time, a duration, a status, and a row of controls. A coach
 * standing in front of the day they are about to work could Check In, Move or
 * Cancel — and could not, from that screen, find out who the 8am actually is or
 * what the 8am is supposed to be.
 *
 * Both were reachable, and both were reachable only by leaving the day. The
 * client's record is behind Check In, which MARKS THEM PRESENT on the way
 * through — a write, and the wrong one, for a coach who only wanted to read
 * their injuries before the session starts. And what they are due to train was
 * on the client screen, three taps and a programme tab further on, resolved by
 * a week calculation that lives in four other files.
 *
 * This module is the vocabulary for both, so the screen stays a screen.
 *
 * ── Rule one: a tap that cannot go anywhere is not offered ────────────────
 *
 * `slotName.ts` already holds the four-state vocabulary for who is in an hour
 * and this file does not invent a second one — it branches on `slotWho` and
 * nothing else. The state that matters here is 'unread': a BOOKED hour whose
 * client the roster this screen holds cannot name. There is an id on that row,
 * so a naive screen would happily push it at `/(trainer)/client`, which reads
 * the same roster, would not find them either, and would draw a record with a
 * blank name and nine empty sections. That is a dead tap, and a dead tap on the
 * screen a coach uses thirty seconds before a session reads as the app having
 * lost the client.
 *
 * So 'unread' is refused, in words, and the words are different for the two
 * reasons a roster comes back short — the client has left this coach's book, or
 * the read did not land. Only the second is worth pulling to refresh over.
 *
 * 'unnamed' is NOT refused. They are on the roster and the id resolves; the row
 * simply carries no name. The record opens and no name is passed with it, which
 * is the same rule `checkIn` already follows in calendar.tsx: a noun phrase
 * standing in for a name must never be handed to a screen that will print it as
 * a title.
 *
 * ── Rule two: an unread programme is never drawn as a rest day ────────────
 *
 * `trainingOnDay` has SIX states and three of them mean "nothing is scheduled"
 * for three different reasons a coach acts on differently:
 *
 *   · 'unreadable' — the assignments did not come back. Nothing is known. This
 *                    is the one that must never render as a rest day, and it is
 *                    the reason this function returns a state rather than a
 *                    nullable day.
 *   · 'unassigned' — the read landed and this coach has assigned them nothing.
 *   · 'unwritten'  — a programme is assigned and the week this date falls in
 *                    has no days written in it.
 *   · 'rest'       — a programme is assigned, was read, has days, and puts none
 *                    of them on this weekday. The ONLY state that may say the
 *                    programme schedules nothing today.
 *
 * `confirmed` is the fourth axis and is deliberately separate from the state.
 * `useAssignedPrograms` keeps whatever it last held when a read fails, so a
 * programme in hand under 'error' is a real programme that may be out of date —
 * which is a caveat on a true answer, not a different answer, and folding it
 * into the state would have cost the day its plan for a dropped connection.
 *
 * ── Which week, counted to the day on screen ──────────────────────────────
 *
 * Not today. The day sheet is a DATE the coach tapped, which is routinely next
 * Tuesday, and "what are they due to train" on next Tuesday is week five of the
 * block and not week four. `blockPosition` already takes the day to count to as
 * an argument, so the whole of the difference is passing `dateISO` where
 * app/(trainer)/client-week.tsx passes `todayISO`, and every other step —
 * `programWeeks`, `weekCount`, `clientWeek`, `scheduledDay` — is the same
 * machinery those screens read, called in the same order. There is no second
 * resolver here and there must never be one: two answers to "which week" is how
 * a coach ends up coaching a session their client was never shown.
 *
 * Pure. No react, no supabase, no clock — `dateISO` is passed in, and the
 * weekday is read off it locally by `weekdayOfIso`, never by slicing a UTC
 * timestamp.
 */
const slotName_1 = require("./slotName");
const programBlock_1 = require("./programBlock");
const programStart_1 = require("./programStart");
const clientBlock_1 = require("./clientBlock");
const checklist_1 = require("./checklist");
const dayPlan_1 = require("./dayPlan");
/** Whether the list in hand is the whole of what the server holds. The same
 *  test `isWhole` makes, written locally for the same reason slotName.ts writes
 *  it locally: this file imports no value from src/ui. */
const whole = (status) => status === 'ready';
/**
 * Whether this hour opens onto somebody.
 *
 * The refusal sentences are short on purpose: on a booked row that cannot be
 * named the day sheet already prints `unnamedSlotNote`, which says the hour is
 * spoken for and must not be given away. This adds only the half that is about
 * the tap, so the two lines together read as one thought rather than as the
 * same warning twice.
 */
function clientTap(clientId, roster, status) {
    const who = (0, slotName_1.slotWho)(clientId, roster);
    if (who === 'open') {
        return {
            can: false, clientId: null, name: null, who,
            why: 'Nobody is booked into this hour, so there is no record to open.',
        };
    }
    if (who === 'unread') {
        return {
            can: false, clientId: null, name: null, who,
            why: whole(status)
                // They left the book and kept the hour. The record is not this coach's
                // to open any more, and saying "pull down to refresh" here would send a
                // coach round a loop that cannot end.
                ? 'Their record cannot be opened from here, because they are no longer on your book.'
                : 'Their record cannot be opened until your roster loads.',
        };
    }
    const id = String(clientId);
    const found = roster.find((c) => c.id === id);
    const name = who === 'named' ? (found?.name ?? '').trim() : '';
    return { can: true, clientId: id, name: name || null, why: null, who };
}
/**
 * What the row's tap does, for a screen reader.
 *
 * Only ever called when the tap is offered, so there is no branch here for a
 * name that is not a name: `clientTap` has already refused every state where
 * one would be reached for.
 */
function clientTapLabel(tap) {
    return tap.name
        ? `Open ${tap.name}’s record and the session planned for this day`
        : 'Open this client’s record and the session planned for this day';
}
const EMPTY = {
    day: null, focus: null, exercises: null, cardio: null, week: null, weekLabel: null,
};
/**
 * What one client is due to train on one date.
 *
 * `programme` and `startsOn` are what `useAssignedPrograms` holds for that
 * client, `status` is that provider's own, and `dateISO` is the day the coach
 * has open — `YYYY-MM-DD`, built from a local Date, never from a UTC slice.
 * `who` is a first name or a noun phrase; every sentence below reads as English
 * with either.
 */
function trainingOnDay(programme, startsOn, dateISO, status, who) {
    const confirmed = whole(status);
    const weekday = (0, dayPlan_1.weekdayOfIso)(dateISO);
    if (weekday == null) {
        return {
            ...EMPTY, state: 'undated', confirmed,
            line: 'This day could not be read as a date, so what is planned for it cannot be worked out.',
        };
    }
    if (!programme) {
        // The order matters. A null programme under a failed read is UNKNOWN, and
        // it is the exact null that used to be presented all over this app as "your
        // coach has not assigned you anything" — see the header of
        // src/ui/assignedPrograms.ts, which is where that was first separated.
        return confirmed
            ? {
                ...EMPTY, state: 'unassigned', confirmed,
                line: `${who} has no programme from you, so nothing is planned for this day. What you do in the session is yours to decide.`,
            }
            : {
                ...EMPTY, state: 'unreadable', confirmed,
                line: `Your programme assignments could not be read, so what ${who} is due to train on this day is not known. This is a connection problem, not a rest day.`,
            };
    }
    const weeks = (0, programBlock_1.programWeeks)(programme);
    const pos = (0, programStart_1.blockPosition)(startsOn, dateISO, (0, programBlock_1.weekCount)(programme));
    const at = (0, clientBlock_1.clientWeek)(pos, weeks.length);
    const wk = weeks[at.index] ?? weeks[0];
    const label = at.count > 1 ? (0, programBlock_1.weekLabel)(wk, at.index + 1) : null;
    // Emptiness is a property of the WEEK this date lands in, never of the list.
    //
    // `programWeeks` cannot return an empty array for a programme that exists: a
    // programme with no `weeks` IS one week, and that week is `days` — see its
    // header. So the `!weeks.length` guard that used to stand here could not
    // fire, 'unwritten' was unreachable, and a coach who had assigned somebody a
    // programme with nothing in it read "schedules nothing on this day", which
    // is the rest-day sentence and sends them to train around a plan that was
    // never written. Asked of `wk` it fires for the case it is named for, and
    // also for the blank week of a block whose other weeks are written — which
    // is the same fact about the same date, and is likewise not a rest day.
    const days = Array.isArray(wk.days) ? wk.days : [];
    if (!days.length) {
        return {
            ...EMPTY, state: 'unwritten', confirmed, week: at, weekLabel: label,
            line: label
                ? `${who}’s programme has no days written in ${label.toLowerCase()}, so there is nothing planned for this day.`
                : `${who}’s programme has no days written in it, so nothing is planned for this day.`,
        };
    }
    const day = (0, checklist_1.scheduledDay)(days, weekday);
    if (!day) {
        return {
            ...EMPTY, state: 'rest', confirmed, week: at, weekLabel: label,
            line: label
                ? `${who}’s programme schedules nothing on this day of ${label.toLowerCase()}.`
                : `${who}’s programme schedules nothing on this day.`,
        };
    }
    const focus = String(day.focus || '').trim() || null;
    const exercises = Array.isArray(day.exercises) ? day.exercises.length : 0;
    const cardio = String(day.cardio || '').trim() || null;
    return {
        state: 'session', day, focus, exercises, cardio, week: at, weekLabel: label, confirmed,
        line: sessionLine(focus, exercises, cardio, label),
    };
}
/**
 * The row's own line for a scheduled day.
 *
 * Assembled here rather than in the screen so the three things a coach wants
 * thirty seconds before a session — what it is, how much of it there is, and
 * which week of the block it belongs to — cannot drift apart between the day
 * sheet and anything else that comes to read this.
 *
 * A blank focus is ordinary and is described rather than left as a hole: a
 * coach who wrote six exercises and no heading has still written a session.
 */
function sessionLine(focus, exercises, cardio, label) {
    const head = focus ?? 'A session is planned';
    const count = exercises === 0
        ? (cardio ? 'no lifts written' : 'no exercises written yet')
        : exercises === 1 ? '1 exercise' : `${exercises} exercises`;
    const parts = [`${head} · ${count}`];
    if (cardio)
        parts.push(cardio);
    if (label)
        parts.push(label);
    return parts.join(' · ');
}
/**
 * The caveat that belongs under a plan resolved from an unconfirmed read, or
 * null when there is none.
 *
 * Its own sentence rather than a clause on `line`, because it is about the
 * connection and not about the training, and because a coach who reads the plan
 * and acts on it is right to do so — the plan is real, it is simply not known
 * to be the newest one.
 */
function dayTrainingCaveat(d) {
    if (d.confirmed)
        return null;
    if (d.state === 'unreadable' || d.state === 'undated')
        return null;
    return 'Your programme assignments could not be read just now, so this is the last plan this phone had rather than a confirmed one.';
}
/**
 * The heading over the plan on the row.
 *
 * Names the date it is about, because the day sheet is routinely open on a day
 * that is not today and "Planned" over next Tuesday's row invites reading it as
 * what they are training now.
 */
function dayPlanHeading(d) {
    switch (d.state) {
        case 'session': return 'Planned for this day';
        case 'rest': return 'Nothing planned for this day';
        case 'unassigned': return 'No programme assigned';
        // On a block, the week is the thing that is empty and the programme is
        // not — a heading that said otherwise would send a coach to rewrite a
        // programme whose other eleven weeks are written.
        case 'unwritten': return d.weekLabel ? 'Nothing written for that week' : 'Programme is empty';
        case 'unreadable': return 'Plan not read';
        case 'undated': return 'Plan not read';
    }
}
/**
 * Whether this state is a fact about the connection rather than about the
 * training, which is what decides whether the row draws a warning mark.
 *
 * A rest day and an unassigned client are both ordinary and neither is a
 * problem to solve. An unread plan is neither ordinary nor about the client,
 * and it is the one a coach must not walk past.
 */
function dayPlanUnread(d) {
    return d.state === 'unreadable' || d.state === 'undated' || !d.confirmed;
}
