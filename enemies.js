import { globals, DIR, tryLoadImage } from './globals.js';
import { getTileElevation, isCliff, isWaterTile } from './world.js';
import { canStep, consumeBerryAt, damageMapObjectAt, getMapObjectAt, particles, setEnemySolidChecker } from './props.js';
import { takePlayerDamage, addPlayerXP } from './player.js';
import { drawEnemyHealthBar } from './ui.js';

function loadVillainSheet(paths, cols = 4, rows = 4) {
  const sheet = { image: null, ready: false, fw: 32, fh: 32, cols, rows };
  tryLoadImage(paths, (img) => {
    sheet.image = img;
    sheet.fw = img.naturalWidth / cols;
    sheet.fh = img.naturalHeight / rows;
    sheet.ready = true;
  });
  return sheet;
}

export const villainWalk = loadVillainSheet(["./villain/1_walk.png", "./1_walk.png"], 4, 4);
export const villainAttack = loadVillainSheet(["./villain/1_attack.png", "./1_attack.png"], 4, 4);
export const villainDie = loadVillainSheet(["./villain/1_die.png", "./1_die.png"], 4, 1);

const MAX_ENEMIES = 5;
const AGGRO_RANGE = 6.0;
const STEP_SPEED = 0.32;
const ATTACK_FRAME_TIME = 110;
const DIE_FRAME_TIME = 180;
const CORPSE_LINGER_TIME = 3.0;

export const enemies = [];

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
      if (Math.abs(x - enemy.tileX) > 10 || Math.abs(y - enemy.tileY) > 10) continue;

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

export function createEnemy(tx, ty) {
  return {
    tileX: tx, tileY: ty,
    targetX: tx, targetY: ty,
    currentX: tx, currentY: ty,
    moveProgress: 0,
    isMoving: false,
    dir: DIR.DOWN,
    walkFrame: 0,

    hp: 100,
    maxHp: 100,
    damage: 20,
    hasDealtDamage: false,

    state: "IDLE",
    attackFrame: 0,
    attackClock: 0,
    attackCooldown: 0.8,
    hitFlashTimer: 0,

    dieFrame: 0,
    dieClock: 0,
    corpseTimer: CORPSE_LINGER_TIME,
    active: true
  };
}

export function initEnemies(player) {
  enemies.length = 0;
  for (let i = 0; i < MAX_ENEMIES; i++) {
    spawnEnemyAround(player);
  }
}

function spawnEnemyAround(player) {
  for (let attempts = 0; attempts < 40; attempts++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 6 + Math.random() * 8;
    const tx = Math.round((player ? player.tileX : 0) + Math.cos(angle) * dist);
    const ty = Math.round((player ? player.tileY : 0) + Math.sin(angle) * dist);

    if (canStep(tx, ty, tx, ty)) {
      const occupied = enemies.some(e => e.active && e.state !== "DYING" && e.tileX === tx && e.tileY === ty);
      const occupiedByPlayer = player && ((player.tileX === tx && player.tileY === ty) ||
        (player.isMoving && player.targetX === tx && player.targetY === ty));
      if (!occupied && !occupiedByPlayer) {
        enemies.push(createEnemy(tx, ty));
        return;
      }
    }
  }
}

export function updateEnemies(dt, player, tryRangedAttack) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.hitFlashTimer = Math.max(0, e.hitFlashTimer - dt);

    if (e.state === "DEAD") {
      e.corpseTimer -= dt;
      if (e.corpseTimer <= 0) {
        enemies.splice(i, 1);
        setTimeout(() => spawnEnemyAround(player), 3000);
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
      } else {
        e.currentX = e.tileX + (e.targetX - e.tileX) * e.moveProgress;
        e.currentY = e.tileY + (e.targetY - e.tileY) * e.moveProgress;
      }
      continue;
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

    if (tryRangedAttack && e.attackCooldown <= 0 && dist > 1.5 && dist <= AGGRO_RANGE) {
      if (dx === 0 || dy === 0) {
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
    }

    if (dist <= AGGRO_RANGE && !e.isMoving) {
      const leader = enemies
        .filter(other => other.active && other.state !== "DEAD" && other.state !== "DYING")
        .sort((a, b) => Math.hypot(a.currentX - player.currentX, a.currentY - player.currentY) -
                        Math.hypot(b.currentX - player.currentX, b.currentY - player.currentY))[0];
      let targetX = player.tileX;
      let targetY = player.tileY;

      if (leader && leader !== e && tryRangedAttack) {
        e.state = "SUPPORT";
        const rangedPositions = DIR_VECTORS.flatMap(vector => [2, 3].map(distance => ({
          x: player.tileX + vector.x * distance,
          y: player.tileY + vector.y * distance
        }))).filter(position =>
          getTileElevation(position.x, position.y) === getTileElevation(player.tileX, player.tileY) &&
          !isSolidEnemyAt(position.x, position.y)
        );
        rangedPositions.sort((a, b) =>
          Math.abs(a.x - e.tileX) + Math.abs(a.y - e.tileY) -
          (Math.abs(b.x - e.tileX) + Math.abs(b.y - e.tileY))
        );
        if (rangedPositions.length > 0) {
          targetX = rangedPositions[0].x;
          targetY = rangedPositions[0].y;
        }
      } else {
        e.state = "CHASE";
      }

      const direction = findNextPathDirection(e, targetX, targetY, player);
      const chaseDirection = direction ?? (targetX !== player.tileX || targetY !== player.tileY
        ? findNextPathDirection(e, player.tileX, player.tileY, player)
        : null);
      if (chaseDirection !== null) {
        e.dir = chaseDirection;
        e.targetX = e.tileX + DIR_VECTORS[chaseDirection].x;
        e.targetY = e.tileY + DIR_VECTORS[chaseDirection].y;
        e.isMoving = true;
        e.moveProgress = 0;
      }
    } else {
      e.state = "IDLE";
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
  let sheet = villainWalk;
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
    sheet = villainDie;
    frameX = enemy.dieFrame;
    frameY = 0;
    flip = false;
  } else if (enemy.state === "ATTACK") {
    sheet = villainAttack;
    frameX = enemy.attackFrame;
    if (enemy.dir === DIR.DOWN) { frameY = 0; }
    else if (enemy.dir === DIR.LEFT) { frameY = 1; }
    else if (enemy.dir === DIR.RIGHT) { frameY = 1; flip = true; }
    else if (enemy.dir === DIR.UP) { frameY = 3; }
  } else {
    sheet = villainWalk;
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