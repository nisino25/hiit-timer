<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { DEFAULT_SETTINGS, buildPhases, formatTime } from './workout.js';
import { unlockAudio, cue, keepAwake } from './cues.js';

const STORAGE_KEY = 'hiit-timer-settings';
const CIRCUMFERENCE = 2 * Math.PI * 54;
const TICK_MS = 200;

const THEME = {
  warmup: { ring: 'text-sky-400', text: 'text-sky-300', chip: 'bg-sky-400/15 text-sky-300', bar: 'bg-sky-400' },
  work: { ring: 'text-orange-500', text: 'text-orange-300', chip: 'bg-orange-500/15 text-orange-300', bar: 'bg-orange-500' },
  rest: { ring: 'text-emerald-400', text: 'text-emerald-300', chip: 'bg-emerald-400/15 text-emerald-300', bar: 'bg-emerald-400' },
  cooldown: { ring: 'text-violet-400', text: 'text-violet-300', chip: 'bg-violet-400/15 text-violet-300', bar: 'bg-violet-400' },
  done: { ring: 'text-yellow-400', text: 'text-yellow-300', chip: 'bg-yellow-400/15 text-yellow-300', bar: 'bg-yellow-400' },
};

const FIELDS = [
  { key: 'warmup', label: 'Warm up (sec)', min: 0 },
  { key: 'work', label: 'Work (sec)', min: 1 },
  { key: 'rest', label: 'Rest (sec)', min: 0 },
  { key: 'sets', label: 'Sets', min: 1 },
  { key: 'cooldown', label: 'Final break (sec)', min: 0 },
];

// ---- settings (saved per device) ----
function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

const settings = ref(loadSettings());
const showSettings = ref(false);

// ---- plan and timer state ----
const phases = computed(() => buildPhases(settings.value));
const totalSeconds = computed(() => phases.value.reduce((sum, p) => sum + p.seconds, 0));

const index = ref(0);
const remainingMs = ref(0);
const running = ref(false);
const finished = ref(false);

let endAt = 0; // timestamp (ms) when the current phase ends; survives sleep/background
let timerId = null;
let lastTickSec = null;

const current = computed(() => phases.value[index.value]);
const next = computed(() => phases.value[index.value + 1]);

const theme = computed(() => THEME[finished.value ? 'done' : current.value?.type] ?? THEME.warmup);
const timeText = computed(() => formatTime(Math.ceil(remainingMs.value / 1000)));
const progress = computed(() => {
  const total = (current.value?.seconds ?? 0) * 1000;
  return total ? Math.min(1, Math.max(0, 1 - remainingMs.value / total)) : 0;
});
const dashOffset = computed(() => CIRCUMFERENCE * (1 - progress.value));

const isAtStart = computed(
  () => index.value === 0 && remainingMs.value === (phases.value[0]?.seconds ?? 0) * 1000,
);
const primaryLabel = computed(() => {
  if (running.value) return 'Pause';
  if (finished.value) return 'Start again';
  return isAtStart.value ? 'Start' : 'Resume';
});

const statusText = computed(() => {
  if (finished.value) return 'Workout complete';
  const p = current.value;
  if (!p) return 'Plan is empty';
  if (p.type === 'work') return `Set ${p.set} of ${settings.value.sets}`;
  if (p.type === 'rest') return `Rest after set ${p.set} of ${settings.value.sets}`;
  return p.type === 'warmup' ? 'Get ready' : 'Cool down';
});

const nextText = computed(() => {
  if (finished.value || !current.value) return '';
  return next.value ? `Next: ${next.value.label} · ${formatTime(next.value.seconds)}` : 'Last phase';
});

// ---- progress: which parts are done, and time left ----
const phaseStates = computed(() =>
  phases.value.map((p, i) => {
    let fill = 0;
    if (finished.value || i < index.value) fill = 100;
    else if (i === index.value) fill = progress.value * 100;
    return { type: p.type, seconds: p.seconds, fill };
  }),
);
const completedPhases = computed(() => (finished.value ? phases.value.length : index.value));
const setsDone = computed(() =>
  finished.value ? settings.value.sets : phases.value.slice(0, index.value).filter((p) => p.type === 'work').length,
);

