import { isGenerating, setActiveCharacter, setActiveGroup, showMoreMessages } from '/script.js';
import { openGroupById } from '/scripts/group-chats.js';
import { createAudio } from './audio.js';
import { mountMixtapeStage } from './mixtape-stage.js';
import { mountMixtapeReader } from './mixtape-reader.js';
import { appearanceFields, mountThemeOptions, titleThemes } from './mixtape-options.js';

const settingsKey = 'nightSignal';
const context = () => SillyTavern.getContext();
let shutdown;

const defaultPreferences = {
    enabled: true,
    hideTopNav: true,
    hideReasoning: false,
    hideActions: false,
    hideNames: false,
    hideAvatars: false,
    hideTimestamps: false,
    hideComposerTools: false,
    volume: 45,
    musicVolume: 100,
    ambienceVolume: 100,
    effectsVolume: 100,
    cueVolume: 100,
    soundEnabled: true,
    showOnStartup: true,
    titleTheme: 'amber',
    gamepad: true,
    followMotion: true,
    leftDeadZone: 24,
    rightDeadZone: 27,
};

function readPreferences(stored) {
    return Object.fromEntries(Object.entries(defaultPreferences).map(([key, fallback]) => {
        const value = stored?.[key];
        if (key === 'titleTheme') {
            return [key, typeof value === 'string' && Object.hasOwn(titleThemes, value) ? value : fallback];
        }
        if (typeof fallback === 'number') {
            return [key, Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : fallback];
        }
        return [key, typeof value === 'boolean' ? value : fallback];
    }));
}

function mixAudio(audio, preferences) {
    audio.setVolume(preferences.volume / 100);
    audio.setChannelVolume('music', preferences.musicVolume / 100);
    audio.setChannelVolume('ambience', preferences.ambienceVolume / 100);
    audio.setChannelVolume('effects', preferences.effectsVolume / 100);
    audio.setChannelVolume('ui', preferences.cueVolume / 100);
}

function applyAppearance(preferences, keepNativeNav = false) {
    for (const [key, , attribute] of appearanceFields) {
        const hidden = Boolean(preferences?.[key]) && !(keepNativeNav && key === 'hideTopNav');
        document.body.toggleAttribute(`data-ns-ui-hide-${attribute}`, hidden);
    }
}

function menuEntry(action, label, detail = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ns-entry';
    button.dataset.action = action;

    const name = document.createElement('span');
    name.className = 'ns-entry-label';
    name.textContent = label;
    const description = document.createElement('span');
    description.className = 'ns-entry-detail';
    description.textContent = detail;
    const arrow = document.createElement('span');
    arrow.className = 'ns-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↗';
    button.append(name, description, arrow);
    return button;
}

function createMenu() {
    const dialog = document.createElement('dialog');
    dialog.id = 'night-signal-menu';
    dialog.className = 'night-signal';
    dialog.setAttribute('aria-labelledby', 'ns-title');
    dialog.innerHTML = `
        <div class="ns-shell">
            <section class="ns-page ns-md-device" data-page="home">
                <div class="ns-md-face" aria-hidden="true"></div>
                <h1 class="ns-title" id="ns-title">夜间电台</h1>
                <nav class="ns-menu" aria-label="标题菜单"></nav>
                <button class="ns-sound" type="button" data-action="sound" aria-pressed="false">声音关</button>
                <button class="ns-close" type="button" data-action="close">退出</button>
                <span class="ns-author" aria-label="作者 poaries">poaries</span>
            </section>
            <section class="ns-page ns-md-history" data-page="recent" hidden>
                <h2 class="ns-title" id="ns-recent-title">最近聊天</h2>
                <div class="ns-recent"></div>
                <button type="button" class="ns-back" data-action="back">← 返回菜单</button>
            </section>
            <p class="ns-status" role="status" hidden></p>
        </div>`;
    dialog.querySelector('[data-page="home"] .ns-menu').append(
        menuEntry('continue', '继续聊天'),
        menuEntry('recent', '最近聊天'),
        menuEntry('characters', '选择角色'),
        menuEntry('settings', '设置'),
    );
    return dialog;
}

