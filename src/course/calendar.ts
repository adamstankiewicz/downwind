// The calendar rules behind the oral and the flight review. Calendar months
// run to the end of the month (a review signed on the 3rd is good through the
// last day of the 24th month); days are counted as whole dates, so time of day
// never changes an answer.

const DAY = 86_400_000;

/** A date-only value at UTC midnight, from an ISO date or a Date (read on the pilot's clock). */
export function dateOnly(d: string | Date): Date {
  if (typeof d === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    d = new Date(d);
  }
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((dateOnly(to).getTime() - dateOnly(from).getTime()) / DAY);
}

/** The last day of the calendar month `months` after the month of `d`. */
export function endOfCalendarMonth(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0));
}

/** "March 31, 2027", read in UTC so a date-only value never slips a day. */
export function longDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export interface CalendarStatus {
  /** Last day the thing is good. */
  dueEnd: Date;
  current: boolean;
  /** Days from `on` to `dueEnd`; negative once it has lapsed. */
  daysLeft: number;
}

/** Anything due "within the preceding N calendar months": annual, ELT, transponder, flight review. */
export function calendarStatus(done: Date, months: number, on: Date): CalendarStatus {
  const dueEnd = endOfCalendarMonth(dateOnly(done), months);
  const daysLeft = daysBetween(on, dueEnd);
  return { dueEnd, current: daysLeft >= 0, daysLeft };
}

/** 14 CFR 61.56(c): a flight review within the preceding 24 calendar months. */
export function flightReviewStatus(lastIso: string | null, on: Date): CalendarStatus | null {
  if (!lastIso || !/^\d{4}-\d{2}-\d{2}/.test(lastIso)) return null;
  return calendarStatus(dateOnly(lastIso), 24, on);
}

export interface PassengerCurrency {
  /** Takeoffs and landings inside the preceding 90 days. */
  inWindow: number;
  current: boolean;
  /** The first day outside the window: landings before it no longer count. */
  windowStart: Date;
}

/** 14 CFR 61.57(a): three takeoffs and landings in the preceding 90 days, same category and class. */
export function passengerCurrency(landings: Date[], on: Date): PassengerCurrency {
  const day = dateOnly(on);
  const windowStart = addDays(day, -90);
  const inWindow = landings.filter((l) => {
    const d = dateOnly(l);
    return d.getTime() >= windowStart.getTime() && d.getTime() <= day.getTime();
  }).length;
  return { inWindow, current: inWindow >= 3, windowStart };
}