const leftSeconds = computed(() => {
  if (finished.value) return 0;
  let ms = remainingMs.value;
  for (let i = index.value + 1; i < phases.value.length; i++) {
    ms += phases.value[i].seconds * 1000;
  }
  return Math.ceil(ms / 1000);
});
const leftText = computed(() => {
  const s = leftSeconds.value;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} sec left`;
});

// ---- timer control ----
function resetState() {
  index.value = 0;
  finished.value = false;
  remainingMs.value = (phases.value[0]?.seconds ?? 0) * 1000;
  lastTickSec = null;
}

function stopClock() {
  running.value = false;
  clearInterval(timerId);
  timerId = null;
  keepAwake(false);
}

function start() {
  if (running.value || !phases.value.length) return;
  if (finished.value) resetState();
  unlockAudio();
  running.value = true;
  endAt = Date.now() + remainingMs.value;
  lastTickSec = null;
  timerId = setInterval(tick, TICK_MS);
  keepAwake(true);
}

function pause() {
  if (!running.value) return;
  remainingMs.value = Math.max(0, endAt - Date.now());
  stopClock();
}

function toggle() {
  if (running.value) pause();
  else start();
}

function reset() {
  stopClock();
  resetState();
}

function tick() {
  let left = endAt - Date.now();
  let changed = false;

  // Catch up if the phone slept or the tab was throttled.
  while (left <= 0 && index.value < phases.value.length - 1) {
    index.value++;
    endAt += phases.value[index.value].seconds * 1000;
    left = endAt - Date.now();
    changed = true;
  }

  if (left <= 0) {
    remainingMs.value = 0;
    finished.value = true;
    stopClock();
    cue('done');
    return;
  }

  remainingMs.value = left;
  if (changed) {
    lastTickSec = null;
    cue(current.value.type);
    return;
  }

  // Countdown beeps at 3, 2, 1 seconds left.
  const sec = Math.ceil(left / 1000);
  if (sec <= 3 && sec !== lastTickSec) {
    lastTickSec = sec;
    cue('tick');
  }
}

// ---- wiring ----
watch(
  settings,
  (value) => {
    saveSettings(value);
    if (!running.value) reset();
  },
  { deep: true },
);

function restoreDefaults() {
  settings.value = { ...DEFAULT_SETTINGS };
}

function onVisibility() {
  if (document.visibilityState === 'visible' && running.value) {
    keepAwake(true); // the wake lock is released when the page is hidden
    tick();
  }
}

function onKey(e) {
  if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
    e.preventDefault();
    toggle();
  }
}

resetState();

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
  clearInterval(timerId);
  keepAwake(false);
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <main
    class="flex min-h-dvh flex-col items-center overflow-x-hidden bg-linear-to-b from-slate-900 to-slate-950 text-white select-none"
    :style="{
      paddingTop: 'max(1rem, env(safe-area-inset-top))',
      paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
      paddingLeft: 'max(1rem, env(safe-area-inset-left))',
      paddingRight: 'max(1rem, env(safe-area-inset-right))',
    }"
  >
    <header class="flex w-full max-w-sm items-center justify-between">
      <h1 class="text-lg font-bold tracking-wide">HIIT Timer</h1>
      <button
        type="button"
        class="rounded-full bg-white/10 px-4 py-2 text-sm font-medium active:bg-white/20 disabled:opacity-40"
        :disabled="running"
        @click="showSettings = !showSettings"
      >
        {{ showSettings ? 'Close' : 'Settings' }}
      </button>
    </header>

    <section v-if="showSettings" class="mt-4 w-full max-w-sm rounded-2xl bg-white/5 p-4">
      <div class="grid grid-cols-2 gap-3">
        <label v-for="f in FIELDS" :key="f.key" class="flex flex-col gap-1 text-sm text-white/70">
          {{ f.label }}
          <input
            v-model.number="settings[f.key]"
            type="number"
            inputmode="numeric"
            :min="f.min"
            :disabled="running"
            class="rounded-lg bg-slate-800 px-3 py-2 font-mono text-base text-white outline-none focus:ring-2 focus:ring-white/40 disabled:opacity-40"
          />
        </label>
      </div>
      <button
        type="button"
        class="mt-4 w-full rounded-lg bg-white/10 py-2 text-sm text-white/80 active:bg-white/20 disabled:opacity-40"
        :disabled="running"
        @click="restoreDefaults"
      >
        Restore defaults
      </button>
    </section>

    <div class="flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-4 py-3">
      <div class="w-full">
        <div class="flex h-3 w-full gap-1">
          <div
            v-for="(p, i) in phaseStates"
            :key="i"
            class="overflow-hidden rounded-full bg-white/10"
            :style="{ flexGrow: p.seconds, flexBasis: 0 }"
          >
            <div class="h-full transition-[width] duration-200" :class="THEME[p.type].bar" :style="{ width: p.fill + '%' }"></div>
          </div>
        </div>
        <div class="mt-2 flex justify-between text-xs text-white/60">
          <span>Done: {{ completedPhases }} / {{ phases.length }} parts</span>
          <span>Sets done: {{ setsDone }} / {{ settings.sets }}</span>
        </div>
      </div>

      <span class="rounded-full px-4 py-1 text-sm font-semibold uppercase tracking-widest" :class="theme.chip">
        {{ finished ? 'Done' : current?.label ?? '—' }}
      </span>

      <div class="relative aspect-square w-[min(18rem,68vw,38svh)]">
        <svg viewBox="0 0 120 120" class="h-full w-full -rotate-90">
          <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" stroke-width="8" class="text-white/10" />
          <circle
            cx="60"
            cy="60"
            r="54"
            fill="none"
            stroke="currentColor"
            stroke-width="8"
            stroke-linecap="round"
            :stroke-dasharray="CIRCUMFERENCE"
            :stroke-dashoffset="dashOffset"
            :class="theme.ring"
            class="transition-[stroke-dashoffset] duration-200 ease-linear"
          />
        </svg>
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <div class="font-mono text-7xl font-bold tabular-nums" :class="theme.text">{{ timeText }}</div>
          <div class="mt-2 text-sm text-white/60">{{ statusText }}</div>
        </div>
      </div>

      <p class="h-5 text-sm text-white/50">{{ nextText }}</p>

      <div class="flex w-full gap-3">
        <button
          type="button"
          class="flex-1 rounded-2xl py-5 text-xl font-bold active:scale-[0.98] disabled:opacity-40"
          :class="running ? 'bg-white/15 text-white' : 'bg-white text-slate-900'"
          :disabled="!phases.length"
          @click="toggle"
        >
          {{ primaryLabel }}
        </button>
        <button
          type="button"
          class="rounded-2xl bg-white/10 px-6 py-5 text-lg font-medium text-white/80 active:bg-white/20"
          @click="reset"
        >
          Reset
        </button>
      </div>
    </div>

    <footer class="text-center text-sm">
      <div class="text-2xl font-bold tabular-nums text-white">{{ leftText }}</div>
      <div class="mt-1 text-xs text-white/40">Total {{ formatTime(totalSeconds) }} · {{ settings.sets }} sets</div>
    </footer>
  </main>
</template>
