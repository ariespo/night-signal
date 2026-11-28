const activationFields = [
    ['扫描深度', '#world_info_depth'],
    ['上下文百分比', '#world_info_budget', value => `${value}%`],
    ['Token 预算上限', '#world_info_budget_cap'],
    ['最少激活数', '#world_info_min_activations'],
    ['最大扫描深度', '#world_info_min_activations_depth_max'],
    ['最大递归次数', '#world_info_max_recursion_steps'],
];

const matchFields = [
    ['包括发言者名字', '#world_info_include_names'],
    ['递归扫描', '#world_info_recursive'],
    ['区分大小写', '#world_info_case_sensitive'],
    ['匹配整个单词', '#world_info_match_whole_words'],
    ['使用分组评分', '#world_info_use_group_scoring'],
    ['预算溢出提醒', '#world_info_overflow_alert'],
];

function fillRows(ui, parent, fields, find, options = {}) {
    for (const [label, selector, format] of fields) {
        ui.field(parent, label, () => find(selector), { ...options, format });
    }
}

function emitChange(field) {
    const win = field.ownerDocument.defaultView;
    field.dispatchEvent(new win.Event('change', { bubbles: true }));
}

function addListButton(parent, name, caption, run) {
    const doc = parent.ownerDocument;
    const row = doc.createElement('div');
    const label = doc.createElement('span');
    const control = doc.createElement('div');
    const button = doc.createElement('button');
    row.className = 'mt-disc-row';
    row.dataset.mtDiscRow = 'action';
    label.className = 'mt-disc-label';
    control.className = 'mt-disc-control';
    button.type = 'button';
    button.className = 'mt-disc-action';
    label.textContent = name;
    button.textContent = caption;
    button.setAttribute('aria-label', `${caption} · ${name}`);
    button.addEventListener('click', run);
    control.append(button);
    row.append(label, control);
    parent.append(row);
    return { row, label, button };
}

function projectMultiple(ui, parent, accessor, emptyCaption) {
    let previousField;
    let previousOptions = [];
    let rows = [];
    const list = parent.ownerDocument.createElement('div');
    const empty = parent.ownerDocument.createElement('p');
    empty.className = 'mt-disc-subtitle';
    empty.textContent = emptyCaption;
    list.append(empty);
    parent.append(list);

    ui.watch(() => {
        const select = accessor();
        const options = Array.from(select?.options ?? []).filter(option => option.value && !option.hidden);
        if (select !== previousField || options.length !== previousOptions.length
            || options.some((option, index) => option !== previousOptions[index])) {
            previousField = select;
            previousOptions = options;
            list.replaceChildren(empty);
            rows = options.map(option => addListButton(list, option.label, '开启', () => {
                if (select !== accessor() || option.disabled || select.disabled) return;
                option.selected = !option.selected;
                emitChange(select);
            }));
        }

        ui.setAttribute(empty, 'hidden', options.length ? '' : null);
        for (const [index, option] of options.entries()) {
            const { label, button } = rows[index];
            if (label.textContent !== option.label) label.textContent = option.label;
            const caption = option.selected ? '开启' : '关闭';
            if (button.textContent !== caption) button.textContent = caption;
            ui.setAttribute(button, 'aria-label', `${option.label} · ${caption}`);
            ui.setAttribute(button, 'aria-pressed', String(option.selected));
            ui.setAttribute(button, 'disabled', option.disabled || select.disabled ? '' : null);
        }
    }, parent);
}

