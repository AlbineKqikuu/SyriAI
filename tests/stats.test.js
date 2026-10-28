// Unit tests for the analysis statistics. Run: npm test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../tools/lib/stats.js');

const close = (actual, expected, tol = 1e-6) =>
    assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

test('quantile uses linear interpolation (R type 7)', () => {
    close(S.quantile([1, 2, 3, 4], 0.25), 1.75);
    close(S.median([1, 2, 3, 4]), 2.5);
    close(S.median([5, 1, 3]), 3);
});

test('mean and sample standard deviation', () => {
    close(S.mean([2, 4, 4, 4, 5, 5, 7, 9]), 5);
    close(S.sd([2, 4, 4, 4, 5, 5, 7, 9]), 2.13808994, 1e-6);
});

test('rank gives ties their average rank', () => {
    assert.deepEqual(S.rank([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
});

test('normalCdf matches known values', () => {
    close(S.normalCdf(0), 0.5, 1e-7);
    close(S.normalCdf(1.959964), 0.975, 1e-6);
});

test('Wilcoxon exact p for distinct ranks (reference: scipy.stats.wilcoxon = 0.015625)', () => {
    // differences -1, 2..8 → W− = 1, W+ = 35
    const a = [0, 2, 3, 4, 5, 6, 7, 8];
    const b = [1, 0, 0, 0, 0, 0, 0, 0];
    const res = S.wilcoxonSignedRank(a, b);
    assert.equal(res.n, 8);
    assert.equal(res.W, 1);
    close(res.p, 0.015625);
    assert.equal(res.method, 'exact');
});

test('Wilcoxon: no difference gives p = 1, zeros are dropped', () => {
    assert.equal(S.wilcoxonSignedRank([1, 2, 3], [1, 2, 3]).p, 1);
    assert.equal(S.wilcoxonSignedRank([1, 2, 5], [1, 2, 3]).n, 1);
});

test('Wilcoxon is symmetric in the order of the samples', () => {
    const a = [12, 7, 3, 9, 15, 4, 8];
    const b = [9, 8, 1, 4, 10, 4, 3];
    close(S.wilcoxonSignedRank(a, b).p, S.wilcoxonSignedRank(b, a).p);
});

test('Wilcoxon uses the normal approximation for large samples', () => {
    const a = Array.from({ length: 30 }, (_, i) => i + 10);
    const b = Array.from({ length: 30 }, () => 0);
    const res = S.wilcoxonSignedRank(a, b);
    assert.equal(res.method, 'normal approximation');
    assert.ok(res.p < 0.001);
    assert.ok(res.r > 0.8);
});
