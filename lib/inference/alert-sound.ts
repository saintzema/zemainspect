"use client";

/**
 * A defect alert tone, synthesised with the Web Audio API rather than shipped
 * as an audio file.
 *
 * No asset to fetch, cache-bust or fail to load on a factory network — and no
 * licensing question over a sound effect. Two short rising beeps read as
 * "attention" without being alarming enough to make an operator mute the tab
 * during a normal shift with real defects passing through.
 */

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

function beep(when: number, frequency: number, durationSec: number, gain: number) {
  const audio = audioContext();
  if (!audio) return;

  const osc = audio.createOscillator();
  const vol = audio.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, when);
  // Ramp rather than a hard stop, so the tail doesn't click.
  vol.gain.setValueAtTime(0, when);
  vol.gain.linearRampToValueAtTime(gain, when + 0.01);
  vol.gain.exponentialRampToValueAtTime(0.0001, when + durationSec);

  osc.connect(vol).connect(audio.destination);
  osc.start(when);
  osc.stop(when + durationSec + 0.02);
}

/**
 * Play the defect alert. Safe to call from any component; a browser that has
 * not yet let audio play (no user gesture) simply resumes silently.
 */
export function playDefectAlert() {
  const audio = audioContext();
  if (!audio) return;
  if (audio.state === "suspended") void audio.resume().catch(() => undefined);

  const now = audio.currentTime;
  beep(now, 880, 0.12, 0.18);
  beep(now + 0.15, 1046, 0.14, 0.18);
}

/** A single, softer chime for "back to passing" — confirmation, not alarm. */
export function playClearTone() {
  const audio = audioContext();
  if (!audio) return;
  if (audio.state === "suspended") void audio.resume().catch(() => undefined);
  beep(audio.currentTime, 660, 0.1, 0.1);
}
