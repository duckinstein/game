import { globals, tryLoadImage } from './globals.js';
import { isHighlandPlateau, isCliff, isStairs, getTileElevation, getHighlandAt } from './world.js';

export const objectsSheet = {
  image: null,
  ready: false,
  u: 16,
  types: {
    TREE_REGULAR: { sx: 16, sy: 0, sw: 32, sh: 32, wUnits: 2, hUnits: 2.2, footOffsetY: 1.8, solid: true },
    TREE_FRUIT:   { sx: 48, sy: 0, sw: 32, sh: 32, wUnits: 2, hUnits: 2.2, footOffsetY: 1.8, solid: true },
    TREE_TALL:    { sx: 0,  sy: 0, sw: 16, sh: 32, wUnits: 1, hUnits: 2.2, footOffsetY: 1.8, solid: true },
    STUMP_1:      { sx: 48, sy: 32, sw: 16, sh: 16, wUnits: 1, hUnits: 1.0, footOffsetY: 0.8, solid: true },
    STUMP_2:      { sx: 64, sy: 32, sw: 16, sh: 16, wUnits: 1, hUnits: 1.0, footOffsetY: 0.8, solid: true },
    ROCK_BIG:     { sx: 112, sy: 16, sw: 16, sh: 16, wUnits: 1, hUnits: 1.0, footOffsetY: 0.8, solid: true },
    ROCK_SMALL:   { sx: 96, sy: 16, sw: 16, sh: 16, wUnits: 1, hUnits: 0.8, footOffsetY: 0.6, solid: false },
    BUSH_REGULAR: { sx: 0,  sy: 48, sw: 16, sh: 16, wUnits: 1, hUnits: 1.0, footOffsetY: 0.8, solid: false },
    BUSH_BERRY:   { sx: 64, sy: 48, sw: 16, sh: 16, wUnits: 1, hUnits: 1.0, footOffsetY: 0.8, solid: false },
    MUSHROOM:     { sx: 80, sy: 0,  sw: 16, sh: 16, wUnits: 1, hUnits: 0.8, footOffsetY: 0.5, solid: false },
    SUNFLOWER:    { sx: 128, sy: 32, sw: 16, sh: 32, wUnits: 1, hUnits: 2.0, footOffsetY: 1.8, solid: false }
  }
};

tryLoadImage([
  "./nature.png", "./Nature.png",
  "./Basic Grass Biom things 1.png",
  "./basic_grass_biom_things_1.png",
  "./objects.png"
], (img) => {
  objectsSheet.image = img;
  let scale = img.naturalWidth / 224;
  if (scale < 1) scale = 1;
  objectsSheet.u = 16 * scale;
  objectsSheet.ready = true;
});

export const coinSheet = { ready: false, frames: [] };

tryLoadImage(["./coins.png", "./coin.png"], (img) => {
  const oc = document.createElement("canvas");
  oc.width = img.naturalWidth;
  oc.height = img.naturalHeight;
  const octx = oc.getContext("2d", { willReadFrequently: true });
  octx.drawImage(img, 0, 0);

  const W = oc.width, H = oc.height;
  const data = octx.getImageData(0, 0, W, H).data;

  const bgR = data[0], bgG = data[1], bgB = data[2], bgA = data[3];
  const isDarkBg = bgA > 200 && (bgR < 50 && bgG < 50 && bgB < 80);

  if (isDarkBg) {
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - bgR) < 32 && Math.abs(data[i + 1] - bgG) < 32 && Math.abs(data[i + 2] - bgB) < 32) {
        data[i + 3] = 0;
      }
    }
    octx.putImageData(new ImageData(data, W, H), 0, 0);
  }

  const colCounts = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (data[(y * W + x) * 4 + 3] > 20) colCounts[x]++;
    }
  }

  let inCoin = false, startX = 0;
  for (let x = 0; x < W; x++) {
    if (!inCoin && colCounts[x] > 0) { inCoin = true; startX = x; }
    else if (inCoin && colCounts[x] === 0) {
      inCoin = false;
      if (x - startX > 4) addFrame(startX, x - 1);
    }
  }
  if (inCoin && W - startX > 4) addFrame(startX, W - 1);

  function addFrame(x1, x2) {
    let minY = H, maxY = 0;
    for (let y = 0; y < H; y++) {
      for (let x = x1; x <= x2; x++) {
        if (data[(y * W + x) * 4 + 3] > 20) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (minY <= maxY) {
      coinSheet.frames.push({
        canvas: oc,
        sx: x1, sy: minY,
        sw: x2 - x1 + 1,
        sh: maxY - minY + 1
      });
    }
  }
  coinSheet.ready = coinSheet.frames.length > 0;
});

