import { globals } from './globals.js';
import { grassSheet, hillsSheet, resolveHillTile, getGrassVariation, getGrassDecor, getTileElevation } from './world.js';
import { objectsSheet, coinSheet, getMapObjectAt, hasCoinAt, particles, propState } from './props.js';
import { player, walk, attack, FOOT_OFFSET_Y, pushDir, removeDir, beginAttack, updatePlayer, getPlayerFootWorldPos, clearInputs } from './player.js';
import { enemies, initEnemies, updateEnemies, drawEnemy, checkPlayerAttackHit } from './enemies.js';
import { updateUIElements, updatePlayerHUDHealth } from './ui.js';

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const attackButton = document.getElementById("attack");
const coinCounterEl = document.getElementById("coin-count");

const SPRITE_W_UNITS = 1.6;
const SPRITE_H_UNITS = 1.6;
const pointers = new Map();
let lastTime = performance.now();

function updateHUD() {
  if (coinCounterEl) coinCounterEl.textContent = propState?.coinsCollectedCount ?? 0;
  updatePlayerHUDHealth(player.hp, player.maxHp);
}

function handleAttackEnd() {
  if (attackButton) attackButton.classList.remove("active");
}

function handleAttackHit(playerObj) {
  checkPlayerAttackHit(playerObj);
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  globals.viewW = rect.width; 
  globals.viewH = rect.height;
  globals.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(globals.viewW * globals.dpr);
  canvas.height = Math.round(globals.viewH * globals.dpr);
  ctx.setTransform(globals.dpr, 0, 0, globals.dpr, 0, 0);

  globals.tile = Math.max(32, Math.min(56, Math.floor(Math.min(globals.viewW, globals.viewH) / 10 * 0.75)));

  if (!player.initialized) {
    player.tileX = 0; player.tileY = 0;
    player.targetX = 0; player.targetY = 0;
    player.currentX = 0; player.currentY = 0;
    player.initialized = true;

    initEnemies(player);

    const foot = getPlayerFootWorldPos();
    globals.cameraX = foot.x - globals.viewW / 2;
    globals.cameraY = foot.y - globals.viewH / 2;
  }
  updateCamera();
  updateUIElements();
}
window.addEventListener("resize", resize, { passive: true });

function updateCamera() {
  const foot = getPlayerFootWorldPos();
  const targetCamX = foot.x - globals.viewW / 2;
  const targetCamY = foot.y - globals.viewH / 2;

  globals.cameraX += (targetCamX - globals.cameraX) * 0.15;
  globals.cameraY += (targetCamY - globals.cameraY) * 0.15;
}

function update(dt) {
  updatePlayer(dt, () => {}, handleAttackEnd, handleAttackHit);
  updateEnemies(dt, player);
  updateHUD();

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }

  updateCamera();
}

function drawLowGrassTile(tx, ty, x, y) {
  if (grassSheet.ready && grassSheet.image) {
    const u = grassSheet.u;
    const v = getGrassVariation(tx, ty);
    ctx.imageSmoothingEnabled = false;

    ctx.drawImage(grassSheet.image, v.col * u, v.row * u, u, u, x, y, globals.tile, globals.tile);

    const decor = getGrassDecor(tx, ty);
    if (decor) {
      ctx.drawImage(grassSheet.image, decor.col * u, decor.row * u, u, u, x, y, globals.tile, globals.tile);
    }
  } else {
    ctx.fillStyle = "#8fc257";
    ctx.fillRect(x, y, globals.tile, globals.tile);
  }
}

function drawHighlandCell(role, x, y) {
  if (hillsSheet.ready && hillsSheet.image) {
    const u = hillsSheet.u;
    const slice = hillsSheet.atlas[role];

    if (slice) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(hillsSheet.image, slice.col * u, slice.row * u, u, u, x, y, globals.tile, globals.tile);
    }
  }
}

function drawWorld() {
  ctx.fillStyle = "#8fc257";
  ctx.fillRect(0, 0, globals.viewW, globals.viewH);

  const firstCol = Math.floor(globals.cameraX / globals.tile);
  const firstRow = Math.floor(globals.cameraY / globals.tile);
  const offsetX = -(globals.cameraX - firstCol * globals.tile);
  const offsetY = -(globals.cameraY - firstRow * globals.tile);
  const cols = Math.ceil(globals.viewW / globals.tile) + 2;
  const rows = Math.ceil(globals.viewH / globals.tile) + 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tx = firstCol + c;
      const ty = firstRow + r;
      const x = Math.round(offsetX + c * globals.tile);
      const y = Math.round(offsetY + r * globals.tile);

      drawLowGrassTile(tx, ty, x, y);

      const hillRole = resolveHillTile(tx, ty);
      if (hillRole) {
        drawHighlandCell(hillRole, x, y);
      }
    }
  }
}

