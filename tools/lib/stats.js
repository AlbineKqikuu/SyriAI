// Small, dependency-free statistics helpers for the thesis analysis.
'use strict';

function mean(xs) {
    return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n − 1) */
function sd(xs) {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** Quantile with linear interpolation (same as R type 7 / numpy default) */
function quantile(xs, q) {
    const s = xs.slice().sort((a, b) => a - b);
    if (!s.length) return NaN;
    const pos = (s.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

const median = (xs) => quantile(xs, 0.5);

/** Average ranks (ties share the mean of their positions), 1-based */
function rank(values) {
    const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(values.length);
    for (let i = 0; i < order.length;) {
        let j = i;
        while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
        const r = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) ranks[order[k][1]] = r;
        i = j + 1;
    }
    return ranks;
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, error < 1.5e-7) */
function normalCdf(z) {
    const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
        * Math.exp(-(z * z) / 2);
    return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/**
 * Wilcoxon signed-rank test for paired samples (two-sided).
 * Zero differences are dropped (Wilcoxon's method). Exact p-value for n ≤ 25
 * (ties handled by enumerating half-ranks), normal approximation with tie correction above.
 * Effect size r = |Z| / √n.
 */
function wilcoxonSignedRank(a, b) {
    const diffs = a.map((x, i) => x - b[i]).filter(d => d !== 0);
    const n = diffs.length;
    if (n === 0) return { n: 0, wPlus: 0, wMinus: 0, W: 0, z: 0, p: 1, r: 0, method: 'no differences' };

    const ranks = rank(diffs.map(Math.abs));
    let wPlus = 0;
    diffs.forEach((d, i) => { if (d > 0) wPlus += ranks[i]; });
    const total = n * (n + 1) / 2;
    const wMinus = total - wPlus;
    const W = Math.min(wPlus, wMinus);

    // Normal approximation (also used for the effect size)
    const tieGroups = {};
    ranks.forEach(r => { tieGroups[r] = (tieGroups[r] || 0) + 1; });
    const tieCorrection = Object.values(tieGroups).reduce((acc, t) => acc + (t ** 3 - t), 0) / 48;
    const variance = n * (n + 1) * (2 * n + 1) / 24 - tieCorrection;
    const z = variance > 0 ? (wPlus - total / 2) / Math.sqrt(variance) : 0;

    let p;
    let method;
    if (n <= 25) {
        // Exact null distribution of W+ over doubled (integer) ranks
        const doubled = ranks.map(r => Math.round(r * 2));
        const maxSum = doubled.reduce((x, y) => x + y, 0);
        let dist = new Array(maxSum + 1).fill(0);
        dist[0] = 1;
        for (const r of doubled) {
            const next = dist.slice();
            for (let s = 0; s + r <= maxSum; s++) if (dist[s]) next[s + r] += dist[s];
            dist = next;
        }
        const count = 2 ** n;
        const target = Math.round(W * 2);
        let tail = 0;
        for (let s = 0; s <= target; s++) tail += dist[s];
        p = Math.min(1, 2 * tail / count);
        method = 'exact';
    } else {
        p = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
        method = 'normal approximation';
    }

    return { n, wPlus, wMinus, W, z, p, r: Math.abs(z) / Math.sqrt(n), method };
}

module.exports = { mean, sd, quantile, median, rank, normalCdf, wilcoxonSignedRank };
