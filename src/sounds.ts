/**
 * Interface sounds, console style: short, quiet blips synthesized on the fly, so there are no
 * audio files to ship. A tick when focus moves, a rising pair on A, a falling pair on B, and a
 * low, warm pair when Sofa switches on.
 */
type Sound = "move" | "select" | "back" | "boot";
/** Frequency (Hz) and length (s) of each note. */
const notes: Record<Sound, [number, number][]> = {
  move: [[1400, 0.03]],
  select: [
    [880, 0.045],
    [1320, 0.07],
  ],
  back: [
    [740, 0.045],
    [494, 0.07],
  ],
  boot: [
    [196, 0.1],
    [294, 0.22],
  ],
};
let context: AudioContext | null = null;
let enabled = true;
export const setSounds = (on: boolean) => {
  enabled = on;
};
export function playSound(sound: Sound) {
  if (!enabled) return;
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume();
  let at = context.currentTime;
  for (const [frequency, length] of notes[sound]) {
    const tone = context.createOscillator();
    const volume = context.createGain();
    tone.type = "sine";
    tone.frequency.value = frequency;
    // A soft attack and a quick fade: no click at either end.
    volume.gain.setValueAtTime(0, at);
    volume.gain.linearRampToValueAtTime(0.06, at + 0.006);
    volume.gain.exponentialRampToValueAtTime(0.0001, at + length);
    tone.connect(volume).connect(context.destination);
    tone.start(at);
    tone.stop(at + length + 0.02);
    at += length * 0.8;
  }
}
