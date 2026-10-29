// Unit tests for the speech-to-script matcher. Run: npm test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../SyriAI.Backend/wwwroot/studio/js/shared/matcher.js');
const { createLegacyTracker } = require('../tools/legacy-matcher.js');

const words = (text) => text.split(/\s+/).filter(Boolean);

test('normalizeWord strips Albanian diacritics, case and punctuation', () => {
    assert.equal(M.normalizeWord('Prishtinë,'), 'prishtine');
    assert.equal(M.normalizeWord('Çështja'), 'ceshtja');
    assert.equal(M.normalizeWord('«Lajmi»'), 'lajmi');
    assert.equal(M.normalizeWord('12/05'), '1205');
    assert.equal(M.normalizeWord('—'), '');
});

test('tokenize drops punctuation-only tokens', () => {
    assert.deepEqual(M.tokenize('Mirëmbrëma — të nderuar!'), ['mirembrema', 'te', 'nderuar']);
});

test('editDistance is exact and stops early past the limit', () => {
    assert.equal(M.editDistance('qeveria', 'qeveria'), 0);
    assert.equal(M.editDistance('qeveria', 'qeveri'), 1);
    assert.equal(M.editDistance('buxhetin', 'buxhetit'), 1);
    assert.equal(M.editDistance('abc', 'xyz', 1), 2); // max + 1
});

test('wordScore grades exact, near and stem matches', () => {
    assert.equal(M.wordScore('prishtine', 'prishtine'), 1);
    assert.equal(M.wordScore('buxhetin', 'buxhetit'), 0.8);      // one edit
    assert.equal(M.wordScore('qeveria', 'qeverise'), 0.8);       // two edits allowed for 8+ letters
    assert.equal(M.wordScore('qeveria', 'qeverisjes'), 0.5);     // shared stem (inflection)
    assert.equal(M.wordScore('sot', 'sod'), 0);                  // short words must be exact
    assert.equal(M.wordScore('lajmet', 'moti'), 0);
});

test('findMatch uses context to choose between repeated words', () => {
    const script = M.tokenize('Sot në Kosovë dhe sot në Shqipëri');
    const match = M.findMatch(script, 0, M.tokenize('dhe sot'));
    assert.equal(match.index, 4); // the second "sot", confirmed by "dhe"
});

test('findMatch ignores short common words without context', () => {
    const script = M.tokenize('Qeveria e Kosovës dhe e Shqipërisë');
    assert.equal(M.findMatch(script, 0, ['e']), null);
    assert.equal(M.findMatch(script, 0, ['qeveria', 'e']).index, 1);
});

test('findMatch only searches inside the look-ahead window', () => {
    const script = M.tokenize('një dy tre katër pesë gjashtë shtatë tetë nëntë dhjetë');
    assert.equal(M.findMatch(script, 0, ['dhjete'], { lookAhead: 5 }), null);
    assert.equal(M.findMatch(script, 0, ['dhjete'], { lookAhead: 10 }).index, 9);
});

test('tracker follows speech without diacritics', () => {
    const tracker = M.createTracker(words('Mirëmbrëma të nderuar shikues. Sot në Prishtinë qeveria mbajti mbledhjen.'));
    assert.equal(tracker.update('mirembrema'), 0);
    assert.equal(tracker.update('mirembrema te nderuar'), 2);
    assert.equal(tracker.update('sot ne prishtine'), 6);
    assert.equal(tracker.position, 7);
});

test('tracker ignores repeated interim transcripts (no jump ahead)', () => {
    const tracker = M.createTracker(words('të mirë të dashur të nderuar të gjithë'));
    assert.equal(tracker.update('te mire'), 1);
    // The same interim sentence again brings no new word: must not move to a later "të"
    assert.equal(tracker.update('te mire'), null);
    assert.equal(tracker.position, 2);
});

test('tracker.setPosition syncs with keyboard navigation', () => {
    const tracker = M.createTracker(words('një dy tre katër pesë'));
    tracker.setPosition(3);
    assert.equal(tracker.update('kater'), 3);
    tracker.setPosition(99);
    assert.equal(tracker.position, 5);
});

test('legacy matcher fails on missing diacritics in short words where the new one succeeds', () => {
    const script = words('Sot moti është i ngrohtë në të gjithë vendin');
    const legacy = createLegacyTracker(script);
    const current = M.createTracker(script);
    // Speech output without diacritics: "eshte" ≠ "është"; the old prefix fallback only covers 7+ letter words
    assert.equal(legacy.update("sot moti eshte"), -1); // "eshte" not found
    assert.equal(current.update('sot moti eshte'), 2);
});

// A script longer than the look-ahead window (25 words), so a skip cannot be found the normal way
const LONG_SCRIPT = words(
    'Mirëmbrëma të nderuar shikues sot qeveria miratoi buxhetin për vitin e ardhshëm pas një debati ' +
    'të gjatë në parlament ku opozita kërkoi më shumë para për shëndetësinë dhe arsimin ndërsa ' +
    'ministri i financave tha se deficiti do të mbetet nën tre përqind në sport ekipi kombëtar ' +
    'fitoi ndeshjen miqësore kundër Maltës me rezultat dy me zero falë golave të Muriqit');

test('tracker finds a reader who skipped far ahead after a few misses', () => {
    const tracker = M.createTracker(LONG_SCRIPT);
    assert.equal(tracker.update('mirembrema te nderuar'), 2);
    // Jumps to the sport story, ~40 words ahead (outside the look-ahead window)
    assert.equal(tracker.update('mirembrema te nderuar ekipi'), -1);
    assert.equal(tracker.update('mirembrema te nderuar ekipi kombetar'), -1);
    assert.equal(tracker.lost, false);
    const index = tracker.update('mirembrema te nderuar ekipi kombetar fitoi');
    assert.equal(LONG_SCRIPT[index], 'fitoi');
    assert.equal(tracker.recovered, true);
    assert.equal(tracker.recoveries, 1);
    assert.equal(tracker.lost, false);
    // Normal tracking continues from there
    assert.equal(LONG_SCRIPT[tracker.update('ekipi kombetar fitoi ndeshjen')], 'ndeshjen');
    assert.equal(tracker.recovered, false);
});

test('tracker reports "lost" while the reader improvises', () => {
    const tracker = M.createTracker(LONG_SCRIPT);
    tracker.update('mirembrema te nderuar');
    tracker.update('mirembrema te nderuar une');
    tracker.update('mirembrema te nderuar une dua');
    assert.equal(tracker.update('mirembrema te nderuar une dua thjesht'), -1);
    assert.equal(tracker.lost, true);
    assert.equal(tracker.recoveries, 0);
    // Back on script: the normal window finds it and "lost" clears
    assert.equal(LONG_SCRIPT[tracker.update('sot qeveria')], 'qeveria');
    assert.equal(tracker.lost, false);
});

test('findResync needs one meaningful word and prefers the nearest place, forward first', () => {
    const script = M.tokenize('a b c dita e mire x y z dita e mire');
    assert.equal(M.findResync(script, 0, M.tokenize('dita e mire')).index, 5);
    assert.equal(M.findResync(script, 12, M.tokenize('dita e mire')).index, 11);
    assert.equal(M.findResync(script, 0, M.tokenize('e te ne')), null);
    assert.equal(M.createTracker(LONG_SCRIPT, { resyncAfter: 0 }).lost, false);
});
