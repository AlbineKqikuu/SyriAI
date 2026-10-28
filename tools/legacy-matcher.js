// The original SyriAI word matcher (before the Albanian-aware rewrite), kept unchanged
// so the evaluation can compare old and new behaviour on identical input.
// Source: matchAndScroll() in wwwroot/studio/app.js, commit b5c777b.
'use strict';

function createLegacyTracker(scriptWords) {
    const words = scriptWords.slice();
    let currentWordIndex = 0;

    function matchAndScroll(spokenText) {
        const searchRange = 25;
        const lookAhead = words.slice(currentWordIndex, currentWordIndex + searchRange);

        const spokenWords = spokenText.split(/\s+/)
            .map(w => w.replace(/[.,!?;]/g, "").toLowerCase())
            .filter(w => w.length > 0);

        if (spokenWords.length === 0) return -1;

        const recentSpoken = spokenWords.slice(-3);
        const lastSpoken = recentSpoken[recentSpoken.length - 1];
        const prevSpoken = recentSpoken.length > 1 ? recentSpoken[recentSpoken.length - 2] : null;

        let bestMatchIndex = -1;
        let matchStrength = 0;

        for (let i = 0; i < lookAhead.length; i++) {
            const scriptWord = lookAhead[i].toLowerCase().replace(/[.,!?;]/g, "");
            if (scriptWord.length < 2) continue;

            if (i > 0 && prevSpoken) {
                const prevScriptWord = lookAhead[i - 1].toLowerCase().replace(/[.,!?;]/g, "");
                if (scriptWord === lastSpoken && prevScriptWord === prevSpoken) {
                    bestMatchIndex = i;
                    matchStrength = 2;
                    break;
                }
            }

            if (matchStrength < 2 && scriptWord === lastSpoken && scriptWord.length > 2) {
                if (bestMatchIndex === -1) {
                    bestMatchIndex = i;
                    matchStrength = 1;
                }
            }

            if (matchStrength < 1 && scriptWord.length > 6 && lastSpoken.length > 4) {
                if (scriptWord.startsWith(lastSpoken.substring(0, 4)) || lastSpoken.startsWith(scriptWord.substring(0, 4))) {
                    bestMatchIndex = i;
                    matchStrength = 0.5;
                }
            }
        }

        if (bestMatchIndex === -1) return -1;
        const actualIndex = currentWordIndex + bestMatchIndex;
        currentWordIndex = actualIndex + 1;
        return actualIndex;
    }

    return {
        get position() { return currentWordIndex; },
        setPosition(i) { currentWordIndex = i; },
        // The original code lowercased the transcript before matching
        update: (transcript) => matchAndScroll(transcript.toLowerCase().trim()),
    };
}

module.exports = { createLegacyTracker };
