/*
 * Genera dist/SHA256SUMS.txt con el hash SHA-256 de cada instalador.
 * Se publica junto al release para que cualquiera pueda comprobar que el
 * archivo que bajó es exactamente el que se compiló (no fue modificado).
 *
 * Verificar en Windows (PowerShell):
 *   Get-FileHash .\PointStream-X.Y.Z-Setup.exe -Algorithm SHA256
 *
 * Uso: node build/checksums.js
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { version } = require('../package.json');
const dist = path.join(__dirname, '..', 'dist');
// Solo los instaladores de la versión actual (dist/ puede tener builds viejos).
const files = fs.existsSync(dist)
  ? fs.readdirSync(dist).filter(f => /\.(exe|zip|7z|msi)$/i.test(f) && f.includes(`-${version}-`))
  : [];

if (!files.length) {
  console.error('[SHA256] No hay instaladores en dist/. Corré primero electron-builder.');
  process.exit(1);
}

const lines = files.sort().map(f => {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(dist, f))).digest('hex');
  console.log(`[SHA256] ${hash}  ${f}`);
  return `${hash}  ${f}`;
});
fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), lines.join('\n') + '\n', 'utf8');
console.log('[SHA256] dist/SHA256SUMS.txt generado');
