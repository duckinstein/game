import { player, clearInputs } from "./player.js";
import { defeatedVillainCount, getCharacterRoster, loadVillains, setPlayerCharacter } from "./enemies.js";
import { propState, spendCoins } from "./props.js";
import { setAudioVolume } from "./audio.js";
import { getTimeMode, setTimeMode } from "./time-of-day.js";

const SHOP_SAVE_KEY = "sprout-lands.shop-progress.v1";
const MAX_UPGRADE_LEVEL = 5;
const UPGRADE_DEFINITIONS = {
  fireball: { base: 30, step: 10, label: "Fireball damage", unit: "damage" },
  sword: { base: 30, step: 10, label: "Sword damage", unit: "damage" }
};

const shopProgress = {
  unlocked: new Set(["player"]),
  selected: "player",
  skillLevels: { player: { fireball: 0, sword: 0 } }
};

const shopDialog = document.getElementById("shop-panel");
const previewCanvas = document.getElementById("shop-preview");
const previewContext = previewCanvas.getContext("2d");
let roster = [];
let selectedIndex = 0;
let previewFrame = 0;
let previewStartTime = 0;

function loadShopProgress() {
  let saved;
  try {
    saved = localStorage.getItem(SHOP_SAVE_KEY);
  } catch (error) {
    console.error("Unable to load saved shop progress.", error);
    return;
  }
  if (saved === null) return;

  let progress;
  try {
    progress = JSON.parse(saved);
  } catch (error) {
    console.error("Saved shop progress is not valid JSON.", error);
    return;
  }

  const validUpgradeLevel = level => Number.isInteger(level) && level >= 0 && level <= MAX_UPGRADE_LEVEL;
  const validSkillLevels = levels => levels && typeof levels === "object" &&
    validUpgradeLevel(levels.fireball) && validUpgradeLevel(levels.sword);
  let skillLevels = progress?.skillLevels;
  if (skillLevels === undefined && validSkillLevels(progress?.upgrades)) {
    skillLevels = { player: { fireball: progress.upgrades.fireball, sword: progress.upgrades.sword } };
  }
  if (!Array.isArray(progress?.unlocked) ||
      !progress.unlocked.every(id => typeof id === "string" && /^(player|villain:[a-zA-Z0-9_-]+)$/.test(id)) ||
      typeof progress.selected !== "string" ||
      !skillLevels || typeof skillLevels !== "object" || Array.isArray(skillLevels) ||
      !Object.entries(skillLevels).every(([id, levels]) =>
        /^(player|villain:[a-zA-Z0-9_-]+)$/.test(id) && validSkillLevels(levels))) {
    console.error("Saved shop progress has an invalid format.");
    return;
  }

  shopProgress.unlocked = new Set(["player", ...progress.unlocked]);
  shopProgress.selected = progress.selected;
  shopProgress.skillLevels = {
    player: { fireball: 0, sword: 0 },
    ...Object.fromEntries(Object.entries(skillLevels).map(([id, levels]) => [
      id,
      { fireball: levels.fireball, sword: levels.sword }
    ]))
  };
}

function getSkillLevels(characterId = shopProgress.selected) {
  if (!shopProgress.skillLevels[characterId]) {
    shopProgress.skillLevels[characterId] = { fireball: 0, sword: 0 };
  }
  return shopProgress.skillLevels[characterId];
}

function saveShopProgress() {
  try {
    localStorage.setItem(SHOP_SAVE_KEY, JSON.stringify({
      unlocked: [...shopProgress.unlocked],
      selected: shopProgress.selected,
      skillLevels: shopProgress.skillLevels
    }));
  } catch (error) {
    console.error("Unable to save shop progress.", error);
  }
}

function applyUpgrades() {
  const skillLevels = getSkillLevels(shopProgress.selected);
  player.fireballDamage = UPGRADE_DEFINITIONS.fireball.base +
    UPGRADE_DEFINITIONS.fireball.step * skillLevels.fireball;
  player.swordDamage = UPGRADE_DEFINITIONS.sword.base +
    UPGRADE_DEFINITIONS.sword.step * skillLevels.sword;
}

function buildRoster() {
  roster = getCharacterRoster().map(character => ({
    id: character.fileName === "player" ? "player" : `villain:${character.fileName}`,
    fileName: character.fileName,
    name: character.name,
    kind: "Character",
    walk: character.walk,
    attack: character.attack
  }));
  const validIds = new Set(roster.map(character => character.id));
  shopProgress.unlocked = validIds;

  if (!shopProgress.unlocked.has(shopProgress.selected) ||
      !roster.some(character => character.id === shopProgress.selected)) {
    shopProgress.selected = "player";
  }
  selectCharacter(shopProgress.selected);
}

