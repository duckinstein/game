import { DIR, globals } from './globals.js';
import { damageMapObjectAt, getMapObjectAtWorld } from './props.js';
import { spendPlayerMana, takePlayerDamage } from './player.js';
import { damageEnemy, enemies } from './enemies.js';
import { getTileElevation, isCliff } from './world.js';

const FIREBALL_SPEED = 8;
const FIREBALL_DAMAGE = 20;
const FIREBALL_RADIUS = 0.18;
const FIREBALL_SIZE = 1.9;
export const FIREBALL_MANA_COST = 0.5;
const FIREBALL_DIRECTIONS = {
  [DIR.DOWN]: { x: 0, y: 1 },
  [DIR.LEFT]: { x: -1, y: 0 },
  [DIR.RIGHT]: { x: 1, y: 0 },
  [DIR.UP]: { x: 0, y: -1 }
};

const FIREBALL_IMAGE = "./effects/fireball.gif";
const fireballImage = new Image();
fireballImage.src = FIREBALL_IMAGE;

export const fireballs = [];

function tileAt(x, y) {
  return { x: Math.floor(x), y: Math.floor(y) };
}

function elevationAt(x, y) {
  const tile = tileAt(x, y);
  return getTileElevation(tile.x, tile.y);
}

export function launchFireball(actor, owner = "player") {
  const direction = FIREBALL_DIRECTIONS[actor.dir];
  if (!direction) return false;
  if (owner === "player" && !spendPlayerMana(FIREBALL_MANA_COST)) return false;
  fireballs.push({
    x: actor.currentX + 0.5 + direction.x * 0.5,
    y: actor.currentY + 0.5 + direction.y * 0.5,
    dirX: direction.x,
    dirY: direction.y,
    owner,
    enemyVariant: owner === "enemy" ? actor.variant : null,
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
      return true;
    }
  }
  return false;
}

function hitPlayerAt(x, y, player, elevation) {
  if (getTileElevation(Math.round(player.currentX), Math.round(player.currentY)) !== elevation) return false;
  if (Math.hypot(player.currentX + 0.5 - x, player.currentY + 0.5 - y) > 0.5 + FIREBALL_RADIUS) return false;
  takePlayerDamage(FIREBALL_DAMAGE);
  return true;
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
        fireball.removed = true;
        continue;
      }

      const damage = fireball.owner === "player" ? FIREBALL_DAMAGE * 2 : FIREBALL_DAMAGE;
      const object = getMapObjectAtWorld(fireball.x, fireball.y, FIREBALL_RADIUS);
      const objectHit = Boolean(object &&
        getTileElevation(object.tx, object.ty) === fireball.elevation &&
        damageMapObjectAt(fireball.x, fireball.y, FIREBALL_RADIUS));
      const targetHit = !objectHit && (fireball.owner === "enemy"
        ? hitPlayerAt(fireball.x, fireball.y, player, fireball.elevation)
        : hitEnemyAt(fireball.x, fireball.y, damage, fireball.elevation));
      if (objectHit || targetHit) {
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
  const width = globals.tile * FIREBALL_SIZE;
  const height = width / 2;

  for (const fireball of fireballs) {
    if (!fireballImage.complete || fireballImage.naturalWidth === 0) continue;
    const x = fireball.x * globals.tile - globals.cameraX;
    const y = (fireball.y - fireball.elevation * 0.6) * globals.tile - globals.cameraY;
    const phase = fireball.age * 24;
    const pulse = 0.92 + 0.12 * Math.sin(phase);
    const flicker = 0.82 + 0.18 * Math.sin(phase * 1.7);
    const enemyShot = fireball.owner === "enemy";
    const blackShot = enemyShot && fireball.enemyVariant === 1;
    const glowColor = blackShot ? "66, 32, 90" : enemyShot ? "157, 91, 220" : "255, 104, 24";

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(fireball.dirY, fireball.dirX));
    ctx.globalAlpha = flicker;
    ctx.globalCompositeOperation = blackShot ? "source-over" : "lighter";
    const glow = ctx.createRadialGradient(0, 0, width * 0.06, 0, 0, width * 0.72);
    glow.addColorStop(0, `rgba(${glowColor}, 0.7)`);
    glow.addColorStop(0.35, `rgba(${glowColor}, 0.34)`);
    glow.addColorStop(1, `rgba(${glowColor}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(0, 0, width * 0.72, height * 1.65, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = "source-over";
    ctx.shadowColor = blackShot ? "#321748" : enemyShot ? "#a764e8" : "#ff742b";
    ctx.shadowBlur = globals.tile * (0.8 + 0.35 * (1 + Math.sin(phase)));
    if (blackShot) ctx.filter = "grayscale(1) brightness(0.15) contrast(1.4)";
    else if (enemyShot) ctx.filter = "hue-rotate(260deg) saturate(1.8) brightness(1.08)";
    ctx.drawImage(
      fireballImage,
      -width * pulse / 2,
      -height * pulse / 2,
      width * pulse,
      height * pulse
    );
    ctx.restore();
  }
}
