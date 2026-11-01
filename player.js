import { globals, DIR, DIR_MAP } from './globals.js';
import { isHighlandPlateau, isCliff, getTileElevation, isWaterTile } from './world.js';
import { canStep, checkCoinPickup, consumeBerryAt, consumeMushroomAt, particles } from './props.js';
import { updatePlayerHUDHealth, updatePlayerHUDMana } from './ui.js';
import { playSound } from './audio.js';

export const STEP_DURATION = 0.20;
export const FOOT_OFFSET_Y = 1.0;
const PLAYER_PROGRESS_KEY = "sprout-lands.player-progress.v1";

export const player = {
  characterId: "player",
  characterName: "Lorna",
  characterWalkSheet: null,
  characterAttackSheet: null,
  tileX: 0, tileY: 0,
  targetX: 0, targetY: 0,
  currentX: 0, currentY: 0,
  moveProgress: 0,
  isMoving: false,
  dir: DIR.DOWN,
  walkFrame: 0,
  attacking: false, attackFrame: 0, attackClock: 0,
  hasDealtDamage: false,
  initialized: false,
  shieldTimer: 0,

  hp: 120,
  maxHp: 120,
  mana: 20,
  maxMana: 20,
  manaRegenPerSecond: 0.5,
  walkSpeed: 5,
  swordDamage: 30,
  fireballDamage: 30,
  xp: 0,
  maxXp: 100,
  level: 1,
  invulnerableTimer: 0
};

let playerDeathHandler = null;

function getXpForNextLevel(level) {
  return 100 * 2 ** (level - 1);
}

function savePlayerProgress() {
  try {
    localStorage.setItem(PLAYER_PROGRESS_KEY, JSON.stringify({
      level: player.level,
      xp: player.xp
    }));
  } catch (error) {
    console.error("Unable to save player progress.", error);
  }
}

function loadPlayerProgress() {
  let saved;
  try {
    saved = localStorage.getItem(PLAYER_PROGRESS_KEY);
  } catch (error) {
    console.error("Unable to load saved player progress.", error);
    return;
  }
  if (saved === null) return;

  let progress;
  try {
    progress = JSON.parse(saved);
  } catch (error) {
    console.error("Saved player progress is not valid JSON.", error);
    return;
  }

  if (!Number.isSafeInteger(progress?.level) || progress.level < 1 ||
      progress.level > 100 || !Number.isFinite(progress.xp) || progress.xp < 0) {
    console.error("Saved player progress has an invalid format.");
    return;
  }

  player.level = progress.level;
  player.maxXp = getXpForNextLevel(player.level);
  player.xp = Math.min(progress.xp, player.maxXp - 1);
  player.maxHp = 120 + (player.level - 1) * 10;
  player.hp = player.maxHp;
}

loadPlayerProgress();

const activeDirs = [];

export function setPlayerDeathHandler(handler) {
  playerDeathHandler = handler;
}

export function losePlayerXP(amount) {
  player.xp = Math.max(0, player.xp - amount);
  savePlayerProgress();
}

export function pushDir(dir) {
  const idx = activeDirs.indexOf(dir);
  if (idx !== -1) activeDirs.splice(idx, 1);
  activeDirs.push(dir);
}

export function removeDir(dir) {
  const idx = activeDirs.indexOf(dir);
  if (idx !== -1) activeDirs.splice(idx, 1);
}

export function clearInputs() {
  activeDirs.length = 0;
}

export function getActiveDir() {
  return activeDirs.length > 0 ? activeDirs[activeDirs.length - 1] : null;
}

export function getPlayerFootWorldPos() {
  let elev = 0;
  if (player.isMoving) {
    const fromElev = getTileElevation(player.tileX, player.tileY);
    const toElev = getTileElevation(player.targetX, player.targetY);
    elev = fromElev + (toElev - fromElev) * player.moveProgress;
  } else {
    elev = getTileElevation(player.tileX, player.tileY);
  }

  return {
    x: (player.currentX + 0.5) * globals.tile,
    y: (player.currentY + FOOT_OFFSET_Y - elev * 0.6) * globals.tile
  };
}

export function beginAttack() {
  if (!player.characterAttackSheet?.ready || player.attacking || player.isMoving) return false;
  playSound("sword");
  player.attacking = true;
  player.attackFrame = 0;
  player.attackClock = 0;
  player.hasDealtDamage = false;
  return true;
}

export function takePlayerDamage(amount) {
  if (player.hp <= 0 || player.invulnerableTimer > 0 || player.shieldTimer > 0) return;
  player.hp = Math.max(0, player.hp - amount);
  player.invulnerableTimer = 0.6;
  updatePlayerHUDHealth(player.hp, player.maxHp);

  particles.push({
    x: (player.currentX + 0.5) * globals.tile,
    y: (player.currentY + 0.2) * globals.tile,
    vy: -globals.tile * 1.5,
    life: 0.6,
    maxLife: 0.6,
    text: `-${amount}`,
    color: "#ff3b56",
    stroke: "#4a000d"
  });

  if (player.hp <= 0) {
    player.isMoving = false;
    player.attacking = false;
    clearInputs();
    playerDeathHandler?.();
  }
}

export function activatePlayerShield() {
  if (player.hp <= 0 || player.shieldTimer > 0 || !spendPlayerMana(1)) return false;
  player.shieldTimer = 5;
  return true;
}

export function spendPlayerMana(amount) {
  if (player.mana < amount) return false;
  player.mana -= amount;
  updatePlayerHUDMana(player.mana, player.maxMana);
  return true;
}

