import { isGenerating, setActiveCharacter } from '/script.js';
import { appearanceFields, audioFields, behaviorFields } from './mixtape-options.js';

function caption(node) {
    return node?.textContent.replace(/\s+/g, ' ').trim() || '';
}

function shown(node, source) {
    for (let element = node; element && element !== source; element = element.parentElement) {
        if (element.hidden || element.ownerDocument.defaultView.getComputedStyle(element).display === 'none') return false;
    }
    return !!node;
}

function availableItems(container, selector) {
    if (!container) return [];
    return [...container.querySelectorAll(selector)].filter(node => !node.hidden && node.style.display !== 'none' && !node.classList.contains('displayNone'));
}

function renderList(ui, parent, readItems, emptyText, includePortraits = false) {
    const doc = parent.ownerDocument;
    const list = doc.createElement('div');
    list.className = 'mt-disc-catalog-list';
    const empty = doc.createElement('p');
    empty.className = 'mt-disc-catalog-empty';
    empty.textContent = emptyText;
    parent.append(list, empty);
    const rows = new Map();

    ui.watch(() => {
        const items = readItems();
        ui.setAttribute(empty, 'hidden', items.length ? '' : null);
        const keys = new Set(items.map(item => item.key));
        for (const [key, row] of rows) {
            if (keys.has(key)) continue;
            row.button.remove();
            rows.delete(key);
        }

        const focused = list.contains(doc.activeElement) ? doc.activeElement : null;
        let position = list.firstElementChild;
        for (const item of items) {
            let row = rows.get(item.key);
            if (!row) {
                const button = doc.createElement('button');
                button.type = 'button';
                button.className = 'mt-disc-catalog-item';
                const name = doc.createElement('span');
                name.className = 'mt-disc-catalog-name';
                const value = doc.createElement('span');
                value.className = 'mt-disc-catalog-value';
                let portrait;
                if (includePortraits) {
                    portrait = doc.createElement('img');
                    portrait.className = 'mt-character-card-portrait';
                    portrait.alt = '';
                    portrait.loading = 'lazy';
                    portrait.decoding = 'async';
                    button.append(portrait);
                }
                button.append(name, value);
                row = { button, name, value, portrait, item };
                button.addEventListener('click', () => {
                    if (!row.item.node.isConnected) return;
                    if (row.item.activate) row.item.activate(row.item.node);
                    else row.item.node.click();
                    ui.requestRefresh();
                });
                rows.set(item.key, row);
            }
            row.item = item;
            if (row.portrait) {
                row.button.classList.toggle('mt-character-card-with-avatar', !!item.avatar);
                ui.setAttribute(row.portrait, 'src', item.avatar || null);
                ui.setAttribute(row.portrait, 'hidden', item.avatar ? null : '');
            }
            if (row.name.textContent !== item.name) row.name.textContent = item.name;
            if (row.value.textContent !== item.value) row.value.textContent = item.value;
            ui.setAttribute(row.button, 'aria-current', item.selected ? 'true' : null);
            if (row.button === position) position = position.nextElementSibling;
            else list.insertBefore(row.button, position);
        }
        if (focused && list.contains(focused) && doc.activeElement !== focused) focused.focus({ preventScroll: true });
    }, parent);
}

function addPagination(ui, parent, selector) {
    const button = direction => () => ui.source.querySelector(`${selector} .paginationjs-${direction}:not(.disabled) a`);
    ui.action(parent, '上一页', button('prev'));
    ui.action(parent, '下一页', button('next'));
}

function renderBackgrounds(ui) {
    const { source } = ui;
    const filters = ui.section('背景选择');
    ui.field(filters, '搜索', '#bg-filter', { event: 'input' });
    ui.field(filters, '排序', '#bg-sort', { event: 'change' });
    ui.field(filters, '画面适配', '#background_fitting', { event: 'input' });
    const tab = suffix => `#bg_tabs a[href="#bg_${suffix}_tab"]`;
    ui.action(filters, '全局背景', tab('global'));
    ui.action(filters, '聊天背景', tab('chat'));
    ui.action(filters, '返回文件夹列表', '#bg_back_to_folders');

    const library = ui.section('可用背景');
    renderList(ui, library, () => {
        const isChat = source.querySelector('#bg_tabs .ui-tabs-active a')?.hash === '#bg_chat_tab';
        const folders = source.querySelector('#bg_folder_grid');
        const images = source.querySelector(isChat ? '#bg_custom_content' : '#bg_menu_content');
        const catalog = [];
        if (!isChat && shown(folders, source)) {
            for (const node of availableItems(folders, '.bg_folder_tile[data-folder-id]')) {
                const key = node.dataset.folderId;
                const name = caption(node.querySelector('.bg_folder_tile_name'));
                if (key && name) catalog.push({ key: `folder:${key}`, name, value: '打开', node });
            }
        }
        if (!shown(images, source)) return catalog;
        for (const node of availableItems(images, '.bg_example[bgfile]')) {
            const key = node.getAttribute('bgfile');
            const name = caption(node.querySelector('.BGSampleTitle')) || node.title || key;
            const selected = node.classList.contains('selected-background') || node.classList.contains('locked-background');
            catalog.push({ key: `background:${key}`, name, value: selected ? '正在使用' : '使用', node, selected });
        }
        return catalog;
    }, '没有找到背景');

    const manage = ui.section('管理');
    ui.action(manage, '添加背景', '#add_background_button_top');
    ui.action(manage, '创建文件夹', '#bg_add_folder_button');
    ui.action(manage, '自动选择背景', '#auto_background');
}

