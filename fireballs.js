import { DIR, globals } from './globals.js';
import { damageMapObjectAt, getMapObjectAtWorld } from './props.js';
import { spendPlayerMana, takePlayerDamage } from './player.js';
import { damageEnemy, enemies } from './enemies.js';
import { getTileElevation, isCliff } from './world.js';
import { playSound } from './audio.js';

const FIREBALL_SPEED = 8;
const ENEMY_FIREBALL_DAMAGE = 10;
const FIREBALL_RADIUS = 0.18;
const FIREBALL_SIZE = 1.9;
const EXPLOSION_FRAME_COUNT = 10;
const EXPLOSION_FRAME_TIME = 0.045;
const EXPLOSION_DURATION = EXPLOSION_FRAME_COUNT * EXPLOSION_FRAME_TIME;
const EXPLOSION_SIZE = 1.7;
const FIREBALL_DIRECTIONS = {
  [DIR.DOWN]: { x: 0, y: 1 },
  [DIR.LEFT]: { x: -1, y: 0 },
  [DIR.RIGHT]: { x: 1, y: 0 },
  [DIR.UP]: { x: 0, y: -1 }
};

const FIREBALL_IMAGE = "./assets/effects/fireball.gif";
const fireballImage = new Image();
fireballImage.decoding = "async";
fireballImage.onerror = () => console.error(`Unable to load fireball image: ${FIREBALL_IMAGE}`);
fireballImage.src = FIREBALL_IMAGE;

const EXPLOSION_IMAGE = "./assets/effects/Explosion_02.png";
const explosionImage = new Image();
explosionImage.decoding = "async";
explosionImage.onload = () => {
  if (explosionImage.naturalWidth % EXPLOSION_FRAME_COUNT !== 0) {
    console.error(`Explosion spritesheet width must be divisible by ${EXPLOSION_FRAME_COUNT}: ${EXPLOSION_IMAGE}`);
  }
};
explosionImage.onerror = () => console.error(`Unable to load explosion image: ${EXPLOSION_IMAGE}`);
explosionImage.src = EXPLOSION_IMAGE;

export const fireballs = [];
const explosions = [];
export const FIREBALLS_PER_MANA = 2;
export const FIREBALL_MANA_COST = 1 / FIREBALLS_PER_MANA;

export function clearFireballs() {
  fireballs.length = 0;
  explosions.length = 0;
}

function tileAt(x, y) {
  return { x: Math.floor(x), y: Math.floor(y) };
}

function elevationAt(x, y) {
  const tile = tileAt(x, y);
  return getTileElevation(tile.x, tile.y);
}

function addExplosion(tile, elevation) {
  explosions.push({ x: tile.x, y: tile.y, elevation, elapsed: 0 });
}

export function launchFireball(actor, owner = "player") {
  const direction = FIREBALL_DIRECTIONS[actor.dir];
  if (!direction) return false;
  if (owner === "player" && !spendPlayerMana(FIREBALL_MANA_COST)) return false;
  playSound("fireball");
  fireballs.push({
    x: actor.currentX + 0.5 + direction.x * 0.5,
    y: actor.currentY + 0.5 + direction.y * 0.5,
    dirX: direction.x,
    dirY: direction.y,
    owner,
    damage: owner === "enemy" ? actor.damage : null,
    age: 0,
    elevation: getTileElevation(Math.round(actor.currentX), Math.round(actor.currentY)),
    removed: false
  });
  return true;
}

function hitEnemyAt(x, y, damage, elevation) {
  for (const enemy of enemies) {
    if (!enemy.active || enemy.state === "DYING" || enemy.state === "DEAD") continue;
    if (getTileElevation(Math.round(enemy.currentX), Math.round(enemy.currentY)) !== elevation) continue;
    if (Math.hypot(enemy.currentX + 0.5 - x, enemy.currentY + 0.5 - y) <= 0.5 + FIREBALL_RADIUS) {
      damageEnemy(enemy, damage);
      return tileAt(Math.round(enemy.currentX), Math.round(enemy.currentY));
    }
  }
  return null;
}

function hitPlayerAt(x, y, player, elevation, damage = ENEMY_FIREBALL_DAMAGE) {
  if (getTileElevation(Math.round(player.currentX), Math.round(player.currentY)) !== elevation) return null;
  if (Math.hypot(player.currentX + 0.5 - x, player.currentY + 0.5 - y) > 0.5 + FIREBALL_RADIUS) return null;
  takePlayerDamage(damage);
  return tileAt(Math.round(player.currentX), Math.round(player.currentY));
}

export function canFireballReach(fromX, fromY, toX, toY) {
  if (elevationAt(fromX, fromY) !== elevationAt(toX, toY)) return false;
  const targetTile = tileAt(toX, toY);
  if (isCliff(targetTile.x, targetTile.y)) return false;
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) < 0.2 && Math.abs(dy) > 1) {
    const direction = Math.sign(dy);
    for (let y = fromY + direction * 0.7; Math.abs(toY - y) > 0.35; y += direction * 0.1) {
      const tile = tileAt(fromX, y);
      if (isCliff(tile.x, tile.y) || elevationAt(fromX, y) !== elevationAt(fromX, fromY) ||
          getMapObjectAtWorld(fromX, y, FIREBALL_RADIUS)) return false;
    }
    return true;
  }
  if (Math.abs(dy) < 0.2 && Math.abs(dx) > 1) {
    const direction = Math.sign(dx);
    for (let x = fromX + direction * 0.7; Math.abs(toX - x) > 0.35; x += direction * 0.1) {
      const tile = tileAt(x, fromY);
      if (isCliff(tile.x, tile.y) || elevationAt(x, fromY) !== elevationAt(fromX, fromY) ||
          getMapObjectAtWorld(x, fromY, FIREBALL_RADIUS)) return false;
    }
    return true;
  }
  return false;
}

