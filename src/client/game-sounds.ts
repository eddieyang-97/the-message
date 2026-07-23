import type { PlayerProjection, WinnerState } from "../game/engine";

export type GameSoundCue =
  | "draw"
  | "play"
  | "pass"
  | "burn"
  | "receive"
  | "prompt"
  | "gameStart"
  | "victory"
  | "defeat"
  | "flower"
  | "tomato";

export const SOUND_ENABLED_STORAGE_KEY = "fengsheng:sound-enabled";

let audioContext: AudioContext | undefined;

function context(): AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) return undefined;
  audioContext ??= new AudioContextConstructor();
  return audioContext;
}

function tone(
  audio: AudioContext,
  frequency: number,
  delay: number,
  duration: number,
  volume: number,
  type: OscillatorType = "sine",
): void {
  const start = audio.currentTime + delay;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.01);
}

function noise(
  audio: AudioContext,
  delay: number,
  duration: number,
  volume: number,
  frequency: number,
): void {
  const sampleCount = Math.ceil(audio.sampleRate * duration);
  const buffer = audio.createBuffer(1, sampleCount, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }
  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const gain = audio.createGain();
  const start = audio.currentTime + delay;
  source.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(gain).connect(audio.destination);
  source.start(start);
}

function renderCue(audio: AudioContext, cue: GameSoundCue): void {
  switch (cue) {
    case "draw":
      tone(audio, 760, 0, 0.055, 0.035, "triangle");
      tone(audio, 1040, 0.055, 0.07, 0.03, "triangle");
      break;
    case "play":
      noise(audio, 0, 0.055, 0.035, 1500);
      tone(audio, 180, 0, 0.08, 0.025, "triangle");
      break;
    case "pass":
      noise(audio, 0, 0.16, 0.018, 3200);
      tone(audio, 620, 0, 0.11, 0.025, "sine");
      tone(audio, 470, 0.09, 0.13, 0.022, "sine");
      break;
    case "burn":
      noise(audio, 0, 0.28, 0.055, 2300);
      tone(audio, 150, 0.02, 0.3, 0.04, "sawtooth");
      break;
    case "receive":
      tone(audio, 440, 0, 0.12, 0.035, "triangle");
      tone(audio, 660, 0.09, 0.16, 0.035, "triangle");
      break;
    case "prompt":
      tone(audio, 740, 0, 0.1, 0.035, "sine");
      tone(audio, 880, 0.12, 0.13, 0.035, "sine");
      break;
    case "gameStart":
      tone(audio, 330, 0, 0.15, 0.035, "triangle");
      tone(audio, 440, 0.1, 0.15, 0.035, "triangle");
      tone(audio, 550, 0.2, 0.2, 0.04, "triangle");
      break;
    case "victory":
      tone(audio, 523, 0, 0.18, 0.04, "triangle");
      tone(audio, 659, 0.12, 0.18, 0.04, "triangle");
      tone(audio, 784, 0.24, 0.32, 0.045, "triangle");
      break;
    case "defeat":
      tone(audio, 392, 0, 0.2, 0.035, "triangle");
      tone(audio, 330, 0.15, 0.2, 0.035, "triangle");
      tone(audio, 262, 0.3, 0.32, 0.04, "triangle");
      break;
    case "flower":
      tone(audio, 880, 0, 0.12, 0.03, "sine");
      tone(audio, 1175, 0.08, 0.2, 0.035, "sine");
      break;
    case "tomato":
      noise(audio, 0, 0.12, 0.055, 700);
      tone(audio, 95, 0, 0.15, 0.04, "triangle");
      break;
  }
}

export function playGameSound(cue: GameSoundCue): void {
  const audio = context();
  if (!audio) return;
  if (audio.state === "running") {
    renderCue(audio, cue);
    return;
  }
  void audio.resume().then(() => renderCue(audio, cue)).catch(() => {
    // Browsers may require a user gesture before audio can begin.
  });
}

export function unlockGameSounds(): void {
  const audio = context();
  if (audio?.state === "suspended") void audio.resume().catch(() => undefined);
}

export function loadSoundEnabledPreference(): boolean {
  try {
    return localStorage.getItem(SOUND_ENABLED_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveSoundEnabledPreference(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_ENABLED_STORAGE_KEY, String(enabled));
  } catch {
    // Keep the preference for this page when storage is unavailable.
  }
}

export function soundCueForAuditEntries(
  entries: readonly string[],
): GameSoundCue | undefined {
  if (entries.some((entry) => /烧毁结算：.*公开弃置/.test(entry))) return "burn";
  if (entries.some((entry) => entry.includes("接收情报"))) return "receive";
  if (entries.some((entry) => /摸\d+张牌/.test(entry))) return "draw";
  if (
    entries.some((entry) =>
      entry.includes("当前接收者：") || entry.includes("成为当前接收者")
    )
  ) return "pass";
  if (
    entries.some((entry) =>
      entry.includes("使用") ||
      /开始以.+传递情报/.test(entry) ||
      entry.includes("弃置一张手牌")
    )
  ) return "play";
  return undefined;
}

export function winnerSoundCue(
  winner: WinnerState,
  own: PlayerProjection["own"],
): Extract<GameSoundCue, "victory" | "defeat"> {
  const won =
    (winner.kind === "faction" && winner.faction === own.faction) ||
    (winner.kind === "agent" && winner.playerId === own.id);
  return won ? "victory" : "defeat";
}
