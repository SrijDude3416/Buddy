// ---------------------------------------------------------------------------
// Display-time derivation.
//
// The backend speaks ISO datetimes (SCHEMA.md: sessions.start / sessions.end,
// 15-minute aligned). Day labels and clock strings are derived here at read
// time and never stored — same rule the schema applies to progress and
// days-to-deadline.
// ---------------------------------------------------------------------------

import { SLOT_MINUTES } from './preferenceCatalog.js';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Whole days from today to `iso`, ignoring time of day. Negative = past. */
export function dayOffset(iso, now = new Date()) {
  const a = startOfDay(now).getTime();
  const b = startOfDay(new Date(iso)).getTime();
  return Math.round((b - a) / 86400000);
}

export function dayLabel(iso, now = new Date()) {
  const offset = dayOffset(iso, now);
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  if (offset === -1) return 'Yesterday';
  return WEEKDAY_SHORT[new Date(iso).getDay()];
}

export function timeLabel(iso) {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function minutesIntoDay(iso) {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

export function slotIndexIntoDay(iso) {
  return Math.floor(minutesIntoDay(iso) / SLOT_MINUTES);
}

/** "Midterm in 12 days" — relative framing, never an absolute date. */
export function relativeDeadline(iso, now = new Date()) {
  const offset = dayOffset(iso, now);
  if (offset < 0) return `${Math.abs(offset)} day${Math.abs(offset) === 1 ? '' : 's'} overdue`;
  if (offset === 0) return 'today';
  if (offset === 1) return 'tomorrow';
  return `in ${offset} days`;
}

/** The day descriptors the "this week" load strip renders. */
export function horizonDays(days, now = new Date()) {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(startOfDay(now), i);
    return { offset: i, date, label: i === 0 ? 'Today' : i === 1 ? 'Tmw' : WEEKDAY_SHORT[date.getDay()] };
  });
}

export function isoAt(dayOffsetFromToday, hour, minute = 0, now = new Date()) {
  const d = addDays(startOfDay(now), dayOffsetFromToday);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export function addMinutesIso(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

/**
 * Whether a session's own scheduled end has already passed, real wall-clock
 * time. Used to auto-cross-out a session once its calendar slot has
 * happened, independent of whether the user ever checked it off — SCHEMA.md's
 * `completed` stays a separate, user-controlled signal; this is a third,
 * computed-at-read-time dimension layered on top for display only, never
 * stored (same rule this whole file already follows for day labels and
 * relative deadlines).
 */
export function hasEnded(iso, now = new Date()) {
  return !!iso && new Date(iso).getTime() <= now.getTime();
}

/** "135" -> "2hr 15min" — a raw minute count read out as hours+minutes, the
 * way a person actually thinks about a chunk of their week, not as a bare
 * number of minutes. Drops the half that's zero rather than printing
 * "2hr 0min" or "0hr 15min". */
export function formatDuration(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}hr`;
  return `${h}hr ${m}min`;
}
