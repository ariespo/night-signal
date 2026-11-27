const builtinTracks = [
    ['yesterday-and-today', 'Yesterday and Today — Yes'],
    ['poltergeist', 'ポルターガイスト'],
    ['if-bread', 'If — Bread'],
].map(([id, title]) => ({ id, title, builtin: true, sample: id }));
const defaultTrackId = builtinTracks[0].id;
const selectionKey = 'night-signal-music-selection';
const playbackModeKey = 'night-signal-music-mode';
const audioExtension = /\.(?:aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|webm)$/i;
export const musicModes = Object.freeze({
    sequential: '顺序播放',
    shuffle: '随机播放',
    'repeat-one': '单曲循环',
});

export function createMusicLibrary(window, onChange) {
    let localTracks = [];
    let selectedId = defaultTrackId;
    let mode = 'sequential';
    let closed = false;

    try {
        const storedId = window.localStorage.getItem(selectionKey);
        const storedMode = window.localStorage.getItem(playbackModeKey);
        if (Object.hasOwn(musicModes, storedMode)) mode = storedMode;
        if (storedId === 'slater') window.localStorage.setItem(selectionKey, defaultTrackId);
        else if (storedId) selectedId = storedId;
    } catch {
        // The built-in tracks remain available when browser storage is blocked.
    }

    const database = new Promise((resolve, reject) => {
        const request = window.indexedDB.open('night-signal-music', 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore('tracks', { keyPath: 'key', autoIncrement: true });
        };
        request.onsuccess = () => {
            request.result.onversionchange = () => request.result.close();
            resolve(request.result);
        };
        request.onerror = () => reject(request.error);
    });

    async function transact(mode, requestsForStore) {
        const db = await database;
        if (closed) throw new Error('The music library is closed');
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('tracks', mode);
            transaction.onabort = () => reject(transaction.error ?? new Error('The music library transaction was aborted'));
            try {
                const requests = requestsForStore(transaction.objectStore('tracks'));
                transaction.oncomplete = () => resolve(requests.map(request => request.result));
            } catch (error) {
                transaction.abort();
                reject(error);
            }
        });
    }

    const getTracks = () => [...builtinTracks, ...localTracks];
    const toTrack = record => ({ ...record, id: `local-${record.key}`, builtin: false });
    const getSelected = () => getTracks().find(track => track.id === selectedId);
    const ready = transact('readonly', store => [store.getAll()]).then(
        ([rows]) => { localTracks = rows.map(toTrack); },
        () => {},
    ).then(() => {
        if (closed) return;
        if (!getSelected()) selectedId = defaultTrackId;
        onChange();
    });

    function select(id) {
        if (closed || !getTracks().some(track => track.id === id)) return false;
        if (selectedId !== id) {
            selectedId = id;
            try {
                window.localStorage.setItem(selectionKey, id);
            } catch {
                // Playback still works for this session.
            }
            onChange();
        }
        return true;
    }

    return {
        getSelected,
        getState() {
            return {
                tracks: getTracks().map(({ id, title, builtin }) => ({ id, title, builtin })),
                selectedId: getSelected()?.id ?? defaultTrackId,
                mode,
            };
        },
        shouldLoop: () => mode === 'repeat-one',
        setMode(nextMode) {
            if (closed || !Object.hasOwn(musicModes, nextMode)) return false;
            if (mode !== nextMode) {
                mode = nextMode;
                try {
                    window.localStorage.setItem(playbackModeKey, mode);
                } catch {
                    // The chosen mode remains active for this session.
                }
                onChange();
            }
            return true;
        },
        select,
        step(direction) {
            const tracks = getTracks();
            if (tracks.length < 2 || (direction !== -1 && direction !== 1)) return false;
            const current = tracks.findIndex(track => track.id === selectedId);
            if (current < 0) return false;
            if (mode === 'shuffle') {
                const next = Math.floor(Math.random() * (tracks.length - 1));
                return select(tracks[next < current ? next : next + 1].id);
            }
            return select(tracks[(current + direction + tracks.length) % tracks.length].id);
        },
        async add(files) {
            const records = Array.from(files ?? [])
                .filter(file => file instanceof window.File && file.size > 0 && (file.type.startsWith('audio/') || audioExtension.test(file.name)))
                .map(file => ({ title: file.name.replace(audioExtension, '').trim() || file.name, file }));
            if (!records.length) return 0;
            await ready;
            const keys = await transact('readwrite', store => records.map(record => store.add(record)));
            if (!closed) {
                localTracks.push(...records.map((record, index) => toTrack({ ...record, key: keys[index] })));
                onChange();
            }
            return keys.length;
        },
        async remove(id) {
            await ready;
            const track = localTracks.find(item => item.id === id);
            if (!track || closed) return false;
            await transact('readwrite', store => [store.delete(track.key)]);
            if (!closed) {
                localTracks = localTracks.filter(item => item.id !== id);
                if (selectedId === id) select(defaultTrackId);
                else onChange();
            }
            return true;
        },
        close() {
            closed = true;
            void database.then(db => db.close(), () => {});
        },
    };
}
