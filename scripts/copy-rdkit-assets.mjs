import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(projectRoot, 'node_modules', '@rdkit', 'rdkit', 'dist');
const targetRoot = resolve(projectRoot, 'public', 'rdkit');

mkdirSync(targetRoot, { recursive: true });

for (const fileName of ['RDKit_minimal.js', 'RDKit_minimal.wasm']) {
  copyFileSync(resolve(sourceRoot, fileName), resolve(targetRoot, fileName));
}

// Preserve the license alongside redistributed browser/WASM assets.
copyFileSync(resolve(sourceRoot, '..', 'LICENSE'), resolve(targetRoot, 'LICENSE'));

console.log('RDKit browser assets and license copied to public/rdkit');
