import { globals, tryLoadImage } from './globals.js';
import { playSound } from './audio.js';
import { isHighlandPlateau, isCliff, isStairs, getTileElevation, getHighlandAt, isWaterTile } from './world.js';
import { damageSheep, getSheepAtWorld } from './sheep.js';


export const objectsSheet = {
  image: null,
  ready: false,
  u: 16,
  types: {
    TREE_1:       { spriteKey: "tree1", wUnits: 3, hUnits: 4, footOffsetY: 1, solid: true, collisionOffsetX: 1 },
    TREE_2:       { spriteKey: "tree2", wUnits: 3, hUnits: 4, footOffsetY: 1, solid: true, collisionOffsetX: 1 },
    TREE_3:       { spriteKey: "tree3", wUnits: 3, hUnits: 3, footOffsetY: 1, solid: true, collisionOffsetX: 1 },
    TREE_4:       { spriteKey: "tree4", wUnits: 3, hUnits: 3, footOffsetY: 1, solid: true, collisionOffsetX: 1 },
    STUMP_1:      { spriteKey: "stump1", wUnits: 3, hUnits: 4, footOffsetY: 1, solid: true, collisionOffsetX: 1 },
    STUMP_2:      { spriteKey: "stump2", wUnits: 3, hUnits: 4, footOffsetY: 1, solid: true, collisionOffsetX: 1 },
    STUMP_3:      { spriteKey: "stump3", wUnits: 3, hUnits: 4, footOffsetY: 1, solid: true, collisionOffsetX: 1 },
    STUMP_4:      { spriteKey: "stump4", wUnits: 3, hUnits: 4, footOffsetY: 1, solid: true, collisionOffsetX: 1 },
    ROCK_BIG:     { sx: 112, sy: 16, sw: 16, sh: 16, wUnits: 1, hUnits: 1.0, footOffsetY: 0.8, solid: true },
    ROCK_SMALL:   { sx: 96, sy: 16, sw: 16, sh: 16, wUnits: 1, hUnits: 0.8, footOffsetY: 0.6, solid: false },
    BUSH_1:       { spriteKey: "bush1", wUnits: 2, hUnits: 2, footOffsetY: 1, solid: false },
    BUSH_2:       { spriteKey: "bush2", wUnits: 2, hUnits: 2, footOffsetY: 1, solid: false },
    BUSH_3:       { spriteKey: "bush3", wUnits: 2, hUnits: 2, footOffsetY: 1, solid: false },
    BUSH_4:       { spriteKey: "bush4", wUnits: 2, hUnits: 2, footOffsetY: 1, solid: false },
    BUSH_BERRY:   { spriteKey: "bush3", wUnits: 2, hUnits: 2, footOffsetY: 1, solid: false },
    MUSHROOM:     { sx: 80, sy: 0,  sw: 16, sh: 16, wUnits: 1, hUnits: 0.8, footOffsetY: 0.5, solid: false },
  }
};

export const objectSprites = {};

const changedObjects = new Map();
const FOOD_OBJECT_TYPES = ["BUSH_BERRY", "MUSHROOM"];
const SCENERY_OBJECT_TYPES = Object.keys(objectsSheet.types)
  .filter(type => !FOOD_OBJECT_TYPES.includes(type) && !type.startsWith("STUMP_"));

function isObjectTileExcluded(tx, ty) {
  if ((Math.abs(tx) <= 1 && Math.abs(ty) <= 1) || isCliff(tx, ty) || isStairs(tx, ty) || isWaterTile(tx, ty)) return true;

  const h = getHighlandAt(tx, ty);
  return h && (tx === h.stairX1 || tx === h.stairX2) && (ty >= h.y1 - 1 && ty <= h.cliffY + 2);
}

function loadObjectSprite(key, path, frameCount, frameWidth, frameHeight) {
  const sheet = { image: null, ready: false, frameCount, frameWidth, frameHeight };
  objectSprites[key] = sheet;
  tryLoadImage([path], (image) => {
    if (image.naturalWidth !== frameCount * frameWidth || image.naturalHeight !== frameHeight) {
      console.error(`Unexpected sprite sheet dimensions for ${path}.`);
      return;
    }
    sheet.image = image;
    sheet.ready = true;
  });
}

for (const [key, file, frameHeight] of [
  ["tree1", "Tree1.png", 256],
  ["tree2", "Tree2.png", 256],
  ["tree3", "Tree3.png", 192],
  ["tree4", "Tree4.png", 192]
]) {
  loadObjectSprite(key, `./assets/world/w2/${file}`, 8, 192, frameHeight);
}

