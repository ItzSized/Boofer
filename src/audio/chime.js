/**
 * Synthesized sounds (no audio files, no licensing questions).
 * Swap for `new Audio("/sounds/done.mp3").play()` if you prefer a sample.
 */
let ctx;
let enabled = true;
let masterVolume = 0.8;

/** From the settings: sounds on/off and volume (0–1). */
export function configureSound({ sounds, volume }) {
  enabled = sounds;
  masterVolume = volume;
}

function audio() {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq, start, { duration = 0.6, volume = 0.22, type = "sine", glideTo } = {}) {
  if (!enabled || masterVolume <= 0) return;
  volume *= masterVolume;
  const ac = audio();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** Bright little major arpeggio — "c'est prêt !" */
export function playDone() {
  const t = audio().currentTime + 0.02;
  [880, 1318.5, 1760].forEach((freq, i) => {
    tone(freq, t + i * 0.09);
    tone(freq * 2, t + i * 0.09, { volume: 0.05, duration: 0.35 }); // bell shimmer
  });
}

/** Soft rising "bloop" — the agent is waiting for you. */
export function playAttention() {
  const t = audio().currentTime + 0.02;
  tone(520, t, { duration: 0.18, glideTo: 780, type: "triangle", volume: 0.18 });
  tone(520, t + 0.22, { duration: 0.18, glideTo: 780, type: "triangle", volume: 0.18 });
}

/** Tiny giggle when you pat the ghost. */
export function playPat() {
  const t = audio().currentTime + 0.01;
  tone(740, t, { duration: 0.12, glideTo: 1100, volume: 0.12 });
  tone(990, t + 0.1, { duration: 0.14, glideTo: 1480, volume: 0.1 });
}

export function playError() {
  const t = audio().currentTime + 0.02;
  tone(330, t, { duration: 0.35, glideTo: 220, type: "triangle", volume: 0.15 });
}
