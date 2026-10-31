import { globals, DIR } from './globals.js';
import { getTileElevation, isCliff, isWaterTile } from './world.js';
import { canStep, consumeBerryAt, damageMapObjectAt, getMapObjectAt, particles, setEnemySolidChecker } from './props.js';
import { takePlayerDamage, addPlayerXP } from './player.js';
import { canFireballReach } from './fireballs.js';
import { drawEnemyHealthBar } from './ui.js';
import { removeLightBackground } from './image-processing.js';

function loadVillainSheet(path, cols, rows) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth % cols !== 0 || image.naturalHeight % rows !== 0) {
        reject(new Error(`Villain spritesheet has invalid dimensions: ${path}`));
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        reject(new Error(`Unable to process villain spritesheet: ${path}`));
        return;
      }

      context.drawImage(image, 0, 0);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      removeLightBackground(imageData, canvas.width, canvas.height);
      context.putImageData(imageData, 0, 0);

      resolve({
        image: canvas,
        ready: true,
        fw: image.naturalWidth / cols,
        fh: image.naturalHeight / rows,
        cols,
        rows
      });
    };
    image.onerror = () => reject(new Error(`Unable to load villain spritesheet: ${path}`));
    image.src = path;
  });
}

let VILLAINS = [];
let villainsLoadPromise = null;

export function loadVillains() {
  if (villainsLoadPromise) return villainsLoadPromise;

  villainsLoadPromise = (async () => {
    const response = await fetch(new URL("./assets/characters/villains/villains.json", import.meta.url));
    if (!response.ok) {
      throw new Error(`Unable to load villain roster: ${response.status} ${response.statusText}`);
    }

    const roster = await response.json();
    if (!Array.isArray(roster.villains) || roster.villains.length === 0) {
      throw new Error("Villain roster must contain at least one villain.");
    }

    const fileNames = new Set();
    const villains = await Promise.all(roster.villains.map(async (entry) => {
      if (typeof entry.fileName !== "string" ||
          !/^[a-zA-Z0-9_-]+$/.test(entry.fileName) ||
          fileNames.has(entry.fileName)) {
        throw new Error("Villain roster contains an invalid or duplicate fileName.");
      }
      if (typeof entry.fireballColor !== "string" || !/^#[\da-fA-F]{6}$/.test(entry.fireballColor)) {
        throw new Error(`Villain "${entry.fileName}" must have a six-digit hex fireballColor.`);
      }
      fileNames.add(entry.fileName);

      const sheetPath = suffix => new URL(
        `./assets/characters/villains/${entry.fileName}_${suffix}.png`,
        import.meta.url
      ).href;
      const [walk, attack, die] = await Promise.all([
        loadVillainSheet(sheetPath("walk"), 4, 4),
        loadVillainSheet(sheetPath("attack"), 4, 4),
        loadVillainSheet(sheetPath("die"), 4, 1)
      ]);
      return { fileName: entry.fileName, fireballColor: entry.fireballColor, walk, attack, die };
    }));

    VILLAINS = villains;
  })();

  return villainsLoadPromise;
}

const MAX_ENEMIES = 6;
const SPAWN_MARGIN_TILES = 2;
const RECYCLE_MARGIN_TILES = 10;
const MIN_SPAWN_DISTANCE = 3;
const AGGRO_RANGE = 9.0;
const RANGED_RANGE = 7.0;
const GUARD_RADIUS = 4;
const STEP_SPEED = 0.32;
const ATTACK_FRAME_TIME = 110;
const DIE_FRAME_TIME = 180;
const CORPSE_LINGER_TIME = 3.0;

export const enemies = [];
let spawnGeneration = 0;

export function isSolidEnemyAt(tx, ty) {
  return enemies.some(e => {
    if (!e.active) return false;
    if (e.state === "DEAD") return Math.round(e.currentX) === tx && Math.round(e.currentY) === ty;
    return e.state !== "DYING" &&
      ((e.tileX === tx && e.tileY === ty) || (e.isMoving && e.targetX === tx && e.targetY === ty));
  });
}
setEnemySolidChecker(isSolidEnemyAt);

