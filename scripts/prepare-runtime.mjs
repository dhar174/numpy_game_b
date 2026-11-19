import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import runtimeAssets from '../runtime-assets.json' with {type: 'json'};

const npm = new URL('../node_modules/pyodide/', import.meta.url);
const version = JSON.parse(await readFile(new URL('package.json', npm), 'utf8')).version;
if (version !== runtimeAssets.version) throw new Error('Update the pinned runtime and test its package lock together.');

const out = new URL(`../public/runtime/${version}/`, import.meta.url);
const lockfile = JSON.parse(await readFile(new URL('pyodide-lock.json', npm), 'utf8'));
const numpy = lockfile.packages.numpy;
if (numpy.file_name !== runtimeAssets.numpyWheel) throw new Error('Update the declared NumPy artifact to match the runtime lock.');
if (numpy.depends.length) throw new Error('Include new NumPy dependencies in the runtime artifact.');
const files = ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm',
  'python_stdlib.zip', 'pyodide-lock.json'];
await mkdir(out, {recursive: true});

const wheelUrl = new URL(numpy.file_name, out);
const verify = bytes => createHash('sha256').update(bytes).digest('hex') === numpy.sha256;
let wheel = await readFile(wheelUrl).catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
if (!wheel || !verify(wheel)) {
  const url = `https://cdn.jsdelivr.net/pyodide/v${version}/full/${numpy.file_name}`;
  const response = await fetch(url, {signal: AbortSignal.timeout(45000)});
  if (!response.ok) throw new Error(`NumPy wheel fetch failed with HTTP ${response.status}`);
  wheel = Buffer.from(await response.arrayBuffer());
  if (!verify(wheel)) throw new Error('The NumPy wheel did not match the pinned SHA-256.');
  await writeFile(wheelUrl, wheel);
}
if (!verify(await readFile(wheelUrl))) throw new Error('NumPy wheel readback failed.');
for (const file of files) {
  const original = new URL(file, npm);
  const destination = new URL(file, out);
  await copyFile(original, destination);
  if (!(await readFile(destination)).equals(await readFile(original))) {
    throw new Error(`Runtime readback failed for ${file}`);
  }
}
const wasm = await readFile(new URL('pyodide.asm.wasm', out));
const packed = new URL('pyodide.asm.wasm.gz', out);
const compressed = gzipSync(wasm, {level: 6});
await writeFile(packed, compressed);
if (!gunzipSync(await readFile(packed)).equals(wasm)) throw new Error('Compressed Wasm readback failed.');
console.log(`Verified Pyodide ${version} and NumPy ${numpy.version} as same-origin assets.`);