export function addPlayerXP(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  player.xp += amount;
  while (player.xp >= player.maxXp && player.level < 100) {
    player.xp -= player.maxXp;
    player.level++;
    player.maxXp = getXpForNextLevel(player.level);
    player.maxHp += 10;
    player.hp = player.maxHp;
    updatePlayerHUDHealth(player.hp, player.maxHp);

    particles.push({
      x: (player.currentX + 0.5) * globals.tile,
      y: (player.currentY - 0.4) * globals.tile,
      vy: -globals.tile * 1.6,
      life: 1.0,
      maxLife: 1.0,
      text: "LEVEL UP!",
      color: "#54ff91",
      stroke: "#00451a"
    });
  }
  savePlayerProgress();
}

function eatBerryAt(tx, ty) {
  if (player.hp >= player.maxHp || !consumeBerryAt(tx, ty)) return;

  const healing = Math.ceil(player.maxHp / 5);
  const healed = Math.min(healing, player.maxHp - player.hp);
  player.hp += healed;
  updatePlayerHUDHealth(player.hp, player.maxHp);
  particles.push({
    x: (tx + 0.5) * globals.tile,
    y: (ty + 0.2) * globals.tile,
    vy: -globals.tile * 1.4,
    life: 0.7,
    maxLife: 0.7,
    text: `+${healed} HP`,
    color: "#ff6d9a",
    stroke: "#4a1028"
  });
}

function eatMushroomAt(tx, ty) {
  if (player.mana >= player.maxMana || !consumeMushroomAt(tx, ty)) return;

  player.mana = Math.min(player.maxMana, player.mana + 1);
  updatePlayerHUDMana(player.mana, player.maxMana);
  particles.push({
    x: (tx + 0.5) * globals.tile,
    y: (ty + 0.2) * globals.tile,
    vy: -globals.tile * 1.4,
    life: 0.7,
    maxLife: 0.7,
    text: "+1 MANA",
    color: "#65c8ff",
    stroke: "#12385c"
  });
}

export function tryStartStep(dirName) {
  const move = DIR_MAP[dirName];
  if (!move) return;
  player.dir = move.dir;

  let nextX = player.tileX + move.x;
  let nextY = player.tileY + move.y;

  if (isHighlandPlateau(player.tileX, player.tileY) && isCliff(nextX, nextY)) {
    if (move.y === 1) nextY += 1;
    else if (move.y === -1) nextY -= 1;
    else if (move.x === 1) nextX += 1;
    else if (move.x === -1) nextX -= 1;
  }

  // canStep checks cliffs, props, AND solid enemies
  if (!canStep(player.tileX, player.tileY, nextX, nextY, true)) {
    player.isMoving = false;
    player.moveProgress = 0;
    player.walkFrame = 0;
    return;
  }

  player.targetX = nextX;
  player.targetY = nextY;
  player.isMoving = true;
}

export function updatePlayer(dt, onCoinPickupCallback, onAttackEndCallback, onAttackHitCallback) {
  player.shieldTimer = Math.max(0, player.shieldTimer - dt);

  if (player.mana < player.maxMana) {
    player.mana = Math.min(player.maxMana, player.mana + player.manaRegenPerSecond * dt);
    updatePlayerHUDMana(player.mana, player.maxMana);
  }

  if (player.invulnerableTimer > 0) {
    player.invulnerableTimer -= dt;
  }

  if (player.attacking) {
    player.attackClock += dt * 1000;

    if (!player.hasDealtDamage && player.attackFrame >= 1) {
      player.hasDealtDamage = true;
      if (onAttackHitCallback) onAttackHitCallback(player);
    }

    while (player.attackClock >= 105 && player.attacking) {
      player.attackClock -= 105;
      player.attackFrame++;
      if (player.attackFrame >= 4) {
        player.attacking = false;
        player.attackFrame = 0;
        if (onAttackEndCallback) onAttackEndCallback();
      }
    }
    return;
  }

  if (player.isMoving) {
    const inWater = isWaterTile(player.tileX, player.tileY) || isWaterTile(player.targetX, player.targetY);
    player.moveProgress += dt * player.walkSpeed * (inWater ? 0.3 : 1);
    player.walkFrame = Math.floor(player.moveProgress * 4) % 4;

    if (player.moveProgress >= 1) {
      player.tileX = player.targetX;
      player.tileY = player.targetY;
      player.currentX = player.tileX;
      player.currentY = player.tileY;

      checkCoinPickup(player.tileX, player.tileY, onCoinPickupCallback);
      eatBerryAt(player.tileX, player.tileY);
      eatMushroomAt(player.tileX, player.tileY);

      const nextDir = getActiveDir();
      if (nextDir) {
        player.moveProgress -= 1;
        tryStartStep(nextDir);
      } else {
        player.isMoving = false;
        player.moveProgress = 0;
        player.walkFrame = 0;
      }
    } else {
      player.currentX = player.tileX + (player.targetX - player.tileX) * player.moveProgress;
      player.currentY = player.tileY + (player.targetY - player.tileY) * player.moveProgress;

      if (player.moveProgress > 0.45) {
        checkCoinPickup(player.targetX, player.targetY, onCoinPickupCallback);
        eatBerryAt(player.targetX, player.targetY);
        eatMushroomAt(player.targetX, player.targetY);
      }
    }
  } else {
    const activeDir = getActiveDir();
    if (activeDir) {
      player.moveProgress = 0;
      tryStartStep(activeDir);
    }
  }
}