function renderExtensions(ui) {
    const manage = ui.section('扩展管理');
    ui.field(manage, '扩展更新通知', '#extensions_notify_updates');
    ui.action(manage, '管理已安装扩展', '#extensions_details');
    ui.action(manage, '安装扩展', '#third_party_extension_button');

    const theme = ui.section('夜间电台');
    const appearance = ui.section('界面显示');
    const audio = ui.section('音乐与音效');
    for (const [group, fields] of [[theme, behaviorFields], [appearance, appearanceFields], [audio, audioFields]]) {
        for (const [key, label] of fields) {
            ui.field(group, label, `[data-ns-theme-option="${key}"]`, { event: 'input', allowHidden: true });
        }
    }
    ui.field(audio, '当前曲目', '[data-ns-music-selection]', { event: 'change', allowHidden: true });
    ui.field(audio, '播放模式', '[data-ns-music-mode]', { event: 'change', allowHidden: true });
    ui.action(audio, '管理曲目', '#night-signal-music-library', {
        shown: () => Boolean(ui.source.querySelector('#night-signal-music-library')),
        run() {
            const settings = ui.source.querySelector('#night-signal-theme-options');
            if (!settings) return;
            ui.showNative();
            settings.open = true;
            settings.querySelector('#night-signal-music-library')?.scrollIntoView({ block: 'center' });
        },
    });

    const plugins = ui.section('扩展选项');
    renderList(ui, plugins, () => {
        const controls = ui.source.querySelectorAll('#extensions_settings .inline-drawer-toggle, #extensions_settings2 .inline-drawer-toggle');
        return [...controls].filter(node => {
            const content = node.closest('.inline-drawer-content');
            return !content && shown(node, ui.source);
        }).map(node => ({
            key: node,
            node,
            name: caption(node) || node.title || '扩展设置',
            value: '打开',
            activate(target) {
                ui.showNative();
                const content = target.parentElement?.querySelector(':scope > .inline-drawer-content');
                if (!content || !shown(content, ui.source)) target.click();
                target.scrollIntoView({ block: 'start' });
            },
        }));
    }, '没有可配置的扩展');
}

function renderPersonas(ui) {
    const filters = ui.section('浏览与筛选');
    ui.field(filters, '搜索', '#persona_search_bar', { event: 'input' });
    ui.field(filters, '排序', '#persona_sort_order', { event: 'input' });
    ui.action(filters, '创建用户设定', '#create_dummy_persona');
    ui.action(filters, '上传头像', '#user_avatar_block .avatar_upload');
    addPagination(ui, filters, '#persona_pagination_container');

    const list = ui.section('选择用户设定');
    renderList(ui, list, () => availableItems(ui.source.querySelector('#user_avatar_block'), '.avatar-container[data-avatar-id]').map(node => {
        const key = node.dataset.avatarId;
        const selected = node.classList.contains('selected');
        return { key, name: caption(node.querySelector('.ch_name')) || key, value: selected ? '当前' : '选择', node, selected };
    }), '没有找到用户设定');

    const description = ui.section('编辑当前用户设定');
    ui.action(description, '重命名', '#persona_rename_button');
    ui.action(description, '更换头像', '#persona_set_image_button');
    ui.field(description, '描述', '#persona_description', { event: 'input' });
    ui.field(description, '插入位置', '#persona_description_position', { event: 'input' });
    ui.field(description, '插入深度', '#persona_depth_value', { event: 'input' });
    ui.field(description, '消息角色', '#persona_depth_role', { event: 'input' });
    ui.action(description, '设为默认', '#lock_persona_default');
    ui.action(description, '绑定到当前角色', '#lock_persona_to_char');
    ui.action(description, '绑定到当前聊天', '#lock_user_name');

    const preferences = ui.section('管理');
    ui.field(preferences, '显示切换通知', '#persona_show_notifications');
    ui.field(preferences, '允许绑定多个用户设定', '#persona_allow_multi_connections');
    ui.field(preferences, '自动绑定到新聊天', '#persona_auto_lock');
    ui.action(preferences, '复制当前设定', '#persona_duplicate_button');
    ui.action(preferences, '备份用户设定', '#personas_backup');
    ui.action(preferences, '从备份导入', '#personas_restore');
}