function addKeywords(ui, parent, label, name, findEntryField) {
    const doc = parent.ownerDocument;
    const row = doc.createElement('label');
    const caption = doc.createElement('span');
    const control = doc.createElement('div');
    const input = doc.createElement('textarea');
    row.className = 'mt-disc-row';
    row.dataset.mtDiscRow = 'text';
    caption.className = 'mt-disc-label';
    control.className = 'mt-disc-control';
    input.className = 'mt-disc-editor';
    caption.textContent = label;
    input.rows = 1;
    input.placeholder = '以逗号分隔';
    control.append(input);
    row.append(caption, control);
    parent.append(row);

    const accessor = () => findEntryField(`[name="${name}"][data-macros]`);
    let boundField = null;
    let pendingField = null;
    let revision = 0;
    ui.watch(() => {
        const field = accessor();
        ui.setAttribute(row, 'hidden', field ? null : '');
        if (!field || field === pendingField || (field === boundField && doc.activeElement === input)) return;
        boundField = field;
        const value = field.tagName === 'SELECT' ? Array.from(field.selectedOptions, option => option.text).join(', ') : field.value;
        if (input.value !== value) input.value = value;
    }, parent);

    input.addEventListener('input', () => input.setCustomValidity(''));
    input.addEventListener('blur', ui.requestRefresh);
    input.addEventListener('change', async () => {
        const field = accessor();
        if (!field) return;
        const value = input.value;
        if (field.tagName !== 'SELECT') {
            field.value = value;
            emitChange(field);
            return;
        }
        const currentRevision = ++revision;
        pendingField = field;

        try {
            const location = doc.defaultView.location.href;
            const worldInfoUrl = new URL('/scripts/world-info.js', location);
            const utilsUrl = new URL('/scripts/utils.js', location);
            const [{ splitKeywordsAndRegexes }, { getSelect2OptionId }] = await Promise.all([
                import(/* webpackIgnore: true */ worldInfoUrl.href),
                import(/* webpackIgnore: true */ utilsUrl.href),
            ]);
            if (!field.isConnected || currentRevision !== revision) return;
            const terms = [...new Set(splitKeywordsAndRegexes(value))];
            const items = new Map(Array.from(field.options, option => [option.value, option]));
            for (const option of field.options) option.selected = false;
            for (const term of terms) {
                const id = getSelect2OptionId(term);
                const existing = items.get(id);
                if (existing) {
                    field.append(existing);
                    existing.selected = true;
                }
                else field.add(new doc.defaultView.Option(term, id, false, true));
            }
            emitChange(field);
        } catch (error) {
            console.warn('[Night Signal] Could not update world entry keywords', error);
            input.setCustomValidity('关键词暂未保存，请重新编辑后重试。');
            input.reportValidity();
        } finally {
            if (currentRevision === revision) {
                pendingField = null;
                ui.requestRefresh();
            }
        }
    });
}

