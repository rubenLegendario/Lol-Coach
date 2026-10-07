/**
 * Genera assets/icon.ico (16, 24, 32, 48, 64, 128 y 256 px) a partir de assets/icon.svg,
 * rasterizando con Chrome en modo headless. Solo hace falta volver a ejecutarlo si cambia el logo.
 *   node scripts/make-icon.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../src/config.js';

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('Necesito Chrome o Edge instalados para rasterizar el icono');

const svg = fs.readFileSync(path.join(ROOT, 'assets', 'icon.svg'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lolcoach-icon-'));
const page = path.join(tmp, 'icon.html');
fs.writeFileSync(page, `<!doctype html><body><script>
  const img = new Image();
  img.onload = () => {
    const out = ${JSON.stringify(SIZES)}.map((s) => {
      const c = document.createElement('canvas'); c.width = c.height = s;
      c.getContext('2d').drawImage(img, 0, 0, s, s);
      return c.toDataURL('image/png');
    });
    document.body.setAttribute('data-icons', out.join('|'));
  };
  img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
</script></body>`);

const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', `--user-data-dir=${path.join(tmp, 'profile')}`, '--virtual-time-budget=3000', '--dump-dom', `file:///${page.replace(/\\/g, '/')}`], { encoding: 'utf8' });
const pngs = dom.match(/data-icons="([^"]+)"/)[1].split('|').map((d) => Buffer.from(d.split(',')[1], 'base64'));

// Contenedor ICO con imágenes PNG (soportado desde Windows Vista)
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach((png, i) => {
  const s = SIZES[i];
  const e = 6 + 16 * i;
  header.writeUInt8(s >= 256 ? 0 : s, e);
  header.writeUInt8(s >= 256 ? 0 : s, e + 1);
  header.writeUInt8(0, e + 2);
  header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(png.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
fs.writeFileSync(path.join(ROOT, 'assets', 'icon.ico'), Buffer.concat([header, ...pngs]));
fs.writeFileSync(path.join(ROOT, 'assets', 'icon-256.png'), pngs[pngs.length - 1]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`assets/icon.ico generado (${SIZES.join(', ')} px)`);