for (let variant = 1; variant <= 4; variant++) {
  loadObjectSprite(
    `bush${variant}`,
    `./assets/world/w2/Bushe${variant}.png`,
    8,
    128,
    128
  );
  loadObjectSprite(
    `stump${variant}`,
    `./assets/world/w2/Stump ${variant}.png`,
    1,
    192,
    256
  );
}

function objectTypeRoll(tx, ty) {
  const value = Math.sin(tx * 12.9898 + ty * 78.233 + 43.17) * 43758.5453;
  return value - Math.floor(value);
}

export const pondDecorSprites = {
  lily: { sx: 128, sy: 64, sw: 16, sh: 16 },
  flower: { sx: 112, sy: 32, sw: 16, sh: 16 }
};

function getGeneratedMapObjectAt(tx, ty) {
  if (isObjectTileExcluded(tx, ty)) return null;
  const hVal = Math.sin(tx * 12.9898 + ty * 78.233) * 43758.5453;
  const rand = Math.abs(hVal - Math.floor(hVal));
  const key = `${tx},${ty}`;
  if (changedObjects.has(key)) return changedObjects.get(key);

  if (rand >= 0.04) return null;

  const typeRoll = objectTypeRoll(tx, ty);
  const foodType = typeRoll < 0.1;
  const typeKeys = foodType ? FOOD_OBJECT_TYPES : SCENERY_OBJECT_TYPES;
  const selectionRoll = objectTypeRoll(tx + 137, ty - 251);
  const typeName = typeKeys[Math.floor(selectionRoll * typeKeys.length)];
  const def = objectsSheet.types[typeName];
  return { name: typeName, def, tx, ty, footY: ty + def.footOffsetY, key };
}

export function isSheepBlockedAt(x, y) {
  const left = x - 0.5;
  const right = x + 1.5;
  const top = y - 1;
  const bottom = y + 1;
  for (let ty = Math.floor(top) - 4; ty <= Math.floor(bottom); ty++) {
    for (let tx = Math.floor(left) - 3; tx <= Math.floor(right); tx++) {
      const object = getGeneratedMapObjectAt(tx, ty);
      if (!object) continue;

      const elevation = getTileElevation(object.tx, object.ty) * 0.6;
      const objectLeft = object.tx;
      const objectRight = object.tx + object.def.wUnits;
      const objectTop = object.ty + object.def.footOffsetY - object.def.hUnits - elevation;
      const objectBottom = object.ty + object.def.footOffsetY - elevation;
      if (left < objectRight && right > objectLeft &&
          top < objectBottom && bottom > objectTop) return true;
    }
  }
  return false;
}

tryLoadImage(["./assets/world/objects/nature-atlas.png"], (img) => {
  objectsSheet.image = img;
  objectsSheet.u = img.naturalWidth / 9;
  objectsSheet.ready = true;
});

export const coinSheet = { ready: false, frames: [] };

