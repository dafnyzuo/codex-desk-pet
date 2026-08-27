import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const releaseDirectory = path.resolve('release');
const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
const versionMarker = `-${packageJson.version}-`;
const files = (await readdir(releaseDirectory))
  .filter((name) => name.includes(versionMarker) && (name.endsWith('.dmg') || name.endsWith('.zip')))
  .sort();

if (files.length === 0) {
  throw new Error(`No DMG or ZIP files found for version ${packageJson.version} in release/`);
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

const lines = [];
for (const file of files) {
  lines.push(`${await sha256(path.join(releaseDirectory, file))}  ${file}`);
}

await writeFile(path.join(releaseDirectory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
console.log(`Wrote SHA256SUMS.txt for ${files.length} release files`);