function updateAccountStats() {
  const experienceLabel = document.getElementById("stat-xp");
  const experienceFill = document.getElementById("stat-xp-fill");
  const experienceTrack = experienceFill.parentElement;
  const experienceRatio = player.maxXp > 0 ? Math.min(player.xp / player.maxXp, 1) : 0;

  document.getElementById("stat-level").textContent = player.level;
  document.getElementById("stat-villains").textContent = defeatedVillainCount;
  document.getElementById("stat-characters").textContent = shopProgress.unlocked.size;
  document.getElementById("stat-skills").textContent = "2";
  experienceLabel.textContent = `${Math.floor(player.xp)} / ${player.maxXp} XP`;
  experienceFill.style.width = `${experienceRatio * 100}%`;
  experienceTrack.setAttribute("aria-valuemax", player.maxXp);
  experienceTrack.setAttribute("aria-valuenow", Math.floor(player.xp));
}

function updateCoinDisplay() {
  const counter = document.getElementById("coin-count");
  if (counter) counter.textContent = propState.coinsCollectedCount;
}

function updateUpgradeCards() {
  const character = currentCharacter();
  const skillLevels = getSkillLevels(character?.id ?? shopProgress.selected);
  for (const [key, definition] of Object.entries(UPGRADE_DEFINITIONS)) {
    const level = skillLevels[key];
    const value = definition.base + definition.step * level;
    const card = document.querySelector(`[data-upgrade="${key}"]`);
    card.querySelector(".upgrade-value").textContent =
      `${Number.isInteger(value) ? value : value.toFixed(1)} ${definition.unit}`;
    card.querySelector(".upgrade-progress-fill").style.width =
      `${(level / MAX_UPGRADE_LEVEL) * 100}%`;
    const progress = card.querySelector(".upgrade-progress");
    progress.setAttribute("aria-valuenow", level);
    card.querySelector(".upgrade-level").textContent = `Level ${level}/${MAX_UPGRADE_LEVEL}`;
    const button = card.querySelector("button");
    const maxed = level >= MAX_UPGRADE_LEVEL;
    const cost = 20 + level * 10;
    button.disabled = maxed || !character;
    button.textContent = maxed ? "Max level" : `Upgrade · ${cost} coins`;
  }
}

function currentCharacter() {
  return roster[selectedIndex];
}

function selectCharacter(id) {
  const character = roster.find(entry => entry.id === id);
  if (!character) return;

  shopProgress.selected = id;
  setPlayerCharacter(character.fileName);
  getSkillLevels(character.id);
  applyUpgrades();
  saveShopProgress();
  updateAccountStats();
}

function drawPreview(timestamp) {
  if (!shopDialog.open) return;
  const character = currentCharacter();
  const elapsed = timestamp - previewStartTime;
  const attacking = elapsed % 4200 >= 2600;
  const sheet = attacking ? character.attack : character.walk;
  const animationElapsed = attacking ? (elapsed - 2600) % 1200 : elapsed % 2600;
  const frame = attacking
    ? Math.min(3, Math.floor(animationElapsed / 150))
    : Math.floor(animationElapsed / 180) % 4;

  previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewContext.fillStyle = "rgba(54, 25, 10, .22)";
  previewContext.beginPath();
  previewContext.ellipse(previewCanvas.width / 2, previewCanvas.height * .87, 43, 9, 0, 0, Math.PI * 2);
  previewContext.fill();

  if (sheet?.ready && sheet.image) {
    previewContext.imageSmoothingEnabled = false;
    const frameX = frame % 4;
    const frameY = 0;
    const scale = Math.min(136 / sheet.fw, 136 / sheet.fh);
    const width = sheet.fw * scale;
    const height = sheet.fh * scale;
    previewContext.drawImage(
      sheet.image,
      frameX * sheet.fw, frameY * sheet.fh, sheet.fw, sheet.fh,
      (previewCanvas.width - width) / 2,
      previewCanvas.height * .86 - height,
      width,
      height
    );
  }

  document.getElementById("preview-animation-label").textContent =
    attacking ? "Attack animation" : "Walk animation";
  previewFrame = requestAnimationFrame(drawPreview);
}

function refreshShop() {
  const character = currentCharacter();
  const selected = shopProgress.selected === character.id;
  const selector = document.getElementById("character-select");
  document.getElementById("character-name").textContent = character.name;
  document.getElementById("character-kind").textContent = character.kind;

  selector.disabled = selected;
  if (selected) {
    selector.textContent = "Selected";
  } else {
    selector.textContent = "Select character";
  }

  document.getElementById("character-position").textContent =
    `${selectedIndex + 1} / ${roster.length}`;
  document.getElementById("shop-message").textContent = "Choose a character or improve your stats.";
  document.getElementById("character-previous").disabled = roster.length < 2;
  document.getElementById("character-next").disabled = roster.length < 2;
  updateUpgradeCards();
  updateAccountStats();
  previewStartTime = performance.now();
  cancelAnimationFrame(previewFrame);
  previewFrame = requestAnimationFrame(drawPreview);
}

function moveSelection(direction) {
  if (roster.length < 2) return;
  selectedIndex = (selectedIndex + direction + roster.length) % roster.length;
  refreshShop();
}