function renderCharacters(ui) {
    const { source, root } = ui;
    const doc = root.ownerDocument;
    const article = root.closest('.mt-disc-page');
    const title = article.querySelector('.mt-disc-title');
    const drawerTitle = title.textContent;
    const pickerTitle = doc.documentElement.lang.toLowerCase().startsWith('zh') ? '角色卡' : 'Character cards';
    const artwork = doc.createElement('div');
    artwork.className = 'mt-character-disc';
    artwork.setAttribute('aria-hidden', 'true');
    const foil = doc.createElement('div');
    foil.className = 'mt-character-disc-foil';
    artwork.append(foil);
    article.prepend(artwork);
    const listPage = doc.createElement('div');
    const editPage = doc.createElement('div');
    const groupPage = doc.createElement('div');
    listPage.dataset.mtCharacterView = 'list';
    editPage.dataset.mtCharacterView = 'edit';
    groupPage.dataset.mtCharacterView = 'group';
    root.append(listPage, editPage, groupPage);
    const toolbar = doc.createElement('div');
    toolbar.className = 'mt-character-toolbar';
    listPage.append(toolbar);
    const search = ui.section('', toolbar);
    search.classList.add('mt-character-search');

    const tools = doc.createElement('details');
    tools.className = 'mt-character-tools';
    const summary = doc.createElement('summary');
    summary.textContent = '管理角色';
    tools.append(summary);
    toolbar.append(tools);
    const filters = ui.section('', tools);
    let openingChat = false;

    function updateView() {
        const edit = !openingChat && shown(source.querySelector('#rm_ch_create_block'), source);
        const groupOpen = !openingChat && !edit && shown(source.querySelector('#rm_group_chats_block'), source);
        const pause = !edit && !groupOpen && source.dataset.mtDiscMode === 'disc';
        ui.setAttribute(listPage, 'hidden', edit || groupOpen ? '' : null);
        ui.setAttribute(editPage, 'hidden', edit ? null : '');
        ui.setAttribute(groupPage, 'hidden', groupOpen ? null : '');
        ui.setAttribute(artwork, 'hidden', pause ? null : '');
        ui.setAttribute(source, 'data-mt-character-pause', pause ? '' : null);
        const headline = pause ? pickerTitle : drawerTitle;
        if (title.textContent !== headline) title.textContent = headline;
        if (!pause && tools.open) tools.open = false;
    }
    const mode = new doc.defaultView.MutationObserver(updateView);
    mode.observe(source, { attributes: true, attributeFilter: ['data-mt-disc-mode'] });

    // Register view synchronization before the view-scoped fields, so the same refresh
    // updates a newly opened editor as soon as the native drawer changes its contents.
    updateView();
    ui.watch(updateView);
    ui.field(search, '搜索角色', '#character_search_bar', { event: 'input', allowHidden: true });
    ui.field(filters, '排序', '#character_sort_order', { event: 'change' });
    ui.action(filters, '创建角色', '#rm_button_create', { value: '创建' });
    ui.action(filters, '从文件导入', '#character_import_button', { value: '导入' });
    ui.action(filters, '从链接导入', '#external_import_button', { value: '导入' });
    ui.action(filters, '创建群聊', '#rm_button_group_chats', { value: '创建' });
    const list = doc.createElement('div');
    list.className = 'mt-character-results';
    const status = doc.createElement('p');
    status.className = 'mt-disc-catalog-empty';
    status.setAttribute('role', 'status');
    status.hidden = true;
    listPage.append(status, list);

    function report(message) {
        status.textContent = message;
        status.hidden = !message;
    }

    async function openCharacter(node) {
        if (openingChat) return;
        if (isGenerating()) {
            report('请等当前回复生成完毕后再切换聊天。');
            return;
        }
        const key = node.dataset.chid;
        const id = Number(key);
        const getContext = () => doc.defaultView.SillyTavern.getContext();
        const context = getContext();
        const avatar = key && context.characters[id]?.avatar;
        if (!avatar) {
            report('找不到这张角色卡。');
            return;
        }

        openingChat = true;
        report('');
        try {
            if (context.groupId || String(context.characterId) !== key || !context.getCurrentChatId()) {
                await context.selectCharacterById(id, { switchMenu: false });
            }
            const current = getContext();
            if (current.groupId || current.characters[current.characterId]?.avatar !== avatar || !current.getCurrentChatId()) {
                report('暂时无法打开这张角色卡的聊天。');
                return;
            }
            setActiveCharacter(avatar);
            current.saveSettingsDebounced();
            if (root.isConnected) ui.onChatOpened?.();
        } catch (error) {
            console.warn('[Night Signal] Unable to open character chat', error);
            report('暂时无法打开这张角色卡的聊天。');
        } finally {
            openingChat = false;
            if (root.isConnected) ui.requestRefresh();
        }
    }

    renderList(ui, list, () => availableItems(source.querySelector('#rm_print_characters_block'), '.character_select, .group_select, .bogus_folder_select').map(node => {
        const isCharacter = node.matches('.character_select');
        const kind = isCharacter ? '角色卡' : node.matches('.group_select') ? '群聊' : '文件夹';
        const avatar = node.querySelector('img');
        const key = node.getAttribute('data-chid') ?? node.getAttribute('grid') ?? node.getAttribute('tagid');
        const name = caption(node.querySelector('.ch_name, .group_name, .bogus_folder_name')) || avatar?.alt || '未命名';
        return { key: key === null ? node : `${kind}:${key}`, name, value: kind, avatar: avatar?.getAttribute('src'), node, activate: isCharacter ? openCharacter : undefined };
    }), '没有找到角色或群聊', true);

    const pages = ui.section('', listPage);
    pages.classList.add('mt-character-pages');
    for (const [direction, name] of [['prev', '上一页'], ['next', '下一页']]) {
        ui.action(pages, name, () => source.querySelector(`#rm_print_characters_pagination .paginationjs-${direction}:not(.disabled) a`), { value: name });
    }

    const editor = ui.section('角色详情', editPage);
    ui.action(editor, '返回角色列表', '#rm_button_characters');
    ui.field(editor, '角色名称', '#character_name_pole', { event: 'both' });
    ui.field(editor, '角色描述', '#description_textarea', { event: 'input' });
    ui.field(editor, '开场白', '#firstmessage_textarea', { event: 'input' });
    ui.action(editor, '更换头像', '#avatar_div_div');
    ui.action(editor, '保存角色', '#create_button_label');

    const group = ui.section('群聊详情', groupPage);
    ui.action(group, '返回角色列表', '#rm_button_characters');
    ui.action(group, '展开群聊选项', '#groupControlsToggle');
    ui.field(group, '群聊名称', '#rm_group_chat_name', { event: 'input' });
    ui.field(group, '回复顺序', '#rm_group_activation_strategy');
    ui.field(group, '角色卡处理', '#rm_group_generation_mode');
    ui.field(group, '前缀', '#rm_group_generation_mode_join_prefix', { event: 'input' });
    ui.field(group, '后缀', '#rm_group_generation_mode_join_suffix', { event: 'input' });
    ui.action(group, '创建群聊', '#rm_group_submit');

    const groupMembers = (selector, action) => () => {
        return availableItems(source.querySelector(selector), '.group_member').flatMap(member => {
            const node = member.querySelector(`[data-action="${action}"]`);
            const name = caption(member.querySelector('.ch_name'));
            if (!node || !name || node.style.display === 'none') return [];
            return [{ key: member.dataset.chid ?? member, name, value: action === 'add' ? '添加' : '移除', node }];
        });
    };
    const members = ui.section('当前成员', groupPage);
    ui.field(members, '筛选成员', '#rm_group_members_filter', { event: 'input', allowHidden: true });
    addPagination(ui, members, '#rm_group_members_pagination');
    renderList(ui, members, groupMembers('#rm_group_members', 'remove'), '没有成员');
    const candidates = ui.section('添加成员', groupPage);
    ui.field(candidates, '搜索可添加角色', '#rm_group_filter', { event: 'input', allowHidden: true });
    addPagination(ui, candidates, '#rm_group_add_members_pagination');
    renderList(ui, candidates, groupMembers('#rm_group_add_members', 'add'), '没有可添加的角色');

    return () => {
        mode.disconnect();
        source.removeAttribute('data-mt-character-pause');
    };
}

export function renderCatalogPage(ui) {
    switch (ui.source.id) {
        case 'Backgrounds': renderBackgrounds(ui); break;
        case 'rm_extensions_block': renderExtensions(ui); break;
        case 'PersonaManagement': renderPersonas(ui); break;
        case 'right-nav-panel': return renderCharacters(ui);
    }
}
