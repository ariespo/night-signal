import { mountDiscPage } from './mixtape-disc-page.js';

const nativePanels = [
    ['ai-config-button', 'AI 响应配置', 'left-nav-panel'],
    ['sys-settings-button', 'API 连接', 'rm_api_block'],
    ['advanced-formatting-button', '高级格式化', 'AdvancedFormatting'],
    ['WI-SP-button', '世界书', 'WorldInfo'],
    ['user-settings-button', '用户设置', 'user-settings-block'],
    ['backgrounds-button', '背景', 'Backgrounds'],
    ['extensions-settings-button', '扩展程序', 'rm_extensions_block'],
    ['persona-management-button', '用户设定', 'PersonaManagement'],
    ['rightNavHolder', '角色管理', 'right-nav-panel'],
];

export const panelEntries = nativePanels.map(([id, label]) => ({ id, label }));

const controlSelector = [
    'button', '[href]', 'input:not([type="hidden"])', 'select', 'textarea', '[role="button"]',
    '[role="slider"]', '.menu_button', '.right_menu_button', '.inline-drawer-toggle', 'summary',
].join(',');
const rangeSelector = 'input[type="range"], [role="slider"]';
const adjustSelector = 'input[type="number"], input[type="color"], select';
const confirmSelector = [
    'button', '[href]', '[role="button"]', '.menu_button', '.right_menu_button',
    '.inline-drawer-toggle', 'summary', 'input[type="checkbox"]', 'input[type="radio"]',
].join(',');

export function mountPanelTheme({ document, onPanel, onCue, onOpenFailed, onChatOpened }) {
    const win = document.defaultView;
    const panels = new Map();
    for (const [id, label, nativeId] of nativePanels) {
        const node = document.getElementById(nativeId);
        const toggle = document.getElementById(id)?.querySelector(':scope > .drawer-toggle');
        if (node && toggle) panels.set(id, { id, label, node, toggle });
    }

    const listeners = new win.AbortController();
    let active = null;
    let disposeDetails;
    let pending = null;
    let queued;
    let pendingTimer;
    const isOpen = panel => panel?.node.classList.contains('openDrawer');
    let openBefore = new Set([...panels.values()].filter(isOpen));
    let lastFocus;
    let lastFocusAt = -Infinity;
    let lastInput;
    let lastInputAt = -Infinity;

    function setActive(panel) {
        if (active === panel) return;
        disposeDetails?.();
        active?.node.removeAttribute('data-mt-native-panel');
        active?.node.removeAttribute('data-mt-entry-motion');
        active = panel;
        if (panel) panel.node.dataset.mtNativePanel = panel.id;
        disposeDetails = panel ? mountDiscPage(panel, onCue, onChatOpened) : undefined;
        onPanel?.(panel && { id: panel.id, label: panel.label, node: panel.node });
    }

    function finishOpening() {
        win.clearTimeout(pendingTimer);
        pending = null;
        const next = queued;
        queued = undefined;
        if (next === null) close();
        else if (next !== undefined) open(next);
    }

    function syncOpenPanels() {
        const openNow = new Set([...panels.values()].filter(isOpen));
        const justOpened = [...openNow].filter(panel => !openBefore.has(panel));
        openBefore = openNow;
        if (pending) {
            if (isOpen(pending)) {
                setActive(pending);
                finishOpening();
            }
            return;
        }
        const requested = justOpened.filter(panel => !panel.node.classList.contains('pinnedOpen'));
        if (requested.length) setActive(requested.at(-1));
        else if (active && !isOpen(active)) setActive(null);
    }

    function expectOpening(panel) {
        pending = panel;
        win.clearTimeout(pendingTimer);
        const duration = win.getComputedStyle(document.body).getPropertyValue('--animation-duration').trim();
        const milliseconds = (Number.parseFloat(duration) || 0) * (duration.endsWith('ms') ? 1 : 1000);
        pendingTimer = win.setTimeout(() => {
            const opened = isOpen(panel);
            if (opened) setActive(panel);
            else if (active && !isOpen(active)) setActive(null);
            finishOpening();
            if (!opened) onOpenFailed?.(panel.id);
        }, Math.max(400, milliseconds + 175));
    }

    function open(id) {
        const panel = panels.get(id);
        if (!panel || listeners.signal.aborted) return false;
        if (pending) {
            queued = id;
            return true;
        }
        if (isOpen(panel)) {
            setActive(panel);
            return true;
        }
        expectOpening(panel);
        panel.toggle.click();
        syncOpenPanels();
        return true;
    }

    function close() {
        if (pending) {
            queued = null;
            return true;
        }
        if (!active) return false;
        if (isOpen(active)) active.toggle.click();
        syncOpenPanels();
        return true;
    }

    const observer = new win.MutationObserver(syncOpenPanels);
    for (const { node } of panels.values()) {
        observer.observe(node, { attributes: true, attributeFilter: ['class'] });
    }

    const options = { capture: true, signal: listeners.signal };
    const inDiscPage = target => active?.node.dataset.mtDiscMode === 'disc' && active.node.contains(target);
    document.addEventListener('click', event => {
        const target = event.target;
        if (inDiscPage(target)) return;
        const toggle = target.closest?.('.drawer-toggle');
        const opener = target.closest?.('.drawer-opener[data-target]');
        if (toggle || opener) {
            const panel = opener
                ? panels.get(opener.dataset.target)
                : [...panels.values()].find(panel => panel.toggle === toggle);
            if (panel && !isOpen(panel) && pending !== panel) expectOpening(panel);
            return;
        }
        const control = target.closest?.(controlSelector);
        if (control?.matches(confirmSelector) && active?.node.contains(control)
            && !control.matches('.mt-rotator-arrow')
            && (event.isTrusted || !control.closest('.mt-detail-toggle-row, [data-mt-world-activation]'))) onCue?.('confirm');
    }, options);

    function focusCue(event) {
        if (inDiscPage(event.target)) return;
        const control = event.target.closest?.(controlSelector);
        if (!control || !active?.node.contains(control)) return;
        const now = win.performance.now();
        if (lastFocus === control && now - lastFocusAt < 115) return;
        lastFocus = control;
        lastFocusAt = now;
        onCue?.('focus');
    }

    document.addEventListener('focusin', focusCue, options);
    document.addEventListener('pointerover', event => {
        if (event.pointerType !== 'mouse') return;
        const control = event.target.closest?.(controlSelector);
        if (control && !(event.relatedTarget instanceof win.Node && control.contains(event.relatedTarget))) focusCue(event);
    }, options);
    document.addEventListener('input', event => {
        const control = event.target;
        if (inDiscPage(control)) return;
        if (!active?.node.contains(control) || !control.matches?.(rangeSelector)) return;
        const now = win.performance.now();
        if (lastInput === control && now - lastInputAt < 76) return;
        lastInput = control;
        lastInputAt = now;
        onCue?.('adjust');
    }, options);
    document.addEventListener('change', event => {
        const control = event.target;
        if (inDiscPage(control)) return;
        if (active?.node.contains(control) && control.matches?.(adjustSelector)
            && (event.isTrusted || !control.closest('.mt-rotator'))) onCue?.('adjust');
    }, options);

    return {
        open,
        close,
        activePanel: () => active && { id: active.id, label: active.label, node: active.node },
        dispose() {
            listeners.abort();
            observer.disconnect();
            win.clearTimeout(pendingTimer);
            disposeDetails?.();
            active?.node.removeAttribute('data-mt-native-panel');
            active?.node.removeAttribute('data-mt-entry-motion');
            active = null;
            pending = null;
            queued = undefined;
        },
    };
}