tryLoadImage(["./assets/ui/coins.png"], (img) => {
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
  if (isObjectTileExcluded(tx, ty)) return null;
  const key = `${tx},${ty}`;
  if (changedObjects.has(key)) return changedObjects.get(key);
  const object = getGeneratedMapObjectAt(tx, ty);
  if (object) return getSheepAtWorld(tx + 0.5, ty + 0.5) ?? object;
  return getSheepAtWorld(tx + 0.5, ty + 0.5);
}

export function getMapObjectAtWorld(x, y, radius = 0) {
  const sheep = getSheepAtWorld(x, y, radius);
  if (sheep) return sheep;

  const tileX = Math.floor(x);
  const tileY = Math.floor(y);

  for (let ty = tileY - 2; ty <= tileY + 1; ty++) {
    for (let tx = tileX - 2; tx <= tileX + 1; tx++) {
      const object = getMapObjectAt(tx, ty);
      if (!object) continue;

      const elevation = getTileElevation(object.tx, object.ty) * 0.6;
      const left = object.tx - radius;
      const right = object.tx + object.def.wUnits + radius;
      const top = object.ty + object.def.footOffsetY - object.def.hUnits - elevation - radius;
      const bottom = object.ty + object.def.footOffsetY - elevation + radius;
      if (x >= left && x <= right && y >= top && y <= bottom) return object;
    }
  }
  return null;
}

export function damageMapObjectAt(x, y, radius = 0) {
  const object = getMapObjectAtWorld(x, y, radius);
  if (!object) return false;

  if (object.name === "SHEEP") {
    return damageSheep(object.sheepId);
  }
  if (object.name.startsWith("TREE_")) {
    const stumpName = `STUMP_${object.name.slice("TREE_".length)}`;
    const stumpDef = objectsSheet.types[stumpName];
    changedObjects.set(object.key, {
      name: stumpName,
      def: stumpDef,
      tx: object.tx,
      ty: object.ty,
      footY: object.ty + stumpDef.footOffsetY,
      key: object.key
    });
  } else {
    changedObjects.set(object.key, null);
  }
  return true;
}

export function consumeBerryAt(tx, ty) {
  const object = getMapObjectAt(tx, ty);
  if (!object || object.name !== "BUSH_BERRY") return false;
  changedObjects.set(object.key, null);
  return true;
}

export function consumeMushroomAt(tx, ty) {
  const object = getMapObjectAt(tx, ty);
  if (!object || object.name !== "MUSHROOM") return false;
  changedObjects.set(object.key, null);
  return true;
}

export function hasObjectCollision(tx, ty) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -2; dy <= 1; dy++) {
      const obj = getMapObjectAt(tx + dx, ty + dy);
      if (obj && obj.def.solid) {
        const collisionX = obj.tx + (obj.def.collisionOffsetX ?? 0);
        const collisionY = obj.ty + (obj.def.collisionOffsetY ?? 0);
        const collisionWidth = obj.def.collisionWidth ?? 1;
        const collisionHeight = obj.def.collisionHeight ?? 1;
        if (tx >= collisionX && tx < collisionX + collisionWidth &&
            ty >= collisionY && ty < collisionY + collisionHeight) return true;
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

const COIN_SAVE_KEY = "sprout-lands.coin-progress.v1";

function loadCoinProgress() {
  let saved;
  try {
    saved = localStorage.getItem(COIN_SAVE_KEY);
  } catch (error) {
    console.error("Unable to load saved coin progress.", error);
    return;
  }
  if (saved === null) return;

  let progress;
  try {
    progress = JSON.parse(saved);
  } catch (error) {
    console.error("Saved coin progress is not valid JSON.", error);
    return;
  }
  if (!Number.isSafeInteger(progress?.coins) || progress.coins < 0 ||
      !Array.isArray(progress.collected) ||
      !progress.collected.every(key => typeof key === "string" && /^-?\d+,-?\d+$/.test(key))) {
    console.error("Saved coin progress has an invalid format.");
    return;
  }

  propState.coinsCollectedCount = progress.coins;
  coinsCollectedCount = progress.coins;
  for (const key of progress.collected) collectedCoins.add(key);
}

function saveCoinProgress() {
  try {
    localStorage.setItem(COIN_SAVE_KEY, JSON.stringify({
      coins: propState.coinsCollectedCount,
      collected: [...collectedCoins]
    }));
    return true;
  } catch (error) {
    console.error("Unable to save coin progress.", error);
    return false;
  }
}

export function spendCoins(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || propState.coinsCollectedCount < amount) {
    return false;
  }

  propState.coinsCollectedCount -= amount;
  coinsCollectedCount = propState.coinsCollectedCount;
  saveCoinProgress();
  return true;
}

loadCoinProgress();

export function hasCoinAt(tx, ty) {
  if (isCliff(tx, ty) || isStairs(tx, ty) || isWaterTile(tx, ty) || hasObjectCollision(tx, ty)) return false;
  const key = `${tx},${ty}`;
  if (collectedCoins.has(key)) return false;

  const hVal = Math.sin(tx * 91.13 + ty * 23.47) * 43758.5453;
  const rand = hVal - Math.floor(hVal);
  if (isHighlandPlateau(tx, ty)) return rand < 0.08;
  return rand < 0.03;
}

export function checkCoinPickup(tx, ty, updateHUDCallback) {
  const key = `${tx},${ty}`;
  if (hasCoinAt(tx, ty)) {
    collectedCoins.add(key);
    propState.coinsCollectedCount++;
    coinsCollectedCount = propState.coinsCollectedCount;
    saveCoinProgress();
    playSound("coin");
    if (updateHUDCallback) updateHUDCallback(propState.coinsCollectedCount);

    const elev = getTileElevation(tx, ty);
    particles.push({
      x: (tx + 0.5) * globals.tile,
      y: (ty + 0.5 - elev) * globals.tile,
      vy: -globals.tile * 1.6,
      life: 0.65,
      maxLife: 0.65
    });
  }
}
