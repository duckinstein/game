export function removeLightBackground(imageData, width, height) {
  const { data } = imageData;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  function isBackgroundPixel(index) {
    const offset = index * 4;
    if (data[offset + 3] === 0) return false;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    return Math.min(red, green, blue) >= 235 &&
      Math.max(red, green, blue) - Math.min(red, green, blue) <= 24;
  }

  function addPixel(index) {
    if (visited[index] || !isBackgroundPixel(index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  }

  for (let x = 0; x < width; x++) {
    addPixel(x);
    addPixel((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    addPixel(y * width);
    addPixel(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const offset = index * 4;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;

    if (x > 0) addPixel(index - 1);
    if (x + 1 < width) addPixel(index + 1);
    if (index >= width) addPixel(index - width);
    if (index + width < width * height) addPixel(index + width);
  }
}
