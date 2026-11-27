import { createMusicLibrary } from './mixtape-music.js';

const menuAmbience = 'sfx_SlatersAlbum_ComputerAmbience';
const settingsClicks = ['sfx_ui_SettingsClick1', 'sfx_ui_SettingsClick2', 'sfx_ui_SettingsClick3', 'sfx_ui_SettingsClick4'];
const menuFocusClicks = ['sfx_ui_PauseClick1', 'sfx_ui_PauseClick2', 'sfx_ui_PauseClick3'];
const tabClicks = ['sfx_ui_SettingsCategory1', 'sfx_ui_SettingsCategory2', 'sfx_ui_SettingsCategory3'];

const actionClick = { samples: settingsClicks, channel: 'ui', rate: [1.2, 1.4], level: [0.75, 0.85] };
const sliderClick = { samples: settingsClicks, channel: 'ui', rate: [1.2, 1.3], level: [0.72, 0.72], interval: 0.075 };
const closeCase = { samples: ['sfx_ui_PauseClose'], channel: 'effects' };

// Source waves and modulation ranges come from the corresponding cooked sc_ui_* cues.
const cues = {
    open: { samples: ['a_VinylRecordScratchSmall'], channel: 'effects', level: [0.5, 0.5] },
    close: closeCase,
    'settings-open': { samples: ['sfx_ui_Pause_Select'], channel: 'effects', rate: [1, 1.1] },
    back: { samples: ['sfx_ui_Pause_Select'], channel: 'effects', rate: [0.8, 0.9] },
    tab: { samples: tabClicks, channel: 'ui' },
    confirm: actionClick,
    apply: actionClick,
    toggle: actionClick,
    adjust: sliderClick,
    'adjust-left': { ...sliderClick, rate: [0.85, 0.95] },
    'adjust-right': { ...sliderClick, rate: [1.1, 1.2] },
    focus: { samples: settingsClicks, channel: 'ui', rate: [2, 2.4], level: [0.25, 0.25], interval: 0.065 },
};
const titleFocus = { samples: menuFocusClicks, channel: 'ui', rate: [0.85, 1.1], interval: 0.065 };
const cueSamples = [...new Set([...Object.values(cues).flatMap(cue => cue.samples), ...titleFocus.samples])];
const busHeadroom = { music: 0.56, effects: 0.82, ambience: 0.66, ui: 0.78 };
const musicFadeSeconds = 0.2;
const clampVolume = value => Math.max(0, Math.min(1, value));
const variation = ([min, max] = [1, 1]) => min + (max - min) * Math.random();

