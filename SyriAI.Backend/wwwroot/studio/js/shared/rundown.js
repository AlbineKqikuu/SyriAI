// SyriAI Studio — rundown: the running order of a news show, written inside the script.
//
// Pure functions (no DOM), shared by the browser and the Node tests.
//
// A line that starts with "##" begins a new story (segment); an optional planned length
// follows a "|":
//
//     ## Politika | 1:30
//     Sot qeveria miratoi buxhetin...
//     ## Moti | 0:45
//     ...
//
// Text before the first "##" line is the intro. A script without "##" lines is one segment.
// Heading lines are not read aloud, so they are not part of the prompter words.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SyriRundown = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const HEADING = /^\s*##\s*(.*)$/;
    const DEFAULT_WPM = 150;

    /** "1:30" → 90, "45" → 45 (seconds); null when missing or invalid */
    function parseDuration(text) {
        const m = /^\s*(?:(\d{1,3}):)?(\d{1,4})\s*$/.exec(text || '');
        if (!m) return null;
        const seconds = (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
        return seconds > 0 ? seconds : null;
    }

    function parseHeading(line) {
        const m = HEADING.exec(line);
        if (!m) return null;
        const [title, duration] = m[1].split('|');
        return { title: title.trim(), plannedSeconds: parseDuration(duration) };
    }

    /**
     * Split a script into prompter words and segments.
     * @returns {{ words: string[], segments: Array<{ title: string, plannedSeconds: number|null,
     *            start: number, end: number, lineStart: number, lineEnd: number }>, marked: boolean }}
     *          start/end: word range [start, end); lineStart/lineEnd: source line range [lineStart, lineEnd)
     */
    function parse(text) {
        const lines = String(text || '').split('\n');
        const words = [];
        const segments = [];
        let current = null;
        let marked = false;

        const close = (lineEnd) => {
            if (!current) return;
            current.end = words.length;
            current.lineEnd = lineEnd;
            // An intro with no words is not a story
            if (current.isIntro && current.end === current.start) return;
            delete current.isIntro;
            segments.push(current);
        };

        lines.forEach((line, i) => {
            const heading = parseHeading(line);
            if (heading) {
                marked = true;
                close(i);
                current = { title: heading.title || `Lajmi ${segments.length + 1}`, plannedSeconds: heading.plannedSeconds, start: words.length, lineStart: i };
                return;
            }
            if (!current) current = { title: 'Hyrja', plannedSeconds: null, start: 0, lineStart: 0, isIntro: true };
            for (const w of line.trim().split(/\s+/)) if (w) words.push(w);
        });
        close(lines.length);
        return { words, segments, marked };
    }

    /** Planned seconds of a segment: written in the script, or estimated from its words at `wpm` */
    function plannedSeconds(segment, wpm = DEFAULT_WPM) {
        if (segment.plannedSeconds) return segment.plannedSeconds;
        return Math.round(((segment.end - segment.start) / Math.max(1, wpm)) * 60);
    }

    /** Index of the segment that contains word `index` (the last one that starts at or before it) */
    function segmentAt(segments, index) {
        let found = 0;
        for (let i = 0; i < segments.length; i++) {
            if (segments[i].start <= Math.max(0, index)) found = i;
            else break;
        }
        return found;
    }

    /** Script text with segment `from` moved to position `to` (both indexes into parse().segments) */
    function moveSegment(text, from, to) {
        const lines = String(text || '').split('\n');
        const { segments } = parse(text);
        if (from === to || !segments[from] || !segments[to]) return text;

        const blocks = segments.map(s => lines.slice(s.lineStart, s.lineEnd));
        const head = lines.slice(0, segments[0].lineStart);
        const [moved] = blocks.splice(from, 1);
        blocks.splice(to, 0, moved);
        // Keep a blank line between stories so the moved block does not join the previous text
        const body = blocks.map(b => {
            const copy = b.slice();
            while (copy.length && !copy[copy.length - 1].trim()) copy.pop();
            return copy.join('\n');
        });
        return [...head, body.join('\n\n')].join('\n') + '\n';
    }

    /**
     * Back-timing for a live show.
     * @param {object} p
     * @param {number[]} p.planned planned seconds per segment
     * @param {number} p.current index of the current segment
     * @param {number} p.elapsed seconds since the show started
     * @param {number} p.inSegment seconds spent in the current segment so far
     * @param {number} p.wordsLeft words left in the current segment
     * @param {number} p.wpm current reading pace
     * @param {boolean[]} p.done segments already finished or skipped (not counted again)
     * @returns {{ segmentLeft: number, plannedTotal: number, projectedTotal: number, delta: number }}
     *          delta > 0: the show will run over the plan by that many seconds
     */
    function backTime({ planned, current, elapsed, inSegment, wordsLeft, wpm, done = [] }) {
        const plannedTotal = planned.reduce((a, b) => a + b, 0);
        const segmentLeft = planned[current] - inSegment;
        const currentLeft = wpm > 0 ? (wordsLeft / wpm) * 60 : Math.max(0, segmentLeft);
        let later = 0;
        for (let i = 0; i < planned.length; i++) {
            if (i > current && !done[i]) later += planned[i];
        }
        const projectedTotal = elapsed + currentLeft + later;
        return { segmentLeft, plannedTotal, projectedTotal, delta: projectedTotal - plannedTotal };
    }

    /** "+1:05" / "-0:20" / "0:00" */
    function formatDelta(seconds) {
        const s = Math.round(seconds);
        const abs = Math.abs(s);
        const text = `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
        return s > 0 ? `+${text}` : s < 0 ? `-${text}` : text;
    }

    return { DEFAULT_WPM, parseDuration, parse, plannedSeconds, segmentAt, moveSegment, backTime, formatDelta };
});