function upgradeStat(key) {
  const character = currentCharacter();
  if (!character) {
    document.getElementById("shop-message").textContent = "Character skills are still loading.";
    return;
  }
  const skillLevels = getSkillLevels(character.id);
  const level = skillLevels[key];
  if (level >= MAX_UPGRADE_LEVEL) return;
  const cost = 20 + level * 10;
  if (!spendCoins(cost)) {
    document.getElementById("shop-message").textContent =
      `You need ${cost - propState.coinsCollectedCount} more coins for this upgrade.`;
    return;
  }

  skillLevels[key]++;
  applyUpgrades();
  saveShopProgress();
  updateCoinDisplay();
  refreshShop();
}

function selectShopCharacter() {
  const character = currentCharacter();
  if (!character) {
    document.getElementById("shop-message").textContent = "Characters are still loading.";
    return;
  }
  selectCharacter(character.id);
  refreshShop();
}

function initializeShop() {
  document.getElementById("character-previous").addEventListener("click", () => moveSelection(-1));
  document.getElementById("character-next").addEventListener("click", () => moveSelection(1));
  document.getElementById("character-select").addEventListener("click", selectShopCharacter);
  for (const key of Object.keys(UPGRADE_DEFINITIONS)) {
    document.querySelector(`[data-upgrade="${key}"] button`)
      .addEventListener("click", () => upgradeStat(key));
  }

  let swipeStart = null;
  previewCanvas.addEventListener("pointerdown", event => {
    swipeStart = event.clientX;
    previewCanvas.setPointerCapture(event.pointerId);
  });
  previewCanvas.addEventListener("pointerup", event => {
    if (swipeStart === null) return;
    const delta = event.clientX - swipeStart;
    swipeStart = null;
    if (Math.abs(delta) > 35) moveSelection(delta < 0 ? 1 : -1);
  });
  previewCanvas.addEventListener("pointercancel", () => { swipeStart = null; });

  shopDialog.addEventListener("keydown", event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    moveSelection(event.key === "ArrowRight" ? 1 : -1);
  });
  shopDialog.addEventListener("close", () => {
    cancelAnimationFrame(previewFrame);
    clearInputs();
    document.querySelectorAll("[data-dir]").forEach(button => button.classList.remove("active"));
  });
}

function initializeVolumes() {
  for (const [inputId, labelId, storageKey] of [
    ["music-volume", "music-volume-value", "game.musicVolume"],
    ["sfx-volume", "sfx-volume-value", "game.sfxVolume"]
  ]) {
    const input = document.getElementById(inputId);
    const label = document.getElementById(labelId);
    let savedValue = null;
    try {
      savedValue = localStorage.getItem(storageKey);
    } catch (error) {
      console.error(`Unable to load saved ${inputId} setting.`, error);
    }
    if (savedValue !== null) input.value = savedValue;

    const updateVolume = () => {
      label.textContent = `${input.value}%`;
      setAudioVolume(inputId === "music-volume" ? "music" : "effects", input.value);
      try {
        localStorage.setItem(storageKey, input.value);
      } catch (error) {
        console.error(`Unable to save ${inputId} setting.`, error);
      }
    };

    input.addEventListener("input", updateVolume);
    updateVolume();
  }
}

function initializeTimeOfDay() {
  const select = document.getElementById("time-of-day");
  select.value = getTimeMode();
  select.addEventListener("change", () => setTimeMode(select.value));
}

function initializeDialog(openButtonId, dialogId, onOpen) {
  const dialog = document.getElementById(dialogId);
  document.getElementById(openButtonId).addEventListener("click", () => {
    onOpen?.();
    dialog.showModal();
  });
  dialog.querySelector(".panel-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    clearInputs();
    document.querySelectorAll("[data-dir]").forEach(button => button.classList.remove("active"));
  });
}

function initializePauseMenu() {
  const pauseDialog = document.getElementById("pause-panel");
  initializeDialog("pause-open", "pause-panel");
  document.getElementById("pause-resume").addEventListener("click", () => pauseDialog.close());
  document.getElementById("pause-settings").addEventListener("click", () => {
    pauseDialog.close();
    updateAccountStats();
    document.getElementById("settings-panel").showModal();
  });
  document.getElementById("pause-shop").addEventListener("click", () => {
    pauseDialog.close();
    openShop();
    shopDialog.showModal();
  });
}

function openShop() {
  document.getElementById("shop-message").textContent = "Loading characters...";
  loadVillains().then(() => {
    buildRoster();
    selectedIndex = Math.max(0, roster.findIndex(character => character.id === shopProgress.selected));
    refreshShop();
  }).catch(error => {
    document.getElementById("shop-message").textContent = "Unable to load the character roster.";
    console.error("Unable to load the shop character roster.", error);
  });
}

export function initializePanels() {
  loadShopProgress();
  applyUpgrades();
  updateCoinDisplay();
  initializeShop();
  initializeVolumes();
  initializeTimeOfDay();
  initializeDialog("shop-open", "shop-panel", openShop);
  initializePauseMenu();
  initializeDialog("settings-open", "settings-panel", updateAccountStats);
}

export function initializeCharacterRoster() {
  buildRoster();
}
