import { tryLoadImage } from './globals.js';
export const waterSheet = { image: null, ready: false, frameSize: 16 };
tryLoadImage(["./assets/world/terrain/water.png"], (img) => {
  waterSheet.image = img;
  waterSheet.frameSize = img.naturalWidth / 4;
  waterSheet.ready = true;
});

const PONDS = [
  { x: -7, y: 2, rx: 2, ry: 1 },
  { x: 7, y: -6, rx: 2, ry: 1 },
  { x: 18, y: 14, rx: 2, ry: 2 },
  { x: -17, y: -12, rx: 2, ry: 2 },
  { x: 6, y: 19, rx: 2, ry: 1 },
  { x: 28, y: 6, rx: 2, ry: 1 }
];

const waterTiles = new Set();
for (const pond of PONDS) {
  const radiusX = pond.rx + 0.5;
  const radiusY = pond.ry + 0.5;
  for (let y = pond.y - Math.ceil(radiusY); y <= pond.y + Math.ceil(radiusY); y++) {
    for (let x = pond.x - Math.ceil(radiusX); x <= pond.x + Math.ceil(radiusX); x++) {
      const dx = (x - pond.x) / radiusX;
      const dy = (y - pond.y) / radiusY;
      if (dx * dx + dy * dy <= 1) waterTiles.add(`${x},${y}`);
    }
  }
}

export function isWaterTile(tx, ty) {
  return waterTiles.has(`${tx},${ty}`);
}

export function getPondAt(tx, ty) {
  if (!isWaterTile(tx, ty)) return null;
  return PONDS.find(pond => {
    const dx = (tx - pond.x) / (pond.rx + 0.5);
    const dy = (ty - pond.y) / (pond.ry + 0.5);
    return dx * dx + dy * dy <= 1;
  }) ?? null;
}

export function getWaterDecor(tx, ty) {
  if (!isWaterTile(tx, ty)) return null;
  const hash = Math.abs(Math.sin(tx * 12.9898 + ty * 78.233) * 43758.5453) % 1;
  if (hash < 0.12) return "lily";
  if (hash < 0.18) return "flower";
  return null;
}

export const grassSheet = {
  image: null,
  ready: false,
  u: 16,
  variations: [
    { col: 0, row: 5, weight: 45 },
    { col: 1, row: 5, weight: 15 },
    { col: 2, row: 5, weight: 10 },
    { col: 0, row: 6, weight: 15 },
    { col: 1, row: 6, weight: 10 },
    { col: 2, row: 6, weight: 5 }
  ],
  decor: [
    { col: 5, row: 5 }, { col: 6, row: 5 }, { col: 7, row: 5 },
    { col: 5, row: 6 }, { col: 6, row: 6 }, { col: 7, row: 6 }
  ]
};

tryLoadImage(["./assets/world/terrain/grass.png"], (img) => {
  grassSheet.image = img;
  grassSheet.u = img.naturalWidth / 11;
  grassSheet.ready = true;
});

export const hillsSheet = {
  image: null,
  ready: false,
  u: 16,
  atlas: {
    TL: { col: 0, row: 0 }, T:  { col: 1, row: 0 }, TR: { col: 2, row: 0 },
    L:  { col: 0, row: 1 }, C:  { col: 1, row: 1 }, R:  { col: 2, row: 1 },
    BL: { col: 0, row: 2 }, B:  { col: 1, row: 2 }, BR: { col: 2, row: 2 },
    
    STAIRS_TL: { col: 9, row: 4 }, STAIRS_TR: { col: 10, row: 4 },
    STAIRS_BL: { col: 9, row: 5 }, STAIRS_BR: { col: 10, row: 5 },
    STAIRS_L3: { col: 9, row: 6 }, STAIRS_R3: { col: 10, row: 6 }
  }
};

tryLoadImage(["./assets/world/terrain/highlands.png"], (img) => {
  hillsSheet.image = img;
  hillsSheet.u = img.naturalWidth / 11;
  hillsSheet.ready = true;
});

// Helper: ensures even width and perfectly centers 2-block wide stairs
export function createHighland(x1, y1, width, height) {
  if (width % 2 !== 0) width += 1;
  const x2 = x1 + width - 1;
  const y2 = y1 + height - 1;
  const cliffY = y2 + 1;
  const flank = (width - 2) / 2;
  const stairX1 = x1 + flank;
  const stairX2 = stairX1 + 1;
  return { x1, x2, y1, y2, cliffY, stairX1, stairX2, width, height };
}

