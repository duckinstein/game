export const globals = {
  tile: 48,
  viewW: 0, 
  viewH: 0,
  cameraX: 0, 
  cameraY: 0,
  dpr: 1
};

export const COLS = 4;
export const ROWS = 4;
export const CAMERA_EDGE_UNITS = 4;
export const DIR = { DOWN: 0, LEFT: 1, RIGHT: 2, UP: 3 };

export const DIR_MAP = {
  down:  { x: 0,  y: 1,  dir: DIR.DOWN },
  left:  { x: -1, y: 0,  dir: DIR.LEFT },
  right: { x: 1,  y: 0,  dir: DIR.RIGHT },
  up:    { x: 0,  y: -1, dir: DIR.UP }
};

export function tryLoadImage(paths, onLoaded) {
  let idx = 0;
  const img = new Image();
  img.onload = () => onLoaded(img);
  img.onerror = () => {
    idx++;
    if (idx < paths.length) img.src = paths[idx];
  };
  img.src = paths[0];
}

export function loadSheet(src, cols = COLS, rows = ROWS) {
  const image = new Image();
  const sheet = { image, ready: false, error: false, fw: 0, fh: 0 };
  image.onload = () => {
    sheet.fw = image.naturalWidth / cols;
    sheet.fh = image.naturalHeight / rows;
    sheet.ready = true;
  };
  image.onerror = () => { sheet.error = true; };
  image.src = src;
  return sheet;
}
