const selectSelectors = {
    WorldInfo: '#world_info_character_strategy',
    'user-settings-block': '#avatar_style, #chat_display, #media_display, #toastr_position',
};
const initializedWorldPanels = new WeakSet();

function mountWorldActivation(node) {
    const content = node.querySelector('#wiTopBlock .inline-drawer-content');
    const toggle = content?.previousElementSibling;
    const caption = toggle?.querySelector('b > span');
    const icon = toggle?.querySelector('.inline-drawer-icon');
    if (!caption || !icon) return;

    const doc = node.ownerDocument;
    const win = doc.defaultView;
    const chinese = doc.documentElement.lang.toLowerCase().startsWith('zh');
    const original = caption.textContent;
    const refresh = () => {
        const expanded = icon.classList.contains('up');
        caption.textContent = expanded ? (chinese ? '收起' : 'Collapse') : (chinese ? '展开' : 'Expand');
    };
    const observer = new win.MutationObserver(refresh);
    observer.observe(icon, { attributes: true, attributeFilter: ['class'] });
    toggle.dataset.mtWorldActivation = '';
    if (!initializedWorldPanels.has(node)) {
        initializedWorldPanels.add(node);
        if (win.getComputedStyle(content).display === 'none') toggle.click();
    }
    refresh();

    return () => {
        observer.disconnect();
        toggle.removeAttribute('data-mt-world-activation');
        caption.textContent = original;
    };
}

function mountRotator(field, onStep) {
    const doc = field.ownerDocument;
    const win = doc.defaultView;
    const isSelect = field instanceof win.HTMLSelectElement;
    const label = isSelect ? field.previousElementSibling : field.closest('label');
    if (!label || (isSelect && (field.multiple || field.classList.contains('select2-hidden-accessible')))) return;

    const caption = label.textContent.trim();
    const chinese = doc.documentElement.lang.toLowerCase().startsWith('zh');
    const group = doc.createElement('span');
    group.className = 'mt-rotator';
    group.dataset.mtRotateFor = field.id;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', caption);
    const buttons = [-1, 1].map(direction => {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'mt-rotator-arrow';
        button.textContent = direction < 0 ? '←' : '→';
        const verb = chinese ? (direction < 0 ? '上一个' : '下一个') : (direction < 0 ? 'Previous' : 'Next');
        button.setAttribute('aria-label', `${verb} · ${caption}`);
        button.setAttribute('aria-controls', field.id);
        return button;
    });

    const value = isSelect ? field : doc.createElement('span');
    if (!isSelect) {
        value.className = 'mt-rotator-value';
        value.setAttribute('aria-live', 'polite');
    }

    let row = field.parentElement;
    if (isSelect) {
        field.before(group);
        row.dataset.mtRotatorRow = '';
    } else {
        row = doc.createElement('div');
        row.className = 'mt-detail-toggle-row';
        label.before(row);
        row.append(label, group);
    }
    group.append(buttons[0], value, buttons[1]);

    function nextIndex(direction) {
        if (field.matches(':disabled')) return -1;
        if (!isSelect) return direction < 0 ? (field.checked ? 0 : -1) : (field.checked ? -1 : 1);
        const options = field.options;
        for (let i = field.selectedIndex + direction; i >= 0 && i < options.length; i += direction) {
            const option = options[i];
            if (!option.hidden && !option.matches(':disabled')) return i;
        }
        return -1;
    }

    function refresh() {
        buttons[0].setAttribute('aria-disabled', String(nextIndex(-1) < 0));
        buttons[1].setAttribute('aria-disabled', String(nextIndex(1) < 0));
        if (!isSelect) value.textContent = field.checked ? (chinese ? '开' : 'On') : (chinese ? '关' : 'Off');
    }

    function step(direction) {
        const next = nextIndex(direction);
        if (next < 0) return;
        if (isSelect) {
            field.selectedIndex = next;
            field.dispatchEvent(new win.Event('input', { bubbles: true }));
            field.dispatchEvent(new win.Event('change', { bubbles: true }));
        } else {
            field.click();
        }
        refresh();
        onStep?.(direction < 0 ? 'adjust-left' : 'adjust-right');
    }

    const lifetime = new win.AbortController();
    const options = { signal: lifetime.signal };
    for (const name of ['input', 'change']) field.addEventListener(name, refresh, options);
    group.addEventListener('focusin', refresh, options);
    group.addEventListener('pointerenter', refresh, options);
    group.addEventListener('keydown', event => {
        if (!buttons.includes(event.target)) return;
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        event.stopPropagation();
        step(event.key === 'ArrowLeft' ? -1 : 1);
    }, options);
    buttons[0].addEventListener('click', () => step(-1), options);
    buttons[1].addEventListener('click', () => step(1), options);
    const observer = new win.MutationObserver(refresh);
    observer.observe(field, { attributes: true, attributeFilter: ['disabled', 'hidden'], subtree: isSelect, childList: isSelect });
    refresh();

    return () => {
        lifetime.abort();
        observer.disconnect();
        if (isSelect) {
            if (field.parentNode === group) group.before(field);
            row.removeAttribute('data-mt-rotator-row');
            group.remove();
        } else {
            if (label.parentNode === row) row.before(label);
            row.remove();
        }
    };
}

export function mountPanelDetails({ node, label }, onStep) {
    const useGeneratedHeading = node.id === 'left-nav-panel' || node.id === 'right-nav-panel';
    let heading = useGeneratedHeading ? null : node.querySelector('h3');
    const generated = !heading;
    if (generated) {
        heading = node.ownerDocument.createElement('h2');
        heading.textContent = label;
        node.prepend(heading);
    }
    heading.dataset.mtDetailHeading = '';

    const selector = selectSelectors[node.id];
    const fields = selector ? [...node.querySelectorAll(selector)] : [];
    if (node.id === 'WorldInfo') fields.push(...node.querySelectorAll('#wiCheckboxes input[type="checkbox"]'));
    const dispose = fields.map(field => mountRotator(field, onStep));
    if (node.id === 'WorldInfo') dispose.push(mountWorldActivation(node));

    return () => {
        for (const restore of dispose) restore?.();
        if (generated) heading.remove();
        else heading.removeAttribute('data-mt-detail-heading');
    };
}
