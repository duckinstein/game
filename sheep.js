import { globals } from "./globals.js";
import { getTileElevation, isCliff, isWaterTile } from "./world.js";
import { isSheepBlockedAt } from "./props.js";

const HERD_REGION_SIZE = 12;
const HERD_SPAWN_CHANCE = 0.34;
const SHEEP_FRAME_COUNT = 4;
const SHEEP_FRAME_SIZE = 128;
const SHEEP_SPEED = 0.32;
const SHEEP_DEF = { wUnits: 1, hUnits: 1, footOffsetY: 1, solid: false };
const sheepImage = new Image();
sheepImage.decoding = "async";
sheepImage.onerror = () => console.error("Unable to load sheep spritesheet: ./assets/world/objects/Sheep_Move.png");
sheepImage.src = "./assets/world/objects/Sheep_Move.png";

const herds = new Map();
const destroyedSheep = new Set();

function hash(x, y, seed = 0) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function regionKey(regionX, regionY) {
  return `${regionX},${regionY}`;
}

function findHerdPosition(regionX, regionY) {
  const baseX = regionX * HERD_REGION_SIZE + HERD_REGION_SIZE / 2;
  const baseY = regionY * HERD_REGION_SIZE + HERD_REGION_SIZE / 2;
  const count = 5 + Math.floor(hash(regionX, regionY, 7) * 6);
  for (let attempt = 0; attempt < 36; attempt++) {
    const x = Math.floor(baseX + (hash(regionX, regionY, attempt * 2) - 0.5) * 8);
    const y = Math.floor(baseY + (hash(regionX, regionY, attempt * 2 + 1) - 0.5) * 8);
    if (isCliff(x, y) || isWaterTile(x, y)) continue;
    let blocked = false;
    for (let index = 0; index < count; index++) {
      const offsetX = (hash(regionX, regionY, 20 + index) - 0.5) * 4.6;
      const offsetY = (hash(regionX, regionY, 60 + index) - 0.5) * 1.6;
      if (isSheepBlockedAt(x + offsetX, y + offsetY)) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    return { x, y };
  }
  return null;
}

function ensureHerd(regionX, regionY) {
  const key = regionKey(regionX, regionY);
  if (herds.has(key)) return herds.get(key);
  if (hash(regionX, regionY) >= HERD_SPAWN_CHANCE) {
    herds.set(key, null);
    return null;
  }

  const position = findHerdPosition(regionX, regionY);
  if (!position) {
    herds.set(key, null);
    return null;
  }

  const herd = {
    key,
    x: position.x,
    y: position.y,
    direction: hash(regionX, regionY, 5) < 0.5 ? -1 : 1,
    minX: position.x - 2.5,
    maxX: position.x + 2.5,
    sheep: []
  };
  const count = 5 + Math.floor(hash(regionX, regionY, 7) * 6);
  for (let index = 0; index < count; index++) {
    const id = `${key}:${index}`;
    if (destroyedSheep.has(id)) continue;
    herd.sheep.push({
      id,
      offsetX: (hash(regionX, regionY, 20 + index) - 0.5) * 4.6,
      offsetY: (hash(regionX, regionY, 60 + index) - 0.5) * 1.6,
      x: 0,
      y: 0,
      herd
    });
    const sheep = herd.sheep[herd.sheep.length - 1];
    sheep.x = herd.x + sheep.offsetX;
    sheep.y = herd.y + sheep.offsetY;
  }
  herd.speed = SHEEP_SPEED * (0.8 + hash(regionX, regionY, 11) * 0.4);
  herds.set(key, herd);
  return herd;
}

function visitRegions(minX, maxX, minY, maxY, visit) {
  const firstRegionX = Math.floor(minX / HERD_REGION_SIZE) - 1;
  const lastRegionX = Math.floor(maxX / HERD_REGION_SIZE) + 1;
  const firstRegionY = Math.floor(minY / HERD_REGION_SIZE) - 1;
  const lastRegionY = Math.floor(maxY / HERD_REGION_SIZE) + 1;
  for (let regionY = firstRegionY; regionY <= lastRegionY; regionY++) {
    for (let regionX = firstRegionX; regionX <= lastRegionX; regionX++) {
      const herd = ensureHerd(regionX, regionY);
      if (herd) visit(herd);
    }
  }
}

function getSheepObject(sheep) {
  return {
    name: "SHEEP",
    key: `sheep:${sheep.id}`,
    sheepId: sheep.id,
    sheep,
    tx: sheep.x,
    ty: sheep.y,
    footY: sheep.y + SHEEP_DEF.footOffsetY,
    def: SHEEP_DEF
  };
}

export function getSheepAtWorld(x, y, radius = 0) {
  let result = null;
  visitRegions(x - 2 - radius, x + 2 + radius, y - 2 - radius, y + 2 + radius, herd => {
    if (result) return;
    for (const sheep of herd.sheep) {
      const left = sheep.x;
      const right = sheep.x + SHEEP_DEF.wUnits;
      const top = sheep.y;
      const bottom = sheep.y + SHEEP_DEF.hUnits;
      if (x + radius >= left && x - radius <= right &&
          y + radius >= top && y - radius <= bottom) {
        result = getSheepObject(sheep);
        return;
      }
    }
  });
  return result;
}

export function getSheepInBounds(minX, maxX, minY, maxY) {
  const result = [];
  visitRegions(minX, maxX, minY, maxY, herd => {
    for (const sheep of herd.sheep) {
      if (sheep.x + 1 >= minX && sheep.x <= maxX &&
          sheep.y + 1 >= minY && sheep.y <= maxY) {
        result.push(sheep);
      }
    }
  });
  return result;
}

export function updateSheep(dt, minX, maxX, minY, maxY) {
  visitRegions(minX, maxX, minY, maxY, () => {});
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  for (const [key, herd] of herds) {
    if (!herd) continue;
    if (Math.abs(herd.x - centerX) > 80 || Math.abs(herd.y - centerY) > 80) {
      herds.delete(key);
      continue;
    }
    let nextX = herd.x + herd.direction * herd.speed * dt;
    if (nextX >= herd.maxX) {
      nextX = herd.maxX;
      herd.direction = -1;
    } else if (nextX <= herd.minX) {
      nextX = herd.minX;
      herd.direction = 1;
    }
    if (herd.sheep.some(sheep => isSheepBlockedAt(nextX + sheep.offsetX, herd.y + sheep.offsetY))) {
      herd.direction = nextX >= herd.maxX ? -1 : nextX <= herd.minX ? 1 : -herd.direction;
      nextX = herd.x;
    }
    herd.x = nextX;
    for (const sheep of herd.sheep) {
      sheep.x = herd.x + sheep.offsetX;
      sheep.y = herd.y + sheep.offsetY;
    }
  }
}

export function damageSheep(id) {
  const [key, memberIndex] = id.split(":");
  const herd = herds.get(key);
  if (!herd) return false;
  const index = Number(memberIndex);
  if (!Number.isInteger(index)) return false;
  const sheepIndex = herd.sheep.findIndex(sheep => sheep.id === id);
  if (sheepIndex === -1) return false;
  herd.sheep.splice(sheepIndex, 1);
  destroyedSheep.add(id);
  return true;
}

export function drawSheep(ctx, sheep, now) {
  if (!sheepImage.complete || sheepImage.naturalWidth < SHEEP_FRAME_COUNT * SHEEP_FRAME_SIZE ||
      sheepImage.naturalHeight < SHEEP_FRAME_SIZE) return;

  const centerX = (sheep.x + 0.5) * globals.tile - globals.cameraX;
  const footY = (sheep.y + SHEEP_DEF.footOffsetY) * globals.tile - globals.cameraY;
  const size = globals.tile * 2;
  const frame = Math.floor(now / 170) % SHEEP_FRAME_COUNT;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(centerX, 0);
  if (sheep.herd.direction < 0) ctx.scale(-1, 1);
  ctx.drawImage(
    sheepImage,
    frame * SHEEP_FRAME_SIZE, 0, SHEEP_FRAME_SIZE, SHEEP_FRAME_SIZE,
    -size / 2, footY - size, size, size
  );
  ctx.restore();
}
