#!/usr/bin/env node
// Analyse the user study: voice tracking (voice) vs auto-scroll (autoscroll), within subjects.
//
// Input: the CSV from the studio (Historiku → Eksporto të gjitha, or /api/sessions/export.csv).
// Output (in --out, default tools/results/study):
//   study-results.md   tables + result sentences ready for the thesis
//   study-paired.csv   one row per participant, both conditions side by side
//   fig-*.svg          paired plots per measure
//
// Usage:
//   node tools/analyze-study.js path/to/syriai-sessions.csv [--out dir]
//   node tools/analyze-study.js --demo      (simulated data, only to try the pipeline; clearly marked DEMO)
'use strict';

const fs = require('fs');
const path = require('path');
const S = require('./lib/stats.js');
const { pairedPlot } = require('./lib/svg-charts.js');

const CONDITIONS = [
    { key: 'voice', label: 'Njohje zëri' },
    { key: 'autoscroll', label: 'Lëvizje automatike' },
];

// Measures compared between conditions. lowerIsBetter only affects the wording.
const MEASURES = [
    { column: 'observer_lost_count', name: 'Herë që humbi vendin (vëzhguesi)', short: 'lost-place', unit: '', lowerIsBetter: true },
    { column: 'stalls', name: 'Ndalesa > 4 s (automatike)', short: 'stalls', unit: '', lowerIsBetter: true },
    { column: 'sus_score', name: 'Përdorshmëria SUS (0–100)', short: 'sus', unit: '', lowerIsBetter: false, yMax: 100 },
    { column: 'avg_wpm', name: 'Shpejtësia mesatare (fjalë/min)', short: 'wpm', unit: '' },
    { column: 'eye_contact_pct', name: 'Shikim drejt kamerës (%)', short: 'eye-contact', unit: '%', lowerIsBetter: false, yMax: 100 },
    { column: 'duration_s', name: 'Kohëzgjatja (s)', short: 'duration', unit: ' s' },
];

// ---------- CLI ----------
const args = process.argv.slice(2);
const demo = args.includes('--demo');
const outIndex = args.indexOf('--out');
const inputPath = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const outDir = outIndex >= 0 ? args[outIndex + 1]
    : path.join(__dirname, 'results', demo ? 'study-demo' : 'study');

if (!demo && !inputPath) {
    console.error('Usage: node tools/analyze-study.js <sessions.csv> [--out dir]   (or --demo)');
    process.exit(1);
}

// ---------- CSV ----------
function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (c === '"') quoted = false;
            else cell += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(cell); rows.push(row); row = []; cell = '';
        } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const [header, ...data] = rows.filter(r => r.some(c => c !== ''));
    return data.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

// ---------- Demo data (clearly simulated) ----------
function demoRows() {
    let seed = 42;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const rows = [];
    for (let p = 1; p <= 10; p++) {
        const skill = rand();
        CONDITIONS.forEach(({ key }, c) => {
            const voice = key === 'voice';
            rows.push({
                participant: `P${String(p).padStart(2, '0')}`,
                condition: key,
                started_at_utc: `2026-10-0${1 + (p % 5)} 10:0${c}:00`,
                duration_s: String(Math.round(110 + rand() * 40 + (voice ? 0 : 8))),
                avg_wpm: String(Math.round(125 + skill * 30 + rand() * 10 - (voice ? 0 : 6))),
                stalls: String(Math.max(0, Math.round((voice ? 0.6 : 2.2) + rand() * 1.5 - skill))),
                eye_contact_pct: String(Math.round(62 + rand() * 20 + (voice ? 6 : 0))),
                observer_lost_count: String(Math.max(0, Math.round((voice ? 0.8 : 2.6) + rand() * 2 - skill * 1.5))),
                sus_score: String(Math.min(100, Math.round((voice ? 78 : 68) + (rand() - 0.5) * 18) / 2.5 * 2.5)),
            });
        });
    }
    return rows;
}

