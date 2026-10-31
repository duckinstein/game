import { globals, DIR, DIR_MAP, loadSheet } from './globals.js';
import { isHighlandPlateau, isCliff, getTileElevation } from './world.js';
import { canStep, checkCoinPickup, particles } from './props.js';
import { updatePlayerHUDHealth } from './ui.js';

export const walk = loadSheet("./walk_sheet.png");
export const attack = loadSheet("./attack_sheet.png");

export const STEP_DURATION = 0.20;
export const FOOT_OFFSET_Y = 1.0;

export const player = {
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

  hp: 100,
  maxHp: 100,
  xp: 0,
  maxXp: 100,
  level: 1,
  invulnerableTimer: 0
};

const activeDirs = [];

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
    y: (player.currentY + FOOT_OFFSET_Y) * globals.tile - (elev * globals.tile * 0.6)
  };
}

export function beginAttack() {
  if (!attack.ready || player.attacking || player.isMoving) return false;
  player.attacking = true;
  player.attackFrame = 0;
  player.attackClock = 0;
  player.hasDealtDamage = false;
  return true;
}

export function takePlayerDamage(amount) {
  if (player.invulnerableTimer > 0) return;
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
    particles.push({
      x: (player.currentX + 0.5) * globals.tile,
      y: (player.currentY - 0.3) * globals.tile,
      vy: -globals.tile * 1.0,
      life: 1.2,
      maxLife: 1.2,
      text: "REVIVED!",
      color: "#ffd84d",
      stroke: "#592f00"
    });
    player.hp = player.maxHp;
    updatePlayerHUDHealth(player.hp, player.maxHp);
  }
}

export function addPlayerXP(amount) {
  player.xp += amount;
  if (player.xp >= player.maxXp) {
    player.xp -= player.maxXp;
    player.level++;
    player.maxXp = Math.round(player.maxXp * 1.4);
    player.maxHp += 20;
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
    player.moveProgress += dt / STEP_DURATION;
    player.walkFrame = Math.floor(player.moveProgress * 4) % 4;

    if (player.moveProgress >= 1) {
      player.tileX = player.targetX;
      player.tileY = player.targetY;
      player.currentX = player.tileX;
      player.currentY = player.tileY;

      checkCoinPickup(player.tileX, player.tileY, onCoinPickupCallback);

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