const DIR_VECTORS = [
  { x: 0,  y: 1,  dir: DIR.DOWN },
  { x: -1, y: 0,  dir: DIR.LEFT },
  { x: 1,  y: 0,  dir: DIR.RIGHT },
  { x: 0,  y: -1, dir: DIR.UP }
];

function findNextPathDirection(enemy, targetX, targetY, player) {
  const startKey = `${enemy.tileX},${enemy.tileY}`;
  const targetsPlayer = targetX === player.tileX && targetY === player.tileY;
  const searchLimit = Math.max(
    10,
    Math.abs(targetX - enemy.tileX) + 1,
    Math.abs(targetY - enemy.tileY) + 1
  );
  const goalKeys = targetsPlayer
    ? new Set(DIR_VECTORS.map(vector => `${targetX + vector.x},${targetY + vector.y}`))
    : new Set([`${targetX},${targetY}`]);
  if (goalKeys.has(startKey)) return null;

  const queue = [{ x: enemy.tileX, y: enemy.tileY }];
  const previous = new Map([[startKey, null]]);
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    const currentKey = `${current.x},${current.y}`;

    for (let dir = 0; dir < DIR_VECTORS.length; dir++) {
      const vector = DIR_VECTORS[dir];
      const x = current.x + vector.x;
      const y = current.y + vector.y;
      const key = `${x},${y}`;
      if (previous.has(key)) continue;
      if (Math.abs(x - enemy.tileX) > searchLimit || Math.abs(y - enemy.tileY) > searchLimit) continue;

      const isGoal = goalKeys.has(key);
      const occupiedByEnemy = enemies.some(other => other !== enemy && other.active &&
        other.state !== "DYING" && other.state !== "DEAD" &&
        ((other.tileX === x && other.tileY === y) || (other.isMoving && other.targetX === x && other.targetY === y)));
      const occupiedByPlayer = (player.tileX === x && player.tileY === y) ||
        (player.isMoving && player.targetX === x && player.targetY === y);
      if (occupiedByEnemy || occupiedByPlayer || !canStep(current.x, current.y, x, y, false)) continue;

      previous.set(key, { key: currentKey, dir });
      if (isGoal) {
        let step = previous.get(key);
        while (step?.key !== startKey) step = previous.get(step.key);
        return step.dir;
      }
      queue.push({ x, y });
    }
  }
  return null;
}

function findBerryTarget(enemy) {
  let closest = null;
  for (let y = enemy.tileY - 6; y <= enemy.tileY + 6; y++) {
    for (let x = enemy.tileX - 6; x <= enemy.tileX + 6; x++) {
      const object = getMapObjectAt(x, y);
      if (!object || object.name !== "BUSH_BERRY") continue;
      const distance = Math.abs(x - enemy.tileX) + Math.abs(y - enemy.tileY);
      if (!closest || distance < closest.distance) closest = { x, y, distance };
    }
  }
  return closest;
}