// ---------- Pairing ----------
const rows = demo ? demoRows() : parseCsv(fs.readFileSync(inputPath, 'utf8'));
const num = (v) => (v === undefined || v === '' ? null : Number(v));

// If a participant has several sessions in one condition, the latest one is used
const byParticipant = new Map();
for (const r of rows) {
    if (!r.participant || !CONDITIONS.some(c => c.key === r.condition)) continue;
    const entry = byParticipant.get(r.participant) || {};
    const prev = entry[r.condition];
    if (!prev || (r.started_at_utc || '') > (prev.started_at_utc || '')) entry[r.condition] = r;
    byParticipant.set(r.participant, entry);
}
const participants = [...byParticipant.entries()]
    .filter(([, e]) => CONDITIONS.every(c => e[c.key]))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
const excluded = [...byParticipant.keys()].filter(p => !participants.some(([q]) => q === p));

if (!participants.length) {
    console.error('No participant has sessions in both conditions (voice and autoscroll).');
    console.error('Label sessions in the studio: “Të dhënat e studimit” → participant ID + condition.');
    process.exit(1);
}

// ---------- Analysis ----------
// Albanian number format in the report: decimal comma
const fmt = (x, d = 1) => (x === null || Number.isNaN(x) ? '—' : Number(x).toFixed(d).replace(/\.0+$/, '').replace('.', ','));
const fmtP = (p) => (p < 0.001 ? '< 0,001' : p.toFixed(3).replace('.', ','));

const results = [];
for (const m of MEASURES) {
    const pairs = participants
        .map(([id, e]) => [id, num(e.voice[m.column]), num(e.autoscroll[m.column])])
        .filter(([, a, b]) => a !== null && b !== null && !Number.isNaN(a) && !Number.isNaN(b));
    if (pairs.length < 2) {
        results.push({ m, n: pairs.length, skipped: true });
        continue;
    }
    const a = pairs.map(p => p[1]);
    const b = pairs.map(p => p[2]);
    const test = S.wilcoxonSignedRank(a, b);
    results.push({
        m, n: pairs.length, pairs, test,
        voice: { median: S.median(a), q1: S.quantile(a, 0.25), q3: S.quantile(a, 0.75), mean: S.mean(a), sd: S.sd(a) },
        auto: { median: S.median(b), q1: S.quantile(b, 0.25), q3: S.quantile(b, 0.75), mean: S.mean(b), sd: S.sd(b) },
    });
}

// ---------- Output ----------
fs.mkdirSync(outDir, { recursive: true });
const watermark = demo ? 'DEMO — të dhëna të simuluara' : undefined;

const md = [];
if (demo) md.push('> **DEMO — këto janë të dhëna të simuluara, jo rezultate reale.** Përdoren vetëm për të provuar analizën.\n');
md.push(`# Rezultatet e studimit me përdorues\n`);
md.push(`- Pjesëmarrës me të dy kushtet: **${participants.length}**${excluded.length ? ` (përjashtuar pa të dy kushtet: ${excluded.join(', ')})` : ''}`);
md.push(`- Dizajni: brenda subjekteve; krahasim i çiftuar *Njohje zëri* vs *Lëvizje automatike*`);
md.push(`- Testi: Wilcoxon signed-rank (dy-anësor), madhësia e efektit r = |Z|/√n; α = 0,05`);
md.push(`- Burimi: ${demo ? 'të dhëna demo' : path.basename(inputPath)} · gjeneruar ${new Date().toISOString().slice(0, 16).replace('T', ' ')}\n`);

md.push('| Masa | n | Njohje zëri — mediana [IQR] | Lëvizje automatike — mediana [IQR] | W | p | r |');
md.push('|---|---|---|---|---|---|---|');
for (const r of results) {
    if (r.skipped) { md.push(`| ${r.m.name} | ${r.n} | — | — | — | — | — |`); continue; }
    md.push(`| ${r.m.name} | ${r.n} | ${fmt(r.voice.median)} [${fmt(r.voice.q1)}–${fmt(r.voice.q3)}] | ${fmt(r.auto.median)} [${fmt(r.auto.q1)}–${fmt(r.auto.q3)}] | ${fmt(r.test.W)} | ${fmtP(r.test.p)} | ${fmt(r.test.r, 2)} |`);
}

