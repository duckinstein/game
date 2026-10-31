import { globals, tryLoadImage } from './globals.js';

// --- 1. ASSET HOLDERS ---
export const uiSheet = { ready: false, frames: {} };
export const playerHealthSheet = { ready: false, frames: [], canvas: null };
export const enemyHealthSheet = { ready: false, frames: [], canvas: null };
export const attackBtnSheet = { ready: false, dataUrl: null };
let actionCircleCanvas = null;
let playerManaHud = { current: 100, max: 100 };

// --- 2. FLOOD-FILL BACKGROUND REMOVAL & AUTOTRIM ---
function processOffscreenCanvas(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  const W = c.width, H = c.height;
  const imgData = ctx.getImageData(0, 0, W, H);
  const data = imgData.data;

  // Check if background is white/light
  const isWhiteBg = data[3] > 200 && data[0] > 240 && data[1] > 240 && data[2] > 240;

  if (isWhiteBg) {
    const visited = new Uint8Array(W * H);
    const queue = [];

    function checkAndPush(x, y) {
      if (x < 0 || x >= W || y < 0 || y >= H) return;
      const idx = y * W + x;
      if (visited[idx]) return;
      visited[idx] = 1;
      const pIdx = idx * 4;
      if (data[pIdx + 3] > 20 && data[pIdx] > 230 && data[pIdx + 1] > 230 && data[pIdx + 2] > 230) {
        queue.push(x, y);
      }
    }

    // Seed borders
    for (let x = 0; x < W; x++) { checkAndPush(x, 0); checkAndPush(x, H - 1); }
    for (let y = 0; y < H; y++) { checkAndPush(0, y); checkAndPush(W - 1, y); }

    let head = 0;
    while (head < queue.length) {
      const x = queue[head++];
      const y = queue[head++];
      const pIdx = (y * W + x) * 4;
      data[pIdx + 3] = 0; // Make transparent

      checkAndPush(x + 1, y);
      checkAndPush(x - 1, y);
      checkAndPush(x, y + 1);
      checkAndPush(x, y - 1);
    }
    ctx.putImageData(imgData, 0, 0);
  }

  return { canvas: c, ctx, width: W, height: H, data };
}

// Scans an area and finds tight bounding box of non-transparent pixels
function findTightBounds(data, W, x1, y1, x2, y2) {
  let minX = x2, maxX = x1, minY = y2, maxY = y1;
  let found = false;

  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const idx = (y * W + x) * 4;
      if (data[idx + 3] > 30) { // non-transparent
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!found) return null;
  return { sx: minX, sy: minY, sw: maxX - minX + 1, sh: maxY - minY + 1 };
}

// --- 3. LOAD & PARSE PLAYER_HP.PNG (Player Health Bar - 2 cols x 3 rows) ---
tryLoadImage(["./assets/ui/player-health.png", "./assets/ui/legacy/player-health.png"], (img) => {
  const { canvas, width: W, height: H, data } = processOffscreenCanvas(img);
  playerHealthSheet.canvas = canvas;
  playerHealthSheet.frames = [];

  const midX = Math.floor(W / 2);
  const rowH = Math.floor(H / 3);

  // Column 0: 100%, 80%, 60%
  for (let r = 0; r < 3; r++) {
    const b = findTightBounds(data, W, 0, r * rowH, midX - 1, (r + 1) * rowH - 1);
    if (b) playerHealthSheet.frames.push(b);
  }
  // Column 1: 40%, 20%, 0%
  for (let r = 0; r < 3; r++) {
    const b = findTightBounds(data, W, midX, r * rowH, W - 1, (r + 1) * rowH - 1);
    if (b) playerHealthSheet.frames.push(b);
  }

  playerHealthSheet.ready = playerHealthSheet.frames.length >= 6;
  updatePlayerHUDHealth(100, 100);
  updatePlayerHUDMana(playerManaHud.current, playerManaHud.max);
});

// --- 4. LOAD & PARSE ENEMY_HEALTH.PNG (Enemy Health Bar - 11 vertical rows) ---
tryLoadImage(["./assets/ui/enemy-health.png", "./assets/ui/legacy/enemy-health.png"], (img) => {
  const { canvas, width: W, height: H, data } = processOffscreenCanvas(img);
  enemyHealthSheet.canvas = canvas;
  enemyHealthSheet.frames = [];

  const rowCounts = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 30) rowCounts[y]++;
    }
  }

  // Scan contiguous vertical bars
  let inBar = false, startY = 0;
  for (let y = 0; y < H; y++) {
    if (!inBar && rowCounts[y] > 5) {
      inBar = true;
      startY = y;
    } else if (inBar && rowCounts[y] <= 5) {
      inBar = false;
      if (y - startY > 4) {
        const b = findTightBounds(data, W, 0, startY, W - 1, y - 1);
        if (b) enemyHealthSheet.frames.push(b);
      }
    }
  }
  if (inBar && H - startY > 4) {
    const b = findTightBounds(data, W, 0, startY, W - 1, H - 1);
    if (b) enemyHealthSheet.frames.push(b);
  }

  enemyHealthSheet.ready = enemyHealthSheet.frames.length > 0;
});