function findRangedPositionDirection(enemy, player) {
  const candidates = [];
  for (const vector of DIR_VECTORS) {
    for (let distance = 2; distance <= RANGED_RANGE; distance++) {
      const x = player.tileX + vector.x * distance;
      const y = player.tileY + vector.y * distance;
      if (getTileElevation(x, y) !== getTileElevation(player.tileX, player.tileY) ||
          isSolidEnemyAt(x, y) ||
          !canFireballReach(x + 0.5, y + 0.5, player.currentX + 0.5, player.currentY + 0.5)) {
        continue;
      }
      candidates.push({ x, y, distance: Math.abs(x - enemy.tileX) + Math.abs(y - enemy.tileY) });
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);
  for (const candidate of candidates) {
    const direction = findNextPathDirection(enemy, candidate.x, candidate.y, player);
    if (direction !== null) return direction;
  }
  return null;
}

function startEnemyStep(enemy, direction, state) {
  if (direction === null) return false;
  const vector = DIR_VECTORS[direction];
  const targetX = enemy.tileX + vector.x;
  const targetY = enemy.tileY + vector.y;
  if (isSolidEnemyAt(targetX, targetY) || !canStep(enemy.tileX, enemy.tileY, targetX, targetY, false)) return false;
  enemy.state = state;
  enemy.dir = vector.dir;
  enemy.targetX = targetX;
  enemy.targetY = targetY;
  enemy.isMoving = true;
  enemy.moveProgress = 0;
  return true;
}

function patrolEnemy(enemy, player, dt) {
  const homeDistance = Math.abs(enemy.tileX - enemy.guardX) + Math.abs(enemy.tileY - enemy.guardY);
  if (homeDistance > GUARD_RADIUS) {
    const direction = findNextPathDirection(enemy, enemy.guardX, enemy.guardY, player);
    if (startEnemyStep(enemy, direction, "PATROL")) return;
  }

  enemy.patrolTimer -= dt;
  if (enemy.patrolTimer > 0) return;
  enemy.patrolTimer = 1.2 + Math.random() * 2.4;

  const options = DIR_VECTORS
    .map((vector, dir) => ({ vector, dir, x: enemy.tileX + vector.x, y: enemy.tileY + vector.y }))
    .filter(option =>
      Math.abs(option.x - enemy.guardX) + Math.abs(option.y - enemy.guardY) <= GUARD_RADIUS &&
      !isSolidEnemyAt(option.x, option.y) &&
      canStep(enemy.tileX, enemy.tileY, option.x, option.y, false)
    );
  if (options.length === 0 || Math.random() < 0.35) {
    enemy.state = "IDLE";
    return;
  }

  const option = options[Math.floor(Math.random() * options.length)];
  startEnemyStep(enemy, option.dir, "PATROL");
}

function tryEatEnemyBerry(enemy) {
  if (enemy.hp >= enemy.maxHp) return false;
  if (!consumeBerryAt(enemy.tileX, enemy.tileY)) return false;
  const healing = Math.min(Math.ceil(enemy.maxHp / 5), enemy.maxHp - enemy.hp);
  if (healing <= 0) return false;
  enemy.hp += healing;
  particles.push({
    x: (enemy.currentX + 0.5) * globals.tile,
    y: (enemy.currentY + 0.2) * globals.tile,
    vy: -globals.tile * 1.4,
    life: 0.7,
    maxLife: 0.7,
    text: `+${healing} HP`,
    color: "#ff6d9a",
    stroke: "#4a1028"
  });
  return true;
}

export function createEnemy(tx, ty, variant = 0) {
  return {
    variant,
    fireballColor: VILLAINS[variant]?.fireballColor,
    tileX: tx, tileY: ty,
    targetX: tx, targetY: ty,
    currentX: tx, currentY: ty,
    moveProgress: 0,
    isMoving: false,
    dir: DIR.DOWN,
    walkFrame: 0,

    hp: 100,
    maxHp: 100,
    damage: 10,
    hasDealtDamage: false,

    state: "IDLE",
    attackFrame: 0,
    attackClock: 0,
    attackCooldown: 0.8,
    hitFlashTimer: 0,

    dieFrame: 0,
    dieClock: 0,
    corpseTimer: CORPSE_LINGER_TIME,
    guardX: tx,
    guardY: ty,
    patrolTimer: 0.8 + Math.random() * 2,
    entering: false,
    active: true
  };
}

export function initEnemies(player) {
  enemies.length = 0;
  spawnGeneration++;

  const variants = Array.from(
    { length: MAX_ENEMIES },
    (_, index) => index % VILLAINS.length
  );
  for (let i = variants.length - 1; i > 0; i--) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    [variants[i], variants[swapIndex]] = [variants[swapIndex], variants[i]];
  }

  for (const variant of variants) {
    if (!spawnEnemyNearPlayer(player, variant)) {
      console.warn(`Unable to find a valid nearby spawn tile for villain "${VILLAINS[variant].fileName}".`);
    }
  }
}

function getSpawnBounds() {
  const tileSize = globals.tile || 48;
  const cameraX = globals.cameraX;
  const cameraY = globals.cameraY;
  return {
    minX: Math.floor(cameraX / tileSize) - SPAWN_MARGIN_TILES,
    minY: Math.floor(cameraY / tileSize) - SPAWN_MARGIN_TILES,
    maxX: Math.ceil((cameraX + globals.viewW) / tileSize) + SPAWN_MARGIN_TILES,
    maxY: Math.ceil((cameraY + globals.viewH) / tileSize) + SPAWN_MARGIN_TILES,
    cameraX,
    cameraY,
    tileSize
  };
}

