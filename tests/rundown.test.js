// Unit tests for the rundown (story list and back-timing). Run: npm test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../SyriAI.Backend/wwwroot/studio/js/shared/rundown.js');

const SCRIPT = [
    'Mirëmbrëma, ja lajmet.',
    '## Politika | 1:30',
    'Qeveria miratoi buxhetin.',
    '## Moti',
    'Nesër diell.',
].join('\n');

test('parse splits stories and keeps headings out of the prompter words', () => {
    const { words, segments, marked } = R.parse(SCRIPT);
    assert.equal(marked, true);
    assert.deepEqual(words, ['Mirëmbrëma,', 'ja', 'lajmet.', 'Qeveria', 'miratoi', 'buxhetin.', 'Nesër', 'diell.']);
    assert.deepEqual(segments.map(s => [s.title, s.plannedSeconds, s.start, s.end]), [
        ['Hyrja', null, 0, 3],
        ['Politika', 90, 3, 6],
        ['Moti', null, 6, 8],
    ]);
});

test('a script without headings is one segment; an empty intro is dropped', () => {
    assert.deepEqual(R.parse('një dy tre').segments.map(s => [s.title, s.start, s.end]), [['Hyrja', 0, 3]]);
    assert.equal(R.parse('## A\nnjë\n## B\ndy').segments[0].title, 'A');
    assert.equal(R.parse('').segments.length, 0);
});

test('parseDuration reads m:ss and plain seconds', () => {
    assert.equal(R.parseDuration('1:30'), 90);
    assert.equal(R.parseDuration(' 45 '), 45);
    assert.equal(R.parseDuration('abc'), null);
    assert.equal(R.parseDuration('0'), null);
});

test('plannedSeconds estimates from words when no length is written', () => {
    const [, politika, moti] = R.parse(SCRIPT).segments;
    assert.equal(R.plannedSeconds(politika), 90);
    assert.equal(R.plannedSeconds(moti, 120), 1); // 2 words at 120 wpm
});

test('segmentAt finds the story of a word', () => {
    const { segments } = R.parse(SCRIPT);
    assert.equal(R.segmentAt(segments, -1), 0);
    assert.equal(R.segmentAt(segments, 4), 1);
    assert.equal(R.segmentAt(segments, 7), 2);
});

test('moveSegment reorders whole stories and keeps their text', () => {
    const moved = R.moveSegment(SCRIPT, 2, 1);
    assert.deepEqual(R.parse(moved).segments.map(s => s.title), ['Hyrja', 'Moti', 'Politika']);
    assert.deepEqual(R.parse(moved).words.length, 8);
    assert.equal(R.moveSegment(SCRIPT, 0, 9), SCRIPT);
});

test('backTime projects the finish against the plan', () => {
    // Plan 60 + 60 + 60; 70 s in, still in story 2 with 50 words left at 150 wpm (20 s)
    const t = R.backTime({ planned: [60, 60, 60], current: 1, elapsed: 70, inSegment: 10, wordsLeft: 50, wpm: 150 });
    assert.equal(t.plannedTotal, 180);
    assert.equal(t.segmentLeft, 50);
    assert.equal(t.projectedTotal, 70 + 20 + 60);
    assert.equal(t.delta, -30);
    assert.equal(R.formatDelta(t.delta), '-0:30');
    assert.equal(R.formatDelta(65), '+1:05');
});
