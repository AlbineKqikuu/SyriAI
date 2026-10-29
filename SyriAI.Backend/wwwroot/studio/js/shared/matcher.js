// SyriAI Studio — speech-to-script word matching.
//
// Pure functions (no DOM), shared by the browser and the Node test / evaluation tools.
//
// Pipeline for every speech-recognition update:
//   1. normalize words: lowercase, strip diacritics (ë→e, ç→c), strip punctuation
//   2. look at the last spoken word and search a window ahead of the current position
//   3. score candidates: exact > near (edit distance) > prefix, plus a bonus for each
//      preceding spoken word that also lines up with the script ("context")
//   4. short, very common words (e, në, të…) only count when context confirms them
//   5. recovery: after several new words without a match (the reader skipped ahead, went
//      back or improvised), search the whole script for the last few spoken words in a row
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SyriMatcher = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const DEFAULTS = {
        lookAhead: 25,       // how many script words ahead of the position to search
        contextWords: 2,     // how many preceding words to use as context
        minWordLength: 3,    // shorter words need context to be matched
        maxPrefixJump: 5,    // weak (prefix-only) guesses further ahead than this are ignored
        resyncAfter: 3,      // updates without a match before searching the whole script (0 = off)
        resyncWords: 3,      // spoken words that must line up in a row to jump there
    };

    /** Lowercase, remove diacritics and punctuation: "Prishtinë," → "prishtine" */
    function normalizeWord(word) {
        return String(word)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^\p{L}\p{N}]+/gu, '');
    }

    /** Split text into normalized words, dropping empty tokens (e.g. lone punctuation) */
    function tokenize(text) {
        return String(text).split(/\s+/).map(normalizeWord).filter(Boolean);
    }

    /** Levenshtein distance; returns max + 1 as soon as the distance is known to exceed max */
    function editDistance(a, b, max = Infinity) {
        if (a === b) return 0;
        if (Math.abs(a.length - b.length) > max) return max + 1;
        let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
        for (let i = 1; i <= a.length; i++) {
            const cur = [i];
            let rowMin = i;
            for (let j = 1; j <= b.length; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
                if (cur[j] < rowMin) rowMin = cur[j];
            }
            if (rowMin > max) return max + 1;
            prev = cur;
        }
        return prev[b.length];
    }

    /**
     * Similarity of two normalized words:
     * 1 = identical, 0.8 = near (1 edit, or 2 edits for 8+ letters), 0.5 = shared 4-letter stem, 0 = different
     */
    function wordScore(scriptWord, spokenWord) {
        if (!scriptWord || !spokenWord) return 0;
        if (scriptWord === spokenWord) return 1;

        const shorter = Math.min(scriptWord.length, spokenWord.length);
        const longer = Math.max(scriptWord.length, spokenWord.length);
        if (shorter >= 4) {
            const allowed = longer >= 8 ? 2 : 1;
            if (editDistance(scriptWord, spokenWord, allowed) <= allowed) return 0.8;
        }
        // Inflected forms: "qeveria" / "qeverise"
        if (longer >= 6 && shorter >= 4 && scriptWord.slice(0, 4) === spokenWord.slice(0, 4)) return 0.5;
        return 0;
    }

    /**
     * Find where the last spoken word is in the script.
     * @param {string[]} scriptWords normalized script words
     * @param {number} fromIndex index of the next expected word
     * @param {string[]} spokenWords normalized spoken words (most recent last)
     * @returns {{index:number, score:number, strength:number, context:number} | null}
     */
    function findMatch(scriptWords, fromIndex, spokenWords, options = {}) {
        const opts = { ...DEFAULTS, ...options };
        if (!spokenWords.length) return null;

        const last = spokenWords[spokenWords.length - 1];
        const end = Math.min(scriptWords.length, fromIndex + opts.lookAhead);
        let best = null;

        for (let i = Math.max(0, fromIndex); i < end; i++) {
            const strength = wordScore(scriptWords[i], last);
            if (strength === 0) continue;

            // Count preceding words that line up (they may be words already read)
            let context = 0;
            for (let k = 1; k <= opts.contextWords; k++) {
                const spoken = spokenWords[spokenWords.length - 1 - k];
                const script = scriptWords[i - k];
                if (spoken === undefined || script === undefined) break;
                if (wordScore(script, spoken) >= 0.8) context++;
                else break;
            }

            if (scriptWords[i].length < opts.minWordLength && context === 0) continue;

            // Prefer the nearest candidate when scores are otherwise equal
            const score = strength + context - (i - fromIndex) * 0.01;
            if (!best || score > best.score) best = { index: i, score, strength, context };
        }

        if (best && best.context === 0 && best.strength < 0.8 && best.index - fromIndex > opts.maxPrefixJump) {
            return null;
        }
        return best;
    }

    /**
     * Search the whole script for the last `resyncWords` spoken words in a row, to find a
     * reader who left the look-ahead window. At least one of the words must be long enough
     * to mean something (three common short words in a row are not evidence).
     * Prefers the place nearest to the current position, forward over backward.
     * @returns {{index:number} | null}
     */
    function findResync(scriptWords, fromIndex, spokenWords, options = {}) {
        const opts = { ...DEFAULTS, ...options };
        const n = opts.resyncWords;
        if (n < 1 || spokenWords.length < n) return null;
        const tail = spokenWords.slice(-n);
        if (!tail.some(w => w.length >= opts.minWordLength + 1)) return null;

        let best = null;
        for (let i = n - 1; i < scriptWords.length; i++) {
            let lined = true;
            for (let k = 0; k < n && lined; k++) {
                lined = wordScore(scriptWords[i - k], tail[n - 1 - k]) >= 0.8;
            }
            if (!lined) continue;
            const distance = i >= fromIndex ? i - fromIndex : (fromIndex - i) * 2;
            if (!best || distance < best.distance) best = { index: i, distance };
        }
        return best && { index: best.index };
    }

    /**
     * Stateful tracker for one script. Feed it every recognition transcript;
     * it ignores repeated interim updates that bring no new word.
     */
    function createTracker(scriptWords, options = {}) {
        const words = scriptWords.map(normalizeWord);
        const opts = { ...DEFAULTS, ...options };
        let position = 0;
        let lastKey = null;
        let misses = 0;
        let recoveries = 0;
        let recovered = false;

        return {
            get position() { return position; },
            get length() { return words.length; },
            /** True while several new words in a row did not match (the reader is off-script) */
            get lost() { return opts.resyncAfter > 0 && misses >= opts.resyncAfter; },
            /** Times the reader was found again through the whole-script search */
            get recoveries() { return recoveries; },
            /** True when the last matched index came from the whole-script search */
            get recovered() { return recovered; },

            /** Move the expected position (e.g. after keyboard navigation) */
            setPosition(index) {
                position = Math.max(0, Math.min(words.length, index));
                lastKey = null;
                misses = 0;
            },

            /**
             * @returns {number|null} matched script index, -1 when the new word did not match,
             *          or null when the transcript brought no new word (ignored update)
             */
            update(transcript) {
                const spoken = tokenize(transcript);
                if (!spoken.length) return null;

                // Chrome resends the whole interim sentence on every update: only react to new words
                const key = spoken.length + '|' + spoken[spoken.length - 1];
                if (key === lastKey) return null;
                lastKey = key;
                recovered = false;

                const match = findMatch(words, position, spoken, opts);
                if (match) {
                    misses = 0;
                    position = match.index + 1;
                    return match.index;
                }

                misses++;
                if (opts.resyncAfter > 0 && misses >= opts.resyncAfter) {
                    const found = findResync(words, position, spoken, opts);
                    if (found) {
                        misses = 0;
                        recoveries++;
                        recovered = true;
                        position = found.index + 1;
                        return found.index;
                    }
                }
                return -1;
            },
        };
    }

    return { DEFAULTS, normalizeWord, tokenize, editDistance, wordScore, findMatch, findResync, createTracker };
});