function findNearbySpawnPosition(player, excludedEnemy = null) {
  const { minX, minY, maxX, maxY, cameraX, cameraY, tileSize } = getSpawnBounds();
  const candidates = [];
  for (let ty = minY; ty < maxY; ty++) {
    for (let tx = minX; tx < maxX; tx++) {
      if (Math.hypot(tx - player.tileX, ty - player.tileY) < MIN_SPAWN_DISTANCE) continue;
      const screenX = (tx + 0.5) * tileSize - cameraX;
      const screenY = (ty + 0.5) * tileSize - cameraY;
      const outsideViewport = screenX < -tileSize || screenX > globals.viewW + tileSize ||
        screenY < -tileSize || screenY > globals.viewH + tileSize;
      if (!outsideViewport) continue;

      const occupied = enemies.some(enemy =>
        enemy !== excludedEnemy && enemy.active && enemy.state !== "DYING" &&
        ((enemy.tileX === tx && enemy.tileY === ty) ||
          (enemy.state !== "DEAD" && enemy.isMoving &&
            enemy.targetX === tx && enemy.targetY === ty))
      );
      const occupiedByPlayer = (player.tileX === tx && player.tileY === ty) ||
        (player.isMoving && player.targetX === tx && player.targetY === ty);
      if (!occupied && !occupiedByPlayer && canStep(tx, ty, tx, ty)) {
        candidates.push({ x: tx, y: ty });
      }
    }
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function spawnEnemyNearPlayer(player, variant) {
  const position = findNearbySpawnPosition(player);
  if (!position) return false;
  const enemy = createEnemy(position.x, position.y, variant);
  enemy.entering = true;
  enemies.push(enemy);
  return true;
}

function keepEnemiesNearPlayer(player) {
  const tileSize = globals.tile || 48;
  for (const enemy of enemies) {
    if (!enemy.active || enemy.state === "DYING" || enemy.state === "DEAD") continue;
    const screenX = (enemy.currentX + 0.5) * tileSize - globals.cameraX;
    const screenY = (enemy.currentY + 0.5) * tileSize - globals.cameraY;
    if (screenX >= -RECYCLE_MARGIN_TILES * tileSize &&
        screenX <= globals.viewW + RECYCLE_MARGIN_TILES * tileSize &&
        screenY >= -RECYCLE_MARGIN_TILES * tileSize &&
        screenY <= globals.viewH + RECYCLE_MARGIN_TILES * tileSize) {
      continue;
    }

    const position = findNearbySpawnPosition(player, enemy);
    if (!position) continue;
    const replacement = createEnemy(position.x, position.y, enemy.variant);
    replacement.hp = enemy.hp;
    replacement.entering = true;
    Object.assign(enemy, replacement);
  }
}

function isEnemyOnScreen(enemy) {
  const tileSize = globals.tile || 48;
  const screenX = (enemy.currentX + 0.5) * tileSize - globals.cameraX;
  const screenY = (enemy.currentY + 0.5) * tileSize - globals.cameraY;
  return screenX >= 0 && screenX < globals.viewW && screenY >= 0 && screenY < globals.viewH;
}

export function updateEnemies(dt, player, tryRangedAttack) {
  keepEnemiesNearPlayer(player);

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.hitFlashTimer = Math.max(0, e.hitFlashTimer - dt);

    if (e.state === "DEAD") {
      e.corpseTimer -= dt;
      if (e.corpseTimer <= 0) {
        enemies.splice(i, 1);
        const generation = spawnGeneration;
        setTimeout(() => {
          if (generation !== spawnGeneration) return;
          if (!spawnEnemyNearPlayer(player, e.variant)) {
            console.warn(`Unable to respawn villain "${VILLAINS[e.variant].fileName}" near the player.`);
          }
        }, 3000);
      }
      continue;
    }

    if (e.state === "DYING") {
      e.dieClock += dt * 1000;
      if (e.dieClock >= DIE_FRAME_TIME) {
        e.dieClock -= DIE_FRAME_TIME;
        e.dieFrame++;
        if (e.dieFrame >= 3) {
          e.dieFrame = 3;
          e.state = "DEAD";
          e.tileX = Math.round(e.currentX);
          e.tileY = Math.round(e.currentY);
          e.corpseTimer = CORPSE_LINGER_TIME;
        }
      }
      continue;
    }

    if (e.attackCooldown > 0) {
      e.attackCooldown -= dt;
    }

    if (e.state === "ATTACK") {
      e.attackClock += dt * 1000;

      if (!e.hasDealtDamage && e.attackFrame >= 1) {
        const dx = Math.abs(player.tileX - e.tileX);
        const dy = Math.abs(player.tileY - e.tileY);
        const cliffBetween = isCliff(player.tileX, player.tileY);
        if (dx + dy === 1 && !cliffBetween &&
            getTileElevation(e.tileX, e.tileY) === getTileElevation(player.tileX, player.tileY)) {
          e.hasDealtDamage = true;
          takePlayerDamage(e.damage);
        }
      }

      if (e.attackClock >= ATTACK_FRAME_TIME) {
        e.attackClock -= ATTACK_FRAME_TIME;
        e.attackFrame++;
        if (e.attackFrame >= 4) {
          e.state = "IDLE";
          e.attackFrame = 0;
          e.hasDealtDamage = false;
          e.attackCooldown = 1.2;
        }
      }
      continue;
    }

    if (e.isMoving) {
      const inWater = isWaterTile(e.tileX, e.tileY) || isWaterTile(e.targetX, e.targetY);
      e.moveProgress += dt / STEP_SPEED * (inWater ? 0.3 : 1);
      e.walkFrame = Math.floor(e.moveProgress * 4) % 4;

      if (e.moveProgress >= 1) {
        e.tileX = e.targetX;
        e.tileY = e.targetY;
        e.currentX = e.tileX;
        e.currentY = e.tileY;
        e.isMoving = false;
        e.moveProgress = 0;
        e.walkFrame = 0;
        tryEatEnemyBerry(e);
        if (e.state === "PATROL") e.state = "IDLE";
      } else {
        e.currentX = e.tileX + (e.targetX - e.tileX) * e.moveProgress;
        e.currentY = e.tileY + (e.targetY - e.tileY) * e.moveProgress;
      }
      continue;
    }

    if (e.entering) {
      if (isEnemyOnScreen(e)) {
        e.entering = false;
      } else {
        const direction = findNextPathDirection(e, player.tileX, player.tileY, player);
        if (startEnemyStep(e, direction, "CHASE")) continue;
      }
    }

    const dx = player.tileX - e.tileX;
    const dy = player.tileY - e.tileY;
    const dist = Math.hypot(dx, dy);

    const sameElevation = getTileElevation(e.tileX, e.tileY) === getTileElevation(player.tileX, player.tileY) &&
      !isCliff(player.tileX, player.tileY);
    if (Math.abs(dx) + Math.abs(dy) === 1 && e.attackCooldown <= 0 && sameElevation) {
      if (Math.abs(dx) > Math.abs(dy)) {
        e.dir = dx > 0 ? DIR.RIGHT : DIR.LEFT;
      } else {
        e.dir = dy > 0 ? DIR.DOWN : DIR.UP;
      }
      e.state = "ATTACK";
      e.attackFrame = 0;
      e.attackClock = 0;
      e.hasDealtDamage = false;
      continue;
    }

    if (tryRangedAttack && e.attackCooldown <= 0 && dist > 1.5 && dist <= RANGED_RANGE &&
        (dx === 0 || dy === 0)) {
      e.dir = dx > 0 ? DIR.RIGHT : dx < 0 ? DIR.LEFT : dy > 0 ? DIR.DOWN : DIR.UP;
      if (tryRangedAttack(e)) {
        e.state = "ATTACK";
        e.attackFrame = 0;
        e.attackClock = 0;
        e.hasDealtDamage = true;
        e.attackCooldown = 1.5;
        continue;
      }
    }

    if (e.hp <= e.maxHp * 0.6) {
      if (tryEatEnemyBerry(e)) {
        e.state = "HEAL";
        e.attackCooldown = Math.max(e.attackCooldown, 0.4);
        continue;
      }
      const berry = findBerryTarget(e);
      if (berry) {
        const direction = findNextPathDirection(e, berry.x, berry.y, player);
        if (direction !== null) {
          e.state = "HEAL";
          e.dir = direction;
          e.targetX = e.tileX + DIR_VECTORS[direction].x;
          e.targetY = e.tileY + DIR_VECTORS[direction].y;
          e.isMoving = true;
          e.moveProgress = 0;
          continue;
        }
      }
    }

    if (e.hp <= e.maxHp * 0.25 && dist <= AGGRO_RANGE) {
      let escapeDirection = null;
      let bestDistance = dist;
      for (let dir = 0; dir < DIR_VECTORS.length; dir++) {
        const vector = DIR_VECTORS[dir];
        const x = e.tileX + vector.x;
        const y = e.tileY + vector.y;
        if (!canStep(e.tileX, e.tileY, x, y, false) || isSolidEnemyAt(x, y)) continue;
        const distance = Math.hypot(player.tileX - x, player.tileY - y);
        if (distance > bestDistance) {
          bestDistance = distance;
          escapeDirection = dir;
        }
      }
      if (escapeDirection !== null) {
        e.state = "FLEE";
        e.dir = escapeDirection;
        e.targetX = e.tileX + DIR_VECTORS[escapeDirection].x;
        e.targetY = e.tileY + DIR_VECTORS[escapeDirection].y;
        e.isMoving = true;
        e.moveProgress = 0;
        continue;
      }
    }

    if (dist <= AGGRO_RANGE && !e.isMoving) {
      const meleeDistance = Math.abs(dx) + Math.abs(dy);
      const inMeleeRange = meleeDistance === 1 && sameElevation;
      if (!inMeleeRange) {
        const meleeDirection = findNextPathDirection(e, player.tileX, player.tileY, player);
        if (meleeDirection !== null && startEnemyStep(e, meleeDirection, "CHASE")) continue;

        if (tryRangedAttack && dist > 1.5) {
          const rangedDirection = findRangedPositionDirection(e, player);
          if (rangedDirection !== null && startEnemyStep(e, rangedDirection, "SUPPORT")) continue;
        }
      }

      e.state = "IDLE";
    } else {
      patrolEnemy(e, player, dt);
    }
  }
}

export function damageEnemy(enemy, damage) {
  if (enemy.state === "DYING" || enemy.state === "DEAD") return;

  enemy.hp -= damage;
  enemy.hitFlashTimer = 0.2;
  particles.push({
    x: (enemy.currentX + 0.5) * globals.tile,
    y: (enemy.currentY + 0.2) * globals.tile,
    vy: -globals.tile * 1.6,
    life: 0.5,
    maxLife: 0.5,
    text: `-${damage}`,
    color: "#ffe03d",
    stroke: "#593300"
  });

  if (enemy.hp <= 0) {
    enemy.hp = 0;
    enemy.state = "DYING";
    enemy.dieFrame = 0;
    enemy.dieClock = 0;
    enemy.isMoving = false;

    addPlayerXP(35);

    particles.push({
      x: (enemy.currentX + 0.5) * globals.tile,
      y: (enemy.currentY - 0.2) * globals.tile,
      vy: -globals.tile * 1.8,
      life: 0.8,
      maxLife: 0.8,
      text: "+35 XP",
      color: "#6effa6",
      stroke: "#00471c"
    });
  }
}

export function checkPlayerAttackHit(player) {
  const dirVec = DIR_VECTORS[player.dir];
  if (!dirVec) return;
  const hitTileX = player.tileX + dirVec.x;
  const hitTileY = player.tileY + dirVec.y;
  const attackElevation = getTileElevation(player.tileX, player.tileY);
  if (getTileElevation(hitTileX, hitTileY) !== attackElevation || isCliff(hitTileX, hitTileY)) {
    return;
  }
  if (damageMapObjectAt(hitTileX + 0.5, hitTileY + 0.5)) return;

  for (const enemy of enemies) {
    if (enemy.state === "DYING" || enemy.state === "DEAD") continue;

    const hitByTile = (enemy.tileX === hitTileX && enemy.tileY === hitTileY) || 
                      (enemy.targetX === hitTileX && enemy.targetY === hitTileY);
    const hitByProximity = Math.hypot(enemy.currentX - (player.currentX + dirVec.x * 0.8), 
                                      enemy.currentY - (player.currentY + dirVec.y * 0.8)) < 1.0;

    if (hitByTile || hitByProximity) {
      damageEnemy(enemy, 20);
      break;
    }
  }
}

export function drawEnemy(ctx, enemy) {
  const villain = VILLAINS[enemy.variant];
  let sheet = villain.walk;
  let frameX = 0;
  let frameY = 0;
  let flip = false;

  let elev = 0;
  if (enemy.isMoving) {
    const fromElev = getTileElevation(enemy.tileX, enemy.tileY);
    const toElev = getTileElevation(enemy.targetX, enemy.targetY);
    elev = fromElev + (toElev - fromElev) * enemy.moveProgress;
  } else {
    elev = getTileElevation(enemy.tileX, enemy.tileY);
  }

  const screenX = (enemy.currentX + 0.5) * globals.tile - globals.cameraX;
  const screenY = (enemy.currentY + 1.0 - elev * 0.6) * globals.tile - globals.cameraY;

  if (enemy.state === "DYING" || enemy.state === "DEAD") {
    sheet = villain.die;
    frameX = enemy.dieFrame;
    frameY = 0;
    flip = false;
  } else if (enemy.state === "ATTACK") {
    sheet = villain.attack;
    frameX = enemy.attackFrame;
    if (enemy.dir === DIR.DOWN) { frameY = 0; }
    else if (enemy.dir === DIR.LEFT) { frameY = 1; }
    else if (enemy.dir === DIR.RIGHT) { frameY = 1; flip = true; }
    else if (enemy.dir === DIR.UP) { frameY = 3; }
  } else {
    sheet = villain.walk;
    frameX = enemy.isMoving ? enemy.walkFrame : 0;
    if (enemy.dir === DIR.DOWN) { frameY = 0; }
    else if (enemy.dir === DIR.LEFT) { frameY = 1; }
    else if (enemy.dir === DIR.RIGHT) { frameY = 1; flip = true; }
    else if (enemy.dir === DIR.UP) { frameY = 3; }
  }

  const hUnits = 1.6;
  const fw = sheet && sheet.fw > 0 ? sheet.fw : 32;
  const fh = sheet && sheet.fh > 0 ? sheet.fh : 32;
  const wUnits = hUnits * (fw / fh);
  const destW = globals.tile * (isFinite(wUnits) ? wUnits : 1.6);
  const isSubmerged = isWaterTile(Math.round(enemy.currentX), Math.round(enemy.currentY));
  const destH = globals.tile * hUnits * (isSubmerged ? 0.6 : 1);

  ctx.imageSmoothingEnabled = true;

  if (sheet && sheet.ready && sheet.image) {
    ctx.save();
    if (enemy.hitFlashTimer > 0) {
      ctx.filter = "brightness(2.2) sepia(1) saturate(6) hue-rotate(315deg)";
    }
    if (flip) {
      ctx.translate(Math.round(screenX), Math.round(screenY));
      ctx.scale(-1, 1);
      ctx.drawImage(
        sheet.image,
        frameX * sheet.fw, frameY * sheet.fh, sheet.fw, sheet.fh * (isSubmerged ? 0.6 : 1),
        Math.round(-destW * 0.5), Math.round(-destH), destW, destH
      );
    } else {
      ctx.drawImage(
        sheet.image,
        frameX * sheet.fw, frameY * sheet.fh, sheet.fw, sheet.fh * (isSubmerged ? 0.6 : 1),
        Math.round(screenX - destW * 0.5), Math.round(screenY - destH), destW, destH
      );
    }
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = enemy.hitFlashTimer > 0 ? "#ff3b56" :
      (enemy.state === "ATTACK" ? "#ff2e4c" : (enemy.state === "DEAD" ? "#555" : "#6a2d9c"));
    ctx.beginPath();
    ctx.arc(Math.round(screenX), Math.round(screenY - destH * 0.45), Math.round(destW * 0.35), 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `bold ${Math.round(globals.tile * 0.38)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(enemy.state === "DEAD" ? "⚰️" : "😈", Math.round(screenX), Math.round(screenY - destH * 0.45));
    ctx.restore();
  }

  // --- Overhead Health Bar from enemy_health.png ---
  if (enemy.state !== "DYING" && enemy.state !== "DEAD") {
    drawEnemyHealthBar(ctx, screenX, screenY - destH - 12, enemy.hp / enemy.maxHp);
  }
}