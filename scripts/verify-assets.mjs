import { readFile } from 'node:fs/promises';

const assetPath = new URL('../assets/pet.png', import.meta.url);
const png = await readFile(assetPath);
const signature = '89504e470d0a1a0a';

if (png.subarray(0, 8).toString('hex') !== signature) {
  throw new Error('assets/pet.png is not a valid PNG file');
}

const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
const colorType = png.readUInt8(25);

if (width < 512 || height < 512) {
  throw new Error(`Desktop-pet asset is too small: ${width}x${height}`);
}

if (colorType !== 4 && colorType !== 6) {
  throw new Error(`Desktop-pet asset has no alpha channel (PNG color type ${colorType})`);
}

console.log(`Verified transparent desktop-pet asset: ${width}x${height}, PNG color type ${colorType}`);
