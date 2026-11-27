import { musicModes } from './mixtape-music.js';

export const titleThemes = Object.freeze({
    amber: '烟茶色透明 MD',
    blue: '深蓝 MD 录音机',
});

export const appearanceFields = [
    ['hideTopNav', '隐藏顶部原生导航', 'top-nav'],
    ['hideReasoning', '隐藏思维链', 'reasoning'],
    ['hideActions', '隐藏消息操作', 'actions'],
    ['hideNames', '隐藏发言名字', 'names'],
    ['hideAvatars', '隐藏头像', 'avatars'],
    ['hideTimestamps', '隐藏日期与时间', 'timestamps'],
    ['hideComposerTools', '隐藏输入栏工具按钮', 'composer-tools'],
];

export const behaviorFields = [
    ['enabled', '启用夜间电台'],
    ['showOnStartup', '启动时打开标题菜单'],
    ['titleTheme', '标题主题'],
    ['gamepad', '手柄切换设置板块'],
];

export const audioFields = [
    ['volume', '主题总音量'], ['musicVolume', '音乐音量'], ['ambienceVolume', '环境声'],
    ['effectsVolume', '过场音效'], ['cueVolume', '操作音效'],
];

export function mountThemeOptions(document, preferences, change) {
    const outlet = document.querySelector('#extensions_settings2, #extensions_settings');
    if (!outlet) return null;

    const element = document.createElement('details');
    element.id = 'night-signal-theme-options';
    element.className = 'mt-theme-options';
    element.innerHTML = `
        <summary>夜间电台 · 主题选项</summary>
        <div class="mt-theme-options-content"></div>`;
    const content = element.lastElementChild;
    for (const [legend, fields] of [
        ['启动与控制', behaviorFields], ['界面显示', appearanceFields], ['音量', audioFields],
    ]) {
        const group = document.createElement('fieldset');
        const heading = document.createElement('legend');
        heading.textContent = legend;
        group.append(heading);
        for (const [key, label] of fields) {
            const row = document.createElement('label');
            row.textContent = label;
            const choices = key === 'titleTheme' ? titleThemes : null;
            const input = document.createElement(choices ? 'select' : 'input');
            input.dataset.nsThemeOption = key;
            if (choices) {
                for (const [value, label] of Object.entries(choices)) {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = label;
                    input.append(option);
                }
                input.value = preferences[key];
            } else if (typeof preferences[key] === 'boolean') {
                input.type = 'checkbox';
                input.checked = preferences[key];
            } else {
                input.type = 'range';
                input.min = '0';
                input.max = '100';
                input.value = String(preferences[key]);
            }
            input.addEventListener(choices ? 'change' : 'input', () => {
                if (choices) preferences[key] = input.value;
                else preferences[key] = input.type === 'checkbox' ? input.checked : input.valueAsNumber;
                change(key);
            });
            row.append(input);
            group.append(row);
        }
        content.append(group);
    }

    const music = document.createElement('fieldset');
    music.id = 'night-signal-music-library';
    music.innerHTML = `
        <legend>曲目</legend>
        <label>当前曲目 <select data-ns-music-selection></select></label>
        <label>播放模式 <select data-ns-music-mode>
            ${Object.entries(musicModes).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
        </select></label>
        <label class="mt-theme-import">导入本地音乐
            <input type="file" aria-label="导入本地音乐" multiple accept="audio/*,.mp3,.wav,.ogg,.opus,.m4a,.aac,.flac,.webm">
        </label>
        <button type="button">移除当前曲目</button>
        <small>导入的文件保存在当前浏览器。</small>
        <p role="status"></p>`;
    content.append(music);
    const selection = music.querySelector('[data-ns-music-selection]');
    const playbackMode = music.querySelector('[data-ns-music-mode]');
    const files = music.querySelector('input');
    const remove = music.querySelector('button');
    const status = music.querySelector('[role="status"]');
    let audio;
    let unsubscribe;

    function update(state) {
        const { tracks, selectedId, mode } = state;
        if (selection.options.length !== tracks.length || tracks.some((track, index) => {
            const option = selection.options[index];
            return option.value !== track.id || option.text !== track.title;
        })) {
            selection.replaceChildren(...tracks.map(track => {
                const option = document.createElement('option');
                option.value = track.id;
                option.textContent = track.title;
                return option;
            }));
        }
        selection.value = selectedId;
        playbackMode.value = mode;
        remove.disabled = !tracks.some(track => track.id === selectedId && !track.builtin);
    }

    selection.addEventListener('change', () => audio?.selectTrack(selection.value));
    playbackMode.addEventListener('change', () => audio?.setMusicMode(playbackMode.value));
    files.addEventListener('change', async () => {
        if (!audio || !files.files.length) return;
        const player = audio;
        files.disabled = true;
        try {
            const count = await player.addTracks(files.files);
            if (player === audio) status.textContent = count ? `已导入 ${count} 首曲目` : '没有可以导入的音频。';
        } catch {
            if (player === audio) status.textContent = '保存失败。请检查浏览器可用空间。';
        } finally {
            files.value = '';
            files.disabled = false;
        }
    });
    remove.addEventListener('click', async () => {
        const player = audio;
        if (!player) return;
        remove.disabled = true;
        try {
            const removed = await player.removeTrack(selection.value);
            if (player === audio) status.textContent = removed ? '已移除曲目。' : '无法移除这首曲目。';
        } catch {
            if (player === audio) status.textContent = '移除曲目失败。';
        } finally {
            if (audio) update(audio.getMusicLibrary());
        }
    });
    outlet.append(element);

    function setAudio(player) {
        unsubscribe?.();
        audio = player;
        music.hidden = !player;
        status.textContent = '';
        unsubscribe = audio?.subscribeMusic(update);
    }
    setAudio(null);
    return {
        setAudio,
        dispose() {
            setAudio(null);
            element.remove();
        },
    };
}
