// SyriAI Studio — user settings: persisted per user on the server (/api/settings),
// cached in localStorage, applied to the studio and pushed to client screens.

const StudioSettings = (() => {
    const LOCAL_KEY = 'syriai.settings';

    const themeDarkBtn = document.getElementById('theme-dark-btn');
    const themeLightBtn = document.getElementById('theme-light-btn');
    const readingLineBtn = document.getElementById('reading-line-btn');
    const tickerTrack = document.querySelector('.news-ticker .ticker-track');

    let saveTimer = null;

    function readLocal() {
        try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; } catch { return {}; }
    }

    function save() {
        try { localStorage.setItem(LOCAL_KEY, JSON.stringify(studioSettings)); } catch { /* storage blocked */ }
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            api('/api/settings', { method: 'PUT', body: studioSettings }).catch(() => { /* offline: local copy is kept */ });
        }, 600);
    }

    function update(changes) {
        Object.assign(studioSettings, changes);
        apply();
        save();
    }

    /** Settings that client screens also need */
    function clientSettings() {
        const { theme, readingLine, sponsors, ticker, fontSize, mirror, broadcastLayout } = studioSettings;
        return { theme, readingLine, sponsors, ticker, fontSize, mirror, broadcastLayout };
    }

    function renderTicker() {
        tickerTrack.innerHTML = studioSettings.ticker
            .map(line => `<span>${escapeHtml(line)}</span>`)
            .join('');
    }

    function apply() {
        const s = studioSettings;

        fontSizeInput.value = s.fontSize;
        fontSizeVal.textContent = s.fontSize;
        scriptDisplay.style.fontSize = `${s.fontSize}rem`;

        scrollSpeedInput.value = s.scrollSpeed;
        speedValDisplay.textContent = s.scrollSpeed;
        scrollSpeed = s.scrollSpeed;

        document.body.classList.toggle('prompter-light', s.theme === 'light');
        themeDarkBtn.classList.toggle('active', s.theme !== 'light');
        themeLightBtn.classList.toggle('active', s.theme === 'light');

        document.body.classList.toggle('show-reading-line', s.readingLine);
        readingLineBtn.classList.toggle('active', s.readingLine);
        readingLineBtn.setAttribute('aria-pressed', String(s.readingLine));

        document.body.classList.toggle('mirrored', s.mirror);
        mirrorBtn.classList.toggle('active', s.mirror);

        if (recognition) recognition.lang = s.speechLang;
        renderTicker();

        broadcastUpdate('settings_sync', clientSettings());
    }

    async function load() {
        // Local copy first (instant), then the server copy (source of truth)
        Object.assign(studioSettings, sanitize(readLocal()));
        apply();
        try {
            const remote = await api('/api/settings');
            if (remote && Object.keys(remote).length) {
                Object.assign(studioSettings, sanitize(remote));
                apply();
                try { localStorage.setItem(LOCAL_KEY, JSON.stringify(studioSettings)); } catch { /* ignore */ }
            }
        } catch { /* no backend: keep local settings */ }
    }

    /** Keep only known keys with the right types */
    function sanitize(raw) {
        const out = {};
        for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
            const value = raw[key];
            if (value === undefined || value === null) continue;
            if (Array.isArray(def)) {
                if (Array.isArray(value)) out[key] = value.map(String).filter(v => v.trim()).slice(0, 30);
            } else if (typeof def === typeof value) {
                out[key] = value;
            }
        }
        return out;
    }

    // ---------- Quick controls in the Reading panel ----------
    themeDarkBtn.addEventListener('click', () => update({ theme: 'dark' }));
    themeLightBtn.addEventListener('click', () => update({ theme: 'light' }));
    readingLineBtn.addEventListener('click', () => update({ readingLine: !studioSettings.readingLine }));

    // Sliders and mirror already act immediately (prompter.js); here we only persist them
    fontSizeInput.addEventListener('change', () => update({ fontSize: parseFloat(fontSizeInput.value) }));
    scrollSpeedInput.addEventListener('change', () => update({ scrollSpeed: parseInt(scrollSpeedInput.value, 10) }));
    mirrorBtn.addEventListener('click', () => update({ mirror: document.body.classList.contains('mirrored') }));

    // ---------- Settings dialog ----------
    function openDialog() {
        const s = studioSettings;
        const form = document.createElement('div');
        form.className = 'settings-form';
        form.innerHTML = `
            <div class="form-grid">
                <div class="form-field">
                    <label class="field-label" for="set-countdown">Numërimi para LIVE</label>
                    <select id="set-countdown" class="text-input">
                        <option value="0">Pa numërim</option>
                        <option value="3">3 sekonda</option>
                        <option value="5">5 sekonda</option>
                        <option value="10">10 sekonda</option>
                    </select>
                </div>
                <div class="form-field">
                    <label class="field-label" for="set-lang">Gjuha e njohjes së zërit</label>
                    <select id="set-lang" class="text-input">
                        <option value="sq-AL">Shqip (sq-AL)</option>
                        <option value="en-US">English (en-US)</option>
                        <option value="en-GB">English (en-GB)</option>
                        <option value="de-DE">Deutsch (de-DE)</option>
                    </select>
                </div>
            </div>
            <div class="form-field">
                <label class="field-label" for="set-layout">Dokumentet në transmetimin YouTube</label>
                <select id="set-layout" class="text-input">
                    <option value="split">Ekran i ndarë — kamera majtas, dokumenti djathtas</option>
                    <option value="box">Dritare e vogël mbi kamerë</option>
                </select>
            </div>
            <div class="form-field">
                <label class="field-label" for="set-ticker">Lajmet në shiritin “Breaking News” — një për rresht</label>
                <textarea id="set-ticker" rows="4"></textarea>
            </div>
            <div class="form-field">
                <label class="field-label" for="set-sponsors">Sponsorët në ekranin e klientit — një për rresht</label>
                <textarea id="set-sponsors" rows="4"></textarea>
            </div>
            <p class="muted">Cilësimet ruhen në llogarinë tuaj dhe aplikohen edhe në ekranin e klientit.</p>`;

        form.querySelector('#set-countdown').value = String(s.countdownSeconds);
        form.querySelector('#set-lang').value = s.speechLang;
        form.querySelector('#set-layout').value = s.broadcastLayout;
        form.querySelector('#set-ticker').value = s.ticker.join('\n');
        form.querySelector('#set-sponsors').value = s.sponsors.join('\n');

        const lines = (id) => form.querySelector(id).value.split('\n').map(l => l.trim()).filter(Boolean);

        openModal({
            title: 'Cilësimet e studios',
            content: form,
            actions: [
                {
                    label: 'Rikthe parazgjedhjet', onClick: (close) => {
                        const { fontSize, scrollSpeed: speed, theme, readingLine, mirror } = studioSettings;
                        update({ ...structuredClone(DEFAULT_SETTINGS), fontSize, scrollSpeed: speed, theme, readingLine, mirror });
                        close();
                        notify("Cilësimet u rikthyen.", 'info', 2500);
                    }
                },
                { label: 'Anulo', onClick: (close) => close() },
                {
                    label: 'Ruaj', variant: 'primary', onClick: (close) => {
                        const ticker = lines('#set-ticker');
                        const sponsors = lines('#set-sponsors');
                        update({
                            countdownSeconds: parseInt(form.querySelector('#set-countdown').value, 10),
                            speechLang: form.querySelector('#set-lang').value,
                            broadcastLayout: form.querySelector('#set-layout').value,
                            ticker: ticker.length ? ticker : DEFAULT_SETTINGS.ticker,
                            sponsors: sponsors.length ? sponsors : DEFAULT_SETTINGS.sponsors,
                        });
                        close();
                        notify("Cilësimet u ruajtën.", 'success', 2500);
                    }
                },
            ],
        });
    }

    document.getElementById('settings-btn').addEventListener('click', openDialog);

    load();

    return { apply, clientSettings };
})();
