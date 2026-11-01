import { globals } from './globals.js';
import { grassSheet, hillsSheet, waterSheet, resolveHillTile, getGrassVariation, getGrassDecor, getPondAt, getWaterDecor, isWaterTile, getTileElevation } from './world.js';
import { objectsSheet, pondDecorSprites, coinSheet, getMapObjectAt, hasCoinAt, particles, propState } from './props.js';
import { player, FOOT_OFFSET_Y, pushDir, removeDir, beginAttack, activatePlayerShield, updatePlayer, getPlayerFootWorldPos, clearInputs, losePlayerXP, setPlayerDeathHandler } from './player.js';
import { enemies, initEnemies, updateEnemies, drawEnemy, checkPlayerAttackHit, loadVillains } from './enemies.js';
import { fireballs, launchFireball, canFireballReach, updateFireballs, drawFireballVisuals, clearFireballs } from './fireballs.js';
import { drawSheep, getSheepInBounds, updateSheep } from './sheep.js';
import { updateUIElements, updatePlayerHUDHealth, updatePlayerHUDMana } from './ui.js';
import { initializePanels, initializeCharacterRoster } from './panels.js';
import { removeDarkBackground } from './image-processing.js';
import { getTimeOfDayColor } from './time-of-day.js';

const canvas = document.getElementById("game");
const outputCtx = canvas.getContext("2d");
const sceneCanvas = document.createElement("canvas");
const ctx = sceneCanvas.getContext("2d");
const attackButton = document.getElementById("attack");
const fireballButton = document.getElementById("fireball");
const shieldButton = document.getElementById("shield");
const coinCounterEl = document.getElementById("coin-count");
const gameOverDialog = document.getElementById("game-over-panel");
document.addEventListener("contextmenu", event => event.preventDefault());
document.addEventListener("dragstart", event => event.preventDefault());
let shieldImage = null;
const shieldSource = new Image();
shieldSource.decoding = "async";
shieldSource.onload = () => {
  try {
    const processedShield = document.createElement("canvas");
    processedShield.width = shieldSource.naturalWidth;
    processedShield.height = shieldSource.naturalHeight;
    const shieldContext = processedShield.getContext("2d", { willReadFrequently: true });
    if (!shieldContext) throw new Error("Unable to create the shield processing context.");
    shieldContext.drawImage(shieldSource, 0, 0);
    const imageData = shieldContext.getImageData(0, 0, processedShield.width, processedShield.height);
    removeDarkBackground(imageData, processedShield.width, processedShield.height);
    shieldContext.putImageData(imageData, 0, 0);
    shieldImage = processedShield;
  } catch (error) {
    console.error("Unable to process player shield image.", error);
  }
};
shieldSource.onerror = () => console.error("Unable to load player shield image: ./assets/effects/shield.png");
shieldSource.src = "./assets/effects/shield.png";

if (!outputCtx || !ctx) throw new Error("Unable to initialize the game canvas.");

const SPRITE_W_UNITS = 1.6;
const SPRITE_H_UNITS = 1.6;
const pointers = new Map();
let lastTime = performance.now();
let villainsLoaded = false;
let enemiesInitialized = false;
let gameOver = false;
let dayCycleTime = 0;

function handlePlayerDeath() {
  if (gameOver) return;
  gameOver = true;
  losePlayerXP(20);
  clearInputs();
  pointers.clear();
  document.querySelectorAll("[data-dir]").forEach(button => button.classList.remove("active"));
  document.querySelectorAll(".action-buttons .active").forEach(button => button.classList.remove("active"));
  gameOverDialog.showModal();
}

function restartAfterGameOver() {
  gameOverDialog.close();
  gameOver = false;
  clearInputs();
  pointers.clear();
  clearFireballs();
  particles.length = 0;

  player.hp = player.maxHp;
  player.mana = player.maxMana;
  player.tileX = 0;
  player.tileY = 0;
  player.targetX = 0;
  player.targetY = 0;
  player.currentX = 0;
  player.currentY = 0;
  player.moveProgress = 0;
  player.isMoving = false;
  player.walkFrame = 0;
  player.attacking = false;
  player.attackFrame = 0;
  player.hasDealtDamage = false;
  player.invulnerableTimer = 0;
  player.shieldTimer = 0;
  player.initialized = true;
  document.querySelectorAll("[data-dir].active, .action-buttons .active")
    .forEach(button => button.classList.remove("active"));
  updatePlayerHUDHealth(player.hp, player.maxHp);
  updatePlayerHUDMana(player.mana, player.maxMana);

  if (villainsLoaded) {
    initEnemies(player);
    enemiesInitialized = true;
  }
  const foot = getPlayerFootWorldPos();
  globals.cameraX = foot.x - globals.viewW / 2;
  globals.cameraY = foot.y - globals.viewH / 2;
}

