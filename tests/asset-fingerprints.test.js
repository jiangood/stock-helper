'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fingerprint, updateHtmlContent } = require('../scripts/update_asset_fingerprints');

test('updates local CSS and JS fingerprints while preserving other query parameters', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-fingerprints-'));
  try {
    fs.writeFileSync(path.join(root, 'app.css'), 'body { color: red; }');
    fs.writeFileSync(path.join(root, 'app.js'), 'window.ready = true;');
    const html = [
      '<link rel="stylesheet" href="app.css?theme=dark">',
      '<script src="app.js?v=old&mode=prod"></script>',
      '<script src="https://cdn.example.com/lib.js"></script>',
      '<link rel="stylesheet" href="https://cdn.example.com/lib.css">'
    ].join('\n');

    const first = updateHtmlContent(html, 'index.html', root);
    assert.equal(first.updated, 2);
    assert.match(first.content, new RegExp('app\\.css\\?theme=dark&v=' + fingerprint(path.join(root, 'app.css'))));
    assert.match(first.content, new RegExp('app\\.js\\?v=' + fingerprint(path.join(root, 'app.js')) + '&mode=prod'));
    assert.match(first.content, /https:\/\/cdn\.example\.com\/lib\.js/);
    assert.match(first.content, /https:\/\/cdn\.example\.com\/lib\.css/);

    const second = updateHtmlContent(first.content, 'index.html', root);
    assert.equal(second.updated, 0);
    assert.equal(second.content, first.content);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('supports root-relative local asset paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-fingerprints-root-'));
  try {
    fs.writeFileSync(path.join(root, 'shared.css'), 'html { color: black; }');
    const result = updateHtmlContent('<link href="/shared.css">', 'nested/page.html', root);
    assert.equal(result.updated, 1);
    assert.match(result.content, new RegExp('/shared\\.css\\?v=' + fingerprint(path.join(root, 'shared.css'))));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails when a referenced local asset is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-fingerprints-missing-'));
  try {
    assert.throws(
      () => updateHtmlContent('<script src="missing.js"></script>', 'index.html', root),
      /Referenced local asset does not exist/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
