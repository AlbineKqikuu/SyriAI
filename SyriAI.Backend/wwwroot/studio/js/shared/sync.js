// SyriAI Studio — message transport between the admin studio and client screens.
//
// Preferred: the SignalR hub on the backend (/hubs/studio). Works between devices
// (e.g. a tablet in the studio) and scopes messages to the signed-in user.
// Fallback: BroadcastChannel, which only reaches other tabs of the same browser.
// It is used automatically when the page is opened without the backend.
//
// Messages keep the original shape: send(type, data) → handler(type, data).
//
// Reliability and speed:
// - The connection never gives up: it keeps retrying (every 15 s at most) and retries at once
//   when the network comes back or the tab becomes visible again.
// - "Latest value wins" messages (pointer, scroll, highlight, timing…) are merged: at most one
//   of each type goes out per frame, so a moving hand cannot flood the connection.
// - Messages are sent without waiting for the server's reply.
// - While disconnected, normal messages are queued; the merged kinds keep only their latest value.
// - When the login has expired the status is 'login'; retries continue, so the screens reconnect
//   as soon as the user signs in again (in any tab of the same browser).

class StudioSync {
    static HUB_URL = '/hubs/studio';
    static CHANNEL_NAME = 'syriai_sync';

    /** Message types where only the newest value matters */
    static LATEST_ONLY = new Set([
        'cursor_pos', 'text_scroll', 'pdf_scroll', 'doc_scroll_ratio', 'highlight_update',
        'pdf_word_highlight', 'show_timing', 'tracking_state', 'scroll_speed_sync', 'font_size',
    ]);
    static FLUSH_MS = 33;           // merged messages: about 30 per second at most
    static MAX_QUEUE = 300;
    static RETRY_DELAYS = [0, 1000, 2000, 5000, 10000];
    static MAX_RETRY_DELAY = 15000;
    static SESSION_PING_MS = 5 * 60 * 1000;

    constructor() {
        this.handlers = [];
        this.statusHandlers = [];
        this.queue = [];
        this.latest = new Map();    // type → data, waiting for the next flush
        this.flushTimer = null;
        this.connection = null;
        this.channel = null;
        this.restartTimer = null;
        this.restartAttempt = 0;
        /** 'connecting' | 'online' | 'reconnecting' | 'login' | 'local' | 'offline' */
        this.status = 'connecting';
    }

    /** Register a handler for incoming messages: (type, data) => void */
    on(handler) {
        this.handlers.push(handler);
    }

    /** Register a handler for connection status changes: (status, previous) => void */
    onStatus(handler) {
        this.statusHandlers.push(handler);
        handler(this.status);
    }

    offStatus(handler) {
        this.statusHandlers = this.statusHandlers.filter(h => h !== handler);
    }

    /**
     * HTTP status behind a SignalR error. Negotiation errors wrap the original one and keep the
     * status only in the text ("… Status code '401'").
     */
    static httpStatus(err) {
        if (!err) return null;
        if (typeof err.statusCode === 'number') return err.statusCode;
        const m = /Status code '(\d{3})'/.exec(String(err.message || err));
        return m ? Number(m[1]) : null;
    }

    get connected() {
        return this.status === 'online' || this.status === 'local';
    }

    send(type, data = null) {
        if (StudioSync.LATEST_ONLY.has(type)) {
            this.latest.set(type, data);
            if (this.connected && !this.flushTimer) {
                this.flushTimer = setTimeout(() => this._flushLatest(), StudioSync.FLUSH_MS);
            }
            return;
        }
        // Keep the order: anything merged before this message goes out first
        if (this.connected) {
            this._flushLatest();
            this._transmit(type, data);
        } else {
            // Offline: merged values set so far go into the queue first, so the replay keeps the order
            this.latest.forEach((latestData, latestType) => this.queue.push({ type: latestType, data: latestData }));
            this.latest.clear();
            this.queue.push({ type, data });
            while (this.queue.length > StudioSync.MAX_QUEUE) this.queue.shift();
        }
    }

    async start() {
        // Opened as a file (no server at all): same-browser mode right away
        if (window.signalR && location.protocol !== 'file:') {
            try {
                await this._startSignalR();
                return;
            } catch (err) {
                // A server that answers but has no hub (static hosting) → same-browser mode.
                // A network error → the backend exists but is unreachable: keep trying.
                const status = StudioSync.httpStatus(err);
                if (status === 401) {
                    this._setStatus('login');
                    this._scheduleRestart(StudioSync.MAX_RETRY_DELAY);
                    this._watchNetwork();
                    return;
                }
                if (status === 404 || status === 405 || status === 501) {
                    console.warn('SignalR hub not found, falling back to BroadcastChannel:', err);
                } else {
                    console.warn('SignalR connection failed, retrying:', err);
                    this._setStatus('offline');
                    this._scheduleRestart();
                    this._watchNetwork();
                    return;
                }
            }
        }
        this._startBroadcastChannel();
    }

