import { addDays, daysBetween, weekStartOf } from './time.js';

// Streaks, records and the heatmap, all computed from a member's check-in dates.

function streakEndingAt(dates, date) {
  let streak = 0;
  while (dates.has(date)) {
    streak++;
    date = addDays(date, -1);
  }
  return streak;
}

/** A streak survives until the end of today, so it counts from yesterday if today is still empty. */
export function currentStreak(dates, today) {
  return dates.has(today) ? streakEndingAt(dates, today) : streakEndingAt(dates, addDays(today, -1));
}

export function longestStreak(dates) {
  let best = 0;
  for (const date of dates) {
    // Only measure from the last day of each run.
    if (!dates.has(addDays(date, 1))) best = Math.max(best, streakEndingAt(dates, date));
  }
  return best;
}

export function bestWeek(dates) {
  const perWeek = new Map();
  for (const date of dates) {
    const week = weekStartOf(date);
    perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
  }
  return Math.max(0, ...perWeek.values());
}

export function daysSinceLast(dates, today) {
  if (dates.size === 0) return null;
  const last = [...dates].sort().at(-1);
  return daysBetween(last, today);
}

export const HEATMAP_LEGEND = '⬛ rest · 🟨 under 30 min · 🟩 30+ min · 🔥 60+ min';

function cell(minutes) {
  if (!minutes) return '⬛';
  if (minutes < 30) return '🟨';
  if (minutes < 60) return '🟩';
  return '🔥';
}

/**
 * GitHub-style grid: one column per week (oldest on the left), one row per
 * weekday (Monday on top). Days after today are left out.
 */
export function renderHeatmap(minutesByDate, today, weeks = 12) {
  const firstWeek = addDays(weekStartOf(today), -7 * (weeks - 1));
  const rows = [];
  for (let day = 0; day < 7; day++) {
    let row = '';
    for (let week = 0; week < weeks; week++) {
      const date = addDays(firstWeek, week * 7 + day);
      row += date > today ? '➖' : cell(minutesByDate.get(date));
    }
    rows.push(row);
  }
  return rows.join('\n');
}
