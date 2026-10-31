#!/usr/bin/env node
'use strict';

// Update local CSS/JS URL fingerprints in root-level HTML pages.
// Fingerprints are the first 12 hex characters of SHA-256 over file contents.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HTML_RE = /\.(?:html?)$/i;
const ASSET_RE = /\.(?:css|js)$/i;

function fingerprint(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').slice(0, 12);
}

function resolveLocalAsset(htmlPath, rawUrl, rootDir) {
  const value = String(rawUrl || '').trim();
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return null;

  let pathname;
  try {
    pathname = decodeURIComponent(value.split(/[?#]/, 1)[0]);
  } catch (_) {
    return null;
  }
  if (!ASSET_RE.test(pathname)) return null;

  const htmlDir = path.dirname(path.resolve(rootDir, htmlPath));
  const assetPath = path.resolve(htmlDir, pathname);
  const root = path.resolve(rootDir);
  if (assetPath !== root && !assetPath.startsWith(root + path.sep)) {
    throw new Error('Local asset escapes repository root: ' + rawUrl);
  }
  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
    throw new Error('Referenced local asset does not exist: ' + rawUrl + ' (from ' + htmlPath + ')');
  }
  return { assetPath, pathname };
}

function updateHtmlContent(html, htmlPath, rootDir) {
  let updated = 0;
  const output = html.replace(/\b(src|href)\s*=\s*(["'])(.*?)\2/gi, (whole, attr, quote, rawUrl) => {
    const resolved = resolveLocalAsset(htmlPath, rawUrl, rootDir);
    if (!resolved) return whole;

    const hash = fingerprint(resolved.assetPath);
    const url = new URL(rawUrl, 'https://fingerprint.invalid/');
    if (url.searchParams.get('v') === hash) return whole;

    url.searchParams.set('v', hash);
    const nextUrl = url.pathname.slice(1) + url.search + url.hash;
    updated += 1;
    return attr + '=' + quote + nextUrl + quote;
  });
  return { content: output, updated };
}

function updateRepository(rootDir) {
  const pages = fs.readdirSync(rootDir)
    .filter(name => HTML_RE.test(name) && fs.statSync(path.join(rootDir, name)).isFile())
    .sort();
  let total = 0;
  for (const page of pages) {
    const filePath = path.join(rootDir, page);
    const original = fs.readFileSync(filePath, 'utf8');
    const result = updateHtmlContent(original, page, rootDir);
    if (result.content !== original) {
      fs.writeFileSync(filePath, result.content);
      total += result.updated;
      process.stdout.write(page + ': updated ' + result.updated + ' asset reference(s)\n');
    }
  }
  process.stdout.write('Updated ' + total + ' local asset reference(s) across ' + pages.length + ' HTML page(s).\n');
  return total;
}

if (require.main === module) {
  try {
    updateRepository(path.resolve(process.argv[2] || process.cwd()));
  } catch (error) {
    process.stderr.write(error.stack + '\n');
    process.exitCode = 1;
  }
}

module.exports = { fingerprint, resolveLocalAsset, updateHtmlContent, updateRepository };
