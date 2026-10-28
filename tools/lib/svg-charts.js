// Dependency-free SVG charts for thesis figures (white background, print-friendly).
// Word, LaTeX (via svg / inkscape) and browsers can all use the output directly.
'use strict';

const FONT = "font-family=\"Inter, 'Helvetica Neue', Arial, sans-serif\"";
const COLORS = ['#0a66c2', '#e8710a', '#1e8e3e', '#9334e6'];
const MUTED = '#5f6368';
const GRID = '#e3e6ea';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "Nice" axis maximum and tick step */
function niceScale(max, ticks = 5) {
    if (!(max > 0)) return { max: 1, step: 0.2 };
    const raw = max / ticks;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
    return { max: Math.ceil(max / step) * step, step };
}

function frame({ width, height, title, subtitle, watermark }) {
    const parts = [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ${FONT}>`,
        `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
        `<text x="24" y="32" font-size="17" font-weight="700" fill="#202124">${esc(title)}</text>`,
    ];
    if (subtitle) parts.push(`<text x="24" y="52" font-size="12" fill="${MUTED}">${esc(subtitle)}</text>`);
    if (watermark) {
        parts.push(`<text x="${width / 2}" y="${height / 2 + 20}" font-size="30" font-weight="800" fill="#d93025" opacity="0.14" text-anchor="middle" transform="rotate(-18 ${width / 2} ${height / 2})">${esc(watermark)}</text>`);
    }
    return parts;
}

function yAxis(parts, { x0, x1, yTop, yBottom, max, step, label, format = (v) => v }) {
    for (let v = 0; v <= max + 1e-9; v += step) {
        const y = yBottom - (v / max) * (yBottom - yTop);
        parts.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${GRID}"/>`);
        parts.push(`<text x="${x0 - 8}" y="${y + 4}" font-size="11" fill="${MUTED}" text-anchor="end">${esc(format(+v.toFixed(6)))}</text>`);
    }
    if (label) {
        const cy = (yTop + yBottom) / 2;
        parts.push(`<text x="18" y="${cy}" font-size="12" fill="${MUTED}" text-anchor="middle" transform="rotate(-90 18 ${cy})">${esc(label)}</text>`);
    }
}

function legend(parts, names, x, y) {
    let cx = x;
    names.forEach((name, i) => {
        parts.push(`<rect x="${cx}" y="${y - 10}" width="12" height="12" rx="2" fill="${COLORS[i % COLORS.length]}"/>`);
        parts.push(`<text x="${cx + 18}" y="${y}" font-size="12" fill="#202124">${esc(name)}</text>`);
        cx += 30 + name.length * 7;
    });
}

/**
 * Grouped bar chart with optional error bars.
 * series: [{ name, values: number[], errors?: number[] }], one value per category.
 */
function groupedBarChart({ title, subtitle, categories, series, yLabel, yMax, format, watermark, width = 760, height = 440 }) {
    const parts = frame({ width, height, title, subtitle, watermark });
    const left = 70, right = width - 24, top = 80, bottom = height - 60;
    const dataMax = Math.max(...series.flatMap(s => s.values.map((v, i) => v + (s.errors ? s.errors[i] : 0))));
    const { max, step } = niceScale(yMax ?? dataMax);
    yAxis(parts, { x0: left, x1: right, yTop: top, yBottom: bottom, max, step, label: yLabel, format });

    const groupWidth = (right - left) / categories.length;
    const barWidth = Math.min(38, (groupWidth * 0.7) / series.length);
    const y = (v) => bottom - (Math.min(v, max) / max) * (bottom - top);

    categories.forEach((cat, ci) => {
        const gx = left + ci * groupWidth + (groupWidth - barWidth * series.length) / 2;
        series.forEach((s, si) => {
            const v = s.values[ci];
            const x = gx + si * barWidth;
            parts.push(`<rect x="${x + 2}" y="${y(v)}" width="${barWidth - 4}" height="${bottom - y(v)}" fill="${COLORS[si % COLORS.length]}" rx="2"/>`);
            if (s.errors) {
                const e = s.errors[ci];
                const cx = x + barWidth / 2;
                parts.push(`<line x1="${cx}" y1="${y(v + e)}" x2="${cx}" y2="${y(Math.max(0, v - e))}" stroke="#202124" stroke-width="1.2"/>`);
                parts.push(`<line x1="${cx - 5}" y1="${y(v + e)}" x2="${cx + 5}" y2="${y(v + e)}" stroke="#202124" stroke-width="1.2"/>`);
            }
        });
        parts.push(`<text x="${left + ci * groupWidth + groupWidth / 2}" y="${bottom + 20}" font-size="12" fill="#202124" text-anchor="middle">${esc(cat)}</text>`);
    });
    parts.push(`<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${MUTED}"/>`);
    legend(parts, series.map(s => s.name), left, height - 18);
    parts.push('</svg>');
    return parts.join('\n');
}

/**
 * Paired dot plot: one line per participant from condition A to condition B,
 * with the median of each condition marked.
 */
function pairedPlot({ title, subtitle, conditions, pairs, yLabel, yMax, format, watermark, width = 560, height = 440 }) {
    const parts = frame({ width, height, title, subtitle, watermark });
    const left = 80, right = width - 40, top = 80, bottom = height - 56;
    const all = pairs.flat();
    const { max, step } = niceScale(yMax ?? Math.max(...all, 0));
    yAxis(parts, { x0: left, x1: right, yTop: top, yBottom: bottom, max, step, label: yLabel, format });

    const xs = [left + (right - left) * 0.28, left + (right - left) * 0.72];
    const y = (v) => bottom - (v / max) * (bottom - top);

    pairs.forEach(([a, b], i) => {
        // Small horizontal jitter keeps identical pairs visible
        const j = ((i % 5) - 2) * 3;
        parts.push(`<line x1="${xs[0] + j}" y1="${y(a)}" x2="${xs[1] + j}" y2="${y(b)}" stroke="#9aa0a6" stroke-width="1.2" opacity="0.8"/>`);
        parts.push(`<circle cx="${xs[0] + j}" cy="${y(a)}" r="4.5" fill="${COLORS[0]}"/>`);
        parts.push(`<circle cx="${xs[1] + j}" cy="${y(b)}" r="4.5" fill="${COLORS[1]}"/>`);
    });

    [0, 1].forEach(c => {
        const values = pairs.map(p => p[c]).sort((p, q) => p - q);
        const mid = values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
        parts.push(`<line x1="${xs[c] - 26}" y1="${y(mid)}" x2="${xs[c] + 26}" y2="${y(mid)}" stroke="#202124" stroke-width="3"/>`);
        parts.push(`<text x="${xs[c]}" y="${bottom + 22}" font-size="13" font-weight="600" fill="#202124" text-anchor="middle">${esc(conditions[c])}</text>`);
    });
    parts.push(`<text x="${right}" y="${height - 14}" font-size="10" fill="${MUTED}" text-anchor="end">vija e zezë = mediana · çdo vijë gri = një pjesëmarrës</text>`);
    parts.push(`<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${MUTED}"/>`);
    parts.push('</svg>');
    return parts.join('\n');
}

module.exports = { groupedBarChart, pairedPlot, niceScale };
