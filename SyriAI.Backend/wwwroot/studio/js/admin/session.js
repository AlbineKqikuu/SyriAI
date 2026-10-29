// SyriAI Studio — session measurement, report and history (evaluation data).
//
// A session runs from "Fillo LIVE" to "Ndalo". While it runs we record reading
// progress, speech-tracking events, processing time and camera (gaze) feedback. At the
// end the summary is shown as a report, saved to the server (/api/sessions) and can be
// exported as CSV for the evaluation chapter.

const StudioSessionLog = (() => {
    const SAMPLE_INTERVAL_MS = 1000;
    const STALL_AFTER_MS = 4000;      // no progress for this long counts as one stall
    const MIN_SAVED_DURATION_S = 3;   // ignore accidental start/stop
    const PENDING_KEY = 'syriai.pendingSessions';

    const participantInput = document.getElementById('study-participant');
    const conditionSelect = document.getElementById('study-condition');
    const notesInput = document.getElementById('study-notes');

    const CONDITION_LABELS = { voice: 'Njohje zëri', autoscroll: 'Lëvizje automatike', manual: 'Manual (tastierë)' };

    let s = null;
    let sampler = null;

    function start() {
        const now = performance.now();
        s = {
            startedAt: new Date(),
            t0: now,
            totalWords: words.length,
            recognitionResults: 0,
            matchEvents: 0,
            manualNavigations: 0,
            processingMs: [],
            timeline: [[0, 0]],
            faceFrames: 0,
            faceVisibleFrames: 0,
            eyeContactFrames: 0,
            faceLostCount: 0,
            faceWasVisible: true,
            maxIndex: -1,
            lastProgressAt: now,
            stalled: false,
            stallCount: 0,
            recoveries: 0,
            usedAutoscroll: isAutoScrolling,
        };
        clearInterval(sampler);
        sampler = setInterval(sample, SAMPLE_INTERVAL_MS);
    }

    /** Words reached: tracked position, or estimated from scroll position when only auto-scroll was used */
    function wordsReached() {
        const tracked = s.maxIndex + 1;
        if (tracked > 0 || !s.usedAutoscroll) return tracked;
        const max = scrollContainer.scrollHeight - scrollContainer.clientHeight;
        return max > 0 ? Math.round((scrollContainer.scrollTop / max) * s.totalWords) : 0;
    }

    function sample() {
        if (!s) return;
        const now = performance.now();
        if (isAutoScrolling) s.usedAutoscroll = true;
        s.timeline.push([Math.round((now - s.t0) / 100) / 10, wordsReached()]);

        const finished = s.maxIndex + 1 >= s.totalWords;
        if (!s.stalled && !finished && !isAutoScrolling && now - s.lastProgressAt > STALL_AFTER_MS) {
            s.stalled = true;
            s.stallCount++;
        }
    }

    function progress(index) {
        if (index <= s.maxIndex) return;
        s.maxIndex = index;
        s.lastProgressAt = performance.now();
        s.stalled = false;
    }

    const api_ = {
        get active() { return s !== null; },

        start,

        recordRecognition() {
            if (s) s.recognitionResults++;
        },

        recordMatch(index, processingMs) {
            if (!s) return;
            s.matchEvents++;
            s.processingMs.push(processingMs);
            progress(index);
        },

        /** The tracker found the reader again after they left the script */
        recordRecovery() {
            if (s) s.recoveries++;
        },

        recordNavigation(index) {
            if (!s) return;
            s.manualNavigations++;
            progress(index);
        },

        recordFace(visible, eyeContact) {
            if (!s) return;
            s.faceFrames++;
            if (visible) s.faceVisibleFrames++;
            if (eyeContact) s.eyeContactFrames++;
            if (!visible && s.faceWasVisible) s.faceLostCount++;
            s.faceWasVisible = visible;
        },

        /** Finish the session: build the summary, save it and optionally show the report */
        end({ showReport = true } = {}) {
            if (!s) return null;
            clearInterval(sampler);
            sample();
            const summary = summarize(s);
            s = null;

            if (summary.durationSeconds < MIN_SAVED_DURATION_S) return summary;
            const saving = save(summary);
            if (showReport) showSessionReport(summary, saving);
            return summary;
        },
    };

    function summarize(session) {
        const endedAt = new Date();
        const durationSeconds = (endedAt - session.startedAt) / 1000;
        const reached = Math.min(wordsReachedFor(session), session.totalWords);
        const sorted = session.processingMs.slice().sort((a, b) => a - b);
        const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);

        const chosen = conditionSelect ? conditionSelect.value : 'auto';
        const condition = chosen !== 'auto' ? chosen
            : session.matchEvents > 0 ? 'voice'
                : session.usedAutoscroll ? 'autoscroll' : 'manual';

        return {
            participant: participantInput?.value.trim() || null,
            condition,
            scriptTitle: ScriptLibrary.currentTitle || null,
            notes: notesInput?.value.trim() || null,
            startedAt: session.startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            durationSeconds: round(durationSeconds, 1),
            totalWords: session.totalWords,
            wordsReached: reached,
            progressPercent: round(pct(reached, session.totalWords), 1),
            averageWpm: round(durationSeconds > 0 ? reached / (durationSeconds / 60) : 0, 1),
            recognitionResults: session.recognitionResults,
            matchEvents: session.matchEvents,
            matchRatePercent: round(pct(session.matchEvents, session.recognitionResults), 1),
            manualNavigations: session.manualNavigations,
            stallCount: session.stallCount,
            recoveryCount: session.recoveries,
            medianProcessingMs: round(percentile(sorted, 0.5), 2),
            p95ProcessingMs: round(percentile(sorted, 0.95), 2),
            faceVisiblePercent: round(pct(session.faceVisibleFrames, session.faceFrames), 1),
            eyeContactPercent: round(pct(session.eyeContactFrames, session.faceVisibleFrames), 1),
            faceLostCount: session.faceLostCount,
            timeline: session.timeline,
            segments: LiveShow.takeSummary(),
        };
    }

    function wordsReachedFor(session) {
        const previous = s;
        s = session;
        const value = wordsReached();
        s = previous;
        return value;
    }

    /** The API returns UTC timestamps without a zone suffix */
    function parseUtc(value) {
        return new Date(/(Z|[+-]\d\d:\d\d)$/.test(value) ? value : value + 'Z');
    }

    function percentile(sorted, p) {
        if (!sorted.length) return 0;
        const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
        return sorted[idx];
    }

    function round(value, digits) {
        const f = 10 ** digits;
        return Math.round(value * f) / f;
    }

    /** Save to the server (resolves to the session id); keep it in localStorage if the server is unreachable (null) */
    async function save(summary) {
        try {
            const saved = await api('/api/sessions', { method: 'POST', body: summary });
            return saved.id;
        } catch (err) {
            console.warn('Session not saved to server, keeping it locally:', err);
            const pending = readPending();
            pending.push(summary);
            try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending.slice(-50))); } catch { /* storage full/blocked */ }
            return null;
        }
    }

    function readPending() {
        try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || []; } catch { return []; }
    }

    /** Retry sessions that could not be saved earlier */
    async function flushPending() {
        const pending = readPending();
        if (!pending.length) return;
        const remaining = [];
        for (const summary of pending) {
            try { await api('/api/sessions', { method: 'POST', body: summary }); }
            catch { remaining.push(summary); }
        }
        try { localStorage.setItem(PENDING_KEY, JSON.stringify(remaining)); } catch { /* ignore */ }
        if (remaining.length < pending.length) {
            notify(`${pending.length - remaining.length} sesion(e) të mëparshme u ruajtën në server.`, 'success');
        }
    }

    // ---------- Report ----------
    function statCard(label, value, hint = '') {
        return `<div class="report-stat"><span class="report-stat-label">${label}</span>
            <span class="report-stat-value">${value}</span>${hint ? `<span class="report-stat-hint">${hint}</span>` : ''}</div>`;
    }

    function progressChart(timeline, totalWords) {
        const W = 560, H = 160, P = 28;
        const maxT = Math.max(1, timeline[timeline.length - 1]?.[0] || 1);
        const maxW = Math.max(1, totalWords);
        const x = t => P + (t / maxT) * (W - P * 1.5);
        const y = w => H - P - (w / maxW) * (H - P * 1.6);
        const points = timeline.map(([t, w]) => `${x(t).toFixed(1)},${y(w).toFixed(1)}`).join(' ');
        return `<svg class="report-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Progresi i leximit në kohë">
            <line x1="${P}" y1="${H - P}" x2="${W - P / 2}" y2="${H - P}" class="axis" />
            <line x1="${P}" y1="${P / 2}" x2="${P}" y2="${H - P}" class="axis" />
            <line x1="${P}" y1="${y(maxW)}" x2="${W - P / 2}" y2="${y(maxW)}" class="target" />
            <polyline points="${points}" class="series" />
            <text x="${P}" y="${H - 8}" class="tick">0 s</text>
            <text x="${W - P / 2}" y="${H - 8}" class="tick" text-anchor="end">${formatDuration(maxT)}</text>
            <text x="${P + 4}" y="${y(maxW) - 4}" class="tick">${maxW} fjalë</text>
        </svg>`;
    }

    /** Reading pace (words per minute) over a sliding window of the progress timeline */
    function paceSeries(timeline, windowSeconds = 10) {
        const out = [];
        let j = 0;
        for (let i = 0; i < timeline.length; i++) {
            const [t, w] = timeline[i];
            while (j < i && t - timeline[j][0] > windowSeconds) j++;
            const [t0, w0] = timeline[j];
            if (t - t0 >= windowSeconds / 2) out.push([t, Math.max(0, ((w - w0) / (t - t0)) * 60)]);
        }
        return out;
    }

    function paceChart(timeline, averageWpm) {
        const series = paceSeries(timeline);
        if (series.length < 2) return '<p class="muted">Sesioni ishte shumë i shkurtër për grafikun e shpejtësisë.</p>';
        const W = 560, H = 160, P = 28;
        const maxT = Math.max(1, series[series.length - 1][0]);
        const maxV = Math.max(60, ...series.map(([, v]) => v)) * 1.1;
        const x = t => P + (t / maxT) * (W - P * 1.5);
        const y = v => H - P - (v / maxV) * (H - P * 1.6);
        const points = series.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
        return `<svg class="report-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Shpejtësia e leximit në kohë">
            <line x1="${P}" y1="${H - P}" x2="${W - P / 2}" y2="${H - P}" class="axis" />
            <line x1="${P}" y1="${P / 2}" x2="${P}" y2="${H - P}" class="axis" />
            <line x1="${P}" y1="${y(averageWpm)}" x2="${W - P / 2}" y2="${y(averageWpm)}" class="avg" />
            <polyline points="${points}" class="series series--pace" />
            <text x="${P}" y="${H - 8}" class="tick">0 s</text>
            <text x="${W - P / 2}" y="${H - 8}" class="tick" text-anchor="end">${formatDuration(maxT)}</text>
            <text x="${P + 4}" y="${y(averageWpm) - 4}" class="tick">mesatarja ${Math.round(averageWpm)} fjalë/min</text>
            <text x="${P + 4}" y="${P / 2 + 10}" class="tick">${Math.round(maxV)}</text>
        </svg>`;
    }

    const SEGMENT_STATUS = { done: 'Lexuar', partial: 'Pjesërisht', skipped: 'Hequr', 'not-reached': 'Pa arritur' };

    function segmentsTable(segments) {
        if (!Array.isArray(segments) || !segments.length) return '';
        const rows = segments.map((seg, i) => {
            const reached = seg.status !== 'skipped' && seg.status !== 'not-reached';
            const diff = reached ? seg.actualSeconds - seg.plannedSeconds : null;
            const diffClass = diff === null ? '' : diff > 5 ? 'is-over' : diff < -5 ? 'is-under' : '';
            return `<tr>
                <td class="num">${i + 1}</td>
                <td>${escapeHtml(seg.title)}</td>
                <td class="num">${seg.plannedEstimated ? '~' : ''}${formatDuration(seg.plannedSeconds)}</td>
                <td class="num">${reached ? formatDuration(seg.actualSeconds) : '—'}</td>
                <td class="num ${diffClass}">${diff === null ? '—' : SyriRundown.formatDelta(diff)}</td>
                <td class="num">${seg.wordsRead} / ${seg.words}</td>
                <td class="num">${reached && seg.wpm ? seg.wpm : '—'}</td>
                <td>${SEGMENT_STATUS[seg.status] || seg.status}</td>
            </tr>`;
        }).join('');
        const plannedTotal = segments.reduce((sum, seg) => sum + (seg.status === 'skipped' ? 0 : seg.plannedSeconds), 0);
        const actualTotal = segments.reduce((sum, seg) => sum + seg.actualSeconds, 0);
        return `<h3 class="report-subtitle">Lajmet (plani kundrejt kohës reale)</h3>
            <div class="table-wrap">
                <table class="data-table">
                    <thead><tr><th class="num">#</th><th>Lajmi</th><th class="num">Plani</th><th class="num">Reale</th>
                        <th class="num">Diferenca</th><th class="num">Fjalë</th><th class="num">WPM</th><th>Statusi</th></tr></thead>
                    <tbody>${rows}</tbody>
                    <tfoot><tr><td></td><td>Gjithsej</td><td class="num">${formatDuration(plannedTotal)}</td>
                        <td class="num">${formatDuration(actualTotal)}</td>
                        <td class="num ${actualTotal - plannedTotal > 5 ? 'is-over' : actualTotal - plannedTotal < -5 ? 'is-under' : ''}">${SyriRundown.formatDelta(actualTotal - plannedTotal)}</td>
                        <td colspan="3"></td></tr></tfoot>
                </table>
            </div>`;
    }

    function showSessionReport(summary, saving) {
        const conditionLabel = CONDITION_LABELS[summary.condition] || summary.condition;
        const voiceUsed = summary.recognitionResults > 0;
        const content = `
            <div class="report-meta">
                <span>${escapeHtml(new Date(summary.startedAt).toLocaleString('sq-AL'))}</span>
                <span>${escapeHtml(conditionLabel)}</span>
                ${summary.participant ? `<span>Pjesëmarrësi: ${escapeHtml(summary.participant)}</span>` : ''}
                <span class="report-save-status" data-state="saving">Duke ruajtur…</span>
            </div>
            <div class="report-grid">
                ${statCard('Kohëzgjatja', formatDuration(summary.durationSeconds))}
                ${statCard('Progresi', `${summary.progressPercent}%`, `${summary.wordsReached} / ${summary.totalWords} fjalë`)}
                ${statCard('Shpejtësia mesatare', `${summary.averageWpm}`, 'fjalë në minutë')}
                ${statCard('Ndalesa', summary.stallCount, `pa progres > ${STALL_AFTER_MS / 1000} s`)}
                ${statCard('Rikuperime', voiceUsed ? (summary.recoveryCount ?? 0) : '—', voiceUsed ? 'vendi u gjet pas daljes nga skripti' : '')}
                ${statCard('Përputhja e zërit', voiceUsed ? `${summary.matchRatePercent}%` : '—', voiceUsed ? `${summary.matchEvents} / ${summary.recognitionResults} përditësime` : 'njohja e zërit nuk u përdor')}
                ${statCard('Koha e përpunimit', voiceUsed ? `${summary.medianProcessingMs} ms` : '—', voiceUsed ? `mediana · p95 ${summary.p95ProcessingMs} ms` : '')}
                ${statCard('Fytyra e dukshme', `${summary.faceVisiblePercent}%`, `humbur ${summary.faceLostCount}×`)}
                ${statCard('Shikim drejt kamerës', `${summary.eyeContactPercent}%`, 'kur fytyra shihet')}
            </div>
            <h3 class="report-subtitle">Progresi në kohë</h3>
            ${progressChart(summary.timeline, summary.totalWords)}
            <h3 class="report-subtitle">Shpejtësia në kohë</h3>
            ${paceChart(summary.timeline, summary.averageWpm)}
            ${segmentsTable(summary.segments)}
            <h3 class="report-subtitle">Pas sesionit (studimi)</h3>
            <div class="report-study">
                <label class="field-label" for="observer-lost">Herë që pjesëmarrësi humbi vendin (numëruar nga vëzhguesi)</label>
                <div class="report-study-row">
                    <input type="number" id="observer-lost" class="text-input" min="0" max="1000" inputmode="numeric" placeholder="0" disabled>
                    <button class="btn btn-secondary btn-sm" data-action="save-observer" disabled>Ruaj numrin</button>
                    <button class="btn btn-secondary btn-sm" data-action="sus" disabled>Pyetësori SUS</button>
                    <span class="report-sus-score muted"></span>
                </div>
            </div>
            <p class="report-footnote">Koha e përpunimit mat vetëm kohën nga marrja e tekstit të njohur deri te theksimi i fjalës; nuk përfshin vonesën e shërbimit të njohjes së zërit. Shikimi vlerësohet nga pozicioni i irisit dhe i kokës (heuristikë).</p>`;

        const modal = openModal({
            title: 'Raporti i sesionit',
            content,
            wide: true,
            actions: [
                { label: 'Shkarko CSV', onClick: () => downloadText(`syriai-session-${Date.now()}.csv`, sessionToCsv(summary), 'text/csv') },
                { label: 'Shkarko JSON', onClick: () => downloadText(`syriai-session-${Date.now()}.json`, JSON.stringify(summary, null, 2), 'application/json') },
                { label: 'Printo / PDF', onClick: () => window.print() },
                { label: 'Historiku', onClick: (close) => { close(); showHistory(); } },
                { label: 'Mbyll', variant: 'primary', onClick: (close) => close() },
            ],
        });
        modal.root.classList.add('printable');

        const status = modal.body.querySelector('.report-save-status');
        const observerInput = modal.body.querySelector('#observer-lost');
        const studyButtons = modal.body.querySelectorAll('.report-study button');
        const susScore = modal.body.querySelector('.report-sus-score');

        saving.then(sessionId => {
            status.dataset.state = sessionId ? 'ok' : 'error';
            status.textContent = sessionId ? 'U ruajt në server' : 'Nuk u ruajt në server — do të provohet përsëri';
            if (!sessionId) {
                susScore.textContent = 'Të dhënat e studimit kërkojnë serverin.';
                return;
            }
            observerInput.disabled = false;
            studyButtons.forEach(b => { b.disabled = false; });
            if (summary.observerLostCount != null) observerInput.value = summary.observerLostCount;
            if (summary.susScore != null) susScore.textContent = `SUS: ${summary.susScore} / 100`;

            modal.body.querySelector('[data-action="save-observer"]').addEventListener('click', async () => {
                const value = parseInt(observerInput.value, 10);
                if (!Number.isInteger(value) || value < 0) { observerInput.focus(); return; }
                try {
                    await api(`/api/sessions/${sessionId}`, { method: 'PATCH', body: { observerLostCount: value } });
                    notify("Numri u ruajt.", 'success', 2000);
                } catch (err) {
                    notify(`Nuk u ruajt: ${err.message}`, 'error');
                }
            });
            modal.body.querySelector('[data-action="sus"]').addEventListener('click', () => {
                showSusQuestionnaire(sessionId, (score) => {
                    susScore.textContent = `SUS: ${score} / 100`;
                });
            });
        });
    }

    // ---------- System Usability Scale (Brooke, 1996), Albanian translation ----------
    const SUS_ITEMS = [
        'Mendoj se do të doja ta përdorja këtë sistem shpesh.',
        'E gjeta sistemin të ndërlikuar pa nevojë.',
        'Mendova se sistemi ishte i lehtë për t’u përdorur.',
        'Mendoj se do të më duhej ndihma e një personi teknik për ta përdorur këtë sistem.',
        'Funksionet e ndryshme të këtij sistemi ishin të integruara mirë.',
        'Mendova se kishte shumë mospërputhje në këtë sistem.',
        'Imagjinoj se shumica e njerëzve do ta mësonin shumë shpejt përdorimin e këtij sistemi.',
        'E gjeta sistemin shumë të rëndë për t’u përdorur.',
        'U ndjeva shumë i/e sigurt duke e përdorur sistemin.',
        'Më duhej të mësoja shumë gjëra para se të filloja ta përdorja këtë sistem.',
    ];

    function showSusQuestionnaire(sessionId, onSaved) {
        const form = document.createElement('div');
        form.className = 'sus-form';
        form.innerHTML = `
            <p class="muted">Për secilën fjali zgjidhni sa jeni dakord: 1 = aspak dakord, 5 = plotësisht dakord.</p>
            <ol class="sus-list">${SUS_ITEMS.map((text, i) => `
                <li class="sus-item" data-item="${i}">
                    <span class="sus-text">${escapeHtml(text)}</span>
                    <span class="sus-scale" role="radiogroup" aria-label="Pyetja ${i + 1}">
                        ${[1, 2, 3, 4, 5].map(v => `
                            <label class="sus-option"><input type="radio" name="sus-${i}" value="${v}"><span>${v}</span></label>`).join('')}
                    </span>
                </li>`).join('')}
            </ol>
            <div class="sus-legend"><span>Aspak dakord</span><span>Plotësisht dakord</span></div>`;

        openModal({
            title: 'Pyetësori i përdorshmërisë (SUS)',
            content: form,
            wide: true,
            actions: [
                { label: 'Anulo', onClick: (close) => close() },
                {
                    label: 'Ruaj përgjigjet', variant: 'primary', onClick: async (close, btn) => {
                        const answers = SUS_ITEMS.map((_, i) => {
                            const checked = form.querySelector(`input[name="sus-${i}"]:checked`);
                            return checked ? Number(checked.value) : null;
                        });
                        const missing = answers.findIndex(a => a === null);
                        form.querySelectorAll('.sus-item').forEach((li, i) => li.classList.toggle('is-missing', answers[i] === null));
                        if (missing !== -1) {
                            form.querySelectorAll('.sus-item')[missing].scrollIntoView({ block: 'center', behavior: 'smooth' });
                            notify("Ju lutem përgjigjuni të gjitha pyetjeve.", 'warning', 3000);
                            return;
                        }
                        btn.disabled = true;
                        try {
                            const result = await api(`/api/sessions/${sessionId}`, { method: 'PATCH', body: { susAnswers: answers } });
                            onSaved(result.susScore);
                            notify(`Pyetësori u ruajt. Rezultati SUS: ${result.susScore} / 100`, 'success');
                            close();
                        } catch (err) {
                            btn.disabled = false;
                            notify(`Nuk u ruajt: ${err.message}`, 'error');
                        }
                    }
                },
            ],
        });
    }

    function sessionToCsv(summary) {
        const fields = ['participant', 'condition', 'scriptTitle', 'startedAt', 'durationSeconds', 'totalWords', 'wordsReached',
            'progressPercent', 'averageWpm', 'recognitionResults', 'matchEvents', 'matchRatePercent', 'manualNavigations',
            'stallCount', 'recoveryCount', 'medianProcessingMs', 'p95ProcessingMs', 'faceVisiblePercent', 'eyeContactPercent', 'faceLostCount', 'notes'];
        const cell = v => (v === null || v === undefined) ? '' : typeof v === 'number' ? String(v) : `"${String(v).replace(/"/g, '""')}"`;
        return '﻿' + fields.join(',') + '\n' + fields.map(f => cell(summary[f])).join(',') + '\n';
    }

    // ---------- History ----------
    async function showHistory() {
        const modal = openModal({
            title: 'Historiku i sesioneve',
            content: '<p class="muted">Duke ngarkuar…</p>',
            wide: true,
            actions: [
                { label: 'Eksporto të gjitha (CSV)', onClick: () => { window.location.href = '/api/sessions/export.csv'; } },
                { label: 'Mbyll', variant: 'primary', onClick: (close) => close() },
            ],
        });

        let sessions;
        try {
            sessions = await api('/api/sessions');
        } catch {
            modal.body.innerHTML = '<p class="muted">Historiku kërkon serverin SyriAI (dotnet run). Raportet mund të shkarkohen si CSV në fund të çdo sesioni.</p>';
            return;
        }
        if (!sessions.length) {
            modal.body.innerHTML = '<p class="muted">Ende nuk ka sesione. Shtypni “Fillo LIVE” dhe pastaj “Ndalo” për të krijuar të parin.</p>';
            return;
        }

        const rows = sessions.map(x => `
            <tr data-id="${x.id}">
                <td>${escapeHtml(parseUtc(x.startedAt).toLocaleString('sq-AL'))}</td>
                <td>${escapeHtml(x.participant || '—')}</td>
                <td>${escapeHtml(CONDITION_LABELS[x.condition] || x.condition || '—')}</td>
                <td class="num">${formatDuration(x.durationSeconds)}</td>
                <td class="num">${x.progressPercent}%</td>
                <td class="num">${x.averageWpm}</td>
                <td class="num">${x.matchRatePercent}%</td>
                <td class="num">${x.stallCount}</td>
                <td class="num">${x.eyeContactPercent}%</td>
                <td class="num">${x.observerLostCount ?? '—'}</td>
                <td class="num">${x.susScore ?? '—'}</td>
                <td class="row-actions"><button class="btn btn-secondary btn-sm" data-action="report">Raporti</button><button class="btn btn-ghost btn-sm" data-action="delete">Fshi</button></td>
            </tr>`).join('');

        modal.body.innerHTML = `
            <div class="table-wrap">
                <table class="data-table">
                    <thead><tr>
                        <th>Data</th><th>Pjesëmarrësi</th><th>Kushti</th><th class="num">Kohëzgjatja</th>
                        <th class="num">Progresi</th><th class="num">WPM</th><th class="num">Përputhja</th>
                        <th class="num">Ndalesa</th><th class="num">Shikimi</th>
                        <th class="num" title="Numëruar nga vëzhguesi">Humbi vendin</th><th class="num">SUS</th><th></th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;

        modal.body.addEventListener('click', async (e) => {
            const reportBtn = e.target.closest('[data-action="report"]');
            if (reportBtn) {
                const id = Number(reportBtn.closest('tr').dataset.id);
                try {
                    const detail = await api(`/api/sessions/${id}`);
                    // Same shape as a fresh summary; the API sends UTC times without a zone suffix
                    detail.startedAt = parseUtc(detail.startedAt).toISOString();
                    detail.timeline = detail.timeline || [[0, 0]];
                    showSessionReport(detail, Promise.resolve(id));
                } catch (err) {
                    notify(`Raporti nuk u hap: ${err.message}`, 'error');
                }
                return;
            }
            const btn = e.target.closest('[data-action="delete"]');
            if (!btn) return;
            // Two-step delete: first click asks for confirmation
            if (btn.dataset.confirm !== 'yes') {
                btn.dataset.confirm = 'yes';
                btn.textContent = 'Konfirmo';
                btn.classList.add('btn-danger');
                return;
            }
            const row = btn.closest('tr');
            try {
                await api(`/api/sessions/${row.dataset.id}`, { method: 'DELETE' });
                row.remove();
            } catch (err) {
                notify(`Sesioni nuk u fshi: ${err.message}`, 'error');
            }
        });
    }

    document.getElementById('history-btn')?.addEventListener('click', showHistory);
    flushPending();

    return api_;
})();
