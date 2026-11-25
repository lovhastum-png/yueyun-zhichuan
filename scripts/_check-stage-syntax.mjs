// Check the production stage's external and inline scripts without executing them.
import { readFile, writeFile, mkdtemp, readdir, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const publicRoot = new URL('../public/', import.meta.url);
const html = await readFile(new URL('3d-stage.html', publicRoot), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
if (!scripts.length) throw new Error('The stage must load its scripts.');
const temp = await mkdtemp(join(tmpdir(), 'stage-check-'));
try {
  for (const [index, script] of scripts.entries()) {
    const src = script[1].match(/\bsrc="([^"]+)"/)?.[1];
    let file;
    if (src) {
      if (!src.startsWith('/js/')) throw new Error('Unexpected stage script: ' + src);
      file = new URL(src.split('?')[0].slice(1), publicRoot);
    } else {
      file = join(temp, `inline-${index}.mjs`);
      await writeFile(file, script[2]);
    }
    execFileSync(process.execPath, ['--check', typeof file === 'string' ? file : fileURLToPath(file)], { stdio: 'pipe' });
    console.log(`${src || `inline-${index}`}: syntax OK`);
  }
} finally {
  for (const file of await readdir(temp)) await unlink(join(temp, file));
  await rmdir(temp);
}