    _transmit(type, data) {
        if (this.status === 'local') {
            this.channel.postMessage({ type, data });
            return;
        }
        // send() does not wait for the server's reply (invoke() would, for every message)
        this.connection.send('Send', type, data).catch(err => {
            console.warn('Sync send failed:', type, err);
            if (!StudioSync.LATEST_ONLY.has(type)) this.queue.push({ type, data });
        });
    }

    _flushLatest() {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
        if (!this.connected || !this.latest.size) return;
        const pending = this.latest;
        this.latest = new Map();
        pending.forEach((data, type) => this._transmit(type, data));
    }

    _buildConnection() {
        const connection = new signalR.HubConnectionBuilder()
            .withUrl(StudioSync.HUB_URL)
            .withAutomaticReconnect({
                // Never stop retrying (the default gives up after four attempts)
                nextRetryDelayInMilliseconds: (ctx) => {
                    if (StudioSync.httpStatus(ctx.retryReason) === 401) {
                        // Report it after this callback returns (status handlers may touch the connection)
                        setTimeout(() => this._setStatus('login'));
                        return StudioSync.MAX_RETRY_DELAY;
                    }
                    return StudioSync.RETRY_DELAYS[ctx.previousRetryCount] ?? StudioSync.MAX_RETRY_DELAY;
                },
            })
            .configureLogging(signalR.LogLevel.Warning)
            .build();
        // The camera AI can keep the page busy for a moment: do not call that a lost connection
        connection.serverTimeoutInMilliseconds = 60000;
        connection.keepAliveIntervalInMilliseconds = 15000;

        connection.on('message', (type, data) => this._dispatch(type, data));
        connection.onreconnecting(() => { if (this.status !== 'login') this._setStatus('reconnecting'); });
        connection.onreconnected(() => this._setStatus('online'));
        connection.onclose(() => {
            // Reached only when the automatic reconnect could not start (e.g. the server restarted)
            this._setStatus('offline');
            this._scheduleRestart();
        });
        return connection;
    }

    async _startSignalR() {
        this.connection = this._buildConnection();
        await this.connection.start();
        this.restartAttempt = 0;
        this._setStatus('online');
        this._watchNetwork();
    }

    /** Renew the sliding login now and then, so a long show does not get logged out */
    _keepSessionAlive() {
        setInterval(() => {
            if (this.status !== 'online') return;
            fetch('/api/ping', { credentials: 'same-origin', cache: 'no-store' }).catch(() => { /* next time */ });
        }, StudioSync.SESSION_PING_MS);
    }

    /** Start a closed connection again, with a growing pause between attempts */
    _scheduleRestart(delay) {
        clearTimeout(this.restartTimer);
        const wait = delay ?? (StudioSync.RETRY_DELAYS[this.restartAttempt] ?? StudioSync.MAX_RETRY_DELAY);
        this.restartTimer = setTimeout(() => this._restart(), wait);
    }

    async _restart() {
        if (!this.connection) this.connection = this._buildConnection();
        if (this.connection.state !== signalR.HubConnectionState.Disconnected) return;
        this.restartAttempt++;
        try {
            await this.connection.start();
            this.restartAttempt = 0;
            this._setStatus('online');
        } catch (err) {
            // 401: the login expired. Keep trying slowly: after the user signs in again, the next try works.
            if (StudioSync.httpStatus(err) === 401) {
                this._setStatus('login');
                this._scheduleRestart(StudioSync.MAX_RETRY_DELAY);
                return;
            }
            this._scheduleRestart();
        }
    }

    _watchNetwork() {
        if (this._watching) return;
        this._watching = true;
        this._keepSessionAlive();
        const retryNow = () => {
            if (this.connection?.state === signalR.HubConnectionState.Disconnected) this._scheduleRestart(0);
        };
        window.addEventListener('online', retryNow);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') retryNow();
        });
    }

    _startBroadcastChannel() {
        this.channel = new BroadcastChannel(StudioSync.CHANNEL_NAME);
        this.channel.onmessage = (event) => this._dispatch(event.data.type, event.data.data);
        this._setStatus('local');
    }

    _dispatch(type, data) {
        for (const handler of this.handlers) {
            try {
                handler(type, data);
            } catch (err) {
                console.error('Sync handler error for', type, err);
            }
        }
    }

    _setStatus(status) {
        const previous = this.status;
        if (status === previous) return;
        this.status = status;
        if (this.connected) {
            const pending = this.queue;
            this.queue = [];
            pending.forEach(m => this._transmit(m.type, m.data));
            this._flushLatest();
        }
        this.statusHandlers.forEach(h => {
            try { h(status, previous); } catch (err) { console.error('Sync status handler error', err); }
        });
    }
}

// Human-readable label for a sync status (Albanian UI)
StudioSync.statusLabel = function (status) {
    return {
        connecting: 'Duke u lidhur…',
        online: 'Sinkronizimi: online',
        reconnecting: 'Duke u rilidhur…',
        login: 'Hyrja ka skaduar — kyçuni përsëri',
        local: 'Sinkronizimi: vetëm ky shfletues',
        offline: 'Sinkronizimi: jashtë linje — duke provuar përsëri',
    }[status] || status;
};
