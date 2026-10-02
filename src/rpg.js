// Character progression: XP, levels, stats, titles and mood.

export const KINDS = {
  strength: { label: 'Strength', emoji: '🏋️', stat: 'STR' },
  cardio: { label: 'Cardio', emoji: '🏃', stat: 'END' },
  mobility: { label: 'Mobility / Yoga', emoji: '🧘', stat: 'FLX' },
  sport: { label: 'Sport', emoji: '⚽', stat: 'AGI' },
  other: { label: 'Other', emoji: '✨', stat: null },
};

export const STATS = {
  STR: 'Strength',
  END: 'Endurance',
  FLX: 'Flexibility',
  AGI: 'Agility',
};

const XP_PER_STAT_POINT = 150;
const MAX_COUNTED_MINUTES = 120;

/**
 * XP for one check-in. Longer workouts earn more (up to 2 hours), each extra
 * day of streak adds 10% (up to +50%), and extra check-ins on the same day
 * earn half so nobody farms XP by splitting a workout into ten posts.
 */
export function checkinXp({ minutes, streak, alreadyCheckedInToday }) {
  const counted = Math.min(Math.max(minutes, 1), MAX_COUNTED_MINUTES);
  let xp = 40 + 2 * counted;
  xp *= 1 + Math.min(Math.max(streak - 1, 0), 5) * 0.1;
  if (alreadyCheckedInToday) xp *= 0.5;
  return Math.round(xp);
}

/** Total XP needed to reach `level`: 0, 100, 300, 600, 1000, ... */
export function xpForLevel(level) {
  return 50 * level * (level - 1);
}

export function levelFromXp(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

export function levelProgress(xp) {
  const level = levelFromXp(xp);
  const floor = xpForLevel(level);
  return { level, current: xp - floor, needed: xpForLevel(level + 1) - floor };
}

/** Stat points from XP earned per workout kind. "Other" spreads across every stat. */
export function statsFromXp(xpByKind) {
  const statXp = Object.fromEntries(Object.keys(STATS).map((s) => [s, 0]));
  for (const [kind, xp] of Object.entries(xpByKind)) {
    const stat = KINDS[kind]?.stat;
    if (stat) {
      statXp[stat] += xp;
    } else {
      for (const s of Object.keys(statXp)) statXp[s] += xp / 4;
    }
  }
  return Object.fromEntries(
    Object.entries(statXp).map(([s, xp]) => [s, 1 + Math.floor(xp / XP_PER_STAT_POINT)]),
  );
}

const TITLES = [
  [20, 'Living Legend'],
  [15, 'Champion'],
  [10, 'Athlete'],
  [6, 'Gym Regular'],
  [3, 'Rookie'],
  [1, 'Couch Potato'],
];

export function titleForLevel(level) {
  return TITLES.find(([min]) => level >= min)[1];
}

/** How the character feels, based on days since the last workout (null = never worked out). */
export function moodFor(daysSince) {
  if (daysSince === null) return { emoji: '🥚', label: 'Unhatched', line: 'Waiting for its first workout.' };
  if (daysSince <= 1) return { emoji: '😤', label: 'Pumped', line: 'Feeling unstoppable.' };
  if (daysSince <= 3) return { emoji: '🙂', label: 'Content', line: 'Doing fine. Could go for a workout.' };
  if (daysSince <= 6) return { emoji: '😕', label: 'Restless', line: 'Pacing around. Getting antsy.' };
  if (daysSince <= 13) return { emoji: '😢', label: 'Sad', line: 'Staring out the window at the gym.' };
  return { emoji: '🛋️', label: 'Melted into the couch', line: 'Has forgotten what sneakers are.' };
}
