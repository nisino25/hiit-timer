// Sound, vibration and screen wake lock. Every call fails silently when unsupported.

let audio = null;
let wakeLock = null;
let wakeToken = 0;

// Must be called from a user gesture (e.g. the Start button) so iOS allows audio.
export function unlockAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === 'suspended') audio.resume();
  } catch {
    /* audio unavailable: cues stay silent */
  }
}

function tone(freq, ms, delay = 0) {
  if (!audio) return;
  const t = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(t);
  osc.stop(t + ms / 1000 + 0.05);
}

function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

export function cue(kind) {
  switch (kind) {
    case 'tick':
      tone(880, 120);
      break;
    case 'warmup':
      tone(523, 300);
      break;
    case 'work':
      tone(1046, 450);
      vibrate([250]);
      break;
    case 'rest':
      tone(523, 450);
      vibrate([250]);
      break;
    case 'cooldown':
      tone(392, 700);
      vibrate([250]);
      break;
    case 'done':
      tone(1046, 200);
      tone(1046, 200, 0.25);
      tone(1318, 600, 0.5);
      vibrate([200, 100, 200, 100, 400]);
      break;
  }
}

// Keeps the screen on while the timer runs.
export async function keepAwake(on) {
  const token = ++wakeToken;
  try {
    await wakeLock?.release();
  } catch {
    /* already released */
  }
  wakeLock = null;

  if (!on || !('wakeLock' in navigator)) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (token !== wakeToken) {
      lock.release();
      return;
    }
    wakeLock = lock;
  } catch {
    /* denied or unsupported */
  }
}