setPlayerDeathHandler(handlePlayerDeath);
document.getElementById("play-again").addEventListener("click", restartAfterGameOver);
gameOverDialog.addEventListener("cancel", event => event.preventDefault());

function updateHUD() {
  if (coinCounterEl) coinCounterEl.textContent = propState?.coinsCollectedCount ?? 0;
  if (shieldButton) {
    shieldButton.classList.toggle("active", player.shieldTimer > 0);
    shieldButton.title = player.shieldTimer > 0
      ? `Shield active (${player.shieldTimer.toFixed(1)}s remaining)`
      : "Shield (costs 1 mana, blocks attacks for 5 seconds)";
  }
  updatePlayerHUDHealth(player.hp, player.maxHp);
}

function handleAttackEnd() {
  if (attackButton) attackButton.classList.remove("active");
}

function handleAttackHit(playerObj) {
  checkPlayerAttackHit(playerObj);
}

function tryEnemyRangedAttack(enemy) {
  const fromX = enemy.currentX + 0.5;
  const fromY = enemy.currentY + 0.5;
  const targetX = player.currentX + 0.5;
  const targetY = player.currentY + 0.5;
  if (!canFireballReach(fromX, fromY, targetX, targetY)) return false;
  return launchFireball(enemy, "enemy");
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  globals.viewW = rect.width; 
  globals.viewH = rect.height;
  globals.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(globals.viewW * globals.dpr);
  canvas.height = Math.round(globals.viewH * globals.dpr);
  sceneCanvas.width = canvas.width;
  sceneCanvas.height = canvas.height;
  ctx.setTransform(globals.dpr, 0, 0, globals.dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  outputCtx.setTransform(globals.dpr, 0, 0, globals.dpr, 0, 0);

  globals.tile = Math.max(32, Math.min(56, Math.floor(Math.min(globals.viewW, globals.viewH) / 10 * 0.75)));

  if (!player.initialized) {
    player.tileX = 0; player.tileY = 0;
    player.targetX = 0; player.targetY = 0;
    player.currentX = 0; player.currentY = 0;
    player.initialized = true;

    const foot = getPlayerFootWorldPos();
    globals.cameraX = foot.x - globals.viewW / 2;
    globals.cameraY = foot.y - globals.viewH / 2;
  }
  if (villainsLoaded && !enemiesInitialized) {
    initEnemies(player);
    enemiesInitialized = true;
  }
  updateCamera();
  updateUIElements();
  updatePlayerHUDMana(player.mana, player.maxMana);
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
  updateEnemies(dt, player, tryEnemyRangedAttack);
  updateFireballs(dt, player);
  updateHUD();

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }

  updateCamera();
  updateSheep(
    dt,
    Math.floor(globals.cameraX / globals.tile) - 4,
    Math.ceil((globals.cameraX + globals.viewW) / globals.tile) + 4,
    Math.floor(globals.cameraY / globals.tile) - 4,
    Math.ceil((globals.cameraY + globals.viewH) / globals.tile) + 4
  );
}

function getBreeze(tx, ty, now) {
  return Math.sin(now * 0.0007 - tx * 0.22 + ty * 0.31);
}

function drawLowGrassTile(tx, ty, x, y, now) {
  if (grassSheet.ready && grassSheet.image) {
    const u = grassSheet.u;
    const v = getGrassVariation(tx, ty);
    ctx.imageSmoothingEnabled = false;

    ctx.drawImage(grassSheet.image, v.col * u, v.row * u, u, u, x, y, globals.tile, globals.tile);

    const decor = getGrassDecor(tx, ty);
    if (decor) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.translate(getBreeze(tx, ty, now) * 0.4, 0);
      ctx.drawImage(grassSheet.image, decor.col * u, decor.row * u, u, u, x, y, globals.tile, globals.tile);
      ctx.restore();
    }
  } else {
    ctx.fillStyle = "#8fc257";
    ctx.fillRect(x, y, globals.tile, globals.tile);
  }

}

function drawPondTile(tx, ty, x, y, now) {
  const pond = getPondAt(tx, ty);
  if (!pond) return;

  const centerX = (pond.x + 0.5) * globals.tile - globals.cameraX;
  const centerY = (pond.y + 0.5) * globals.tile - globals.cameraY;
  const bankWidth = globals.tile * 0.12;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(
    centerX,
    centerY,
    (pond.rx + 0.5) * globals.tile - bankWidth,
    (pond.ry + 0.5) * globals.tile - bankWidth,
    0,
    0,
    Math.PI * 2
  );
  ctx.clip();

  if (waterSheet.ready && waterSheet.image) {
    const frame = Math.floor(now / 300) % 4;
    const u = waterSheet.frameSize;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(waterSheet.image, frame * u, 0, u, u, x, y, globals.tile, globals.tile);
  } else {
    ctx.fillStyle = "#72c9d2";
    ctx.fillRect(x, y, globals.tile, globals.tile);
  }

  const decor = getWaterDecor(tx, ty);
  if (decor && objectsSheet.ready && objectsSheet.image) {
    const sprite = pondDecorSprites[decor];
    const size = globals.tile * 0.75;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      objectsSheet.image,
      sprite.sx, sprite.sy, sprite.sw, sprite.sh,
      Math.round(x + (globals.tile - size) / 2),
      Math.round(y + (globals.tile - size) / 2),
      size,
      size
    );
  }
  ctx.restore();
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