export function getMapObjectAt(tx, ty) {
  if ((Math.abs(tx) <= 1 && Math.abs(ty) <= 1) || isCliff(tx, ty) || isStairs(tx, ty)) return null;

  const h = getHighlandAt(tx, ty);
  if (h && (tx === h.stairX1 || tx === h.stairX2) && (ty >= h.y1 - 1 && ty <= h.cliffY + 2)) {
    return null;
  }

  const hVal = Math.sin(tx * 12.9898 + ty * 78.233) * 43758.5453;
  const rand = Math.abs(hVal - Math.floor(hVal));
  const typeKeys = Object.keys(objectsSheet.types);
  if (rand < 0.04) {
    const typeIndex = Math.floor((rand * 1000) % typeKeys.length);
    const typeName = typeKeys[typeIndex];
    const def = objectsSheet.types[typeName];
    return { name: typeName, def, tx, ty, footY: ty + def.footOffsetY, key: `${tx},${ty}` };
  }
  return null;
}

export function hasObjectCollision(tx, ty) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -2; dy <= 1; dy++) {
      const obj = getMapObjectAt(tx + dx, ty + dy);
      if (obj && obj.def.solid) {
        if (obj.def.wUnits === 2) {
          if ((tx === obj.tx || tx === obj.tx + 1) && (ty === obj.ty + 1)) return true;
        } else {
          if (obj.tx === tx && obj.ty === ty) return true;
        }
      }
    }
  }
  return false;
}

// Solid Enemy Physical Collision Handler
let enemySolidChecker = null;
export function setEnemySolidChecker(fn) {
  enemySolidChecker = fn;
}

export function canStep(fromX, fromY, toX, toY, isPlayer = false) {
  if (isCliff(toX, toY) || hasObjectCollision(toX, toY)) return false;

  // Solid enemy collision blocking player
  if (isPlayer && enemySolidChecker && enemySolidChecker(toX, toY)) {
    return false;
  }

  if (isStairs(toX, toY) || isStairs(fromX, fromY)) return true;

  const fromHigh = isHighlandPlateau(fromX, fromY);
  const toHigh = isHighlandPlateau(toX, toY);

  if (!fromHigh && toHigh) return false;
  if (fromHigh && !toHigh) return true;

  return true;
}

export const propState = { coinsCollectedCount: 0 };
export let coinsCollectedCount = 0;
export const collectedCoins = new Set();
export const particles = [];

export function hasCoinAt(tx, ty) {
  if (isCliff(tx, ty) || isStairs(tx, ty) || hasObjectCollision(tx, ty)) return false;
  const key = `${tx},${ty}`;
  if (collectedCoins.has(key)) return false;

  const hVal = Math.sin(tx * 91.13 + ty * 23.47) * 43758.5453;
  const rand = hVal - Math.floor(hVal);
  if (isHighlandPlateau(tx, ty)) return rand < 0.16;
  return rand < 0.06;
}

export function checkCoinPickup(tx, ty, updateHUDCallback) {
  const key = `${tx},${ty}`;
  if (hasCoinAt(tx, ty)) {
    collectedCoins.add(key);
    propState.coinsCollectedCount++;
    coinsCollectedCount = propState.coinsCollectedCount;
    if (updateHUDCallback) updateHUDCallback(propState.coinsCollectedCount);

    const elev = getTileElevation(tx, ty);
    particles.push({
      x: (tx + 0.5) * globals.tile,
      y: (ty + 0.5) * globals.tile - (elev * globals.tile * 0.6),
      vy: -globals.tile * 1.6,
      life: 0.65,
      maxLife: 0.65
    });
  }
}