async function fetchRecentChats(signal) {
    const ctx = context();
    const response = await fetch('/api/chats/recent', {
        method: 'POST',
        headers: ctx.getRequestHeaders(),
        body: JSON.stringify({ max: 7 }),
        cache: 'no-store',
        signal,
    });
    if (!response.ok) throw new Error(`Recent chats returned HTTP ${response.status}`);

    const entries = await response.json();
    if (!Array.isArray(entries)) throw new Error('Invalid recent chats response');
    return entries.flatMap(({ file_name, avatar, group, last_mes }) => {
        const owner = group
            ? ctx.groups.find(item => String(item.id) === String(group))
            : ctx.characters.find(item => item.avatar === avatar);
        if (!owner || typeof file_name !== 'string' || !file_name.endsWith('.jsonl')) return [];
        return [{
            name: file_name.slice(0, -'.jsonl'.length),
            owner: owner.name,
            avatar,
            group: group ? owner.id : null,
            date: last_mes ? ctx.timestampToMoment(last_mes)?.format('L') : '',
        }];
    });
}

async function openRecentChat(entry) {
    if (isGenerating()) throw new Error('A chat is generating');

    const ctx = context();
    if (entry.group !== null) {
        const group = ctx.groups.find(item => item.id === entry.group);
        if (!group?.chats?.includes(entry.name)) throw new Error('Group chat no longer exists');
        if (String(ctx.groupId) !== String(entry.group)) await openGroupById(entry.group);
        if (String(context().groupId) !== String(entry.group)) throw new Error('Could not select group');
        if (context().getCurrentChatId() !== entry.name) await ctx.openGroupChat(entry.group, entry.name);
        setActiveGroup(entry.group);
    } else {
        const id = ctx.characters.findIndex(item => item.avatar === entry.avatar);
        if (id < 0) throw new Error('Character no longer exists');
        if (ctx.groupId || String(ctx.characterId) !== String(id)) await ctx.selectCharacterById(id);
        if (context().groupId || String(context().characterId) !== String(id)) throw new Error('Could not select character');
        if (context().getCurrentChatId() !== entry.name) await ctx.openCharacterChat(entry.name);
        setActiveCharacter(entry.avatar);
    }
    ctx.saveSettingsDebounced();
}

export function mount({ resolveAudioUrl, resolveSceneAsset, deferStartup = false } = {}) {
    if (shutdown || document.querySelector('#night-signal-menu, #night-signal-theme-options')) return null;
    const menu = document.querySelector('#extensionsMenu');
    if (!menu) return null;

    const ctx = context();
    const managedChat = window.__TAURITAVERN__?.api?.chatSurface?.isManagedOwnershipRequired?.() === true;
    const preferences = readPreferences(ctx.extensionSettings[settingsKey]);
    const savePreferences = () => {
        ctx.extensionSettings[settingsKey] = { ...ctx.extensionSettings[settingsKey], ...preferences };
        ctx.saveSettingsDebounced();
    };
    let theme;
    let ready = false;
    const options = mountThemeOptions(document, preferences, key => {
        savePreferences();
        if (key === 'enabled') {
            if (preferences.enabled) {
                if (document.querySelector('#rm_extensions_block.openDrawer:not(.pinnedOpen)')) {
                    document.querySelector('#extensions-settings-button > .drawer-toggle')?.click();
                }
                enableTheme();
            } else disableTheme();
        } else theme?.updatePreferences(key);
    }, { keepNativeNav: managedChat });

    function enableTheme() {
        if (theme) return;
        theme = mountTheme({ ctx, menu, preferences, savePreferences, resolveAudioUrl, resolveSceneAsset, managedChat });
        options?.setAudio(theme.audio);
        if (ready) theme.startAudio(Boolean(window.navigator.userActivation?.isActive));
    }

    function disableTheme() {
        if (!theme) return;
        options?.setAudio(null);
        theme.dispose();
        theme = undefined;
    }

    function openOnStartup() {
        ready = true;
        theme?.startAudio();
        theme?.openOnStartup();
    }

    const dispose = () => {
        if (shutdown !== dispose) return;
        if (!ready) ctx.eventSource.removeListener(ctx.eventTypes.APP_READY, openOnStartup);
        disableTheme();
        options?.dispose();
        shutdown = undefined;
    };
    shutdown = dispose;
    if (preferences.enabled) enableTheme();
    if (deferStartup) ctx.eventSource.once(ctx.eventTypes.APP_READY, openOnStartup);
    else openOnStartup();
    return dispose;
}

