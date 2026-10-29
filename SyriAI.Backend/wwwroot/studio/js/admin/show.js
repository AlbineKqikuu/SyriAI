// SyriAI Studio — live show tools: rundown (story list), back-timing, producer messages to
// the presenter and the "lost place" indicator of the speech tracker.
//
// Stories come from "## Title | 1:30" lines in the script (js/shared/rundown.js). While LIVE
// we follow which story the reader is in, how long each one takes and whether the show will
// end on time; the presenter screen gets the same timing (message 'show_timing').

const LiveShow = (() => {
    const TICK_MS = 500;
    const MIN_WORDS_FOR_PACE = 20;      // before this, the planned pace is used
    const VOICE_COMMAND_GAP_MS = 4000;  // one voice command per this interval (interim results repeat)
    const NEXT_STORY_PHRASES = ['lajmi tjeter', 'lajmi i radhes', 'next story'];
    const QUICK_CUES = ['Ngadalëso', 'Shpejto', 'Kalo te lajmi tjetër', 'Edhe 30 sekonda', 'Mbyll lajmin', 'Shiko kamerën'];

    const listEl = document.getElementById('rundown-list');
    const hintEl = document.getElementById('rundown-hint');
    const totalEl = document.getElementById('rundown-total');
    const nextBtn = document.getElementById('rundown-next-btn');
    const addBtn = document.getElementById('rundown-add-btn');
    const statSegment = document.getElementById('stat-segment');
    const statSegmentLabel = document.getElementById('stat-segment-label');
    const statPlan = document.getElementById('stat-plan');
    const statPlanLabel = document.getElementById('stat-plan-label');
    const lostBadge = document.getElementById('tracking-lost');
    const cueQuick = document.getElementById('cue-quick');
    const cueInput = document.getElementById('cue-input');
    const cueSendBtn = document.getElementById('cue-send-btn');
    const cueClearBtn = document.getElementById('cue-clear-btn');
    const cueStatus = document.getElementById('cue-status');

    let segments = [];
    let marked = false;
    /** While LIVE: { current, enteredAt, spent[], reached[], skipped[], visited[] } */
    let state = null;
    let timer = null;
    let lastVoiceCommand = 0;
    let lost = false;
    let foundTimer = null;
    let lastTiming = null;
    let cue = null;

    const planned = (i) => SyriRundown.plannedSeconds(segments[i], studioSettings.targetWpm);
    const fmt = (seconds) => formatDuration(Math.abs(seconds));

    // ---------- Segments ----------
    function setSegments(list, isMarked) {
        segments = list;
        marked = isMarked;
        if (state && state.spent.length !== segments.length) {
            // The script changed while LIVE: keep the clock, restart the per-story figures
            state = newState(Math.min(state.current, Math.max(0, segments.length - 1)));
        }
        renderList();
        tick();
    }

    function newState(current = 0) {
        const n = segments.length;
        return {
            current,
            enteredAt: Date.now(),
            spent: new Array(n).fill(0),
            reached: new Array(n).fill(-1),
            skipped: new Array(n).fill(false),
            visited: new Array(n).fill(false).map((_, i) => i === current),
        };
    }

    function currentIndex() {
        if (state) return state.current;
        return segments.length ? SyriRundown.segmentAt(segments, lastReadIndex) : 0;
    }

    function secondsIn(i) {
        if (!state) return 0;
        return (state.spent[i] + (i === state.current ? Date.now() - state.enteredAt : 0)) / 1000;
    }

    function enter(i) {
        if (!state || i === state.current || !segments[i]) return;
        const now = Date.now();
        state.spent[state.current] += now - state.enteredAt;
        state.current = i;
        state.enteredAt = now;
        state.visited[i] = true;
        state.skipped[i] = false;
        renderList();
        tick();
    }

    // ---------- Rundown panel ----------
    function renderList() {
        const live = !!state;
        const current = currentIndex();
        hintEl.hidden = marked;
        nextBtn.disabled = segments.length < 2;

        listEl.innerHTML = segments.map((seg, i) => {
            const classes = ['rundown-item'];
            if (i === current) classes.push('is-current');
            if (state?.skipped[i]) classes.push('is-skipped');
            else if (live && state.visited[i] && i < current) classes.push('is-done');
            const estimated = !seg.plannedSeconds;
            const actual = live && state.visited[i] ? `<span class="rundown-actual" data-actual="${i}">${fmt(secondsIn(i))}</span>` : '';
            const buttons = live
                ? `<button class="icon-btn icon-btn--sm" data-action="skip" title="${state.skipped[i] ? 'Riktheje në plan' : 'Hiqe nga plani (nuk lexohet)'}" aria-label="Hiq">${state.skipped[i] ? '↺' : '✕'}</button>`
                : `<button class="icon-btn icon-btn--sm" data-action="up" title="Lart" aria-label="Lart" ${i === 0 ? 'disabled' : ''}>↑</button>
                   <button class="icon-btn icon-btn--sm" data-action="down" title="Poshtë" aria-label="Poshtë" ${i === segments.length - 1 ? 'disabled' : ''}>↓</button>`;
            return `<li class="${classes.join(' ')}" data-index="${i}">
                <button class="rundown-main" data-action="jump" title="Shko te ky lajm">
                    <span class="rundown-num">${i + 1}</span>
                    <span class="rundown-title">${escapeHtml(seg.title)}</span>
                    <span class="rundown-time">${actual}<span class="rundown-plan" title="${estimated ? `Vlerësuar nga ${seg.end - seg.start} fjalë me ${studioSettings.targetWpm} fjalë/min` : 'Kohëzgjatja e planifikuar'}">${estimated ? '~' : ''}${fmt(planned(i))}</span></span>
                </button>
                ${buttons}
            </li>`;
        }).join('');

        const total = segments.reduce((sum, _, i) => sum + (state?.skipped[i] ? 0 : planned(i)), 0);
        totalEl.textContent = segments.length ? `${segments.length} lajme · ${fmt(total)}` : '';
    }

    listEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const i = Number(btn.closest('li').dataset.index);
        switch (btn.dataset.action) {
            case 'jump':
                jumpTo(i);
                break;
            case 'skip':
                if (!state) return;
                state.skipped[i] = !state.skipped[i];
                if (state.skipped[i] && i === state.current) return step(1);
                renderList();
                tick();
                break;
            case 'up':
            case 'down':
                moveStory(i, i + (btn.dataset.action === 'up' ? -1 : 1));
                break;
        }
    });

    /** Reorder stories by rewriting the script text (only before LIVE) */
    function moveStory(from, to) {
        if (state) return;
        scriptInput.value = SyriRundown.moveSegment(scriptInput.value, from, to);
        scriptInput.dispatchEvent(new Event('input')); // draft autosave + unsaved marker
        applyScriptText();
    }

    function jumpTo(i) {
        const seg = segments[i];
        if (!seg) return;
        jumpToWord(seg.start);
        document.getElementById(`segment-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        broadcastUpdate('segment_jump', i);
        enter(i);
        renderList();
    }

    /** Next (+1) or previous (-1) story, passing over stories removed from the plan */
    function step(direction) {
        if (segments.length < 2) return;
        let i = currentIndex() + direction;
        while (state && segments[i] && state.skipped[i]) i += direction;
        if (!segments[i]) {
            notify(direction > 0 ? "Ky është lajmi i fundit." : "Ky është lajmi i parë.", 'info', 2000);
            return;
        }
        jumpTo(i);
    }

    nextBtn.addEventListener('click', () => step(1));

    addBtn.addEventListener('click', () => {
        const at = scriptInput.selectionStart ?? scriptInput.value.length;
        const before = scriptInput.value.slice(0, at);
        const insert = `${before && !before.endsWith('\n') ? '\n' : ''}## Lajm i ri | 1:00\n`;
        scriptInput.setRangeText(insert, at, at, 'end');
        scriptInput.focus();
        scriptInput.dispatchEvent(new Event('input'));
    });

    // ---------- Back-timing ----------
    function readingPace() {
        const read = lastReadIndex + 1;
        const minutes = startTime ? (Date.now() - startTime) / 60000 : 0;
        return read >= MIN_WORDS_FOR_PACE && minutes > 0 ? read / minutes : studioSettings.targetWpm;
    }

    function tick() {
        if (!segments.length) {
            showStats(null);
            return;
        }
        if (!state) {
            const i = currentIndex();
            const total = segments.reduce((sum, _, k) => sum + planned(k), 0);
            showStats({ live: false, segmentLabel: 'Lajmi (plani)', segment: fmt(planned(i)), planLabel: 'Shfaqja (plani)', plan: fmt(total) });
            return;
        }

        const i = state.current;
        const seg = segments[i];
        const t = SyriRundown.backTime({
            planned: segments.map((_, k) => planned(k)),
            current: i,
            elapsed: (Date.now() - startTime) / 1000,
            inSegment: secondsIn(i),
            wordsLeft: Math.max(0, seg.end - Math.max(seg.start, lastReadIndex + 1)),
            wpm: readingPace(),
            done: state.skipped,
        });
        // A skipped story is not in the plan any more
        const skippedPlan = state.skipped.reduce((sum, s, k) => sum + (s ? planned(k) : 0), 0);
        const delta = t.delta + skippedPlan;
        let next = i + 1;
        while (segments[next] && state.skipped[next]) next++;

        showStats({
            live: true,
            segmentLabel: t.segmentLeft >= 0 ? 'Lajmi: mbetur' : 'Lajmi: mbi kohë',
            segment: (t.segmentLeft < 0 ? '+' : '') + fmt(t.segmentLeft),
            segmentOver: t.segmentLeft < 0,
            planLabel: Math.round(delta) > 0 ? 'Shfaqja: mbi plan' : 'Shfaqja: nën plan',
            plan: SyriRundown.formatDelta(delta),
            planOver: Math.round(delta) > 0,
        });

        listEl.querySelectorAll('[data-actual]').forEach(el => { el.textContent = fmt(secondsIn(Number(el.dataset.actual))); });

        lastTiming = {
            index: i,
            count: segments.length,
            title: marked ? seg.title : null,
            segmentLeft: Math.round(t.segmentLeft),
            delta: Math.round(delta),
            next: marked && segments[next] ? segments[next].title : null,
        };
        broadcastUpdate('show_timing', lastTiming);
    }

    function showStats(s) {
        if (!s) {
            statSegment.textContent = '—';
            statPlan.textContent = '—';
            statSegment.dataset.state = statPlan.dataset.state = '';
            return;
        }
        statSegmentLabel.textContent = s.segmentLabel;
        statSegment.textContent = s.segment;
        statSegment.dataset.state = s.live ? (s.segmentOver ? 'over' : 'ok') : '';
        statPlanLabel.textContent = s.planLabel;
        statPlan.textContent = s.plan;
        statPlan.dataset.state = s.live ? (s.planOver ? 'over' : 'ok') : '';
    }

    // ---------- Lost place (speech tracker) ----------
    function setLost(isLost, found = false) {
        if (found) {
            clearTimeout(foundTimer);
            lostBadge.hidden = false;
            lostBadge.dataset.state = 'found';
            lostBadge.textContent = '✓ Vendi u gjet';
            foundTimer = setTimeout(() => { if (!lost) lostBadge.hidden = true; }, 1500);
            broadcastUpdate('tracking_state', { lost: false, found: true });
        }
        if (isLost === lost) return;
        lost = isLost;
        if (lost) {
            clearTimeout(foundTimer);
            lostBadge.hidden = false;
            lostBadge.dataset.state = 'lost';
            lostBadge.textContent = 'Duke kërkuar vendin në skript…';
        } else if (!found) {
            lostBadge.hidden = true;
        }
        if (!found) broadcastUpdate('tracking_state', { lost });
    }

    // ---------- Producer messages ----------
    cueQuick.innerHTML = QUICK_CUES.map(text => `<button class="chip-btn" data-cue="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join('');
    cueQuick.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cue]');
        if (btn) sendCue(btn.dataset.cue);
    });
    cueSendBtn.addEventListener('click', () => {
        if (!cueInput.value.trim()) { cueInput.focus(); return; }
        sendCue(cueInput.value.trim());
        cueInput.value = '';
    });
    cueInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') cueSendBtn.click();
    });
    cueClearBtn.addEventListener('click', () => {
        if (!cue) return;
        broadcastUpdate('producer_cue', { id: cue.id, text: null });
        cue = null;
        setCueStatus('');
    });

    function sendCue(text) {
        cue = { id: Date.now(), text: text.slice(0, 120) };
        broadcastUpdate('producer_cue', cue);
        setCueStatus(`“${cue.text}” — u dërgua, pret ekranin e prezantuesit…`, 'sent');
    }

    function setCueStatus(text, stateName) {
        cueStatus.textContent = text;
        cueStatus.dataset.state = stateName || '';
        cueClearBtn.hidden = !cue;
    }

    function onCueReply(type, data) {
        if (!cue || data?.id !== cue.id) return;
        if (type === 'cue_shown') setCueStatus(`“${cue.text}” — shfaqet te prezantuesi`, 'shown');
        else setCueStatus(`✓ “${cue.text}” — prezantuesi e konfirmoi`, 'ack');
    }

    // ---------- Voice ----------
    /** "lajmi tjetër" moves to the next story, unless the phrase is part of the script right here */
    function voiceCommand(spokenLower) {
        if (!marked || Date.now() - lastVoiceCommand < VOICE_COMMAND_GAP_MS) return false;
        const spoken = SyriMatcher.tokenize(spokenLower).join(' ');
        const phrase = NEXT_STORY_PHRASES.find(p => spoken.endsWith(p));
        if (!phrase) return false;
        const ahead = SyriMatcher.tokenize(words.slice(Math.max(0, lastReadIndex - 2), lastReadIndex + 8).join(' ')).join(' ');
        if (ahead.includes(phrase)) return false;
        lastVoiceCommand = Date.now();
        step(1);
        return true;
    }

    // ---------- Session ----------
    function start() {
        state = newState(currentIndex());
        clearInterval(timer);
        timer = setInterval(tick, TICK_MS);
        renderList();
        tick();
    }

    function stop() {
        if (!state) return;
        clearInterval(timer);
        state.spent[state.current] += Date.now() - state.enteredAt;
        state.enteredAt = Date.now();
        summaryCache = buildSummary();
        state = null;
        lastTiming = null;
        setLost(false);
        broadcastUpdate('show_timing', null);
        renderList();
        tick();
    }

    let summaryCache = null;

    function buildSummary() {
        if (!state || !segments.length) return null;
        return segments.map((seg, i) => {
            const read = Math.max(0, Math.min(seg.end, state.reached[i] + 1) - seg.start);
            const total = seg.end - seg.start;
            const actual = Math.round(state.spent[i] / 100) / 10;
            return {
                title: seg.title,
                plannedSeconds: planned(i),
                plannedEstimated: !seg.plannedSeconds,
                actualSeconds: actual,
                words: total,
                wordsRead: read,
                wpm: actual > 0 ? Math.round((read / actual) * 60 * 10) / 10 : 0,
                status: state.skipped[i] ? 'skipped' : !state.visited[i] ? 'not-reached' : read >= total * 0.9 ? 'done' : 'partial',
            };
        });
    }

    /** Per-story results of the session that just stopped (null without stories) */
    function takeSummary() {
        const summary = summaryCache ?? buildSummary();
        summaryCache = null;
        return summary;
    }

    function onPosition(wordIndex) {
        if (!segments.length) return;
        const i = SyriRundown.segmentAt(segments, wordIndex);
        if (state) {
            state.reached[i] = Math.max(state.reached[i], wordIndex);
            enter(i);
        } else {
            renderList();
            tick();
        }
    }

    /** State for a presenter screen that just connected */
    function syncScreen() {
        broadcastUpdate('show_timing', lastTiming);
        if (cue) broadcastUpdate('producer_cue', cue);
        broadcastUpdate('tracking_state', { lost });
    }

    renderList();
    tick();

    return {
        setSegments, onPosition, start, stop, step, setLost, voiceCommand, onCueReply, syncScreen, takeSummary,
        /** Planned times changed (e.g. the planned pace in Settings) */
        refresh() { renderList(); tick(); },
        get hasStories() { return marked && segments.length > 0; },
    };
})();
