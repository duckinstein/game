import { globals, DIR, tryLoadImage } from './globals.js';
import { getTileElevation } from './world.js';
import { canStep, particles, setEnemySolidChecker } from './props.js';
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
  return enemies.some(e => 
    e.active && 
    e.state !== "DEAD" && 
    e.state !== "DYING" && 
    ((e.tileX === tx && e.tileY === ty) || (e.isMoving && e.targetX === tx && e.targetY === ty))
  );
}
setEnemySolidChecker(isSolidEnemyAt);

const DIR_VECTORS = [
  { x: 0,  y: 1,  dir: DIR.DOWN },
  { x: -1, y: 0,  dir: DIR.LEFT },
  { x: 1,  y: 0,  dir: DIR.RIGHT },
  { x: 0,  y: -1, dir: DIR.UP }
];

export function createEnemy(tx, ty) {
  return {
    tileX: tx, tileY: ty,
    targetX: tx, targetY: ty,
    currentX: tx, currentY: ty,
    moveProgress: 0,
    isMoving: false,
    dir: DIR.DOWN,
    walkFrame: 0,

    hp: 60,
    maxHp: 60,
    damage: 15,
    hasDealtDamage: false,

    state: "IDLE",
    attackFrame: 0,
    attackClock: 0,
    attackCooldown: 0.8,

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
      const occupied = enemies.some(e => e.active && e.tileX === tx && e.tileY === ty);
      if (!occupied) {
        enemies.push(createEnemy(tx, ty));
        return;
      }
    }
  }
}

export function updateEnemies(dt, player) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];

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
        if (dx + dy <= 1) {
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
      e.moveProgress += dt / STEP_SPEED;
      e.walkFrame = Math.floor(e.moveProgress * 4) % 4;

      if (e.moveProgress >= 1) {
        e.tileX = e.targetX;
        e.tileY = e.targetY;
        e.currentX = e.tileX;
        e.currentY = e.tileY;
        e.isMoving = false;
        e.moveProgress = 0;
        e.walkFrame = 0;
      } else {
        e.currentX = e.tileX + (e.targetX - e.tileX) * e.moveProgress;
        e.currentY = e.tileY + (e.targetY - e.tileY) * e.moveProgress;
      }
      continue;
    }

    const dx = player.tileX - e.tileX;
    const dy = player.tileY - e.tileY;
    const dist = Math.hypot(dx, dy);

    if (Math.abs(dx) + Math.abs(dy) === 1 && e.attackCooldown <= 0) {
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

    if (dist <= AGGRO_RANGE && !e.isMoving) {
      e.state = "CHASE";
      const moves = [];

      if (Math.abs(dx) >= Math.abs(dy)) {
        moves.push(dx > 0 ? DIR.RIGHT : DIR.LEFT);
        if (dy !== 0) moves.push(dy > 0 ? DIR.DOWN : DIR.UP);
      } else {
        moves.push(dy > 0 ? DIR.DOWN : DIR.UP);
        if (dx !== 0) moves.push(dx > 0 ? DIR.RIGHT : DIR.LEFT);
      }

      for (const tryDir of moves) {
        const vec = DIR_VECTORS[tryDir];
        const nextX = e.tileX + vec.x;
        const nextY = e.tileY + vec.y;

        const isPlayerTile = (nextX === player.tileX && nextY === player.tileY) ||
                             (player.isMoving && nextX === player.targetX && nextY === player.targetY);
        const tileOccupied = enemies.some(other => other !== e && other.active && other.state !== "DEAD" && 
          ((other.tileX === nextX && other.tileY === nextY) || (other.isMoving && other.targetX === nextX && other.targetY === nextY)));

        if (!isPlayerTile && !tileOccupied && canStep(e.tileX, e.tileY, nextX, nextY, false)) {
          e.dir = tryDir;
          e.targetX = nextX;
          e.targetY = nextY;
          e.isMoving = true;
          e.moveProgress = 0;
          break;
        }
      }
    } else {
      e.state = "IDLE";
    }
  }
}

export function checkPlayerAttackHit(player) {
  const dirVec = DIR_VECTORS[player.dir];
  if (!dirVec) return;
  const hitTileX = player.tileX + dirVec.x;
  const hitTileY = player.tileY + dirVec.y;

  for (const enemy of enemies) {
    if (enemy.state === "DYING" || enemy.state === "DEAD") continue;

    const hitByTile = (enemy.tileX === hitTileX && enemy.tileY === hitTileY) || 
                      (enemy.targetX === hitTileX && enemy.targetY === hitTileY);
    const hitByProximity = Math.hypot(enemy.currentX - (player.currentX + dirVec.x * 0.8), 
                                      enemy.currentY - (player.currentY + dirVec.y * 0.8)) < 1.0;

    if (hitByTile || hitByProximity) {
      const damage = 30;
      enemy.hp -= damage;

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
  const screenY = (enemy.currentY + 1.0) * globals.tile - globals.cameraY - (elev * globals.tile * 0.6);

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
  const destH = globals.tile * hUnits;

  ctx.imageSmoothingEnabled = true;

  if (sheet && sheet.ready && sheet.image) {
    ctx.save();
    if (flip) {
      ctx.translate(Math.round(screenX), Math.round(screenY));
      ctx.scale(-1, 1);
      ctx.drawImage(
        sheet.image,
        frameX * sheet.fw, frameY * sheet.fh, sheet.fw, sheet.fh,
        Math.round(-destW * 0.5), Math.round(-destH), destW, destH
      );
    } else {
      ctx.drawImage(
        sheet.image,
        frameX * sheet.fw, frameY * sheet.fh, sheet.fw, sheet.fh,
        Math.round(screenX - destW * 0.5), Math.round(screenY - destH), destW, destH
      );
    }
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = enemy.state === "ATTACK" ? "#ff2e4c" : (enemy.state === "DEAD" ? "#555" : "#6a2d9c");
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