function drawCoin(cx, cy, coinFrameIdx) {
  const screenX = cx - globals.cameraX;
  const screenY = cy - globals.cameraY;

  if (coinSheet.ready && coinSheet.frames.length > 0) {
    const frame = coinSheet.frames[coinFrameIdx];
    const coinHeight = globals.tile * 0.75;
    const coinWidth = (frame.sw / frame.sh) * coinHeight;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      frame.canvas,
      frame.sx, frame.sy, frame.sw, frame.sh,
      Math.round(screenX - coinWidth / 2),
      Math.round(screenY - coinHeight / 2),
      Math.round(coinWidth),
      Math.round(coinHeight)
    );
  } else {
    const t = performance.now() * 0.006;
    const scaleX = Math.cos(t);
    const rad = globals.tile * 0.22;
    ctx.fillStyle = "#ffcc00";
    ctx.beginPath();
    ctx.ellipse(screenX, screenY, Math.max(1, Math.abs(scaleX) * rad), rad, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlayerSprite(sheet, frameX, frameY, footScreenX, footScreenY) {
  const destW = globals.tile * SPRITE_W_UNITS;
  const destH = globals.tile * SPRITE_H_UNITS;
  const drawX = Math.round(footScreenX - destW * 0.5);
  const drawY = Math.round(footScreenY - destH);

  if (sheet && sheet.ready && sheet.image) {
    ctx.imageSmoothingEnabled = true;
    if (player.invulnerableTimer > 0 && Math.floor(performance.now() / 80) % 2 === 0) {
      ctx.save();
      ctx.filter = "brightness(2.2) sepia(1) saturate(5) hue-rotate(-50deg)";
      ctx.drawImage(
        sheet.image,
        frameX * sheet.fw, frameY * sheet.fh, sheet.fw, sheet.fh,
        drawX, drawY, destW, destH
      );
      ctx.restore();
    } else {
      ctx.drawImage(
        sheet.image,
        frameX * sheet.fw, frameY * sheet.fh, sheet.fw, sheet.fh,
        drawX, drawY, destW, destH
      );
    }
  } else {
    ctx.save();
    ctx.fillStyle = player.invulnerableTimer > 0 ? "#ff5555" : "#3282b8";
    ctx.beginPath();
    ctx.arc(Math.round(footScreenX), Math.round(footScreenY - destH * 0.45), Math.round(destW * 0.35), 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `bold ${Math.round(globals.tile * 0.38)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🧙", Math.round(footScreenX), Math.round(footScreenY - destH * 0.45));
    ctx.restore();
  }
}

function drawMapObject(obj) {
  if (!objectsSheet.ready || !objectsSheet.image) return;
  const def = obj.def;
  const destW = globals.tile * def.wUnits;
  const destH = globals.tile * def.hUnits;

  const elev = getTileElevation(obj.tx, obj.ty);
  const screenX = (obj.tx + obj.def.wUnits * 0.5) * globals.tile - globals.cameraX;
  const screenY = (obj.ty + obj.def.footOffsetY) * globals.tile - globals.cameraY - (elev * globals.tile * 0.6);

  const drawX = Math.round(screenX - destW * 0.5);
  const drawY = Math.round(screenY - destH);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    objectsSheet.image,
    def.sx, def.sy, def.sw, def.sh,
    drawX, drawY, destW, destH
  );
}

function draw(now) {
  ctx.clearRect(0, 0, globals.viewW, globals.viewH);
  drawWorld();

  const minCol = Math.floor((globals.cameraX - globals.tile * 3) / globals.tile);
  const maxCol = Math.ceil((globals.cameraX + globals.viewW + globals.tile * 3) / globals.tile);
  const minRow = Math.floor((globals.cameraY - globals.tile * 3) / globals.tile);
  const maxRow = Math.ceil((globals.cameraY + globals.viewH + globals.tile * 6) / globals.tile);

  const coinFrameIdx = coinSheet.frames.length > 0 ? Math.floor((now / 85) % coinSheet.frames.length) : 0;

  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      if (hasCoinAt(c, r)) {
        const elev = getTileElevation(c, r);
        drawCoin((c + 0.5) * globals.tile, (r + 0.5) * globals.tile - (elev * globals.tile * 0.6), coinFrameIdx);
      }
    }
  }

  // --- Y-SORTED DEPTH RENDER QUEUE ---
  const renderQueue = [];

  // 1. Add Player
  const playerFoot = getPlayerFootWorldPos();
  renderQueue.push({
    type: "PLAYER",
    footY: player.currentY + FOOT_OFFSET_Y,
    draw: () => {
      const screenX = playerFoot.x - globals.cameraX;
      const screenY = playerFoot.y - globals.cameraY;

      if (player.attacking && attack.ready) {
        drawPlayerSprite(attack, player.attackFrame, player.dir, screenX, screenY);
      } else {
        drawPlayerSprite(walk, player.isMoving ? player.walkFrame : 0, player.dir, screenX, screenY);
      }
    }
  });

  // 2. Add Map Objects
  for (let r = minRow - 2; r <= maxRow + 2; r++) {
    for (let c = minCol - 2; c <= maxCol + 2; c++) {
      const obj = getMapObjectAt(c, r);
      if (obj) {
        renderQueue.push({
          type: "OBJECT",
          footY: obj.footY,
          draw: () => drawMapObject(obj)
        });
      }
    }
  }

  // 3. Add Enemies
  for (const enemy of enemies) {
    if (!enemy.active) continue;
    renderQueue.push({
      type: "ENEMY",
      footY: enemy.currentY + 1.0,
      draw: () => drawEnemy(ctx, enemy)
    });
  }

  // 4. Sort and render back-to-front
  renderQueue.sort((a, b) => a.footY - b.footY);
  for (const item of renderQueue) item.draw();

  // Floating Combat & Reward Particles
  if (particles.length > 0) {
    ctx.save();
    for (const p of particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color || "#ffe24a";
      ctx.strokeStyle = p.stroke || "#3d1400";
      ctx.lineWidth = 3;
      ctx.font = `900 ${Math.round(globals.tile * 0.36)}px system-ui`;
      ctx.textAlign = "center";
      const sx = p.x - globals.cameraX;
      const sy = p.y - globals.cameraY;
      const text = p.text || "+1";
      ctx.strokeText(text, sx, sy);
      ctx.fillText(text, sx, sy);
    }
    ctx.restore();
  }
}

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  update(dt);
  draw(now);
  requestAnimationFrame(loop);
}

function keyDirection(code) {
  if (code === "ArrowUp" || code === "KeyW") return "up";
  if (code === "ArrowDown" || code === "KeyS") return "down";
  if (code === "ArrowLeft" || code === "KeyA") return "left";
  if (code === "ArrowRight" || code === "KeyD") return "right";
  return null;
}

window.addEventListener("keydown", e => {
  const dir = keyDirection(e.code);
  if (dir) { pushDir(dir); e.preventDefault(); }
  if ((e.code === "Space" || e.code === "Enter") && !e.repeat) {
    e.preventDefault(); 
    if (beginAttack() && attackButton) attackButton.classList.add("active");
  }
});

window.addEventListener("keyup", e => {
  const dir = keyDirection(e.code);
  if (dir) { removeDir(dir); e.preventDefault(); }
});

window.addEventListener("blur", () => {
  clearInputs();
  pointers.clear();
  document.querySelectorAll("[data-dir]").forEach(b => b.classList.remove("active"));
});

document.querySelectorAll("[data-dir]").forEach(button => {
  const dir = button.dataset.dir;
  button.addEventListener("pointerdown", e => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    pointers.set(dir, e.pointerId);
    pushDir(dir);
    button.classList.add("active");
  });
  const release = e => {
    if (pointers.get(dir) === e.pointerId) {
      pointers.delete(dir);
      removeDir(dir);
    }
    button.classList.remove("active");
  };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
});

if (attackButton) {
  attackButton.addEventListener("pointerdown", e => { 
    e.preventDefault(); 
    if (beginAttack()) attackButton.classList.add("active"); 
  });
  attackButton.addEventListener("pointerup", () => attackButton.classList.remove("active"));
  attackButton.addEventListener("pointercancel", () => attackButton.classList.remove("active"));
}

resize();
requestAnimationFrame(loop);
