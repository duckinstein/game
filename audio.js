const SOUND_ASSETS = {
  ambient: "./audio/ambient.mp3",
  coin: "./audio/coin.wav",
  fireball: "./audio/fireball.mp3",
  sword: "./audio/sword-attack.mp3"
};

const soundEffects = Object.fromEntries(
  Object.entries(SOUND_ASSETS)
    .filter(([name]) => name !== "ambient")
    .map(([name, src]) => {
      const audio = new Audio();
      audio.preload = "none";
      audio.src = src;
      return [name, audio];
    })
);
const ambient = new Audio();
ambient.loop = true;
ambient.preload = "none";
ambient.src = SOUND_ASSETS.ambient;
let musicVolume = 0.35;
let effectsVolume = 0.8;
let ambientStarted = false;
let ambientStartPending = false;

function readSavedVolume(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    if (saved === null) return fallback;
    const volume = Number(saved);
    return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume / 100)) : fallback;
  } catch (error) {
    console.error(`Unable to load saved ${key} audio setting.`, error);
    return fallback;
  }
}

musicVolume = readSavedVolume("game.musicVolume", 0.7);
effectsVolume = readSavedVolume("game.sfxVolume", 0.8);
ambient.volume = musicVolume;

export function setAudioVolume(channel, percentage) {
  const volume = Math.max(0, Math.min(1, Number(percentage) / 100));
  if (!Number.isFinite(volume)) return;

  if (channel === "music") {
    musicVolume = volume;
    ambient.volume = volume;
  } else if (channel === "effects") {
    effectsVolume = volume;
  } else {
    throw new Error(`Unknown audio channel: ${channel}`);
  }
}

export function startAmbientAudio() {
  if (ambientStarted || ambientStartPending || musicVolume === 0) return;
  ambient.volume = musicVolume;
  ambientStartPending = true;
  ambient.play().then(() => {
    ambientStarted = true;
  }).catch(error => {
    if (error.name !== "NotAllowedError") {
      console.error("Unable to start ambient game audio.", error);
    }
  }).finally(() => {
    ambientStartPending = false;
  });
}

export function playSound(name) {
  const source = soundEffects[name];
  if (!source || effectsVolume === 0) return;

  const sound = source.cloneNode();
  sound.volume = effectsVolume;
  sound.play().catch(error => {
    if (error.name !== "NotAllowedError") {
      console.error(`Unable to play the ${name} sound effect.`, error);
    }
  });
}

document.addEventListener("pointerdown", startAmbientAudio);
document.addEventListener("keydown", startAmbientAudio);
