'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sector = require('../scripts/build_sector_monthly');
const research = require('../scripts/build_research_scores');

function withTempFile(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-helper-derived-'));
  const file = path.join(dir, 'snapshot.json');
  try { fn(file); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('empty sector rebuild preserves the previous valid snapshot', () => {
  withTempFile(file => {
    const previous = { schemaVersion: 1, stocks: { sh600000: { m1: 2.5 } } };
    fs.writeFileSync(file, JSON.stringify(previous) + '\n');
    const before = fs.readFileSync(file, 'utf8');
    const result = sector.buildFile({
      stocks: [{ code: 'sh600000' }],
      marketDate: '2026-10-29',
      readCache: () => null,
      file
    });
    assert.equal(result.skipped, true);
    assert.equal(result.changed, false);
    assert.deepEqual(result.payload, previous);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });
});

test('empty sector rebuild without a previous snapshot fails instead of writing empty data', () => {
  withTempFile(file => {
    assert.throws(() => sector.buildFile({
      stocks: [{ code: 'sh600000' }],
      readCache: () => null,
      file
    }), /refusing to publish an empty sector snapshot/);
    assert.equal(fs.existsSync(file), false);
  });
});

test('empty research score rebuild preserves the previous valid snapshot', () => {
  withTempFile(file => {
    const previous = { schemaVersion: 1, scores: { sh600000: { points: 20 } } };
    fs.writeFileSync(file, JSON.stringify(previous) + '\n');
    const before = fs.readFileSync(file, 'utf8');
    const result = research.buildFile({
      stocks: [{ code: 'sh600000' }],
      fundamentals: {},
      readCache: () => null,
      file
    });
    assert.equal(result.skipped, true);
    assert.equal(result.changed, false);
    assert.deepEqual(result.payload, previous);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });
});

test('empty research score rebuild without a previous snapshot fails instead of writing empty data', () => {
  withTempFile(file => {
    assert.throws(() => research.buildFile({
      stocks: [{ code: 'sh600000' }],
      fundamentals: {},
      readCache: () => null,
      file
    }), /refusing to publish an empty score snapshot/);
    assert.equal(fs.existsSync(file), false);
  });
});