function mountTheme({ ctx, menu, preferences, savePreferences, resolveAudioUrl, resolveSceneAsset, managedChat }) {
    const audio = createAudio(window, resolveAudioUrl);

    const launcherItem = document.createElement('div');
    launcherItem.className = 'extension_container';
    launcherItem.setAttribute('role', 'listitem');
    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'night-signal-launcher';
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-controls', 'night-signal-menu');
    launcher.textContent = '夜间电台';
    launcherItem.append(launcher);
    const dialog = createMenu();
    dialog.dataset.nsTitleTheme = preferences.titleTheme;
    const pages = [...dialog.querySelectorAll('.ns-page')];
    const status = dialog.querySelector('.ns-status');
    const recentList = dialog.querySelector('.ns-recent');
    const sound = dialog.querySelector('.ns-sound');
    const recentRows = new WeakMap();

    let page = 'home';
    let recentRequest;
    let openingChat = false;
    let previousFocus;
    let currentEntry;
    let titleVisited = false;
    let unlocking;

    const domEvents = new AbortController();
    const { signal } = domEvents;
    const routedAudio = {
        ...audio,
        cue(name) {
            if (unlocking) void unlocking.then(enabled => { if (enabled) audio.cue(name); });
            else audio.cue(name);
        },
    };
    const stage = mountMixtapeStage(document, {
        audio: routedAudio,
        preferences,
        savePreferences,
        resolveAsset: resolveSceneAsset,
        isSoundOn: () => preferences.soundEnabled,
        toggleSound: () => toggleSound({ restoreFocus: false }),
        onTitle: showTitle,
    });

    const readerItem = document.createElement('div');
    readerItem.className = 'extension_container';
    readerItem.setAttribute('role', 'listitem');
    const readerToggle = document.createElement('button');
    readerToggle.type = 'button';
    readerToggle.className = 'night-signal-launcher';
    readerItem.append(readerToggle);

    function refreshReaderToggle(enabled) {
        readerToggle.textContent = enabled ? '关闭歌词内页' : '打开歌词内页';
        readerToggle.setAttribute('aria-pressed', String(enabled));
    }

    // TauriTavern's virtualizer owns the native message list and its scroll position.
    const reader = managedChat ? null : mountMixtapeReader(document, {
        context: ctx,
        stored: ctx.extensionSettings[settingsKey]?.reader,
        save(value) {
            ctx.extensionSettings[settingsKey] = { ...ctx.extensionSettings[settingsKey], reader: value };
            ctx.saveSettingsDebounced();
            refreshReaderToggle(value.enabled);
        },
        loadHistory: showMoreMessages,
        openWorld: () => stage.open('WI-SP-button'),
        openCharacters: () => stage.open('rightNavHolder'),
        openExtensions: () => stage.open('extensions-settings-button'),
        subscribeMusic: audio.subscribeMusic,
        changeTrack: audio.stepTrack,
        setMusicMode: audio.setMusicMode,
        playTrack(playing) {
            if (playing && !preferences.soundEnabled) {
                preferences.soundEnabled = true;
                savePreferences();
                refreshSoundState();
            }
            audio.setMusicPlaying(playing);
            if (playing) unlockSound(true);
        },
    });
    if (reader) {
        refreshReaderToggle(reader.enabled);
        readerToggle.addEventListener('click', () => reader.setEnabled(!reader.enabled), { signal: domEvents.signal });
    } else if (managedChat) {
        readerItem.textContent = '关闭 TauriTavern 的「聊天 DOM 虚拟化」并重启，即可使用歌词内页。';
    }

    const toolbar = document.createElement('nav');
    toolbar.className = 'ns-theme-toolbar';
    toolbar.setAttribute('aria-label', '夜间电台');
    const titleButton = document.createElement('button');
    titleButton.type = 'button';
    titleButton.textContent = '夜间电台';
    titleButton.addEventListener('click', showTitle, { signal });
    const optionsButton = document.createElement('button');
    optionsButton.type = 'button';
    optionsButton.textContent = '扩展程序';
    optionsButton.addEventListener('click', () => stage.open('extensions-settings-button'), { signal });
    toolbar.append(titleButton, optionsButton);

    const selectable = () => [...dialog.querySelectorAll('.ns-page:not([hidden]) :is(.ns-entry, .ns-back):enabled')];

    function setStatus(text) {
        status.textContent = text;
        status.hidden = !text;
    }

    function setActive(entry, playCue = false) {
        if (entry === currentEntry) return;
        currentEntry?.removeAttribute('data-active');
        currentEntry = entry;
        currentEntry?.setAttribute('data-active', 'true');
        if (entry && playCue) routedAudio.cue('focus');
    }

    function showPage(name, focusAction) {
        recentRequest?.abort();
        page = name;
        setStatus('');
        for (const section of pages) section.hidden = section.dataset.page !== name;
        dialog.dataset.page = name;
        dialog.setAttribute('aria-labelledby', name === 'home' ? 'ns-title' : `ns-${name}-title`);
        const choices = selectable();
        const first = choices.find(choice => choice.dataset.action === focusAction) ?? choices[0];
        setActive(first);
        if (dialog.open) first?.focus();
    }

    function showTitle() {
        if (dialog.open || document.body.classList.contains('mt-stage-open')) return;
        titleVisited = true;
        previousFocus = document.activeElement;
        const current = context();
        const detail = dialog.querySelector('[data-action="continue"] .ns-entry-detail');
        detail.textContent = current.getCurrentChatId() ? current.name2 || '' : '';
        showPage('home');
        dialog.showModal();
        currentEntry?.focus();
        audio.setAmbient(true);
    }

    function closeTitle({ focusChat = false, keepAmbience = false } = {}) {
        recentRequest?.abort();
        if (!keepAmbience) {
            audio.setAmbient(false);
            audio.setSettingsActive(false);
        }
        dialog.close();
        if (focusChat) document.querySelector('#send_textarea')?.focus({ preventScroll: true });
        else if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus();
        else document.querySelector('#extensionsMenuButton')?.focus();
    }

    function goBack() {
        routedAudio.cue('back');
        if (page === 'home') closeTitle();
        else showPage('home', page);
    }

    async function showRecent({ resume = false } = {}) {
        recentList.replaceChildren();
        showPage('recent');
        setStatus('正在读取最近聊天…');
        const request = new AbortController();
        recentRequest = request;
        try {
            const entries = await fetchRecentChats(request.signal);
            if (request.signal.aborted) return;
            setStatus(entries.length ? '' : '还没有最近聊天。');
            for (const entry of entries) {
                const detail = [entry.owner, entry.date !== 'Invalid date' && entry.date].filter(Boolean).join(' · ');
                const row = menuEntry('open-chat', entry.name, detail);
                row.title = entry.name;
                recentRows.set(row, entry);
                recentList.append(row);
            }
            if (resume && entries.length) {
                await resumeChat(entries[0]);
                return;
            }
            if (document.activeElement?.classList.contains('ns-back')) selectable()[0]?.focus();
        } catch (error) {
            if (!request.signal.aborted) {
                console.warn('[Night Signal] Unable to load recent chats', error);
                setStatus('最近聊天暂时无法读取。请稍后再试。');
            }
        } finally {
            if (recentRequest === request) recentRequest = undefined;
        }
    }

    async function resumeChat(entry) {
        if (openingChat || !entry) return;
        if (isGenerating()) {
            setStatus('请等当前回复生成完毕后再切换聊天。');
            return;
        }
        openingChat = true;
        routedAudio.cue('confirm');
        try {
            await openRecentChat(entry);
            if (dialog.open) closeTitle({ focusChat: true });
        } catch (error) {
            console.warn('[Night Signal] Unable to open chat', error);
            setStatus('这段聊天暂时无法打开。');
        } finally {
            openingChat = false;
        }
    }

    function refreshSoundState() {
        sound.setAttribute('aria-pressed', String(preferences.soundEnabled));
        sound.textContent = preferences.soundEnabled ? '声音开' : '声音关';
        stage.refreshSound();
    }

    function unlockSound(gesture = false) {
        if (!preferences.soundEnabled) return;
        const attempt = audio.setEnabled(true, { gesture });
        // The initial resume() can remain pending while autoplay is blocked.
        // Let a trusted gesture make its own attempt without waiting for it.
        if (!gesture) return;
        unlocking = attempt;
        void attempt.finally(() => {
            if (unlocking === attempt) unlocking = undefined;
        });
    }

    function primeAudio(event) {
        if (!event.isTrusted || event.isComposing) return;
        if (event.type === 'pointerdown' && event.pointerType !== 'mouse') return;
        if (event.type === 'pointerup' && event.pointerType === 'mouse') return;
        if (event.target?.closest?.('.ns-sound, .mt-stage-sound, .ns-reader-track')) return;
        unlockSound(true);
    }

    async function toggleSound({ restoreFocus = true } = {}) {
        const enabled = preferences.soundEnabled = !preferences.soundEnabled;
        savePreferences();
        refreshSoundState();
        if (dialog.open && restoreFocus) sound.focus({ preventScroll: true });
        if (await audio.setEnabled(enabled, { gesture: enabled }) && preferences.soundEnabled) routedAudio.cue('toggle');
    }

    function openTitlePanel(id, message, { returnToTitle = false } = {}) {
        return stage.open(id, {
            returnToTitle,
            beforeOpen: () => closeTitle({ keepAmbience: true }),
            onFailure() {
                showTitle();
                setStatus(message);
            },
        });
    }

    const actions = {
        close: () => { routedAudio.cue('back'); closeTitle(); },
        back: goBack,
        sound: () => toggleSound(),
        continue: () => context().getCurrentChatId() ? closeTitle({ focusChat: true }) : showRecent({ resume: true }),
        recent: () => showRecent(),
        settings: () => openTitlePanel('ai-config-button', '预设设置暂时不可用。', { returnToTitle: true }),
        characters: () => openTitlePanel('rightNavHolder', '角色管理暂时不可用。'),
        'open-chat': button => resumeChat(recentRows.get(button)),
    };

    launcher.addEventListener('click', showTitle);
    document.addEventListener('pointerdown', primeAudio, { capture: true, signal: domEvents.signal });
    document.addEventListener('pointerup', primeAudio, { capture: true, signal: domEvents.signal });
    document.addEventListener('keydown', primeAudio, { capture: true, signal: domEvents.signal });
    dialog.addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        if (['continue', 'recent', 'characters'].includes(button.dataset.action)) {
            routedAudio.cue('confirm');
        }
        void actions[button.dataset.action]?.(button);
    });
    dialog.addEventListener('focusin', event => {
        if (event.target.matches('.ns-entry, .ns-back')) setActive(event.target, true);
    });
    dialog.addEventListener('pointerover', event => {
        const button = event.target.closest('.ns-entry, .ns-back');
        if (event.pointerType === 'mouse' && button && !button.contains(event.relatedTarget)) setActive(button, true);
    });
    dialog.addEventListener('cancel', event => {
        event.preventDefault();
        goBack();
    });
    dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            goBack();
            return;
        }
        if (event.target instanceof HTMLInputElement || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        const choices = selectable();
        if (!choices.length) return;
        event.preventDefault();
        event.stopPropagation();
        const position = choices.indexOf(document.activeElement);
        const step = event.key === 'ArrowDown' ? 1 : choices.length - 1;
        const next = position < 0 ? (step === 1 ? 0 : choices.length - 1) : (position + step) % choices.length;
        choices[next].focus();
    });

    mixAudio(audio, preferences);

    menu.append(launcherItem);
    if (reader || managedChat) menu.append(readerItem);
    document.body.append(dialog, toolbar);
    document.body.classList.add('night-signal-theme');
    applyAppearance(preferences, managedChat);
    refreshSoundState();
    return {
        audio,
        startAudio: unlockSound,
        openOnStartup() {
            if (preferences.showOnStartup && !titleVisited) showTitle();
        },
        updatePreferences(key) {
            if (key === 'titleTheme') {
                dialog.dataset.nsTitleTheme = preferences.titleTheme;
            } else if (appearanceFields.some(([field]) => key === field)) {
                applyAppearance(preferences, managedChat);
                reader?.refresh();
            } else mixAudio(audio, preferences);
        },
        dispose() {
            recentRequest?.abort();
            domEvents.abort();
            reader?.dispose();
            stage.dispose();
            audio.dispose();
            if (dialog.open) dialog.close();
            dialog.remove();
            toolbar.remove();
            launcherItem.remove();
            readerItem.remove();
            applyAppearance(null);
            document.body.classList.remove('night-signal-theme');
        },
    };
}

export function onDisable() {
    shutdown?.();
}