// Fixed game map of highlands across the world (fast O(1) checks, zero stutter)
export const HIGHLANDS = [
  // 1. Central North Highland (Overlook directly north of spawn)
  createHighland(-4, -8, 8, 5),   // width 8, stairs: [-1, 0]

  // 2. East Highland
  createHighland(8, -2, 6, 4),    // width 6, stairs: [10, 11]

  // 3. South-East Grand Highland
  createHighland(6, 8, 10, 5),    // width 10, stairs: [10, 11]

  // 4. South-West Mesa
  createHighland(-14, 6, 8, 5),   // width 8, stairs: [-11, -10]

  // 5. North-West Bluffs
  createHighland(-14, -8, 6, 4),  // width 6, stairs: [-12, -11]

  // 6. Far North Highlands
  createHighland(4, -18, 8, 5),   // width 8, stairs: [7, 8]

  // 7. Far North-West Plateau
  createHighland(-12, -19, 8, 5), // width 8, stairs: [-9, -8]

  // 8. Far West Rise
  createHighland(-24, -2, 8, 5),  // width 8, stairs: [-21, -20]

  // 9. Far South Meadow Rise
  createHighland(-4, 16, 8, 5),   // width 8, stairs: [-1, 0]

  // 10. Far East Horizon
  createHighland(18, -4, 8, 5)    // width 8, stairs: [21, 22]
];

export function getHighlandAt(tx, ty) {
  for (let i = 0; i < HIGHLANDS.length; i++) {
    const h = HIGHLANDS[i];
    if (tx >= h.x1 && tx <= h.x2 && ty >= h.y1 && ty <= h.cliffY + 1) {
      return h;
    }
  }
  return null;
}

export function isHighlandPlateau(tx, ty) {
  const h = getHighlandAt(tx, ty);
  return h ? (tx >= h.x1 && tx <= h.x2 && ty >= h.y1 && ty <= h.y2) : false;
}

export function isCliff(tx, ty) {
  const h = getHighlandAt(tx, ty);
  if (!h) return false;
  const isStairCol = (tx === h.stairX1 || tx === h.stairX2);
  const isStairRow = (ty === h.cliffY || ty === h.cliffY + 1 || ty === h.y2);
  return tx >= h.x1 && tx <= h.x2 && ty === h.cliffY && !(isStairCol && isStairRow);
}

export function isStairs(tx, ty) {
  const h = getHighlandAt(tx, ty);
  if (!h) return false;
  const isStairCol = (tx === h.stairX1 || tx === h.stairX2);
  return isStairCol && (ty === h.y2 || ty === h.cliffY || ty === h.cliffY + 1);
}

export function resolveHillTile(tx, ty) {
  const h = getHighlandAt(tx, ty);
  if (!h) return null;

  if (tx === h.stairX1 || tx === h.stairX2) {
    if (ty === h.y2) return tx === h.stairX1 ? "STAIRS_TL" : "STAIRS_TR";
    if (ty === h.cliffY) return tx === h.stairX1 ? "STAIRS_BL" : "STAIRS_BR";
    if (ty === h.cliffY + 1) return tx === h.stairX1 ? "STAIRS_L3" : "STAIRS_R3";
  }

  if (isCliff(tx, ty)) {
    if (tx === h.x1) return "BL";
    if (tx === h.x2) return "BR";
    return "B";
  }

  if (isHighlandPlateau(tx, ty)) {
    const top = (ty === h.y1);
    const left = (tx === h.x1);
    const right = (tx === h.x2);

    if (top && left) return "TL";
    if (top && right) return "TR";
    if (top) return "T";
    if (left) return "L";
    if (right) return "R";
    return "C";
  }

  return null;
}

export function getGrassVariation(tx, ty) {
  const h = Math.sin(tx * 31.17 + ty * 67.43) * 43758.5453;
  const rand = Math.abs(h - Math.floor(h)) * 100;
  let accum = 0;
  for (const v of grassSheet.variations) {
    accum += v.weight;
    if (rand <= accum) return v;
  }
  return grassSheet.variations[0];
}

export function getGrassDecor(tx, ty) {
  const h = Math.sin(tx * 83.19 + ty * 41.27) * 43758.5453;
  const rand = Math.abs(h - Math.floor(h));
  if (rand < 0.14) {
    const idx = Math.floor(((rand * 100) % 1) * grassSheet.decor.length);
    return grassSheet.decor[idx];
  }
  return null;
}

export function getTileElevation(tx, ty) {
  const h = getHighlandAt(tx, ty);
  if (!h) return 0.0;
  if (isHighlandPlateau(tx, ty)) return 1.0;
  const isStairCol = (tx === h.stairX1 || tx === h.stairX2);
  if (isStairCol) {
    if (ty === h.cliffY) return 0.66;
    if (ty === h.cliffY + 1) return 0.33;
  }
  return 0.0;
}

export function getInterpolatedElevation(x, y) {
  const floorX = Math.floor(x);
  const floorY = Math.floor(y);
  const e1 = getTileElevation(floorX, floorY);
  const e2 = getTileElevation(Math.ceil(x), Math.ceil(y));
  const frac = (y - floorY);
  return e1 + (e2 - e1) * frac;
}
