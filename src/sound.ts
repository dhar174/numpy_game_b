let context: AudioContext | undefined;
let ambience: OscillatorNode | undefined;

function audio() {
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume().catch(() => {});
  return context;
}

export function primeSound() {
  if (typeof AudioContext !== 'undefined') audio();
}

export function repairSound(enabled: boolean, sector: boolean) {
  if (!enabled || typeof AudioContext === 'undefined') return;
  const ctx = audio();
  const notes = sector ? [261.63, 329.63, 392, 523.25] : [392, 523.25];
  notes.forEach((frequency, index) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + index * 0.085;
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.08, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.19);
  });
}

export function toggleAmbience(enabled: boolean) {
  if (!enabled || typeof AudioContext === 'undefined') {
    ambience?.stop();
    ambience = undefined;
    return;
  }
  if (ambience) return;
  const ctx = audio();
  const gain = ctx.createGain();
  ambience = ctx.createOscillator();
  ambience.type = 'sine';
  ambience.frequency.value = 55;
  gain.gain.value = 0.028;
  ambience.connect(gain).connect(ctx.destination);
  ambience.start();
}