function drawWorld(now) {
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

      drawLowGrassTile(tx, ty, x, y, now);

      if (isWaterTile(tx, ty)) {
        drawPondTile(tx, ty, x, y, now);
      }

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
  const isSubmerged = isWaterTile(Math.round(player.currentX), Math.round(player.currentY));
  const visibleHeight = isSubmerged ? 0.6 : 1;
  const destH = globals.tile * SPRITE_H_UNITS * visibleHeight;
  const drawX = Math.round(footScreenX - destW * 0.5);
  const drawY = Math.round(footScreenY - destH);

  if (sheet && sheet.ready && sheet.image) {
    ctx.imageSmoothingEnabled = true;
    if (player.invulnerableTimer > 0 && Math.floor(performance.now() / 80) % 2 === 0) {
      ctx.save();
      ctx.filter = "brightness(2.2) sepia(1) saturate(5) hue-rotate(-50deg)";
      ctx.drawImage(
        sheet.image,
        frameX * sheet.fw, frameY * sheet.fh, sheet.fw, sheet.fh * visibleHeight,
        drawX, drawY, destW, destH
      );
      ctx.restore();
    } else {
      ctx.drawImage(
        sheet.image,
        frameX * sheet.fw, frameY * sheet.fh, sheet.fw, sheet.fh * visibleHeight,
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

function drawPlayerShield(footScreenX, footScreenY) {
  if (!shieldImage || player.shieldTimer <= 0) return;
  const size = globals.tile * 4.2;
  const pulse = 0.88 + Math.sin(performance.now() * 0.006) * 0.08;
  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    shieldImage,
    Math.round(footScreenX - size / 2),
    Math.round(footScreenY - size * 0.482 - globals.tile * 0.8),
    size,
    size
  );
  ctx.restore();
}

function drawMapObject(obj, now) {
  if (!objectsSheet.ready || !objectsSheet.image) return;
  const def = obj.def;
  const destW = globals.tile * def.wUnits;
  const destH = globals.tile * def.hUnits;

  const elev = getTileElevation(obj.tx, obj.ty);
  const screenX = (obj.tx + obj.def.wUnits * 0.5) * globals.tile - globals.cameraX;
  const screenY = (obj.ty + obj.def.footOffsetY - elev * 0.6) * globals.tile - globals.cameraY;

  if (obj.name.startsWith("TREE_") || obj.name.startsWith("BUSH_")) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.translate(screenX, screenY);
    ctx.rotate(getBreeze(obj.tx, obj.ty, now) * 0.012);
    ctx.drawImage(
      objectsSheet.image,
      def.sx, def.sy, def.sw, def.sh,
      -destW * 0.5, -destH, destW, destH
    );
    ctx.restore();
    return;
  }

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
  drawWorld(now);

  const minCol = Math.floor((globals.cameraX - globals.tile * 3) / globals.tile);
  const maxCol = Math.ceil((globals.cameraX + globals.viewW + globals.tile * 3) / globals.tile);
  const minRow = Math.floor((globals.cameraY - globals.tile * 3) / globals.tile);
  const maxRow = Math.ceil((globals.cameraY + globals.viewH + globals.tile * 6) / globals.tile);

  const coinFrameIdx = coinSheet.frames.length > 0 ? Math.floor((now / 85) % coinSheet.frames.length) : 0;

  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      if (hasCoinAt(c, r)) {
        const elev = getTileElevation(c, r);
        drawCoin((c + 0.5) * globals.tile, (r + 0.5 - elev * 0.6) * globals.tile, coinFrameIdx);
      }
    }
  }

  // --- Y-SORTED DEPTH RENDER QUEUE ---
  const renderQueue = [];
  const visibleSheep = getSheepInBounds(minCol - 2, maxCol + 2, minRow - 2, maxRow + 2);

  // 1. Add Player
  const playerFoot = getPlayerFootWorldPos();
  renderQueue.push({
    type: "PLAYER",
    footY: player.currentY + FOOT_OFFSET_Y,
    draw: () => {
      const screenX = playerFoot.x - globals.cameraX;
      const screenY = playerFoot.y - globals.cameraY;

      const characterAttack = player.characterAttackSheet;
      const characterWalk = player.characterWalkSheet;
      if (player.attacking && characterAttack?.ready) {
        drawPlayerSprite(characterAttack, player.attackFrame, player.dir, screenX, screenY);
      } else {
        drawPlayerSprite(characterWalk, player.isMoving ? player.walkFrame : 0, player.dir, screenX, screenY);
      }
      drawPlayerShield(screenX, screenY);
    }
  });

  // 2. Add Map Objects
  for (let r = minRow - 2; r <= maxRow + 2; r++) {
    for (let c = minCol - 2; c <= maxCol + 2; c++) {
      const obj = getMapObjectAt(c, r);
      if (obj && obj.name !== "SHEEP") {
        renderQueue.push({
          type: "OBJECT",
          footY: obj.footY,
          draw: () => drawMapObject(obj, now)
        });
      }
    }
  }

  for (const sheep of visibleSheep) {
    renderQueue.push({
      type: "SHEEP",
      footY: sheep.y + 1,
      draw: () => drawSheep(ctx, sheep, now)
    });
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

  renderQueue.sort((a, b) => a.footY - b.footY);
  for (const item of renderQueue) item.draw();
  drawFireballVisuals(ctx);

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

  const dayColor = getTimeOfDayColor(dayCycleTime);
  outputCtx.clearRect(0, 0, globals.viewW, globals.viewH);
  outputCtx.imageSmoothingEnabled = false;
  outputCtx.drawImage(sceneCanvas, 0, 0, globals.viewW, globals.viewH);
  outputCtx.save();
  outputCtx.globalCompositeOperation = "multiply";
  outputCtx.globalAlpha = dayColor.alpha;
  outputCtx.fillStyle = `rgb(${dayColor.color.join(",")})`;
  outputCtx.fillRect(0, 0, globals.viewW, globals.viewH);
  outputCtx.restore();
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  if (!document.querySelector("dialog[open]")) {
    update(dt);
    dayCycleTime += dt * 1000;
  }
  draw(now);
}

function keyDirection(code) {
  if (code === "ArrowUp" || code === "KeyW") return "up";
  if (code === "ArrowDown" || code === "KeyS") return "down";
  if (code === "ArrowLeft" || code === "KeyA") return "left";
  if (code === "ArrowRight" || code === "KeyD") return "right";
  return null;
}

window.addEventListener("keydown", e => {
  if (document.querySelector("dialog[open]")) return;
  const dir = keyDirection(e.code);
  if (dir) { pushDir(dir); e.preventDefault(); }
  if ((e.code === "Space" || e.code === "Enter") && !e.repeat) {
    e.preventDefault(); 
    if (beginAttack() && attackButton) attackButton.classList.add("active");
  }
  if (e.code === "KeyF" && !e.repeat) {
    e.preventDefault();
    if (launchFireball(player) && fireballButton) fireballButton.classList.add("active");
  }
  if (e.code === "KeyQ" && !e.repeat) {
    e.preventDefault();
    if (activatePlayerShield() && shieldButton) shieldButton.classList.add("active");
  }
  if (e.code === "Escape") {
    e.preventDefault();
    document.getElementById("pause-panel").showModal();
  }
});

window.addEventListener("keyup", e => {
  const dir = keyDirection(e.code);
  if (dir) { removeDir(dir); e.preventDefault(); }
  if (e.code === "KeyF" && fireballButton) fireballButton.classList.remove("active");
});

window.addEventListener("blur", () => {
  clearInputs();
  pointers.clear();
  document.querySelectorAll("[data-dir]").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".action-btn").forEach(b => b.classList.remove("active"));
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

if (fireballButton) {
  fireballButton.addEventListener("pointerdown", e => {
    e.preventDefault();
    if (launchFireball(player)) fireballButton.classList.add("active");
  });
  fireballButton.addEventListener("pointerup", () => fireballButton.classList.remove("active"));
  fireballButton.addEventListener("pointercancel", () => fireballButton.classList.remove("active"));
}

if (shieldButton) {
  const activateShield = () => {
    if (activatePlayerShield()) shieldButton.classList.add("active");
  };
  shieldButton.addEventListener("pointerdown", event => {
    event.preventDefault();
    activateShield();
  });
  shieldButton.addEventListener("click", activateShield);
}

initializePanels();

function startGame() {
  resize();
  requestAnimationFrame(loop);

  loadVillains().then(() => {
    villainsLoaded = true;
    initializeCharacterRoster();
    if (!enemiesInitialized) {
      initEnemies(player);
      enemiesInitialized = true;
    }
  }).catch(error => {
    console.error("Unable to load the full character roster.", error);
  });
}

startGame();
