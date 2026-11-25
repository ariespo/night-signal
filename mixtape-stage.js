import { connectGamepad } from './mixtape-controls.js';
import { createDeviceOrientation } from './mixtape-device-orientation.js';
import { mountPanelTheme, panelEntries } from './mixtape-panels.js';
import { createJewelScene } from './mixtape-scene.js';

const sensorLabels = {
    prompt: ['启用体感', '允许浏览器读取手机方向以旋转光盘盒'],
    prompting: ['等待授权', '在浏览器的权限提示中允许访问方向传感器'],
    listening: ['校准体感', '以手机当前的姿势作为旋转起点'],
    active: ['校准体感', '以手机当前的姿势作为旋转起点'],
    denied: ['体感未授权', '在浏览器中允许访问方向传感器后再试'],
    insecure: ['体感需 HTTPS', '通过 HTTPS 打开酒馆后即可使用手机体感旋转'],
};

function createButton(doc, label, className = '') {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    return button;
}

export function mountMixtapeStage(doc, { audio, preferences, resolveAsset, onTitle, isSoundOn, toggleSound }) {
    const win = doc.defaultView;
    const decor = doc.createElement('div');
    decor.className = 'mt-scene-layer';
    decor.hidden = true;
    decor.setAttribute('aria-hidden', 'true');
    const fallback = doc.createElement('div');
    fallback.className = 'mt-scene-fallback';
    const reflection = doc.createElement('span');
    reflection.className = 'mt-scene-reflection';
    fallback.append(reflection);
    for (const className of ['mt-scene-sticker', 'mt-scene-barcode', 'mt-scene-shop']) {
        const sticker = doc.createElement('i');
        sticker.className = className;
        fallback.append(sticker);
    }
    decor.append(fallback);

    const controls = doc.createElement('div');
    controls.className = 'mt-stage-controls';
    controls.hidden = true;
    const nav = doc.createElement('nav');
    nav.className = 'mt-stage-nav';
    nav.setAttribute('aria-label', '酒馆设置板块');
    const rail = new Map();
    for (const { id, label } of panelEntries) {
        const button = createButton(doc, label);
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => panels.open(id));
        rail.set(id, button);
        nav.append(button);
    }
    const returnButton = createButton(doc, '返回', 'mt-stage-return');
    const key = doc.createElement('kbd');
    key.textContent = 'ESC';
    returnButton.prepend(key);
    const rotate = createButton(doc, '旋转光盘盒', 'mt-stage-rotate');
    rotate.title = '拖动或使用方向键旋转光盘盒，双击复位';
    const sensor = createButton(doc, '', 'mt-stage-sensor');
    sensor.hidden = true;
    const sound = createButton(doc, '声音关', 'mt-stage-sound');
    sound.setAttribute('aria-pressed', 'false');
    controls.append(nav, returnButton, rotate, sensor, sound);
    doc.body.append(decor, controls);

    const lifecycle = new AbortController();
    const listen = { signal: lifecycle.signal };
    const reduce = win.matchMedia('(prefers-reduced-motion: reduce)');
    let scene;
    let panel;
    let content;
    let caseBox;
    let fromTitle = false;
    let titleTimer;
    let drag;
    let suppressBackdropClick = false;
    let navFocused = false;

    function showSensorStatus(status) {
        const label = sensorLabels[status];
        sensor.hidden = !label;
        if (!label) return;
        [sensor.textContent, sensor.title] = label;
        sensor.disabled = status === 'prompting' || status === 'insecure';
    }

    const orientation = createDeviceOrientation(win, {
        onTilt: (pitch, yaw) => scene?.setDeviceTilt(pitch, yaw),
        onStatus: showSensorStatus,
    });
    showSensorStatus(orientation.status);

    function readBox() {
        const node = panel?.node;
        if (!node) return null;
        const bounds = node.getBoundingClientRect();
        const articleX = bounds.left + node.clientLeft + (content?.offsetLeft ?? 0);
        const articleY = bounds.top + node.clientTop + (content?.offsetTop ?? 0);
        const pauseArt = decor.dataset.artwork === 'character-pause' && content?.querySelector(':scope > .mt-character-disc');
        if (pauseArt?.offsetWidth && pauseArt.offsetHeight) {
            const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = pauseArt;
            content.style.transformOrigin = `${offsetLeft + offsetWidth / 2}px ${offsetTop + offsetHeight / 2}px`;
            return { x: articleX + offsetLeft, y: articleY + offsetTop, width: offsetWidth, height: offsetHeight };
        }
        const inset = Math.min(bounds.width * 0.044, 56);
        const width = Math.min(win.innerWidth - 4, bounds.width + inset * 2);
        const top = Math.max(0, bounds.top - Math.min(22, win.innerHeight * 0.026));
        const available = win.innerHeight - top;
        const height = node.dataset.mtDiscMode === 'disc'
            ? available + 8
            : Math.min(available + 8, Math.max(width * 0.87, bounds.height + 46));
        const box = {
            x: Math.min(win.innerWidth - width - 2, Math.max(2, bounds.left + bounds.width / 2 - width / 2)),
            y: top,
            width,
            height,
        };
        if (content && !content.hidden) {
            // Use the drawer's layout coordinates so the previous frame cannot move the pivot.
            const x = box.x + width / 2 - articleX;
            const y = top + height / 2 - articleY;
            content.style.transformOrigin = `${x}px ${y}px`;
        }
        return box;
    }

    function refreshBounds() {
        caseBox = readBox();
        scene?.layout(caseBox);
    }

    function refreshArtwork() {
        const node = panel?.node;
        const pause = node?.dataset.mtDiscMode === 'disc' && node.hasAttribute('data-mt-character-pause');
        decor.dataset.artwork = pause ? 'character-pause' : 'settings';
        scene?.setArtworkVisible(!pause);
    }

    const boxObserver = new win.ResizeObserver(refreshBounds);
    const modeObserver = new win.MutationObserver(() => {
        refreshArtwork();
        refreshBounds();
    });
    win.addEventListener('resize', refreshBounds, listen);
    win.visualViewport?.addEventListener('resize', refreshBounds, listen);

    function projectCase({ box, lens, pitch, yaw, roll, scale, lift, opacity, lightX, lightY }) {
        // The browser's y axis points down. The depth is the front of the original case mesh.
        const depth = box.width / 2 * 0.045274;
        const transform = `translateY(${lift}px) perspective(${lens}px) rotateZ(${-roll}rad) rotateY(${yaw}rad) `
            + `rotateX(${-pitch}rad) scale3d(${scale},${scale},${scale}) translateZ(${depth}px)`;
        if (content && !content.hidden) {
            content.style.transform = transform;
            content.style.opacity = opacity;
        }
        if (decor.dataset.renderer === 'flat' && decor.dataset.artwork !== 'character-pause') {
            fallback.style.transform = transform;
            fallback.style.opacity = opacity;
            reflection.style.setProperty('--mt-reflection-x', `${-yaw * 245 + lightX * 8}%`);
            reflection.style.setProperty('--mt-reflection-y', `${-pitch * 230 - lightY * 8}%`);
        }
    }

    function refreshSound() {
        const enabled = isSoundOn();
        sound.textContent = enabled ? '声音开' : '声音关';
        sound.setAttribute('aria-pressed', String(enabled));
    }

    function panelChanged(next) {
        const old = panel;
        panel = next;
        content = next?.node.querySelector(':scope > .mt-disc-page');
        caseBox = null;
        boxObserver.disconnect();
        modeObserver.disconnect();
        controls.hidden = !next;
        doc.body.classList.toggle('mt-stage-open', !!next);
        for (const [id, button] of rail) button.setAttribute('aria-pressed', String(id === next?.id));

        if (!next) {
            orientation.setActive(false);
            scene?.hide();
            if (old) audio.cue('close');
            audio.setAmbient(false);
            audio.setSettingsActive(false);
            if (fromTitle) {
                fromTitle = false;
                titleTimer = win.setTimeout(() => {
                    if (!panel && !lifecycle.signal.aborted) onTitle();
                }, reduce.matches || doc.body.classList.contains('reduced-motion') ? 0 : 360);
            }
            navFocused = false;
            return;
        }

        win.clearTimeout(titleTimer);
        if (!scene) scene = createJewelScene(decor, { resolveAsset, onPose: projectCase });
        refreshArtwork();
        const order = [...rail.keys()];
        const direction = old ? Math.sign(order.indexOf(next.id) - order.indexOf(old.id)) : 0;
        const animation = old ? 'switching' : 'opening';
        next.node.dataset.mtEntryMotion = animation;
        boxObserver.observe(next.node);
        modeObserver.observe(next.node, { attributes: true, attributeFilter: ['data-mt-disc-mode', 'data-mt-character-pause'] });
        caseBox = readBox();
        scene.show(caseBox, direction);
        orientation.setActive(true);
        audio.setSettingsActive(true);
        audio.setAmbient(true);
        audio.cue(old ? 'tab' : fromTitle ? 'settings-open' : 'open');
        refreshSound();
        if (!navFocused && fromTitle) {
            navFocused = true;
            rail.get(next.id)?.focus({ preventScroll: true });
        }
    }

    const panels = mountPanelTheme({
        document: doc,
        onPanel: panelChanged,
        onCue: cue => audio.cue(cue),
    });

    function stepPanel(direction) {
        const choices = [...rail];
        const current = choices.findIndex(([id]) => id === panel?.id);
        const [id, button] = choices[(current + direction + choices.length) % choices.length];
        panels.open(id);
        button.focus({ preventScroll: true });
    }

    function exit() {
        if (panel) panels.close();
    }

    const disconnectGamepad = connectGamepad(win, {
        isActive: () => !!panel && preferences.gamepad,
        deadZone: side => (side === 'right' ? preferences.rightDeadZone : preferences.leftDeadZone) / 100,
        onInput(input) {
            if (input === 'back') exit();
            else if (['left', 'previous-tab'].includes(input)) stepPanel(-1);
            else if (['right', 'next-tab'].includes(input)) stepPanel(1);
        },
    });

    // SillyTavern dismisses unpinned drawers on presses outside their DOM subtree.
    for (const outlet of [controls, decor]) {
        for (const eventType of ['mousedown', 'touchstart']) {
            outlet.addEventListener(eventType, event => event.stopPropagation(), { ...listen, passive: true });
        }
    }
    returnButton.addEventListener('click', exit, listen);
    decor.addEventListener('click', () => {
        if (!suppressBackdropClick) exit();
        suppressBackdropClick = false;
    }, listen);
    sound.addEventListener('click', async () => {
        await toggleSound();
        refreshSound();
    }, listen);
    nav.addEventListener('focusin', event => {
        if (event.target instanceof win.HTMLButtonElement) audio.cue('focus');
    }, listen);
    nav.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') {
            const first = [...(panel?.node.querySelectorAll('.mt-disc-page :is([tabindex="0"], button:not([tabindex="-1"]), input, textarea)') ?? [])]
                .find(element => !element.disabled && element.getClientRects().length);
            if (!first) return;
            event.preventDefault();
            event.stopPropagation();
            first.focus();
            return;
        }
        const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        if (!direction) return;
        event.preventDefault();
        event.stopPropagation();
        stepPanel(direction);
    }, listen);
    doc.addEventListener('keydown', event => {
        if (!panel || event.defaultPrevented || event.key !== 'Escape' || event.isComposing) return;
        if (doc.querySelector('dialog[open], .select2-container--open')) return;
        const target = event.target;
        if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (!(controls.contains(target) || panel.node.contains(target))) return;
        event.preventDefault();
        event.stopPropagation();
        exit();
    }, listen);

    for (const target of [rotate, decor]) {
        target.addEventListener('pointerdown', event => {
            if (event.button !== 0 || drag) return;
            if (target === decor) {
                suppressBackdropClick = false;
                const box = caseBox;
                if (!box || event.clientX < box.x || event.clientX > box.x + box.width
                    || event.clientY < box.y || event.clientY > box.y + box.height) return;
            }
            if (reduce.matches || doc.body.classList.contains('reduced-motion')) return;
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
            target.setPointerCapture(event.pointerId);
            target.classList.add('is-dragging');
        }, listen);
        target.addEventListener('pointermove', event => {
            if (drag?.id !== event.pointerId || !target.hasPointerCapture(event.pointerId)) return;
            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;
            if (!drag.moved && Math.hypot(dx, dy) < 4) return;
            drag.moved = true;
            scene?.rotate(dx * 0.004, dy * 0.004);
            drag.x = event.clientX;
            drag.y = event.clientY;
        }, listen);
        target.addEventListener('lostpointercapture', event => {
            if (drag?.id !== event.pointerId) return;
            if (target === decor) suppressBackdropClick = drag.moved;
            drag = undefined;
            target.classList.remove('is-dragging');
        }, listen);
    }
    rotate.addEventListener('dblclick', () => {
        scene?.resetRotation();
        orientation.reset();
    }, listen);
    sensor.addEventListener('click', () => {
        if (orientation.status === 'active' || orientation.status === 'listening') orientation.reset();
        else void orientation.enable();
    }, listen);
    rotate.addEventListener('keydown', event => {
        const input = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, -0.05], ArrowDown: [0, 0.05] }[event.key];
        if (!input) return;
        event.preventDefault();
        event.stopPropagation();
        scene?.rotate(...input);
    }, listen);

    return {
        refreshSound,
        open(id, { returnToTitle = false } = {}) {
            fromTitle = returnToTitle;
            navFocused = false;
            return panels.open(id);
        },
        dispose() {
            lifecycle.abort();
            win.clearTimeout(titleTimer);
            disconnectGamepad();
            boxObserver.disconnect();
            modeObserver.disconnect();
            panels.dispose();
            orientation.dispose();
            scene?.dispose();
            decor.remove();
            controls.remove();
            doc.body.classList.remove('mt-stage-open');
        },
    };
}
