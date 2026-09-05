import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const root = 'dist/client';
async function files(dir) {
  const items = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      items.map((item) =>
        item.isDirectory() ? files(join(dir, item.name)) : join(dir, item.name),
      ),
    )
  ).flat();
}
const assets = (await files(root))
  .filter((p) => /\.(js|css|woff2)$/.test(p))
  .map((p) => '/' + p.slice(root.length + 1));
const version = createHash('sha256')
  .update(assets.sort().join('\n'))
  .digest('hex')
  .slice(0, 12);
const source = await readFile('public/sw.js', 'utf8');
await writeFile(
  join(root, 'sw.js'),
  source
    .replace("'microtek-v1'", `'microtek-${version}'`)
    .replace(
      /const SHELL = \[[\s\S]*?\];/,
      `const SHELL = ${JSON.stringify(['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', ...assets.filter((asset) => asset !== '/sw.js')])};`,
    ),
);
console.log(`Prepared offline shell with ${assets.length} built assets.`);
