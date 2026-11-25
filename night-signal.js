import { isGenerating, setActiveCharacter, setActiveGroup } from '/script.js';
import { openGroupById } from '/scripts/group-chats.js';
import { createAudio } from './audio.js';
import { mountMixtapeStage } from './mixtape-stage.js';

const settingsKey = 'nightSignal';
const context = () => SillyTavern.getContext();
let shutdown;

const defaultPreferences = {
    volume: 45,
    musicVolume: 100,
    ambienceVolume: 100,
    effectsVolume: 100,
    cueVolume: 100,
    soundEnabled: true,
    showOnStartup: true,
    gamepad: true,
    leftDeadZone: 24,
    rightDeadZone: 27,
};

function readPreferences(stored) {
    return Object.fromEntries(Object.entries(defaultPreferences).map(([key, fallback]) => {
        const value = stored?.[key];
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

function addThemeOptions(doc, preferences, change) {
    const outlet = doc.querySelector('#extensions_settings2, #extensions_settings');
    if (!outlet) return null;
    const item = doc.createElement('details');
    item.className = 'mt-theme-options';
    const heading = doc.createElement('summary');
    heading.textContent = '夜间电台 · 主题选项';
    item.append(heading);
    const controls = [
        ['volume', '主题总音量'], ['musicVolume', '音乐'], ['ambienceVolume', '环境声'],
        ['effectsVolume', '过场音效'], ['cueVolume', '操作音效'],
        ['showOnStartup', '启动时打开标题菜单'], ['gamepad', '手柄切换设置板块'],
    ];
    for (const [key, label] of controls) {
        const row = doc.createElement('label');
        row.textContent = label;
        const input = doc.createElement('input');
        if (typeof preferences[key] === 'boolean') {
            input.type = 'checkbox';
            input.checked = preferences[key];
        } else {
            input.type = 'range';
            input.min = '0';
            input.max = '100';
            input.value = String(preferences[key]);
        }
        input.addEventListener('input', () => {
            preferences[key] = input.type === 'checkbox' ? input.checked : input.valueAsNumber;
            change();
        });
        row.append(input);
        item.append(row);
    }
    outlet.append(item);
    return item;
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
            <header class="ns-header">
                <span class="ns-brand">SILLYTAVERN</span>
                <button class="ns-close" type="button" data-action="close">关闭 <span aria-hidden="true">×</span></button>
            </header>
            <main class="ns-main">
                <div class="ns-copy">
                    <section class="ns-page" data-page="home">
                        <h1 class="ns-title ns-mixtape-logo" id="ns-title"><span>Mixtape · 夜间电台</span></h1>
                        <nav class="ns-menu" aria-label="标题菜单"></nav>
                    </section>
                    <section class="ns-page" data-page="recent" hidden>
                        <h2 class="ns-title" id="ns-recent-title">最近聊天</h2>
                        <div class="ns-recent"></div>
                        <button type="button" class="ns-back" data-action="back">← 返回菜单</button>
                    </section>
                    <p class="ns-status" role="status" hidden></p>
                </div>
                <div class="ns-art" aria-hidden="true"></div>
            </main>
            <footer class="ns-footer">
                <div class="ns-hints"><span>↑ ↓ 选择</span><span>Enter 确认</span><span>Esc 返回</span></div>
                <button class="ns-sound" type="button" data-action="sound" aria-pressed="false">声音关</button>
            </footer>
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
    if (shutdown || document.getElementById('night-signal-menu')) return null;
    const menu = document.querySelector('#extensionsMenu');
    if (!menu) return null;

    const ctx = context();
    const audio = createAudio(window, resolveAudioUrl);
    const preferences = readPreferences(ctx.extensionSettings[settingsKey]);
    const savePreferences = () => {
        ctx.extensionSettings[settingsKey] = { ...ctx.extensionSettings[settingsKey], ...preferences };
        ctx.saveSettingsDebounced();
    };

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
    const pages = [...dialog.querySelectorAll('.ns-page')];
    const status = dialog.querySelector('.ns-status');
    const recentList = dialog.querySelector('.ns-recent');
    const sound = dialog.querySelector('.ns-sound');
    const titleArt = dialog.querySelector('.ns-art');
    const recentRows = new WeakMap();

    let page = 'home';
    let recentRequest;
    let openingChat = false;
    let previousFocus;
    let currentEntry;
    let titleVisited = false;
    let soundActive = false;
    let unlocking;

    const domEvents = new AbortController();
    const routedAudio = {
        ...audio,
        cue(name) {
            if (unlocking) void unlocking.then(enabled => { if (enabled) audio.cue(name); });
            else audio.cue(name);
        },
    };
    const themeOptions = addThemeOptions(document, preferences, () => {
        mixAudio(audio, preferences);
        savePreferences();
    });

    const stage = mountMixtapeStage(document, {
        audio: routedAudio,
        preferences,
        resolveAsset: resolveSceneAsset,
        isSoundOn: () => soundActive,
        toggleSound: () => toggleSound({ restoreFocus: false }),
        onTitle: showTitle,
    });

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

    function refreshSoundState(enabled) {
        soundActive = enabled;
        sound.setAttribute('aria-pressed', String(enabled));
        sound.textContent = enabled ? '声音开' : '声音关';
        stage.refreshSound();
        return enabled;
    }

    function unlockSound() {
        if (!soundActive && preferences.soundEnabled && !unlocking) {
            unlocking = audio.setEnabled(true).then(refreshSoundState).finally(() => { unlocking = undefined; });
        }
    }

    function primeAudio(event) {
        if (!event.isTrusted || event.isComposing) return;
        const target = event.target;
        if (!target?.closest) return;
        if (target.closest('.ns-sound, .mt-stage-sound')) return;
        if (target.closest('#night-signal-menu, .night-signal-launcher, #top-settings-holder .drawer-toggle, .mt-stage-controls, body.mt-stage-open #top-settings-holder .openDrawer')) {
            unlockSound();
        }
    }

    async function toggleSound({ restoreFocus = true } = {}) {
        sound.disabled = true;
        try {
            preferences.soundEnabled = !soundActive;
            savePreferences();
            const enabled = refreshSoundState(await audio.setEnabled(preferences.soundEnabled));
            if (enabled) routedAudio.cue('toggle');
        } finally {
            sound.disabled = false;
            if (dialog.open && restoreFocus) sound.focus({ preventScroll: true });
        }
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
        settings: () => openTitlePanel('user-settings-button', '酒馆设置暂时不可用。', { returnToTitle: true }),
        characters: () => {
            if (openTitlePanel('rightNavHolder', '角色管理暂时不可用。')) {
                document.querySelector('#rm_button_characters')?.click();
            }
        },
        'open-chat': button => resumeChat(recentRows.get(button)),
    };

    launcher.addEventListener('click', showTitle);
    document.addEventListener('pointerdown', primeAudio, { capture: true, signal: domEvents.signal });
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
    titleArt.addEventListener('pointermove', event => {
        if (event.pointerType !== 'mouse') return;
        const bounds = titleArt.getBoundingClientRect();
        titleArt.style.setProperty('--ns-tilt-x', `${(0.5 - (event.clientY - bounds.top) / bounds.height) * 12}deg`);
        titleArt.style.setProperty('--ns-tilt-y', `${((event.clientX - bounds.left) / bounds.width - 0.5) * 15}deg`);
    });
    titleArt.addEventListener('pointerleave', () => {
        titleArt.style.removeProperty('--ns-tilt-x');
        titleArt.style.removeProperty('--ns-tilt-y');
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
    document.body.append(dialog);
    document.body.classList.add('night-signal-theme');
    const openOnStartup = () => {
        if (preferences.showOnStartup && !titleVisited) showTitle();
    };
    const dispose = () => {
        if (shutdown !== dispose) return;
        shutdown = undefined;
        if (deferStartup) ctx.eventSource.removeListener(ctx.eventTypes.APP_READY, openOnStartup);
        recentRequest?.abort();
        domEvents.abort();
        stage.dispose();
        themeOptions?.remove();
        audio.dispose();
        if (dialog.open) dialog.close();
        dialog.remove();
        launcherItem.remove();
        document.body.classList.remove('night-signal-theme');
    };
    shutdown = dispose;
    if (deferStartup) ctx.eventSource.once(ctx.eventTypes.APP_READY, openOnStartup);
    else openOnStartup();
    return dispose;
}

export function onDisable() {
    shutdown?.();
}