export function updateFireballs(dt, player) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    explosions[i].elapsed += dt;
    if (explosions[i].elapsed >= EXPLOSION_DURATION) explosions.splice(i, 1);
  }

  const steps = Math.max(1, Math.ceil(FIREBALL_SPEED * dt / 0.12));
  const stepDistance = FIREBALL_SPEED * dt / steps;

  for (let step = 0; step < steps; step++) {
    for (const fireball of fireballs) {
      if (fireball.removed) continue;
      fireball.x += fireball.dirX * stepDistance;
      fireball.y += fireball.dirY * stepDistance;
      fireball.age += dt / steps;
    }

    for (let i = 0; i < fireballs.length; i++) {
      const first = fireballs[i];
      if (first.removed) continue;
      for (let j = i + 1; j < fireballs.length; j++) {
        const second = fireballs[j];
        if (second.removed) continue;
        if (Math.hypot(first.x - second.x, first.y - second.y) > FIREBALL_RADIUS * 2) continue;
        first.removed = true;
        second.removed = true;
        break;
      }
    }

    for (const fireball of fireballs) {
      if (fireball.removed) continue;
      const tile = tileAt(fireball.x, fireball.y);
      const currentElevation = getTileElevation(tile.x, tile.y);
      if (isCliff(tile.x, tile.y) || currentElevation !== fireball.elevation) {
        addExplosion(tile, fireball.elevation);
        fireball.removed = true;
        continue;
      }

      const damage = fireball.owner === "player" ? player.fireballDamage : 20;
      const object = getMapObjectAtWorld(fireball.x, fireball.y, FIREBALL_RADIUS);
      const objectHit = Boolean(object &&
        getTileElevation(object.tx, object.ty) === fireball.elevation);
      if (objectHit) damageMapObjectAt(fireball.x, fireball.y, FIREBALL_RADIUS);
      const targetTile = !objectHit && (fireball.owner === "enemy"
        ? hitPlayerAt(fireball.x, fireball.y, player, fireball.elevation, fireball.damage)
        : hitEnemyAt(fireball.x, fireball.y, damage, fireball.elevation));
      if (objectHit || targetTile) {
        addExplosion(objectHit ? tileAt(fireball.x, fireball.y) : targetTile, fireball.elevation);
        fireball.removed = true;
      }
    }
  }

  for (const fireball of fireballs) {
    const screenX = fireball.x * globals.tile - globals.cameraX;
    const screenY = (fireball.y - fireball.elevation * 0.6) * globals.tile - globals.cameraY;
    if (screenX < -globals.tile * 2 || screenX > globals.viewW + globals.tile * 2 ||
        screenY < -globals.tile * 2 || screenY > globals.viewH + globals.tile * 2) {
      fireball.removed = true;
    }
  }
  for (let i = fireballs.length - 1; i >= 0; i--) {
    if (fireballs[i].removed) fireballs.splice(i, 1);
  }

}

export function drawFireballVisuals(ctx) {
  if (explosionImage.complete && explosionImage.naturalWidth > 0) {
    const frameWidth = explosionImage.naturalWidth / EXPLOSION_FRAME_COUNT;
    const frameHeight = explosionImage.naturalHeight;
    const size = globals.tile * EXPLOSION_SIZE;

    for (const explosion of explosions) {
      const frameProgress = explosion.elapsed / EXPLOSION_FRAME_TIME;
      const frameIndex = Math.min(Math.floor(frameProgress), EXPLOSION_FRAME_COUNT - 1);
      const blend = frameProgress - frameIndex;
      const centerX = (explosion.x + 0.5) * globals.tile - globals.cameraX;
      const centerY = (explosion.y + 0.5 - explosion.elevation * 0.6) * globals.tile - globals.cameraY;
      const drawFrame = (index, alpha) => {
        if (alpha <= 0) return;
        ctx.globalAlpha = alpha;
        ctx.drawImage(
          explosionImage,
          index * frameWidth, 0, frameWidth, frameHeight,
          centerX - size / 2, centerY - size / 2, size, size
        );
      };

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      if (frameIndex < EXPLOSION_FRAME_COUNT - 1) {
        drawFrame(frameIndex, 1 - blend);
        drawFrame(frameIndex + 1, blend);
      } else {
        drawFrame(frameIndex, 1 - blend);
      }
      ctx.restore();
    }
  }

  const width = globals.tile * FIREBALL_SIZE;
  const height = width / 2;

  for (const fireball of fireballs) {
    const x = fireball.x * globals.tile - globals.cameraX;
    const y = (fireball.y - fireball.elevation * 0.6) * globals.tile - globals.cameraY;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(fireball.dirY, fireball.dirX));
    if (fireballImage.complete && fireballImage.naturalWidth > 0) {
      ctx.drawImage(
        fireballImage,
        -width / 2,
        -height / 2,
        width,
        height
      );
    }
    ctx.restore();
  }
}