md.push('\n## Mesatarja ± devijimi standard\n');
md.push('| Masa | Njohje zëri | Lëvizje automatike |');
md.push('|---|---|---|');
for (const r of results.filter(x => !x.skipped)) {
    md.push(`| ${r.m.name} | ${fmt(r.voice.mean)} ± ${fmt(r.voice.sd)} | ${fmt(r.auto.mean)} ± ${fmt(r.auto.sd)} |`);
}

md.push('\n## Fjali për kapitullin e rezultateve (kontrolloni dhe përshtatni)\n');
const effectWord = (r) => (r >= 0.5 ? 'i madh' : r >= 0.3 ? 'mesatar' : r >= 0.1 ? 'i vogël' : 'i papërfillshëm');
for (const r of results.filter(x => !x.skipped)) {
    const sig = r.test.p < 0.05;
    const better = r.m.lowerIsBetter === undefined ? null
        : (r.m.lowerIsBetter ? r.voice.median < r.auto.median : r.voice.median > r.auto.median);
    const direction = r.voice.median === r.auto.median ? 'e njëjtë në të dy kushtet'
        : `${r.voice.median < r.auto.median ? 'më e ulët' : 'më e lartë'} me njohje zëri`;
    md.push(`- **${r.m.name}:** mediana ishte ${direction} (${fmt(r.voice.median)}${r.m.unit} kundrejt ${fmt(r.auto.median)}${r.m.unit}; ` +
        `W = ${fmt(r.test.W)}, p = ${fmtP(r.test.p)}, r = ${fmt(r.test.r, 2)}, efekt ${effectWord(r.test.r)}). ` +
        (sig ? `Ndryshimi është statistikisht i rëndësishëm${better === true ? ' në favor të njohjes së zërit' : better === false ? ' në favor të lëvizjes automatike' : ''}.`
            : 'Ndryshimi nuk është statistikisht i rëndësishëm.'));
}
if (participants.length < 6) {
    md.push(`\n> Me n = ${participants.length}, testi i saktë Wilcoxon nuk mund të arrijë p < 0,05 (minimumi n = 6). Raportoni statistikat përshkruese dhe madhësinë e efektit.`);
}
md.push('\n## Figurat\n');
for (const r of results.filter(x => !x.skipped)) md.push(`- \`fig-${r.m.short}.svg\` — ${r.m.name}`);
fs.writeFileSync(path.join(outDir, 'study-results.md'), md.join('\n') + '\n');

// Paired CSV (one row per participant)
const header = ['participant', ...MEASURES.flatMap(m => [`${m.column}_voice`, `${m.column}_autoscroll`])];
const csvRows = participants.map(([id, e]) => [id, ...MEASURES.flatMap(m => [e.voice[m.column] ?? '', e.autoscroll[m.column] ?? ''])]);
fs.writeFileSync(path.join(outDir, 'study-paired.csv'), '﻿' + [header, ...csvRows].map(r => r.join(',')).join('\n') + '\n');

// Figures
for (const r of results.filter(x => !x.skipped)) {
    const svg = pairedPlot({
        title: r.m.name,
        subtitle: `n = ${r.n} · Wilcoxon p = ${fmtP(r.test.p)} · r = ${fmt(r.test.r, 2)}`,
        conditions: CONDITIONS.map(c => c.label),
        pairs: r.pairs.map(p => [p[1], p[2]]),
        yLabel: r.m.name.replace(/ \(.*\)$/, ''),
        yMax: r.m.yMax,
        watermark,
    });
    fs.writeFileSync(path.join(outDir, `fig-${r.m.short}.svg`), svg);
}

console.log(fs.readFileSync(path.join(outDir, 'study-results.md'), 'utf8'));
console.log(`Saved to ${path.relative(process.cwd(), outDir) || '.'}/`);