// --- 5. LOAD & PARSE UI.PNG (3x3 Controls Grid) ---
tryLoadImage(["./assets/ui/controls-and-hud.png"], (img) => {
  const { canvas, width: W, height: H, data } = processOffscreenCanvas(img);
  function getTrimmed(c, r) {
    const x1 = Math.floor(c * W / 3);
    const y1 = Math.floor(r * H / 3);
    const x2 = Math.floor((c + 1) * W / 3) - 1;
    const y2 = Math.floor((r + 1) * H / 3) - 1;
    const b = findTightBounds(data, W, x1, y1, x2, y2);
    if (!b) return null;
    const oc = document.createElement("canvas");
    oc.width = b.sw; oc.height = b.sh;
    const octx = oc.getContext("2d");
    octx.drawImage(canvas, b.sx, b.sy, b.sw, b.sh, 0, 0, b.sw, b.sh);
    return oc.toDataURL();
  }

  uiSheet.frames = {
    down: getTrimmed(0, 0),
    right: getTrimmed(1, 0),
    up: getTrimmed(2, 0),
    left: getTrimmed(0, 1),
    circle: getTrimmed(1, 1),
    goldBox: getTrimmed(2, 1),
    coin: getTrimmed(1, 2)
  };
  uiSheet.ready = true;
  updateUIElements();
});

// --- 6. LOAD & COMPOSITE ATTACK BUTTON (Sword inside Circle) ---
tryLoadImage(["./assets/ui/attack-button.png"], (img) => {
  const { canvas, width: W, height: H, data } = processOffscreenCanvas(img);

  const splitX = Math.floor(W * 0.58);
  const swordBounds = findTightBounds(data, W, 0, 0, splitX - 1, H - 1);
  const circleBounds = findTightBounds(data, W, splitX, 0, W - 1, H - 1);

  const btnCanvas = document.createElement("canvas");
  btnCanvas.width = 72; btnCanvas.height = 72;
  const bctx = btnCanvas.getContext("2d");
  bctx.imageSmoothingEnabled = false;

  actionCircleCanvas = document.createElement("canvas");
  actionCircleCanvas.width = 72;
  actionCircleCanvas.height = 72;
  const circleCtx = actionCircleCanvas.getContext("2d");
  circleCtx.imageSmoothingEnabled = false;
  if (circleBounds) {
    circleCtx.drawImage(canvas, circleBounds.sx, circleBounds.sy, circleBounds.sw, circleBounds.sh, 2, 2, 68, 68);
  } else {
    drawProceduralCircle(circleCtx, 72);
  }
  bctx.drawImage(actionCircleCanvas, 0, 0);

  // 2. Tint sword to dark brown (#3a1406) and center it
  if (swordBounds) {
    const sc = document.createElement("canvas");
    sc.width = swordBounds.sw; sc.height = swordBounds.sh;
    const sctx = sc.getContext("2d");
    sctx.drawImage(canvas, swordBounds.sx, swordBounds.sy, swordBounds.sw, swordBounds.sh, 0, 0, sc.width, sc.height);

    const sData = sctx.getImageData(0, 0, sc.width, sc.height);
    for (let i = 0; i < sData.data.length; i += 4) {
      if (sData.data[i + 3] > 30) {
        sData.data[i] = 0x3a;     // Red
        sData.data[i + 1] = 0x14; // Green
        sData.data[i + 2] = 0x06; // Blue
      }
    }
    sctx.putImageData(sData, 0, 0);

    const swordSize = 52;
    const swordScale = Math.min(swordSize / sc.width, swordSize / sc.height);
    const swordW = Math.round(sc.width * swordScale);
    const swordH = Math.round(sc.height * swordScale);
    bctx.drawImage(sc, Math.round((72 - swordW) / 2), Math.round((72 - swordH) / 2) - 1, swordW, swordH);
  } else {
    drawProceduralSword(bctx, 72);
  }

  attackBtnSheet.dataUrl = btnCanvas.toDataURL();
  attackBtnSheet.ready = true;
  updateAttackButton();
  updateFireballButton();
});

