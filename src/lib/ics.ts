// Pure iCalendar (.ics) builder — no React Native imports, so it unit-tests in
// plain node. The share/file-write side lives in exportShare.ts (needs RN).
export interface IcsEvent { start: string; durationMin: number; title: string; location?: string; notes?: string }

const icsStamp = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};
const icsEsc = (s: string) => (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

export function buildIcs(events: IcsEvent[], calName = 'Repple', nowMs: number = Date.now()): string {
  const stamp = icsStamp(new Date(nowMs).toISOString());
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Repple//Sessions//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEsc(calName)}`];
  events.forEach((e, i) => {
    const start = new Date(e.start);
    const end = new Date(start.getTime() + (e.durationMin || 60) * 60000);
    lines.push('BEGIN:VEVENT', `UID:repple-${icsStamp(e.start)}-${i}@repple.app`, `DTSTAMP:${stamp}`, `DTSTART:${icsStamp(e.start)}`, `DTEND:${icsStamp(end.toISOString())}`, `SUMMARY:${icsEsc(e.title)}`);
    if (e.location) lines.push(`LOCATION:${icsEsc(e.location)}`);
    if (e.notes) lines.push(`DESCRIPTION:${icsEsc(e.notes)}`);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
