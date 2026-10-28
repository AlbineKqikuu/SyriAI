// SyriAI Studio — script library (saved scripts per user) and local draft autosave.

const ScriptLibrary = (() => {
    const DRAFT_KEY = 'syriai.scriptDraft';

    const titleDisplay = document.getElementById('script-title-display');
    const saveBtn = document.getElementById('save-script-btn');
    const libraryBtn = document.getElementById('open-library-btn');
    const newBtn = document.getElementById('new-script-btn');

    let currentId = null;
    let currentTitle = '';
    let dirty = false;

    function updateIndicator() {
        titleDisplay.textContent = currentTitle || 'Skript pa titull';
        titleDisplay.classList.toggle('is-dirty', dirty && scriptInput.value.trim() !== '');
        titleDisplay.title = dirty ? 'Ndryshime të paruajtura' : '';
    }

    function setCurrent(id, title, isDirty = false) {
        currentId = id;
        currentTitle = title || '';
        dirty = isDirty;
        updateIndicator();
        saveDraft();
    }

    // ---------- Draft autosave (survives a page reload) ----------
    let draftTimer = null;
    function saveDraft() {
        clearTimeout(draftTimer);
        draftTimer = setTimeout(() => {
            try {
                localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: currentId, title: currentTitle, content: scriptInput.value, dirty }));
            } catch { /* storage blocked */ }
        }, 400);
    }

    function restoreDraft() {
        let draft = null;
        try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { /* ignore */ }
        if (!draft || !draft.content || scriptInput.value.trim()) return updateIndicator();
        scriptInput.value = draft.content;
        currentId = draft.id;
        currentTitle = draft.title || '';
        dirty = !!draft.dirty;
        applyScriptText();
        updateIndicator();
    }

    scriptInput.addEventListener('input', () => {
        dirty = true;
        updateIndicator();
        saveDraft();
    });

    // ---------- Save ----------
    function askTitle(initial) {
        return new Promise((resolve) => {
            const form = document.createElement('div');
            form.innerHTML = `<label class="field-label" for="script-title-input">Titulli i skriptit</label>
                <input id="script-title-input" class="text-input" maxlength="200" placeholder="p.sh. Lajmet e mbrëmjes — 28 shtator">`;
            const input = form.querySelector('input');
            input.value = initial || '';
            let resolved = false;
            const done = (value) => { if (!resolved) { resolved = true; resolve(value); } };
            const modal = openModal({
                title: 'Ruaj skriptin',
                content: form,
                onClose: () => done(null),
                actions: [
                    { label: 'Anulo', onClick: (close) => close() },
                    {
                        label: 'Ruaj', variant: 'primary', onClick: (close) => {
                            const value = input.value.trim();
                            if (!value) { input.focus(); return; }
                            done(value);
                            close();
                        }
                    },
                ],
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') modal.root.querySelector('.btn-primary').click();
            });
        });
    }

    async function save() {
        const content = scriptInput.value;
        if (!content.trim()) {
            notify("Skripti është bosh.", 'warning');
            return;
        }
        let title = currentTitle;
        if (!currentId || !title) {
            title = await askTitle(currentTitle);
            if (!title) return;
        }
        try {
            const saved = currentId
                ? await api(`/api/scripts/${currentId}`, { method: 'PUT', body: { title, content } })
                : await api('/api/scripts', { method: 'POST', body: { title, content } });
            setCurrent(saved.id, saved.title);
            notify(`“${saved.title}” u ruajt.`, 'success', 2500);
        } catch (err) {
            if (err.status === 404 && currentId) {
                // Deleted elsewhere: save as a new script
                currentId = null;
                return save();
            }
            // No status (network) or 404/405/501 from a static web server: the backend is not running
            const noBackend = !err.status || [404, 405, 501].includes(err.status);
            notify(noBackend
                ? "Ruajtja kërkon serverin SyriAI. Skripti mbetet si draft në këtë shfletues."
                : `Ruajtja dështoi: ${err.message}`, 'error', 6000);
        }
    }

    // ---------- Library ----------
    async function openLibrary() {
        const modal = openModal({
            title: 'Biblioteka e skripteve',
            content: '<p class="muted">Duke ngarkuar…</p>',
            wide: true,
            actions: [{ label: 'Mbyll', variant: 'primary', onClick: (close) => close() }],
        });

        let scripts;
        try {
            scripts = await api('/api/scripts');
        } catch {
            modal.body.innerHTML = '<p class="muted">Biblioteka kërkon serverin SyriAI (dotnet run).</p>';
            return;
        }
        if (!scripts.length) {
            modal.body.innerHTML = '<p class="muted">Nuk ka skripte të ruajtura. Shkruani një skript dhe shtypni “Ruaj”.</p>';
            return;
        }

        modal.body.innerHTML = `<ul class="library-list">${scripts.map(x => `
            <li data-id="${x.id}" class="${x.id === currentId ? 'is-current' : ''}">
                <div class="library-item-main">
                    <span class="library-item-title">${escapeHtml(x.title)}</span>
                    <span class="library-item-meta">${escapeHtml(new Date(x.updatedAt + (x.updatedAt.endsWith('Z') ? '' : 'Z')).toLocaleString('sq-AL'))} · ${x.characters.toLocaleString('sq-AL')} karaktere</span>
                </div>
                <button class="btn btn-secondary btn-sm" data-action="open">Hap</button>
                <button class="btn btn-ghost btn-sm" data-action="delete">Fshi</button>
            </li>`).join('')}</ul>`;

        modal.body.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const item = btn.closest('li');
            const id = Number(item.dataset.id);

            if (btn.dataset.action === 'open') {
                if (dirty && scriptInput.value.trim() && btn.dataset.confirm !== 'yes') {
                    btn.dataset.confirm = 'yes';
                    btn.textContent = 'Hap pa ruajtur?';
                    return;
                }
                try {
                    const script = await api(`/api/scripts/${id}`);
                    scriptInput.value = script.content;
                    applyScriptText();
                    setCurrent(script.id, script.title);
                    modal.close();
                } catch (err) {
                    notify(`Skripti nuk u hap: ${err.message}`, 'error');
                }
            } else if (btn.dataset.action === 'delete') {
                if (btn.dataset.confirm !== 'yes') {
                    btn.dataset.confirm = 'yes';
                    btn.textContent = 'Konfirmo';
                    btn.classList.add('btn-danger');
                    return;
                }
                try {
                    await api(`/api/scripts/${id}`, { method: 'DELETE' });
                    item.remove();
                    if (id === currentId) setCurrent(null, currentTitle, true);
                } catch (err) {
                    notify(`Skripti nuk u fshi: ${err.message}`, 'error');
                }
            }
        });
    }

    function newScript() {
        scriptInput.value = '';
        applyScriptText();
        setCurrent(null, '');
        scriptInput.focus();
    }

    saveBtn.addEventListener('click', save);
    libraryBtn.addEventListener('click', openLibrary);
    newBtn.addEventListener('click', newScript);

    // Ctrl/Cmd + S saves the script
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            save();
        }
    });

    restoreDraft();

    return {
        get currentTitle() { return currentTitle; },
        /** A document was loaded: it becomes a new, unsaved script */
        markUnsaved(suggestedTitle) {
            setCurrent(null, suggestedTitle, true);
        },
    };
})();