function drawProceduralCircle(ctx, size) {
  const r = size / 2;
  ctx.fillStyle = "#843e26";
  ctx.beginPath(); ctx.arc(r, r + 3, r - 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#c37b58";
  ctx.beginPath(); ctx.arc(r, r - 1, r - 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#431c0e";
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawProceduralSword(ctx, size) {
  ctx.save();
  ctx.translate(size / 2, size / 2 - 1);
  ctx.strokeStyle = "#3a1406";
  ctx.fillStyle = "#3a1406";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";

  // Slash arc
  ctx.beginPath(); ctx.arc(0, 0, 18, -Math.PI * 0.7, Math.PI * 0.35); ctx.stroke();
  // Blade
  ctx.beginPath(); ctx.moveTo(-11, -11); ctx.lineTo(11, 11); ctx.stroke();
  // Guard
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-14, -8); ctx.lineTo(-8, -14); ctx.stroke();
  ctx.restore();
}

// Fallback arrow generator
function generateProceduralArrow(dir) {
  const c = document.createElement("canvas");
  c.width = 36; c.height = 36;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  ctx.save();
  ctx.translate(18, 18);
  if (dir === "right") ctx.rotate(Math.PI / 2);
  if (dir === "up")    ctx.rotate(Math.PI);
  if (dir === "left")  ctx.rotate(-Math.PI / 2);

  ctx.fillStyle = "#843e26";
  ctx.beginPath();
  ctx.moveTo(-6, -12); ctx.lineTo(6, -12); ctx.lineTo(6, 1);
  ctx.lineTo(14, 1); ctx.lineTo(0, 15); ctx.lineTo(-14, 1); ctx.lineTo(-6, 1);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = "#c37b58";
  ctx.beginPath();
  ctx.moveTo(-6, -12); ctx.lineTo(6, -12); ctx.lineTo(6, 0);
  ctx.lineTo(14, 0); ctx.lineTo(0, 13); ctx.lineTo(-14, 0); ctx.lineTo(-6, 0);
  ctx.closePath(); ctx.fill();

  ctx.strokeStyle = "#431c0e";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  return c.toDataURL();
}

export function updateUIElements() {
  document.querySelectorAll("[data-dir]").forEach(btn => {
    const dir = btn.dataset.dir;
    const url = (uiSheet.ready && uiSheet.frames[dir]) ? uiSheet.frames[dir] : generateProceduralArrow(dir);
    btn.style.backgroundImage = `url("${url}")`;
  });

  const coinIcon = document.getElementById("coin-icon-img");
  if (coinIcon) {
    if (uiSheet.ready && uiSheet.frames.coin) {
      coinIcon.src = uiSheet.frames.coin;
    } else {
      coinIcon.src = generateProceduralCoin();
    }
  }

  updateAttackButton();
  updateFireballButton();
}

export function updateAttackButton() {
  const attackBtn = document.getElementById("attack");
  if (!attackBtn) return;

  if (attackBtnSheet.ready && attackBtnSheet.dataUrl) {
    attackBtn.style.backgroundImage = `url("${attackBtnSheet.dataUrl}")`;
  } else {
    const c = document.createElement("canvas");
    c.width = 72; c.height = 72;
    const ctx = c.getContext("2d");
    drawProceduralCircle(ctx, 72);
    drawProceduralSword(ctx, 72);
    attackBtn.style.backgroundImage = `url("${c.toDataURL()}")`;
  }
}

export function updateFireballButton() {
  const fireballBtn = document.getElementById("fireball");
  if (!fireballBtn) return;

  const circleUrl = actionCircleCanvas
    ? actionCircleCanvas.toDataURL()
    : (() => {
        const canvas = document.createElement("canvas");
        canvas.width = 72;
        canvas.height = 72;
        drawProceduralCircle(canvas.getContext("2d"), 72);
        return canvas.toDataURL();
      })();
  fireballBtn.style.backgroundImage = `url("./assets/effects/fireball.gif"), url("${circleUrl}")`;
  fireballBtn.style.backgroundSize = "68% auto, 100% 100%";
  fireballBtn.style.backgroundPosition = "center";
  fireballBtn.style.backgroundRepeat = "no-repeat";
}

function generateProceduralCoin() {
  const c = document.createElement("canvas");
  c.width = 30; c.height = 30;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#431c0e";
  ctx.beginPath(); ctx.arc(15, 15, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#f8b724";
  ctx.beginPath(); ctx.arc(15, 15, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffe266";
  ctx.beginPath(); ctx.arc(14, 14, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#b8720e";
  ctx.fillRect(14, 10, 3, 9);
  return c.toDataURL();
}

// --- 7. LARGE, CLEAR PLAYER HEALTH BAR (0 to 5 Stages) ---
export function updatePlayerHUDHealth(currentHp, maxHp) {
  drawPlayerResourceBar("player-health-canvas", currentHp, maxHp, false);
}

export function updatePlayerHUDMana(currentMana, maxMana) {
  playerManaHud = { current: currentMana, max: maxMana };
  drawPlayerResourceBar("player-mana-canvas", currentMana, maxMana, true);
}

function drawPlayerResourceBar(canvasId, current, max, blueTint) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const ratio = Math.max(0, Math.min(1, current / max));

  // 6 Stages from 100% to 0%
  let stage = 0;
  if (ratio >= 0.85)      stage = 0;
  else if (ratio >= 0.65) stage = 1;
  else if (ratio >= 0.45) stage = 2;
  else if (ratio >= 0.25) stage = 3;
  else if (ratio > 0.05)  stage = 4;
  else                    stage = 5;

  if (playerHealthSheet.ready && playerHealthSheet.frames[stage]) {
    const f = playerHealthSheet.frames[stage];
    const scale = Math.min(canvas.width / f.sw, canvas.height / f.sh);
    const destW = Math.round(f.sw * scale);
    const destH = Math.round(f.sh * scale);
    const destX = Math.round((canvas.width - destW) / 2);
    const destY = Math.round((canvas.height - destH) / 2);

    ctx.save();
    if (blueTint) ctx.filter = "hue-rotate(190deg) saturate(1.5)";
    ctx.drawImage(playerHealthSheet.canvas, f.sx, f.sy, f.sw, f.sh, destX, destY, destW, destH);
    ctx.restore();
    return;
  }

  // Large Procedural Fallback matching Image 1
  const heartW = 28, barW = canvas.width - heartW - 8, barH = 20;
  const barX = canvas.width - barW, barY = Math.round((canvas.height - barH) / 2);

  // Heart
  ctx.fillStyle = ratio > 0.2 ? (blueTint ? "#278de0" : "#e62238") : "#444";
  ctx.beginPath();
  ctx.arc(barX - 18, barY + 7, 7, 0, Math.PI * 2);
  ctx.arc(barX - 8, barY + 7, 7, 0, Math.PI * 2);
  ctx.fill();

  // 5-Segment Pill Bar
  ctx.fillStyle = "#1b191c";
  ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
  ctx.fillStyle = "#2c2d38";
  ctx.fillRect(barX, barY, barW, barH);

  const segments = 5;
  const segW = Math.floor((barW - (segments - 1) * 2) / segments);
  const activeSegs = Math.round(ratio * segments);

  for (let s = 0; s < segments; s++) {
    const sx = barX + s * (segW + 2);
    if (s < activeSegs) {
      ctx.fillStyle = blueTint ? "#278de0" : "#e62238";
      ctx.fillRect(sx, barY, segW, barH);
      ctx.fillStyle = blueTint ? "#86d9ff" : "#ff7d8d";
      ctx.fillRect(sx, barY, segW, 3);
    }
  }
}

// --- 8. ENEMY HEALTH BAR (11 Stages, Zero Clipping) ---
export function drawEnemyHealthBar(ctx, screenX, screenY, ratio) {
  const totalStages = 11;
  const stage = Math.max(0, Math.min(totalStages - 1, Math.round((1 - ratio) * (totalStages - 1))));

  if (enemyHealthSheet.ready && enemyHealthSheet.frames[stage]) {
    const f = enemyHealthSheet.frames[stage];
    const barW = Math.round(globals.tile * 1.15); // ~55px wide
    const barH = Math.round(barW * (f.sh / f.sw));
    const barX = Math.round(screenX - barW / 2);
    const barY = Math.round(screenY);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(enemyHealthSheet.canvas, f.sx, f.sy, f.sw, f.sh, barX, barY, barW, barH);
    return;
  }

  // Fallback matching Image 2
  const barW = Math.round(globals.tile * 1.05);
  const barH = 8;
  const barX = Math.round(screenX - barW / 2);
  const barY = Math.round(screenY);

  ctx.fillStyle = "#1b191c";
  ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
  ctx.fillStyle = "#e89f30";
  ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
  ctx.fillStyle = "#b0c4de";
  ctx.fillRect(barX, barY, barW, barH);

  const fillW = Math.round(barW * ratio);
  if (fillW > 0) {
    ctx.fillStyle = "#e62238";
    ctx.fillRect(barX, barY, fillW, barH);
    ctx.fillStyle = "#ff7d8d";
    ctx.fillRect(barX, barY, fillW, 2);
  }
}