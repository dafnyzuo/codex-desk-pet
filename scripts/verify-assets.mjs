import { readFile } from 'node:fs/promises';

const assetNames = [
  'pet.png',
  'pet-blink.png',
  'pet-hop.png',
  'pet-nod.png',
  'pet-peek.png',
  'pet-shake.png',
  'pet-stretch.png',
  'pet-wave.png'
];
const signature = '89504e470d0a1a0a';

for (const assetName of assetNames) {
  const png = await readFile(new URL(`../assets/${assetName}`, import.meta.url));
  if (png.subarray(0, 8).toString('hex') !== signature) {
    throw new Error(`assets/${assetName} is not a valid PNG file`);
  }

  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const colorType = png.readUInt8(25);

  if (width < 512 || height < 512) {
    throw new Error(`Desktop-pet asset ${assetName} is too small: ${width}x${height}`);
  }

  if (colorType !== 4 && colorType !== 6) {
    throw new Error(`Desktop-pet asset ${assetName} has no alpha channel (PNG color type ${colorType})`);
  }

  console.log(`Verified ${assetName}: ${width}x${height}, PNG color type ${colorType}`);
}
