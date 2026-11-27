import { mountPanelDetails } from './mixtape-detail.js';
import { renderWorldPage } from './mixtape-world-page.js';
import { renderConfigurationPage } from './mixtape-configuration-pages.js';
import { renderCatalogPage } from './mixtape-catalog-pages.js';

const catalogs = new Set(['Backgrounds', 'rm_extensions_block', 'PersonaManagement', 'right-nav-panel']);
const backingChanges = {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
        'class', 'style', 'hidden', 'disabled', 'aria-disabled', 'readonly', 'checked',
        'selected', 'value', 'label', 'min', 'max', 'step', 'placeholder', 'title', 'type',
    ],
};

function setAttribute(element, name, value) {
    if (element.getAttribute(name) === value) return;
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
}

export function mountDiscPage(panel, onCue, onChatOpened) {
    const source = panel.node;
    const doc = source.ownerDocument;
    const win = doc.defaultView;
    const zh = doc.documentElement.lang.toLowerCase().startsWith('zh');
    const msg = (cn, en) => zh ? cn : en;
    const observers = new Map();
    const backing = new Map();
    const listeners = new win.AbortController();
    let disposeNative;
    let native = false;
    let discScrollTop = 0;
    let refreshFrame = 0;
    let visibility;

    function element(tag, cls, label) {
        const el = doc.createElement(tag);
        el.className = cls;
        if (label) el.textContent = label;
        return el;
    }

    function button(cls, label) {
        const el = element('button', cls, label);
        el.type = 'button';
        return el;
    }

    const article = element('article', 'mt-disc-page');
    const header = element('header', 'mt-disc-header');
    const title = element('h2', 'mt-disc-title', panel.label);
    const root = element('div', 'mt-disc-content');
    const footer = element('footer', 'mt-disc-footer');
    const more = button('mt-disc-action mt-disc-more', msg('完整设置', 'All controls'));
    const back = button('mt-disc-action mt-disc-back', msg('返回唱片盒设置', 'Back to disc settings'));
    back.hidden = true;
    header.append(title);
    footer.append(more);
    article.append(header, root, footer);
    source.prepend(article, back);

    const nativeObserver = new win.MutationObserver(records => {
        if (records.some(record => record.target === source)) refreshBacking();
        requestRefresh();
    });

    function restoreBacking(child, wasInert) {
        child.removeAttribute('data-mt-backing');
        child.inert = wasInert;
    }

    function refreshBacking() {
        for (const [child, wasInert] of backing) {
            if (child.parentElement === source) continue;
            restoreBacking(child, wasInert);
            backing.delete(child);
        }
        for (const child of source.children) {
            if (child === article || child === back || backing.has(child)) continue;
            backing.set(child, child.inert);
            child.dataset.mtBacking = '';
            child.inert = !native || child.inert;
        }
        // The article is animated and writes its own DOM. Observe only native controls.
        nativeObserver.disconnect();
        nativeObserver.observe(source, { childList: true });
        for (const child of backing.keys()) nativeObserver.observe(child, backingChanges);
    }

    function watch(callback, scope = root) {
        if (!observers.has(scope)) observers.set(scope, new Set());
        observers.get(scope).add(callback);
    }

    function requestRefresh() {
        if (native || doc.hidden || refreshFrame || listeners.signal.aborted) return;
        refreshFrame = win.requestAnimationFrame(() => {
            refreshFrame = 0;
            refresh();
        });
    }

    function refresh() {
        if (native || doc.hidden || listeners.signal.aborted) return;
        if (visibility) return requestRefresh();
        win.cancelAnimationFrame(refreshFrame);
        refreshFrame = 0;
        visibility = new WeakMap();
        try {
            for (const [scope, callbacks] of observers) {
                if (!article.contains(scope)) observers.delete(scope);
                else if (!scope.closest('[hidden]')) {
                    for (const callback of callbacks) callback();
                }
            }
        } finally {
            visibility = undefined;
        }
    }

    function setNative(show) {
        if (show === native) return;
        if (show) discScrollTop = root.scrollTop;
        native = show;
        source.dataset.mtDiscMode = show ? 'native' : 'disc';
        article.hidden = show;
        back.hidden = !show;
        for (const [child, wasInert] of backing) child.inert = !show || wasInert;
        if (show) {
            disposeNative = mountPanelDetails(panel, onCue);
            back.focus({ preventScroll: true });
        } else {
            disposeNative?.();
            disposeNative = undefined;
            title.tabIndex = -1;
            title.focus({ preventScroll: true });
            refresh();
            root.scrollTop = discScrollTop;
        }
        source.scrollTop = 0;
        onCue?.('back');
    }

    function section(label, parent = root) {
        const block = element('section', 'mt-disc-section');
        if (label) block.append(element('h3', 'mt-disc-heading', label));
        const rows = element('div', 'mt-disc-rows');
        block.append(rows);
        parent.append(block);
        return rows;
    }

    const resolve = target => typeof target === 'function' ? target() : target ? source.querySelector(target) : null;
    function disabled(node) {
        const wrapper = node.closest('.disabled');
        return node.matches(':disabled, [aria-disabled="true"]') || Boolean(wrapper && source.contains(wrapper));
    }

    function isShown(node) {
        for (let el = node; el && el !== source; el = el.parentElement) {
            let shown = visibility.get(el);
            if (shown === undefined) {
                shown = !el.hidden && win.getComputedStyle(el).display !== 'none';
                visibility.set(el, shown);
            }
            if (!shown) return false;
        }
        return true;
    }

    function createRow(parent, label, type) {
        const row = element('div', 'mt-disc-row');
        row.dataset.mtDiscRow = type;
        const caption = element('span', 'mt-disc-label', label);
        const output = element('div', 'mt-disc-control');
        row.append(caption, output);
        parent.append(row);
        return { row, output };
    }

    function notify(node, event) {
        for (const name of event === 'both' ? ['input', 'change'] : [event]) {
            node.dispatchEvent(new win.Event(name, { bubbles: true }));
        }
    }

    function field(parent, label, target, options = {}) {
        const { row, output } = createRow(parent, label, options.mode ?? 'field');
        row.dataset.mtDiscHandled = '';
        let mode;
        let syncWidget;

        function update(callback) {
            const node = resolve(target);
            if (!node || disabled(node) || node.readOnly) return;
            callback(node);
            requestRefresh();
        }

        function rotator(kind) {
            const group = element('div', 'mt-disc-rotator');
            const previous = button('mt-disc-arrow', '←');
            const next = button('mt-disc-arrow', '→');
            const value = element('span', 'mt-disc-value');
            value.setAttribute('aria-live', 'polite');
            previous.setAttribute('aria-label', `${msg('上一个', 'Previous')} · ${label}`);
            next.setAttribute('aria-label', `${msg('下一个', 'Next')} · ${label}`);
            previous.tabIndex = -1;
            next.tabIndex = -1;
            row.tabIndex = 0;
            row.setAttribute('role', 'group');
            group.append(previous, value, next);
            output.replaceChildren(group);

            function candidate(node, direction) {
                if (disabled(node)) return -1;
                if (kind === 'checkbox') return node.checked === (direction > 0) ? -1 : 0;
                for (let i = node.selectedIndex + direction; i >= 0 && i < node.options.length; i += direction) {
                    const option = node.options[i];
                    if (!option.hidden && option.style.display !== 'none' && !option.matches(':disabled')) return i;
                }
                return -1;
            }

            function step(direction) {
                update(node => {
                    const index = candidate(node, direction);
                    if (index < 0) return;
                    if (kind === 'checkbox') node.click();
                    else {
                        node.selectedIndex = index;
                        notify(node, options.event ?? 'both');
                    }
                    onCue?.(direction < 0 ? 'adjust-left' : 'adjust-right');
                });
            }

            previous.addEventListener('click', () => step(-1));
            next.addEventListener('click', () => step(1));
            row.onkeydown = event => {
                const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
                if (!direction) return;
                event.preventDefault();
                event.stopPropagation();
                step(direction);
            };
            return node => {
                const selected = node.options?.[node.selectedIndex];
                const text = kind === 'checkbox'
                    ? node.checked ? msg('开', 'On') : msg('关', 'Off')
                    : (selected?.label || '–');
                const displayed = options.format ? options.format(text, node) : text;
                if (value.textContent !== displayed) value.textContent = displayed;
                setAttribute(row, 'aria-label', `${label} · ${displayed}`);
                setAttribute(previous, 'aria-disabled', String(candidate(node, -1) < 0));
                setAttribute(next, 'aria-disabled', String(candidate(node, 1) < 0));
            };
        }

        function editor(kind) {
            const area = kind === 'textarea';
            const input = element(area ? 'textarea' : 'input', 'mt-disc-editor');
            if (!area) input.type = kind;
            input.setAttribute('aria-label', label);
            row.removeAttribute('tabindex');
            row.removeAttribute('role');
            row.removeAttribute('aria-label');
            row.onkeydown = null;
            const meter = kind === 'range' ? element('div', 'mt-disc-meter') : null;
            const valueLabel = meter && element('span', 'mt-disc-meter-value');
            if (meter) {
                meter.append(input, valueLabel);
                output.replaceChildren(meter);
            } else output.replaceChildren(input);

            input.addEventListener('input', () => {
                if (options.event === 'change') return;
                update(node => {
                    node.value = input.value;
                    notify(node, 'input');
                    if (meter) onCue?.('adjust');
                });
            });
            input.addEventListener('change', () => {
                if (options.event === 'input') return;
                update(node => {
                    node.value = input.value;
                    notify(node, 'change');
                    if (!meter) onCue?.('confirm');
                });
            });
            input.addEventListener('blur', requestRefresh);
            return node => {
                if (kind === 'number' || meter) {
                    setAttribute(input, 'min', node.getAttribute('min') ?? '');
                    setAttribute(input, 'max', node.getAttribute('max') ?? '');
                    setAttribute(input, 'step', node.getAttribute('step') ?? 'any');
                }
                setAttribute(input, 'disabled', disabled(node) ? '' : null);
                setAttribute(input, 'readonly', node.readOnly ? '' : null);
                setAttribute(input, 'placeholder', node.placeholder ?? '');
                if ((doc.activeElement !== input || meter) && input.value !== node.value) input.value = node.value;
                if (meter) {
                    const min = Number(input.min || 0);
                    const max = Number(input.max || 100);
                    const percent = Math.min(100, Math.max(0, (Number(node.value) - min) / Math.max(max - min, 1) * 100));
                    const fill = `${percent}%`;
                    if (meter.style.getPropertyValue('--mt-disc-fill') !== fill) meter.style.setProperty('--mt-disc-fill', fill);
                    const display = options.format?.(node.value, node) ?? node.value;
                    if (valueLabel.textContent !== display) valueLabel.textContent = display;
                }
            };
        }

        function sync() {
            if (!article.contains(row)) {
                observers.get(parent)?.delete(sync);
                return;
            }
            const node = resolve(target);
            setAttribute(row, 'hidden', !node || (!(options.force || options.allowHidden) && !isShown(node)) ? '' : null);
            if (row.hidden) return;
            const kind = options.mode ?? (node.localName === 'select' ? 'select' : node.localName === 'textarea' ? 'textarea' : node.type);
            if (mode !== kind) {
                mode = kind;
                row.dataset.mtDiscRow = mode;
                syncWidget = kind === 'select' || kind === 'checkbox' ? rotator(kind) : editor(kind);
            }
            syncWidget(node);
        }
        watch(sync, parent);
        return row;
    }

    function action(parent, label, target, options = {}) {
        const { row, output } = createRow(parent, label, 'action');
        row.dataset.mtDiscHandled = '';
        const control = button('mt-disc-action');
        control.setAttribute('aria-label', label);
        output.append(control);
        control.addEventListener('click', () => {
            const node = resolve(target);
            if (options.run) options.run();
            else node?.click();
            options.after?.();
            onCue?.(options.cue ?? 'confirm');
            requestRefresh();
        });
        function sync() {
            if (!article.contains(row)) {
                observers.get(parent)?.delete(sync);
                return;
            }
            const node = resolve(target);
            const shown = options.shown?.() ?? (options.run || (node && (options.force || isShown(node))));
            setAttribute(row, 'hidden', shown ? null : '');
            setAttribute(control, 'disabled', !options.run && node && disabled(node) ? '' : null);
            const text = (typeof options.value === 'function' ? options.value() : options.value) ?? msg('打开', 'Open');
            if (control.textContent !== text) control.textContent = text;
        }
        watch(sync, parent);
        return row;
    }

    const ui = { root, source, section, field, action, watch, refresh, requestRefresh, setAttribute, showNative: () => setNative(true), cue: onCue, onChatOpened };
    source.dataset.mtDiscMode = 'disc';
    refreshBacking();
    const nativeInput = event => {
        if (!article.contains(event.target) && event.target !== back) requestRefresh();
    };
    const capture = { capture: true, signal: listeners.signal };
    source.addEventListener('input', nativeInput, capture);
    source.addEventListener('change', nativeInput, capture);
    doc.addEventListener('visibilitychange', requestRefresh, { signal: listeners.signal });
    const jquerySource = win.jQuery?.(source);
    const jqueryEvents = 'input.nightSignalDisc change.nightSignalDisc';
    const jqueryChange = event => {
        if (!event.originalEvent) nativeInput(event);
    };
    jquerySource?.on(jqueryEvents, jqueryChange);
    // Some host scripts assign control properties without emitting an event.
    const timer = win.setInterval(refresh, 1500);
    more.addEventListener('click', () => setNative(true));
    back.addEventListener('click', () => setNative(false));
    article.addEventListener('focusin', event => {
        if (event.target !== title) onCue?.('focus');
    });
    article.addEventListener('pointerover', event => {
        const row = event.target.closest('.mt-disc-row, .mt-disc-catalog-item');
        if (event.pointerType === 'mouse' && row
            && !(event.relatedTarget instanceof win.Node && row.contains(event.relatedTarget))) onCue?.('focus');
    });
    article.addEventListener('click', event => {
        const pressed = event.target.closest('button');
        if (pressed && pressed !== more && !pressed.closest('[data-mt-disc-handled]')) onCue?.('confirm');
    });
    article.addEventListener('keydown', event => {
        const direction = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
        if (!direction || event.defaultPrevented || event.target.matches('textarea, input, [contenteditable]')) return;
        const items = [...article.querySelectorAll('.mt-disc-row[tabindex="0"], button:not([tabindex="-1"]), input, textarea')]
            .filter(item => item.getClientRects().length && !item.disabled);
        const index = items.indexOf(event.target);
        if (index < 0) return;
        event.preventDefault();
        items[index + direction]?.focus();
    });

    const render = source.id === 'WorldInfo' ? renderWorldPage : catalogs.has(source.id) ? renderCatalogPage : renderConfigurationPage;
    const disposePage = render(ui);
    refresh();

    return () => {
        listeners.abort();
        jquerySource?.off(jqueryEvents, jqueryChange);
        nativeObserver.disconnect();
        win.cancelAnimationFrame(refreshFrame);
        win.clearInterval(timer);
        disposePage?.();
        disposeNative?.();
        for (const [child, wasInert] of backing) restoreBacking(child, wasInert);
        delete source.dataset.mtDiscMode;
        article.remove();
        back.remove();
    };
}
