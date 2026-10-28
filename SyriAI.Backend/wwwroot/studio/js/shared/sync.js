// SyriAI Studio — message transport between the admin studio and client screens.
//
// Preferred: the SignalR hub on the backend (/hubs/studio). Works between devices
// (e.g. a tablet in the studio) and scopes messages to the signed-in user.
// Fallback: BroadcastChannel, which only reaches other tabs of the same browser.
// It is used automatically when the page is opened without the backend.
//
// Messages keep the original shape: send(type, data) → handler(type, data).

class StudioSync {
    static HUB_URL = '/hubs/studio';
    static CHANNEL_NAME = 'syriai_sync';

    constructor() {
        this.handlers = [];
        this.statusHandlers = [];
        this.queue = [];
        this.connection = null;
        this.channel = null;
        /** 'connecting' | 'online' | 'reconnecting' | 'local' | 'offline' */
        this.status = 'connecting';
    }

    /** Register a handler for incoming messages: (type, data) => void */
    on(handler) {
        this.handlers.push(handler);
    }

    /** Register a handler for connection status changes: (status) => void */
    onStatus(handler) {
        this.statusHandlers.push(handler);
        handler(this.status);
    }

    send(type, data = null) {
        if (this.status === 'online') {
            this.connection.invoke('Send', type, data).catch(err => console.warn('Sync send failed:', type, err));
        } else if (this.status === 'local') {
            this.channel.postMessage({ type, data });
        } else {
            // Not connected yet: deliver once connected (bounded, oldest dropped first)
            this.queue.push({ type, data });
            if (this.queue.length > 200) this.queue.shift();
        }
    }

    async start() {
        if (window.signalR) {
            try {
                await this._startSignalR();
                return;
            } catch (err) {
                console.warn('SignalR unavailable, falling back to BroadcastChannel:', err);
            }
        }
        this._startBroadcastChannel();
    }

    async _startSignalR() {
        this.connection = new signalR.HubConnectionBuilder()
            .withUrl(StudioSync.HUB_URL)
            .withAutomaticReconnect([0, 1000, 2000, 5000, 10000, 10000, 30000])
            .configureLogging(signalR.LogLevel.Warning)
            .build();

        this.connection.on('message', (type, data) => this._dispatch(type, data));
        this.connection.onreconnecting(() => this._setStatus('reconnecting'));
        this.connection.onreconnected(() => this._setStatus('online'));
        this.connection.onclose(() => this._setStatus('offline'));

        await this.connection.start();
        this._setStatus('online');
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
        this.status = status;
        if ((status === 'online' || status === 'local') && this.queue.length) {
            const pending = this.queue;
            this.queue = [];
            pending.forEach(m => this.send(m.type, m.data));
        }
        this.statusHandlers.forEach(h => h(status, previous));
    }
}

// Human-readable label for a sync status (Albanian UI)
StudioSync.statusLabel = function (status) {
    return {
        connecting: 'Duke u lidhur…',
        online: 'Sinkronizimi: online',
        reconnecting: 'Duke u rilidhur…',
        local: 'Sinkronizimi: vetëm ky shfletues',
        offline: 'Sinkronizimi: jashtë linje',
    }[status] || status;
};