export function createAudio(window, resolveSample = name => new URL(`./assets/mixtape/audio/${name}.mp3`, import.meta.url)) {
    const document = window.document;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const activeCues = new Set();
    const decoded = new Map();
    const pending = new Map();
    const requests = new AbortController();
    const channelVolumes = { music: 1, effects: 1, ambience: 1, ui: 1 };
    const channelBuses = {};
    const lastCueAt = new Map();
    const musicListeners = new Set();
    const musicLibrary = createMusicLibrary(window, () => {
        syncMusic();
        notifyMusic();
    });
    let context;
    let master;
    let musicEnvelope;
    let music;
    let musicSource;
    let musicTrackId;
    let localMusicUrl;
    let musicPausing;
    let musicStarting;
    let ambienceVoice;
    let ambienceRequest;
    let enabled = false;
    let ambient = false;
    let musicRequested = true;
    let settingsActive = false;
    let disposed = false;
    let volume = 0.65;
    let activation = 0;
    let playbackReset = 0;

    function setGain(node, value, duration = 0.1) {
        if (!node) return;
        const current = context.currentTime;
        if (typeof node.gain.cancelAndHoldAtTime === 'function') node.gain.cancelAndHoldAtTime(current);
        else node.gain.cancelScheduledValues(current);
        node.gain.setTargetAtTime(value, current, duration / 4.6);
    }

    function canPlay() {
        return enabled && !disposed && volume > 0 && !document.hidden && context?.state === 'running';
    }

    function wantsMusic() {
        return enabled && !disposed && musicRequested;
    }

    function loadSample(name) {
        if (decoded.has(name)) return Promise.resolve(decoded.get(name));
        if (pending.has(name)) return pending.get(name);
        const request = Promise.resolve()
            .then(() => {
                const url = resolveSample(name);
                if (!url) throw new Error(`Missing audio resource: ${name}`);
                return window.fetch(url, { signal: requests.signal });
            })
            .then(response => {
                if (!response.ok) throw new Error(`Audio resource ${name} returned HTTP ${response.status}`);
                return response.arrayBuffer();
            })
            .then(data => disposed ? null : context.decodeAudioData(data))
            .then(buffer => {
                if (buffer && !disposed) decoded.set(name, buffer);
                return buffer;
            })
            .catch(error => {
                if (!requests.signal.aborted) console.warn('Night Signal could not load an audio sample.', error);
                return null;
            })
            .finally(() => pending.delete(name));
        pending.set(name, request);
        return request;
    }

    function startSample(buffer, bus, { loop = false, rate = 1, level = 1 } = {}) {
        const source = context.createBufferSource();
        const envelope = context.createGain();
        source.buffer = buffer;
        source.loop = loop;
        source.playbackRate.value = rate;
        envelope.gain.value = loop ? 0 : level;
        source.connect(envelope).connect(bus);
        const voice = {
            stop(seconds = 0) {
                if (source.onended === null) return;
                setGain(envelope, 0, Math.max(seconds, 0.001));
                source.stop(context.currentTime + seconds);
                activeCues.delete(voice);
            },
        };
        source.onended = () => {
            activeCues.delete(voice);
            source.onended = null;
            source.disconnect();
            envelope.disconnect();
        };
        source.start();
        if (loop) setGain(envelope, level, 0.13);
        else activeCues.add(voice);
        return voice;
    }

    function syncAmbience() {
        if (!ambient || !canPlay() || channelVolumes.ambience === 0) {
            ambienceRequest = undefined;
            ambienceVoice?.stop(canPlay() ? 0.13 : 0);
            ambienceVoice = undefined;
            return;
        }
        if (ambienceVoice || ambienceRequest) return;
        const request = loadSample(menuAmbience);
        ambienceRequest = request;
        void request.then(buffer => {
            if (ambienceRequest !== request) return;
            ambienceRequest = undefined;
            if (buffer && ambient && canPlay() && channelVolumes.ambience > 0) {
                ambienceVoice = startSample(buffer, channelBuses.ambience, { loop: true });
            }
        });
    }

    function musicState() {
        return { ...musicLibrary.getState(), playing: Boolean(context?.state === 'running' && music && !music.paused && !music.ended) };
    }

    function notifyMusic() {
        const state = musicState();
        for (const listener of musicListeners) listener(state);
    }

    function releaseMusicTrack() {
        if (!music) return;
        window.clearTimeout(musicPausing);
        musicPausing = undefined;
        musicStarting = undefined;
        musicTrackId = undefined;
        music.pause();
        music.removeAttribute('src');
        music.load();
        if (localMusicUrl) window.URL.revokeObjectURL(localMusicUrl);
        localMusicUrl = undefined;
        musicEnvelope.gain.cancelScheduledValues(context.currentTime);
        musicEnvelope.gain.value = 0;
    }

    function syncMusic(gesture = false) {
        const selectedTrack = musicLibrary.getSelected();
        if (musicTrackId && musicTrackId !== selectedTrack?.id) releaseMusicTrack();
        if (wantsMusic()) {
            if (!selectedTrack || !context || (context.state !== 'running' && !gesture)) return;
            if (musicPausing !== undefined) {
                window.clearTimeout(musicPausing);
                musicPausing = undefined;
            }
            if (!music) {
                music = document.createElement('audio');
                music.preload = 'none';
                music.addEventListener('play', notifyMusic);
                music.addEventListener('pause', notifyMusic);
                music.addEventListener('ended', () => {
                    if (wantsMusic() && !music.loop) musicLibrary.step(1);
                    notifyMusic();
                });
                musicSource = context.createMediaElementSource(music);
                musicSource.connect(musicEnvelope);
            }
            music.loop = musicLibrary.shouldLoop();
            if (!musicTrackId) {
                const url = selectedTrack.builtin ? resolveSample(selectedTrack.sample) : window.URL.createObjectURL(selectedTrack.file);
                if (!url) return;
                if (!selectedTrack.builtin) localMusicUrl = url;
                musicTrackId = selectedTrack.id;
                music.src = String(url);
            }
            setGain(musicEnvelope, 1, musicFadeSeconds);
            if (music.paused && (!musicStarting || gesture)) {
                const request = music.play();
                musicStarting = request;
                void request.then(() => {
                    if (musicStarting === request && !wantsMusic() && musicPausing === undefined) music.pause();
                }).catch(() => {
                    // Browser media policy can require the next user gesture.
                }).finally(() => {
                    if (musicStarting === request) musicStarting = undefined;
                });
            }
            return;
        }
        if (!music || music.paused) return;
        if (!enabled || context?.state !== 'running') {
            window.clearTimeout(musicPausing);
            musicPausing = undefined;
            musicEnvelope.gain.cancelScheduledValues(context.currentTime);
            musicEnvelope.gain.value = 0;
            music.pause();
        } else if (musicPausing === undefined) {
            setGain(musicEnvelope, 0, musicFadeSeconds);
            musicPausing = window.setTimeout(() => {
                musicPausing = undefined;
                if (!wantsMusic()) music.pause();
            }, musicFadeSeconds * 1000);
        }
    }

    function syncPlayback() {
        syncAmbience();
        syncMusic();
        if (!canPlay()) {
            playbackReset++;
            for (const voice of activeCues) voice.stop();
        }
    }

    function audioStateChanged() {
        syncPlayback();
        notifyMusic();
    }

    function playCue(name) {
        const cue = name === 'focus' && !settingsActive ? titleFocus : Object.hasOwn(cues, name) && cues[name];
        if (!cue || !canPlay() || channelVolumes[cue.channel] === 0) return;
        const now = context.currentTime;
        const group = name.startsWith('adjust') ? 'adjust' : name;
        if (now - (lastCueAt.get(group) ?? -Infinity) < (cue.interval ?? 0)) return;
        lastCueAt.set(group, now);

        const sample = cue.samples[Math.floor(Math.random() * cue.samples.length)];
        const resetAtPlay = playbackReset;
        const play = buffer => {
            if (!buffer || resetAtPlay !== playbackReset || !canPlay() || context.currentTime - now > 0.35) return;
            if (activeCues.size >= 5) activeCues.values().next().value.stop(0.02);
            startSample(buffer, channelBuses[cue.channel], { rate: variation(cue.rate), level: variation(cue.level) });
        };
        if (decoded.has(sample)) play(decoded.get(sample));
        else void loadSample(sample).then(play);
    }

    async function setEnabled(next, { gesture = false } = {}) {
        if (disposed) return false;
        if (next && enabled && context?.state === 'running') {
            if (!music || music.paused) syncMusic(gesture);
            return true;
        }
        const request = ++activation;
        enabled = Boolean(next);
        if (!next) {
            syncPlayback();
            return false;
        }
        try {
            if (!context) {
                if (!AudioContext) return false;
                context = new AudioContext();
                master = context.createGain();
                master.gain.value = volume ** 2;
                master.connect(context.destination);
                for (const [channel, level] of Object.entries(busHeadroom)) {
                    const bus = context.createGain();
                    bus.gain.value = level * channelVolumes[channel];
                    bus.connect(master);
                    channelBuses[channel] = bus;
                }
                musicEnvelope = context.createGain();
                musicEnvelope.gain.value = 0;
                musicEnvelope.connect(channelBuses.music);
                context.addEventListener('statechange', audioStateChanged);
            }
            // Start media on the same trusted event that resumes the audio context.
            // Waiting for resume() can lose the user activation on mobile browsers.
            if (gesture) syncMusic(true);
            if (context.state !== 'running') await context.resume();
        } catch {
            if (request === activation) {
                enabled = false;
                syncPlayback();
            }
            return enabled && context?.state === 'running' && !disposed;
        }
        if (request === activation && !disposed) {
            syncPlayback();
            if (context.state === 'running') {
                for (const name of cueSamples) void loadSample(name);
            }
        }
        return enabled && context.state === 'running' && !disposed;
    }

    document.addEventListener('visibilitychange', syncPlayback);
    return {
        setEnabled,
        getMusicLibrary: musicState,
        subscribeMusic(listener) {
            if (disposed) return () => {};
            musicListeners.add(listener);
            listener(musicState());
            return () => musicListeners.delete(listener);
        },
        selectTrack: musicLibrary.select,
        setMusicMode: musicLibrary.setMode,
        stepTrack: musicLibrary.step,
        addTracks: musicLibrary.add,
        removeTrack: musicLibrary.remove,
        setVolume(value) {
            if (!Number.isFinite(value) || disposed) return;
            volume = clampVolume(value);
            setGain(master, volume ** 2);
            syncPlayback();
        },
        setAmbient(value) {
            if (disposed) return;
            ambient = Boolean(value);
            syncAmbience();
        },
        setMusicPlaying(value) {
            if (disposed) return;
            musicRequested = Boolean(value);
            syncMusic();
        },
        setSettingsActive(value) {
            if (disposed) return;
            settingsActive = Boolean(value);
        },
        setChannelVolume(channel, value) {
            if (!Object.hasOwn(channelVolumes, channel) || !Number.isFinite(value) || disposed) return;
            channelVolumes[channel] = clampVolume(value);
            setGain(channelBuses[channel], busHeadroom[channel] * channelVolumes[channel]);
            syncPlayback();
        },
        supportsOutputDevice() {
            return typeof AudioContext?.prototype.setSinkId === 'function';
        },
        async setOutputDevice(deviceId) {
            if (!enabled || disposed || typeof context?.setSinkId !== 'function' || typeof deviceId !== 'string') return false;
            try {
                await context.setSinkId(deviceId);
                return enabled && !disposed;
            } catch {
                return false;
            }
        },
        cue: playCue,
        dispose() {
            if (disposed) return;
            void setEnabled(false);
            disposed = true;
            musicListeners.clear();
            musicLibrary.close();
            requests.abort();
            decoded.clear();
            document.removeEventListener('visibilitychange', syncPlayback);
            if (music) {
                releaseMusicTrack();
                musicSource.disconnect();
            }
            if (context) {
                context.removeEventListener('statechange', audioStateChanged);
                void context.close().catch(() => {});
            }
        },
    };
}