export function renderWorldPage(ui) {
    const doc = ui.root.ownerDocument;
    const win = doc.defaultView;
    const find = selector => ui.source.querySelector(selector);
    let viewName = 'overview';
    const views = Object.fromEntries(['overview', 'active', 'entries', 'entry', 'filters'].map(name => {
        const view = doc.createElement('div');
        view.dataset.mtWorldView = name;
        view.hidden = name !== viewName;
        ui.root.append(view);
        return [name, view];
    }));

    let openedEntry = null;
    let openedBook = '';
    let openedNativeEntry = null;
    let entryCreation = null;
    let bookSelect;
    let missingTimer;
    const isEntryView = () => viewName === 'entry' || viewName === 'filters';
    const currentBook = () => {
        if (!bookSelect || !ui.source.contains(bookSelect)) bookSelect = find('#world_editor_select');
        return bookSelect?.selectedOptions[0];
    };
    const entryList = () => Array.from(ui.source.querySelectorAll('#world_popup_entries_list .world_entry[uid]'));
    const findEntry = () => {
        if (openedEntry === null || currentBook()?.text !== openedBook) return null;
        if (openedNativeEntry?.getAttribute('uid') === openedEntry && ui.source.contains(openedNativeEntry)
            && openedNativeEntry.closest('#world_popup_entries_list')) return openedNativeEntry;
        return find(`#world_popup_entries_list .world_entry[uid="${win.CSS.escape(openedEntry)}"]`);
    };
    const findEntryField = selector => findEntry()?.querySelector(selector) ?? null;

    function show(name) {
        if (name !== 'entries') entryCreation = null;
        viewName = name;
        for (const [key, view] of Object.entries(views)) ui.setAttribute(view, 'hidden', key === name ? null : '');
        ui.root.scrollTop = 0;
        ui.refresh();
    }

    function openBackingEntry(entry) {
        openedNativeEntry = entry;
        const toggle = entry.querySelector('.inline-drawer-header .inline-drawer-toggle');
        if (toggle?.classList.contains('down')) toggle.click();
    }

    function enterEntry(entry) {
        openedEntry = entry.getAttribute('uid');
        openedBook = currentBook()?.text;
        openBackingEntry(entry);
        show('entry');
    }

    const jump = (parent, label, name) => ui.action(parent, label, () => ui.source, {
        run: () => show(name),
        ...(label.startsWith('返回') ? { value: '返回', cue: 'back' } : {}),
    });
    const bookAction = (parent, label, target, options) => ui.action(parent, label, target, {
        shown: () => Boolean(currentBook()?.value),
        ...options,
    });

    const books = ui.section('书库', views.overview);
    ui.field(books, '编辑中的世界书', '#world_editor_select', { event: 'change', force: true });
    jump(books, '全局启用的世界书', 'active');
    bookAction(books, '浏览条目', '#world_info_search', { run: () => show('entries'), value: '查看' });
    ui.action(books, '新建世界书', '#world_create_button', { value: '创建' });
    ui.action(books, '导入世界书', '#world_import_button', { value: '导入' });

    const activation = ui.section('激活参数', views.overview);
    fillRows(ui, activation, activationFields, find, { event: 'input', force: true });
    ui.field(activation, '插入顺序', '#world_info_character_strategy', { event: 'change', force: true });
    const rules = ui.section('匹配规则', views.overview);
    fillRows(ui, rules, matchFields, find, { force: true });

    const active = ui.section('全局启用的世界书', views.active);
    jump(active, '返回世界书', 'overview');
    const bookSwitches = doc.createElement('div');
    active.append(bookSwitches);
    projectMultiple(ui, bookSwitches, () => find('#world_info'), '暂无可启用的世界书。');

    const entries = ui.section('世界书条目', views.entries);
    jump(entries, '返回世界书', 'overview');
    ui.field(entries, '当前世界书', '#world_editor_select', { event: 'change', force: true });
    ui.field(entries, '搜索条目', '#world_info_search', { event: 'input' });
    ui.field(entries, '条目排序', '#world_info_sort_order', { event: 'change' });

    bookAction(entries, '新建条目', '#world_popup_new', {
        run() {
            entryCreation = {
                book: currentBook()?.text,
                existing: new Set(entryList().map(entry => entry.getAttribute('uid'))),
            };
            find('#world_popup_new')?.click();
        },
    });
    const list = doc.createElement('div');
    list.dataset.mtWorldEntries = '';
    entries.append(list);

    let previousEntries = [];
    let entryRows = [];
    const emptyEntries = doc.createElement('p');
    emptyEntries.className = 'mt-disc-subtitle';
    emptyEntries.textContent = '当前没有条目。';

    function renderEntries() {
        const selected = currentBook()?.value ? entryList() : [];
        if (entryCreation && currentBook()?.text !== entryCreation.book) entryCreation = null;
        if (entryCreation && selected.length) {
            const added = selected.filter(entry => !entryCreation.existing.has(entry.getAttribute('uid')));
            if (added.length === 1) {
                entryCreation = null;
                enterEntry(added[0]);
                return;
            }
        }
        if (selected.length !== previousEntries.length || selected.some((entry, index) => entry !== previousEntries[index])) {
            previousEntries = selected;
            list.replaceChildren();
            entryRows = selected.map(entry => addListButton(list, '', '编辑', () => enterEntry(entry)));
        }
        if (!selected.length && emptyEntries.parentElement !== list) list.append(emptyEntries);
        for (const [index, entry] of selected.entries()) {
            const title = entry.querySelector('[name="comment"]');
            const label = title?.value.trim() || title?.placeholder || '无标题条目';
            const { label: caption, button } = entryRows[index];
            if (caption.textContent !== label) caption.textContent = label;
            ui.setAttribute(button, 'aria-label', `编辑 · ${label}`);
        }
    }
    ui.watch(renderEntries, entries);

    const pageDirection = direction => {
        const control = find(`#world_info_pagination .paginationjs-${direction} a`);
        return control?.closest('li')?.classList.contains('disabled') ? null : control;
    };
    ui.action(entries, '上一页', () => pageDirection('prev'));
    ui.action(entries, '下一页', () => pageDirection('next'));
    bookAction(entries, '导出', '#world_popup_export');
    bookAction(entries, '重命名', '#world_popup_name_button');
    bookAction(entries, '复制世界书', '#world_duplicate');
    bookAction(entries, '删除世界书', '#world_popup_delete');

    const entry = ui.section('编辑条目', views.entry);
    jump(entry, '返回条目列表', 'entries');
    ui.field(entry, '标题', () => findEntryField('[name="comment"]'), { event: 'input', mode: 'text' });
    const triggerLabels = { constant: '永久', normal: '关键词', vectorized: '向量化' };
    fillRows(ui, entry, [
        ['触发方式', '[name="entryStateSelector"]', (text, node) => triggerLabels[node.value] ?? text],
        ['插入位置', '[name="position"]'],
        ['插入深度', '[name="depth"]'],
        ['顺序', '[name="order"]'],
        ['概率', '[name="probability"]'],
    ], findEntryField, { event: 'input' });
    const enabled = addListButton(entry, '条目状态', '开启', () => {
        findEntryField('.killSwitch')?.click();
        ui.requestRefresh();
    });
    ui.watch(() => {
        const control = findEntryField('.killSwitch');
        ui.setAttribute(enabled.row, 'hidden', control ? null : '');
        if (!control) return;
        const on = control.classList.contains('fa-toggle-on');
        const text = on ? '开启' : '关闭';
        if (enabled.button.textContent !== text) enabled.button.textContent = text;
        ui.setAttribute(enabled.button, 'aria-label', on ? '条目已开启' : '条目已关闭');
        ui.setAttribute(enabled.button, 'aria-pressed', String(on));
    }, entry);

    const trigger = ui.section('关键词', views.entry);
    addKeywords(ui, trigger, '主要关键词', 'key', findEntryField);
    ui.field(trigger, '筛选逻辑', () => findEntryField('[name="entryLogicType"]'), { event: 'input' });
    addKeywords(ui, trigger, '次要关键词', 'keysecondary', findEntryField);

    const content = ui.section('内容', views.entry);
    ui.field(content, '正文', () => findEntryField('[name="content"]'), { event: 'input', mode: 'textarea' });
    jump(content, '匹配与筛选选项', 'filters');
    ui.action(content, '复制条目', () => findEntryField('.duplicate_entry_button'), { after: () => show('entries') });
    ui.action(content, '删除条目', () => findEntryField('.delete_entry_button'));
    ui.action(content, '移动或复制到其他世界书', () => findEntryField('.move_entry_button'));

    const filters = ui.section('匹配与筛选选项', views.filters);
    jump(filters, '返回条目', 'entry');
    fillRows(ui, filters, [
        ['扫描深度覆盖', '[name="scanDepth"]'],
        ['区分大小写', '[name="caseSensitive"]'],
        ['匹配整个单词', '[name="matchWholeWords"]'],
        ['分组评分', '[name="useGroupScoring"]'],
        ['自动化 ID', '[name="automationId"]'],
        ['输出口名称', '[name="outletName"]'],
        ['不可被递归激活', '[name="excludeRecursion"]'],
        ['禁止触发下一层递归', '[name="preventRecursion"]'],
        ['延后到递归扫描', '[name="delay_until_recursion"]'],
        ['递归级别', '[name="delayUntilRecursionLevel"]'],
        ['忽略预算', '[name="ignoreBudget"]'],
        ['归属分组', '[name="group"]'],
        ['同组优先', '[name="groupOverride"]'],
        ['分组权重', '[name="groupWeight"]'],
        ['保持生效消息数', '[name="sticky"]'],
        ['冷却消息数', '[name="cooldown"]'],
        ['延迟消息数', '[name="delay"]'],
        ['排除指定角色', '[name="character_exclusion"]'],
        ['匹配角色描述', '[name="matchCharacterDescription"]'],
        ['匹配角色性格', '[name="matchCharacterPersonality"]'],
        ['匹配场景', '[name="matchScenario"]'],
        ['匹配用户设定', '[name="matchPersonaDescription"]'],
        ['匹配角色备注', '[name="matchCharacterNote"]'],
        ['匹配作者注释', '[name="matchCreatorNotes"]'],
    ], findEntryField, { event: 'input', force: true });

    const characters = ui.section('角色与标签', views.filters);
    projectMultiple(ui, characters, () => findEntryField('[name="characterFilter"]'), '暂无角色与标签。');
    const generation = ui.section('生成触发类型', views.filters);
    projectMultiple(ui, generation, () => findEntryField('[name="triggers"]'), '暂无筛选项。');

    ui.watch(() => {
        if (!isEntryView()) return;
        const current = findEntry();
        if (current) {
            win.clearTimeout(missingTimer);
            missingTimer = undefined;
            if (current !== openedNativeEntry) openBackingEntry(current);
            return;
        }
        missingTimer ??= win.setTimeout(() => {
            missingTimer = undefined;
            if (ui.source.dataset.mtDiscMode !== 'disc' || !isEntryView() || findEntry()) return;
            openedEntry = null;
            show('entries');
        }, 400);
    });
    return () => win.clearTimeout(missingTimer);
}
