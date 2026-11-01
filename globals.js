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
  let index = 0;
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    try {
      onLoaded(image);
    } catch (error) {
      console.error("Unable to process loaded image.", error);
    }
  };
  image.onerror = () => {
    index++;
    if (index < paths.length) {
      image.src = paths[index];
    } else {
      console.error(`Unable to load image: ${paths.join(", ")}`);
    }
  };
  image.src = paths[index];
  return image;
}

export function loadSheet(src, cols = COLS, rows = ROWS) {
  const image = new Image();
  const sheet = { image, ready: false, error: false, fw: 0, fh: 0 };
  image.decoding = "async";
  image.onload = () => {
    if (!image.naturalWidth || !image.naturalHeight) {
      sheet.error = true;
      console.error(`Spritesheet has invalid dimensions: ${src}`);
      return;
    }
    sheet.fw = image.naturalWidth / cols;
    sheet.fh = image.naturalHeight / rows;
    sheet.ready = true;
  };
  image.onerror = () => {
    sheet.error = true;
    console.error(`Unable to load spritesheet: ${src}`);
  };
  image.src = src;
  return sheet;
}
