import {
    captureReaderAnchor,
    findReaderFloorPage,
    measureReaderLayout,
    readerPageOffset,
    resolveReaderAnchor,
} from './mixtape-reader-layout.js';

const defaults = {
    enabled: true,
    scale: 100,
    background: '#2d2825',
    text: '#edd8bd',
    em: '#c6d3d6',
    quote: '#ebbd87',
    underline: '#a9cedf',
};

const colorSettings = [
    ['background', '纸面底色'],
    ['text', '正文'],
    ['em', '斜体'],
    ['quote', '引号'],
    ['underline', '下划线'],
];

function readPreferences(stored) {
    const preferences = { ...defaults };
    if (typeof stored?.enabled === 'boolean') preferences.enabled = stored.enabled;
    if (Number.isFinite(stored?.scale)) preferences.scale = Math.min(160, Math.max(75, Math.round(stored.scale)));
    for (const [key] of colorSettings) {
        if (/^#[0-9a-f]{6}$/i.test(stored?.[key] ?? '')) preferences[key] = stored[key];
    }
    return preferences;
}

function createControls(document) {
    const header = document.createElement('header');
    header.className = 'ns-reader-header';
    header.innerHTML = `
        <div class="ns-reader-brand">夜间电台 <i aria-hidden="true">///</i><span>聊天记录</span></div>
        <button type="button" class="ns-reader-track" aria-pressed="false" aria-label="播放 Slater Synth Track">
            <span aria-hidden="true">▶</span> Slater Synth Track
        </button>
        <div class="ns-reader-tools">
            <button type="button" data-ns-world>世界书</button>
            <select data-ns-floor aria-label="跳到楼层"><option value="">跳到楼层</option></select>
            <details class="ns-reader-options">
                <summary>阅读设置</summary>
                <div class="ns-reader-settings">
                    <label><span>字号 <output data-ns-scale></output></span>
                        <input data-ns-reader-setting="scale" type="range" min="75" max="160" step="5">
                    </label>
                    ${colorSettings.map(([key, label]) => `<label>${label} <input data-ns-reader-setting="${key}" type="color"></label>`).join('')}
                    <button type="button" data-ns-reset>恢复默认</button>
                </div>
            </details>
            <button type="button" class="ns-reader-exit">原生视图</button>
        </div>`;

    const pages = document.createElement('nav');
    pages.className = 'ns-reader-pages';
    pages.setAttribute('aria-label', '歌词内页翻页');
    pages.innerHTML = `
        <button type="button" data-ns-previous aria-label="上一页">‹</button>
        <output data-ns-page aria-live="polite"></output>
        <button type="button" data-ns-next aria-label="下一页">›</button>
        <button type="button" data-ns-latest hidden>回到最新</button>`;
    return { header, pages };
}

function createArtwork(document) {
    const art = document.createElement('div');
    art.className = 'ns-reader-art';
    art.setAttribute('aria-hidden', 'true');
    art.innerHTML = `
        <i class="ns-reader-art-disc"></i>
        <i class="ns-reader-art-case"></i>
        <i class="ns-reader-art-station"></i>
        <i class="ns-reader-art-barcode"></i>`;
    return art;
}

export function mountMixtapeReader(document, { context, stored, save, loadHistory, openWorld, playTrack }) {
    const window = document.defaultView;
    const chat = document.querySelector('#sheld > #chat');
    const composer = document.querySelector('#sheld > #form_sheld');
    if (!chat || !composer) return null;
    const shell = chat.parentElement;
    const preferences = readPreferences(stored);
    const events = new AbortController();
    const { signal } = events;
    const { header, pages } = createControls(document);
    const art = createArtwork(document);
    const floor = header.querySelector('[data-ns-floor]');
    const track = header.querySelector('.ns-reader-track');
    const trackIcon = track.firstElementChild;
    const inputs = [...header.querySelectorAll('[data-ns-reader-setting]')];
    const scaleValue = header.querySelector('[data-ns-scale]');
    const options = header.querySelector('.ns-reader-options');
    const previous = pages.querySelector('[data-ns-previous]');
    const next = pages.querySelector('[data-ns-next]');
    const latest = pages.querySelector('[data-ns-latest]');
    const pageNumber = pages.querySelector('[data-ns-page]');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    chat.before(header);
    composer.before(pages);
    shell.prepend(art);

    let active = false;
    let frame = 0;
    let layout = { stride: 0, pages: 0, visibleLeaves: 1 };
    let anchor = null;
    let currentPage = 0;
    let following = true;
    let epoch = 0;
    let turning = null;
    let floorCount = -1;
    let pageHeight = 0;
    let pageWidth = 0;

    const spreadStart = page => Math.floor(page / layout.visibleLeaves) * layout.visibleLeaves;
    const lastSpread = () => spreadStart(Math.max(0, layout.pages - 1));

    function layoutArtwork() {
        const box = {
            top: chat.offsetTop,
            height: chat.offsetHeight,
            left: chat.offsetLeft,
            width: chat.offsetWidth,
        };
        for (const [edge, value] of Object.entries(box)) {
            const property = `--ns-reader-art-${edge}`;
            const length = `${value}px`;
            if (shell.style.getPropertyValue(property) !== length) shell.style.setProperty(property, length);
        }
    }

    function showTrackState(playing) {
        track.setAttribute('aria-pressed', String(playing));
        track.setAttribute('aria-label', `${playing ? '暂停' : '播放'} Slater Synth Track`);
        trackIcon.textContent = playing ? 'Ⅱ' : '▶';
    }

    function applyPreferences() {
        shell.style.setProperty('--ns-reader-scale', String(preferences.scale / 100));
        for (const [key] of colorSettings) {
            shell.style.setProperty(`--ns-reader-${key === 'background' ? 'bg' : key}`, preferences[key]);
        }
        for (const input of inputs) input.value = preferences[input.dataset.nsReaderSetting];
        scaleValue.value = `${preferences.scale}%`;
    }

    function refreshFloorOptions() {
        if (context.chat.length === floorCount) return;
        floorCount = context.chat.length;
        floor.options.length = 1;
        const items = document.createDocumentFragment();
        context.chat.forEach((message, index) => {
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = message.name ? `第 ${index} 楼 · ${message.name}` : `第 ${index} 楼`;
            items.append(option);
        });
        floor.append(items);
        floor.disabled = floorCount === 0;
    }

    function updatePageControls() {
        const first = spreadStart(currentPage);
        const last = Math.min(layout.pages, first + layout.visibleLeaves);
        const range = first + 1 === last ? last : `${first + 1}–${last}`;
        pageNumber.value = layout.pages ? `页 ${range} / ${layout.pages}` : '页 0 / 0';
        previous.disabled = first <= 0;
        next.disabled = first >= lastSpread();
        latest.hidden = next.disabled;
    }

    function showPage(page, { updateFollowing = false } = {}) {
        currentPage = Math.max(0, Math.min(Math.max(0, layout.pages - 1), page));
        chat.scrollLeft = readerPageOffset(layout, currentPage);
        if (updateFollowing) {
            chat.scrollTop = 0;
            following = spreadStart(currentPage) === lastSpread();
        }
        anchor = following ? null : captureReaderAnchor(chat, layout, currentPage);
        updatePageControls();
    }

    function refreshLayout() {
        if (!active || turning) return;
        pageWidth = chat.clientWidth;
        const leaves = pageWidth >= 760 ? 2 : 1;
        shell.dataset.nsReaderLeaves = String(leaves);
        layoutArtwork();
        const styles = window.getComputedStyle(chat);
        const height = Math.max(0, chat.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom));
        if (height !== pageHeight) {
            pageHeight = height;
            shell.style.setProperty('--ns-reader-page-height', `${height}px`);
        }
        const priorPage = currentPage;
        layout = measureReaderLayout(chat, leaves);
        const page = following ? lastSpread() : anchor ? resolveReaderAnchor(chat, layout, anchor) : priorPage;
        showPage(page);
        refreshFloorOptions();
    }

    function queueLayout() {
        if (!active || frame) return;
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            refreshLayout();
        });
    }

    function cancelTurn() {
        if (!turning) return;
        const { animation, overlay } = turning;
        turning = null;
        animation?.cancel();
        overlay.remove();
    }

    async function navigate(page, { animate = true } = {}) {
        if (!active || turning || page < 0 || page >= layout.pages) return;
        const current = spreadStart(currentPage);
        const target = spreadStart(page);
        const noMotion = reducedMotion.matches || context.powerUserSettings?.reduced_motion;
        if (current === target || !animate || noMotion || !chat.clientHeight) {
            showPage(page, { updateFollowing: true });
            return;
        }

        const forward = target > current;
        const sign = forward ? -1 : 1;
        const overlay = document.createElement('div');
        overlay.className = 'ns-reader-turn';
        overlay.setAttribute('aria-hidden', 'true');
        const leaf = document.createElement('div');
        leaf.className = 'ns-reader-turn-leaf';
        leaf.dataset.direction = forward ? 'next' : 'previous';
        overlay.append(leaf);
        shell.append(overlay);
        const turn = { overlay, animation: null };
        turning = turn;
        try {
            turn.animation = leaf.animate([
                { transform: 'rotateY(0deg)' },
                { transform: `rotateY(${34 * sign}deg) rotateZ(${1.2 * sign}deg)`, offset: 0.48 },
                { transform: `rotateY(${90 * sign}deg)` },
            ], { duration: 230, easing: 'cubic-bezier(.4,.05,.72,.72)', fill: 'forwards' });
            await turn.animation.finished;
            if (turning !== turn) return;
            showPage(page, { updateFollowing: true });
            const lift = turn.animation;
            turn.animation = leaf.animate([
                { transform: `rotateY(${90 * sign}deg)` },
                { transform: `rotateY(${158 * sign}deg) rotateZ(${0.7 * sign}deg)`, offset: 0.72 },
                { transform: `rotateY(${180 * sign}deg)` },
            ], { duration: 270, easing: 'cubic-bezier(.25,.65,.25,1)', fill: 'forwards' });
            lift.cancel();
            await turn.animation.finished;
        } catch (error) {
            if (error.name !== 'AbortError') console.warn('[Night Signal] Page turn interrupted', error);
        } finally {
            if (turning === turn) {
                cancelTurn();
                queueLayout();
            }
        }
    }

    async function jumpToFloor(value) {
        if (value === '' || !active) return;
        cancelTurn();
        const id = Number(value);
        const request = ++epoch;
        const first = Number(chat.querySelector(':scope > .mes[mesid]')?.getAttribute('mesid'));
        try {
            if (Number.isFinite(first) && id < first) await loadHistory(first - id);
            if (!active || request !== epoch) return;
            refreshLayout();
            const target = findReaderFloorPage(chat, layout, value);
            if (target !== null) {
                following = false;
                showPage(target);
            }
        } catch (error) {
            console.warn('[Night Signal] Could not open chat floor', error);
        }
    }

    function syncActive() {
        const displayed = Boolean(context.getCurrentChatId() || context.chat.length);
        const enabled = preferences.enabled && displayed;
        if (active !== enabled) {
            active = enabled;
            epoch++;
            cancelTurn();
            if (!active) {
                window.cancelAnimationFrame(frame);
                frame = 0;
                chat.scrollLeft = 0;
                void playTrack(false);
                showTrackState(false);
            }
        }
        document.body.classList.toggle('night-signal-reader', active);
        header.hidden = !active;
        pages.hidden = !active;
        art.hidden = !active;
        if (active) queueLayout();
    }

    function setEnabled(enabled) {
        if (preferences.enabled === Boolean(enabled)) return;
        preferences.enabled = Boolean(enabled);
        save({ ...preferences });
        syncActive();
        if (!enabled) {
            const message = anchor?.message ?? chat.querySelector(':scope > .mes.last_mes');
            if (message?.isConnected) message.scrollIntoView({ block: 'start', inline: 'nearest' });
        }
    }

    function changeChat() {
        epoch++;
        cancelTurn();
        floorCount = -1;
        anchor = null;
        currentPage = 0;
        following = true;
        syncActive();
    }

    const listeners = [
        ['CHAT_CHANGED', changeChat],
        ['APP_READY', syncActive],
        ['SETTINGS_UPDATED', queueLayout],
    ];
    for (const [name, callback] of listeners) {
        const type = context.eventTypes[name];
        if (type) context.eventSource.on(type, callback);
    }
    const resize = new ResizeObserver(() => {
        if (turning) cancelTurn();
        queueLayout();
    });
    resize.observe(chat);
    const messages = new MutationObserver(() => {
        if (active) queueLayout();
        else if (preferences.enabled) syncActive();
    });
    messages.observe(chat, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'height', 'width', 'mesid'],
    });
    const stylesheet = 'style, link[rel~="stylesheet"]';
    const styles = new MutationObserver(records => {
        if (records.some(record => {
            const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
            return target === document.body || target?.matches(stylesheet)
                || [...record.addedNodes, ...record.removedNodes].some(node => node.matches?.(stylesheet));
        })) queueLayout();
    });
    styles.observe(document.head, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'media', 'disabled'],
    });
    styles.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    document.head.addEventListener('load', event => {
        if (event.target.matches?.(stylesheet)) queueLayout();
    }, { capture: true, signal });
    chat.addEventListener('load', queueLayout, { capture: true, signal });
    chat.addEventListener('scroll', () => {
        if (!active || turning || frame || !layout.stride || pageWidth !== chat.clientWidth) return;
        if (Math.abs(chat.scrollLeft - readerPageOffset(layout, currentPage)) <= 1) return;
        // Browser focus can expose part of an offscreen column, even when scrollbars are hidden.
        const focused = document.activeElement;
        const offset = chat.contains(focused)
            ? chat.scrollLeft + focused.getBoundingClientRect().left - chat.getBoundingClientRect().left - chat.clientLeft
            : chat.scrollLeft + layout.stride / 2;
        showPage(Math.floor((offset + 1) / layout.stride), { updateFollowing: true });
    }, { passive: true, signal });
    document.fonts?.addEventListener('loadingdone', queueLayout, { signal });

    previous.addEventListener('click', () => void navigate(spreadStart(currentPage) - layout.visibleLeaves), { signal });
    next.addEventListener('click', () => void navigate(spreadStart(currentPage) + layout.visibleLeaves), { signal });
    latest.addEventListener('click', () => void navigate(lastSpread(), { animate: false }), { signal });
    pages.addEventListener('keydown', event => {
        if (event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        void navigate(spreadStart(currentPage) + direction * layout.visibleLeaves);
    }, { signal });
    floor.addEventListener('change', () => {
        const value = floor.value;
        floor.value = '';
        void jumpToFloor(value);
    }, { signal });
    header.querySelector('[data-ns-world]').addEventListener('click', openWorld, { signal });
    track.addEventListener('click', async () => {
        track.disabled = true;
        try {
            const playing = await playTrack(track.getAttribute('aria-pressed') !== 'true');
            if (active && !signal.aborted) showTrackState(playing);
            else if (playing) void playTrack(false);
        } finally {
            track.disabled = false;
        }
    }, { signal });
    header.querySelector('.ns-reader-exit').addEventListener('click', () => setEnabled(false), { signal });
    header.querySelector('[data-ns-reset]').addEventListener('click', () => {
        Object.assign(preferences, defaults);
        applyPreferences();
        save({ ...preferences });
        queueLayout();
    }, { signal });
    for (const input of inputs) {
        input.addEventListener('input', () => {
            const key = input.dataset.nsReaderSetting;
            preferences[key] = key === 'scale' ? input.valueAsNumber : input.value;
            applyPreferences();
            save({ ...preferences });
            queueLayout();
        }, { signal });
    }
    document.addEventListener('click', event => {
        if (options.open && !options.contains(event.target)) options.open = false;
    }, { signal });

    applyPreferences();
    syncActive();
    return {
        setEnabled,
        stopTrack() {
            void playTrack(false);
            showTrackState(false);
        },
        get enabled() { return preferences.enabled; },
        dispose() {
            epoch++;
            cancelTurn();
            window.cancelAnimationFrame(frame);
            events.abort();
            resize.disconnect();
            messages.disconnect();
            styles.disconnect();
            for (const [name, callback] of listeners) {
                const type = context.eventTypes[name];
                if (type) context.eventSource.removeListener(type, callback);
            }
            document.body.classList.remove('night-signal-reader');
            delete shell.dataset.nsReaderLeaves;
            for (const property of ['scale', 'bg', 'text', 'em', 'quote', 'underline', 'page-height']) {
                shell.style.removeProperty(`--ns-reader-${property}`);
            }
            for (const edge of ['top', 'height', 'left', 'width']) shell.style.removeProperty(`--ns-reader-art-${edge}`);
            chat.scrollLeft = 0;
            header.remove();
            pages.remove();
            art.remove();
        },
    };
}
