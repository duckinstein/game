const TIME_MODE_KEY = "sprout-lands.time-mode.v1";
const DAY_CYCLE_DURATION = 180_000;
const DAY_COLOR_STOPS = [
  { time: 0, color: [255, 247, 224], alpha: 0.04 },
  { time: 0.35, color: [255, 247, 224], alpha: 0.04 },
  { time: 0.5, color: [224, 112, 165], alpha: 0.4 },
  { time: 0.68, color: [42, 52, 104], alpha: 0.68 },
  { time: 0.82, color: [42, 52, 104], alpha: 0.68 },
  { time: 0.96, color: [230, 153, 72], alpha: 0.4 },
  { time: 1, color: [255, 247, 224], alpha: 0.04 }
];
const FIXED_TIME_COLORS = {
  day: { color: [255, 247, 224], alpha: 0.04 },
  night: { color: [42, 52, 104], alpha: 0.75 },
  sunset: { color: [224, 112, 165], alpha: 0.24 },
  sunrise: { color: [230, 153, 72], alpha: 0.4 }
};
const VALID_TIME_MODES = new Set(["auto", ...Object.keys(FIXED_TIME_COLORS)]);

let timeMode = "auto";
try {
  const savedMode = localStorage.getItem(TIME_MODE_KEY);
  if (savedMode !== null) {
    if (VALID_TIME_MODES.has(savedMode)) {
      timeMode = savedMode;
    } else {
      console.error("Saved time-of-day setting has an invalid value.");
    }
  }
} catch (error) {
  console.error("Unable to load saved time-of-day setting.", error);
}

function interpolateCycleColor(time) {
  const phase = (time % DAY_CYCLE_DURATION) / DAY_CYCLE_DURATION;
  for (let index = 1; index < DAY_COLOR_STOPS.length; index++) {
    const next = DAY_COLOR_STOPS[index];
    if (phase > next.time) continue;

    const previous = DAY_COLOR_STOPS[index - 1];
    const linearProgress = (phase - previous.time) / (next.time - previous.time);
    const progress = linearProgress * linearProgress * (3 - 2 * linearProgress);
    return {
      color: previous.color.map((channel, channelIndex) =>
        Math.round(channel + (next.color[channelIndex] - channel) * progress)
      ),
      alpha: previous.alpha + (next.alpha - previous.alpha) * progress
    };
  }
  return DAY_COLOR_STOPS[0];
}

export function getTimeMode() {
  return timeMode;
}

export function setTimeMode(mode) {
  if (!VALID_TIME_MODES.has(mode)) {
    throw new Error(`Unknown time-of-day mode: ${mode}`);
  }

  timeMode = mode;
  try {
    localStorage.setItem(TIME_MODE_KEY, mode);
  } catch (error) {
    console.error("Unable to save time-of-day setting.", error);
  }
}

export function getTimeOfDayColor(cycleTime) {
  return timeMode === "auto" ? interpolateCycleColor(cycleTime) : FIXED_TIME_COLORS[timeMode];
}

export function getNightIntensity(cycleTime) {
  if (timeMode === "night") return 1;
  if (timeMode !== "auto") return 0;

  const phase = (cycleTime % DAY_CYCLE_DURATION) / DAY_CYCLE_DURATION;
  const smoothstep = value => {
    const progress = Math.max(0, Math.min(1, value));
    return progress * progress * (3 - 2 * progress);
  };
  return Math.min(
    smoothstep((phase - 0.64) / 0.08),
    1 - smoothstep((phase - 0.82) / 0.08)
  );
}
