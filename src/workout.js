// Workout plan: pure functions, no DOM access.

export const DEFAULT_SETTINGS = {
  warmup: 300, // seconds
  work: 60,
  rest: 120,
  sets: 5,
  cooldown: 300, // final break after the last work set
};

const clamp = (value, min, fallback) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
};

// Warm up -> (Work -> Rest) x (sets - 1) -> Work -> Final break
export function buildPhases(input) {
  const s = {
    warmup: clamp(input.warmup, 0, DEFAULT_SETTINGS.warmup),
    work: clamp(input.work, 1, DEFAULT_SETTINGS.work),
    rest: clamp(input.rest, 0, DEFAULT_SETTINGS.rest),
    sets: clamp(input.sets, 1, DEFAULT_SETTINGS.sets),
    cooldown: clamp(input.cooldown, 0, DEFAULT_SETTINGS.cooldown),
  };

  const phases = [];
  if (s.warmup > 0) {
    phases.push({ type: 'warmup', label: 'Warm up', seconds: s.warmup });
  }
  for (let set = 1; set <= s.sets; set++) {
    phases.push({ type: 'work', label: 'Work', seconds: s.work, set });
    if (set < s.sets && s.rest > 0) {
      phases.push({ type: 'rest', label: 'Rest', seconds: s.rest, set });
    }
  }
  if (s.cooldown > 0) {
    phases.push({ type: 'cooldown', label: 'Break', seconds: s.cooldown });
  }
  return phases;
}

export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
