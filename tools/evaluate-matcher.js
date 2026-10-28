#!/usr/bin/env node
// Offline evaluation of the speech-to-script matcher (new) against the original one (legacy).
//
// A reader is simulated going through Albanian news scripts. Their words pass through a
// noise model that imitates speech-recognition errors, and are delivered the way Chrome
// delivers them: interim transcripts that grow word by word, then a final one, per
// utterance. Both matchers receive exactly the same transcripts.
//
// This is a SIMULATION: it isolates the matching algorithm from real ASR, microphones
// and speakers. Use it together with the live user study (see docs/EVALUATION.md).
//
// Usage: node tools/evaluate-matcher.js [--runs 30] [--out tools/results]
'use strict';

const fs = require('fs');
const path = require('path');
const M = require('../SyriAI.Backend/wwwroot/studio/js/shared/matcher.js');
const { createLegacyTracker } = require('./legacy-matcher.js');
const { groupedBarChart } = require('./lib/svg-charts.js');

const args = process.argv.slice(2);
const argValue = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
};
const RUNS = parseInt(argValue('--runs', '30'), 10);
const OUT_DIR = argValue('--out', path.join(__dirname, 'results'));

// ---------- Corpus: short Albanian news scripts ----------
const CORPUS = [
    `Mirëmbrëma, të nderuar shikues. Qeveria e Kosovës miratoi sot projektbuxhetin për vitin e ardhshëm,
    i cili parashikon rritje të investimeve në arsim dhe shëndetësi. Ministri i Financave deklaroi se
    buxheti do të jetë më i madhi deri më tani dhe se pagat në sektorin publik do të rriten gradualisht.
    Opozita kritikoi vendimin, duke thënë se mungon një plan i qartë për zhvillimin ekonomik. Debati në
    Kuvend pritet të vazhdojë javën e ardhshme, ndërsa votimi përfundimtar është caktuar për fund të muajit.`,

    `Në Prishtinë sot u hap panairi ndërkombëtar i librit, ku marrin pjesë më shumë se njëqind botues nga
    rajoni dhe Evropa. Organizatorët thanë se këtë vit është rritur numri i vizitorëve të rinj, veçanërisht
    studentëve. Gjatë ditës u prezantuan disa romane të reja të autorëve shqiptarë, si dhe përkthime të
    veprave klasike. Panairi do të qëndrojë i hapur deri të dielën, çdo ditë nga ora nëntë e mëngjesit
    deri në ora tetë të mbrëmjes. Hyrja për nxënësit dhe studentët është falas.`,

    `Parashikimi i motit për nesër: në pjesën më të madhe të vendit pritet mot me diell dhe temperatura
    deri në njëzet e tetë gradë. Në zonat malore të veriut dhe të perëndimit mund të ketë vranësira dhe
    reshje të lehta shiu pasdite. Era do të fryjë lehtë nga jugu. Shërbimi hidrometeorologjik këshillon
    shoferët të jenë të kujdesshëm në rrugët malore, ku gjatë natës mund të formohet mjegull. Fundjava
    pritet të jetë më e freskët, me rënie të temperaturave për rreth pesë gradë.`,
].map(t => t.split(/\s+/).filter(Boolean));

// ---------- Noise model ----------
const CONDITIONS = [
    { name: 'clean', diacritics: 0, substitute: 0, drop: 0, filler: 0 },
    { name: 'diacritics-only', diacritics: 0.7, substitute: 0, drop: 0, filler: 0 },
    { name: 'light', diacritics: 0.3, substitute: 0.05, drop: 0.03, filler: 0.02 },
    { name: 'moderate', diacritics: 0.5, substitute: 0.12, drop: 0.07, filler: 0.05 },
    { name: 'heavy', diacritics: 0.7, substitute: 0.2, drop: 0.12, filler: 0.08 },
];

const FILLERS = ['ee', 'pra', 'domethënë', 'mmm'];
const LETTERS = 'abcdefghijklmnopqrstuvxyz';

/** Deterministic PRNG (mulberry32) so every run is reproducible */
function rng(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function stripDiacritics(w) {
    return w.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** One recognised word for a spoken script word (or null when the recogniser misses it) */
function recognise(word, cond, rand) {
    if (rand() < cond.drop) return null;
    let w = word.toLowerCase().replace(/[.,!?;:«»"]/g, '');
    if (rand() < cond.diacritics) w = stripDiacritics(w);
    if (w.length > 2 && rand() < cond.substitute) {
        const i = Math.floor(rand() * w.length);
        w = w.slice(0, i) + LETTERS[Math.floor(rand() * LETTERS.length)] + w.slice(i + 1);
    }
    return w;
}

/**
 * Simulate reading one script. Returns a list of events:
 * { transcript, truth } where truth is the index of the last script word spoken.
 */
function simulateReading(script, cond, rand) {
    const events = [];
    let i = 0;
    while (i < script.length) {
        const length = 5 + Math.floor(rand() * 8); // utterance of 5–12 words
        const spoken = [];
        for (let k = 0; k < length && i < script.length; k++, i++) {
            if (rand() < cond.filler) spoken.push(FILLERS[Math.floor(rand() * FILLERS.length)]);
            const w = recognise(script[i], cond, rand);
            if (w) spoken.push(w);
            // Interim update after every spoken word, as Chrome does
            events.push({ transcript: spoken.join(' '), truth: i });
        }
    }
    return events;
}

function evaluate(trackerFactory, script, events) {
    const tracker = trackerFactory(script);
    let absError = 0, within2 = 0, jumps = 0, updates = 0;
    for (const { transcript, truth } of events) {
        tracker.update(transcript);
        const tracked = tracker.position - 1;
        const error = tracked - truth;
        absError += Math.abs(error);
        if (Math.abs(error) <= 2) within2++;
        if (error > 3) jumps++;
        updates++;
    }
    return {
        coverage: (tracker.position / script.length) * 100,
        meanAbsError: absError / updates,
        within2: (within2 / updates) * 100,
        jumpRate: (jumps / updates) * 100,
    };
}

const MATCHERS = {
    legacy: (script) => createLegacyTracker(script),
    new: (script) => M.createTracker(script),
};

function meanSd(values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length - 1));
    return { mean, sd };
}

// ---------- Run ----------
const rows = [];
for (const cond of CONDITIONS) {
    const samples = { legacy: [], new: [] };
    for (let run = 0; run < RUNS; run++) {
        CORPUS.forEach((script, s) => {
            const events = simulateReading(script, cond, rng(1000 * run + s + 1));
            for (const [name, factory] of Object.entries(MATCHERS)) {
                samples[name].push(evaluate(factory, script, events));
            }
        });
    }
    for (const name of Object.keys(MATCHERS)) {
        const metric = (key) => meanSd(samples[name].map(r => r[key]));
        rows.push({
            condition: cond.name,
            matcher: name,
            samples: samples[name].length,
            coverage: metric('coverage'),
            meanAbsError: metric('meanAbsError'),
            within2: metric('within2'),
            jumpRate: metric('jumpRate'),
        });
    }
}

// ---------- Report ----------
const f = (x, d = 1) => x.mean.toFixed(d) + ' ± ' + x.sd.toFixed(d);
console.log(`\nMatcher evaluation — ${CORPUS.length} scripts × ${RUNS} runs per condition (simulated ASR noise)\n`);
console.log('| Condition | Matcher | Coverage % ↑ | Mean abs. error (words) ↓ | Within ±2 words % ↑ | Jump-ahead % ↓ |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) {
    console.log(`| ${r.condition} | ${r.matcher} | ${f(r.coverage)} | ${f(r.meanAbsError, 2)} | ${f(r.within2)} | ${f(r.jumpRate, 2)} |`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const csvHeader = 'condition,matcher,samples,coverage_mean,coverage_sd,mean_abs_error_mean,mean_abs_error_sd,within2_mean,within2_sd,jump_rate_mean,jump_rate_sd';
const csv = [csvHeader, ...rows.map(r => [
    r.condition, r.matcher, r.samples,
    r.coverage.mean, r.coverage.sd, r.meanAbsError.mean, r.meanAbsError.sd,
    r.within2.mean, r.within2.sd, r.jumpRate.mean, r.jumpRate.sd,
].map(v => typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(4) : v).join(','))].join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'matcher-evaluation.csv'), csv + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'matcher-evaluation.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), runs: RUNS, scripts: CORPUS.length, conditions: CONDITIONS, rows,
}, null, 2));
// Figures for the thesis (Albanian labels)
const CONDITION_LABELS = {
    clean: 'Pa zhurmë', 'diacritics-only': 'Vetëm diakritikë', light: 'E lehtë', moderate: 'Mesatare', heavy: 'E rëndë',
};
const chartFor = (key, title, yLabel, options = {}) => groupedBarChart({
    title,
    subtitle: `Zhurmë e simuluar e njohjes së zërit · ${CORPUS.length} tekste × ${RUNS} përsëritje · shiritat e gabimit = ±1 SD`,
    categories: CONDITIONS.map(c => CONDITION_LABELS[c.name] || c.name),
    series: ['legacy', 'new'].map(name => ({
        name: name === 'legacy' ? 'Algoritmi fillestar' : 'Algoritmi i ri',
        values: CONDITIONS.map(c => rows.find(r => r.condition === c.name && r.matcher === name)[key].mean),
        errors: CONDITIONS.map(c => rows.find(r => r.condition === c.name && r.matcher === name)[key].sd),
    })),
    yLabel,
    ...options,
});
fs.writeFileSync(path.join(OUT_DIR, 'fig-matcher-within2.svg'),
    chartFor('within2', 'Sa shpesh theksimi është brenda ±2 fjalëve', 'Përditësime brenda ±2 fjalëve (%)', { yMax: 100 }));
fs.writeFileSync(path.join(OUT_DIR, 'fig-matcher-error.svg'),
    chartFor('meanAbsError', 'Gabimi mesatar i pozicionit', 'Gabimi mesatar absolut (fjalë)', { format: (v) => String(v).replace('.', ',') }));

console.log(`\nSaved ${path.relative(process.cwd(), path.join(OUT_DIR, 'matcher-evaluation.csv'))}, .json and fig-matcher-*.svg`);
