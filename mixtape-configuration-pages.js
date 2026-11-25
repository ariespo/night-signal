const input = { event: 'input' };
const change = { event: 'change' };
const hiddenToggle = { force: true };

function fields(ui, section, rows, defaults = input) {
    for (const [label, target, options = defaults] of rows) {
        ui.field(section, label, target, options);
    }
}

function actions(ui, section, rows) {
    for (const [label, target, value] of rows) ui.action(section, label, target, { value });
}

function visibleIn(source, control) {
    const { defaultView } = source.ownerDocument;
    let node = control;
    while (node && node !== source) {
        if (node.hidden || defaultView.getComputedStyle(node).display === 'none') return false;
        node = node.parentElement;
    }
    return node === source;
}

function firstVisible(source, selector) {
    return () => [...source.querySelectorAll(selector)].find(control => visibleIn(source, control)) ?? null;
}

function getSamplerCaption(control) {
    const caption = control.parentElement?.querySelector('small')
        ?? control.closest('.range-block')?.querySelector('.range-block-title');
    return caption?.textContent.trim().replaceAll(/\s+/g, ' ') || control.id.replaceAll('_', ' ');
}

function renderAiPage(ui) {
    const presets = ui.section('预设');
    fields(ui, presets, [
        ['Kobold 预设', '#settings_preset'],
        ['NovelAI 预设', '#settings_preset_novel'],
        ['聊天补全预设', '#settings_preset_openai'],
        ['文本补全预设', '#settings_preset_textgenerationwebui'],
    ], change);

    const response = ui.section('回复');
    fields(ui, response, [
        ['回复长度', '#amount_gen'],
        ['上下文长度', '#max_context'],
        ['聊天补全上下文长度', '#openai_max_context'],
        ['解锁上下文上限', '#max_context_unlocked'],
        ['流式输出', firstVisible(ui.source, '#streaming_textgenerationwebui, #streaming_kobold, #streaming_novel'), { mode: 'checkbox' }],
    ]);

    const sampler = ui.section('采样');
    const limits = new Set(['amount_gen', 'max_context', 'openai_max_context']);
    for (const slider of ui.source.querySelectorAll('input[type="range"][id]')) {
        if (limits.has(slider.id)) continue;
        ui.field(sampler, getSamplerCaption(slider), `#${slider.id}`, input);
    }
}

function renderApiPage(ui) {
    const provider = ui.section('来源');
    fields(ui, provider, [
        ['API 类型', '#main_api'],
        ['文本补全服务', '#textgen_type'],
        ['聊天补全服务', '#chat_completion_source'],
    ], change);

    const model = ui.section('地址与模型');
    fields(ui, model, [
        ['API 地址', firstVisible(ui.source, 'input[data-server-history], #custom_api_url_text, #azure_base_url'), { mode: 'text', event: 'input' }],
        ['反向代理预设', '#openai_proxy_preset', change],
        ['反向代理地址', '#openai_reverse_proxy'],
        ['模型', firstVisible(ui.source, 'select[id^="model_"]:not([multiple]), #openrouter_model, #vllm_model, #mancer_model, #aphrodite_model, #llamacpp_model, #ollama_model, #tabby_model, #generic_model_select, #azure_openai_model'), { mode: 'select', event: 'change' }],
        ['自定义模型', firstVisible(ui.source, '#custom_model_id, #custom_model_textgenerationwebui, #generic_model_textgenerationwebui'), { mode: 'text', event: 'input' }],
        ['Azure 部署名称', '#azure_deployment_name'],
        ['Azure API 版本', '#azure_api_version', change],
        ['提示词后处理', '#custom_prompt_post_processing', change],
    ]);

    const connection = ui.section('连接');
    fields(ui, connection, [
        ['自动连接', '#auto-connect-checkbox'],
        ['仅使用可信工作节点', '#horde_trusted_workers_only'],
        ['自动调整上下文长度', '#horde_auto_adjust_context_length'],
        ['自动调整回复长度', '#horde_auto_adjust_response_length'],
    ]);
    ui.action(connection, 'API 密钥', firstVisible(ui.source, '.manage-api-keys[data-key]'), { value: '管理' });
    ui.action(connection, '连接到服务', firstVisible(ui.source, '#api_button, #api_button_novel, #api_button_textgenerationwebui, #api_button_openai, #horde_api_key_button'), { value: '连接' });
    ui.action(connection, '正在连接', firstVisible(ui.source, '.api_loading'), { value: '取消' });
    ui.action(connection, '测试连接', '#test_api_button', { value: '发送消息' });
}

function templateActions(ui, section, key) {
    actions(ui, section, [
        ['当前模板', `[data-preset-manager-update="${key}"]`, '更新'],
        ['另存模板', `[data-preset-manager-new="${key}"]`, '另存'],
        ['恢复模板', `[data-preset-manager-restore="${key}"]`, '恢复'],
    ]);
}

function renderFormattingPage(ui) {
    const context = ui.section('上下文模板');
    fields(ui, context, [
        ['模板', '#context_presets', change],
        ['故事模板', '#context_story_string'],
        ['故事模板位置', '#context_story_string_position'],
        ['注入深度', '#context_story_string_depth'],
        ['注入角色', '#context_story_string_role'],
        ['示例分隔符', '#context_example_separator'],
        ['聊天起始符', '#context_chat_start'],
        ['提示词中始终包含角色名', '#always-force-name2-checkbox'],
        ['单行模式', '#single_line'],
        ['折叠连续换行', '#collapse-newlines-checkbox'],
        ['修剪空格', '#trim_spaces'],
        ['修剪不完整句子', '#trim_sentences_checkbox'],
        ['使用上下文停止字符串', '#context_use_stop_strings'],
        ['将角色名用作停止字符串', '#context_names_as_stop_strings'],
    ]);
    templateActions(ui, context, 'context');

    const instruct = ui.section('指令模板');
    fields(ui, instruct, [
        ['启用指令模式', '#instruct_enabled', hiddenToggle],
        ['与上下文模板绑定', '#instruct_bind_to_context', hiddenToggle],
        ['模板', '#instruct_presets', change],
        ['自动启用表达式', '#instruct_activation_regex'],
        ['换行包裹', '#instruct_wrap'],
        ['展开宏', '#instruct_macro'],
        ['跳过示例消息', '#instruct_skip_examples'],
        ['名称行为', '#instruct_names_behavior'],
        ['将序列用作停止字符串', '#instruct_sequences_as_stop_strings'],
        ['故事模板前缀', '#instruct_story_string_prefix'],
        ['故事模板后缀', '#instruct_story_string_suffix'],
        ['用户前缀', '#instruct_input_sequence'],
        ['用户后缀', '#instruct_input_suffix'],
        ['助手前缀', '#instruct_output_sequence'],
        ['助手后缀', '#instruct_output_suffix'],
        ['系统前缀', '#instruct_system_sequence'],
        ['系统后缀', '#instruct_system_suffix'],
        ['系统序列沿用用户序列', '#instruct_system_same_as_user'],
        ['首次助手回复前缀', '#instruct_first_output_sequence'],
        ['最后助手回复前缀', '#instruct_last_output_sequence'],
        ['首条用户消息前缀', '#instruct_first_input_sequence'],
        ['最后用户消息前缀', '#instruct_last_input_sequence'],
        ['最后系统消息前缀', '#instruct_last_system_sequence'],
        ['停止序列', '#instruct_stop_sequence'],
        ['用户对齐消息', '#instruct_user_alignment_message'],
    ]);
    templateActions(ui, instruct, 'instruct');

    const system = ui.section('系统提示词');
    fields(ui, system, [
        ['启用系统提示词', '#sysprompt_enabled', hiddenToggle],
        ['模板', '#sysprompt_select', change],
        ['提示词', '#sysprompt_content'],
        ['聊天记录后提示词', '#sysprompt_post_history'],
    ]);

    const tokens = ui.section('分词与停止条件');
    fields(ui, tokens, [
        ['分词器', '#tokenizer', change],
        ['Token 预留量', '#token_padding'],
        ['自定义停止字符串', '#custom_stopping_strings'],
        ['展开停止字符串中的宏', '#custom_stopping_strings_macro'],
    ]);

    const reasoning = ui.section('推理');
    fields(ui, reasoning, [
        ['推理模板', '#reasoning_select', change],
        ['自动解析', '#reasoning_auto_parse'],
        ['自动展开', '#reasoning_auto_expand'],
        ['显示隐藏的推理', '#reasoning_show_hidden'],
        ['在提示词中包含推理', '#reasoning_add_to_prompts'],
        ['最大添加数', '#reasoning_max_additions'],
        ['开始标记', '#reasoning_prefix'],
        ['结束标记', '#reasoning_suffix'],
        ['分隔符', '#reasoning_separator'],
    ]);

    const files = ui.section('格式预设文件');
    actions(ui, files, [
        ['导入格式预设', '#af_master_import', '导入'],
        ['导出格式预设', '#af_master_export', '导出'],
    ]);
}

function renderPreferencesPage(ui) {
    const general = ui.section('语言与外观');
    fields(ui, general, [
        ['界面语言', '#ui_language_select', change],
        ['UI 主题', '#themes', change],
        ['头像样式', '#avatar_style', change],
        ['聊天样式', '#chat_display', change],
        ['媒体样式', '#media_display'],
        ['通知位置', '#toastr_position', change],
        ['聊天宽度', '#chat_width_slider', { event: 'input', format: value => `${value}%` }],
        ['字体大小', '#font_scale', { event: 'input', format: value => `${Math.round(Number(value) * 100)}%` }],
        ['模糊强度', '#blur_strength'],
        ['阴影宽度', '#shadow_width'],
        ['减少动态效果', '#reduced_motion'],
        ['简化界面效果', '#fast_ui_mode'],
        ['关闭阴影', '#noShadowsmode'],
        ['视觉小说模式', '#waifuMode'],
    ]);

    const messages = ui.section('消息显示');
    fields(ui, messages, [
        ['显示时间戳', '#messageTimestampsEnabled'],
        ['显示模型图标', '#messageModelIconEnabled'],
        ['显示消息编号', '#mesIDDisplayEnabled'],
        ['隐藏聊天头像', '#hideChatAvatarsEnabled'],
        ['显示消息 Token 数', '#messageTokensEnabled'],
        ['自动滚动', '#auto_scroll_chat_to_bottom'],
        ['加载消息数', '#chat_truncation'],
        ['流式刷新率', '#streaming_fps'],
        ['平滑流式输出', '#smooth_streaming'],
        ['消息淡入', '#stream_fade_in'],
        ['消息提示音', '#play_message_sound'],
    ]);

    const inputSettings = ui.section('输入与聊天');
    fields(ui, inputSettings, [
        ['回车发送规则', '#send_on_enter', change],
        ['精简输入区', '#compact_input_area'],
        ['恢复未发送文字', '#restore_user_input'],
        ['启动时加载聊天', '#auto-load-chat-checkbox'],
        ['自动保存消息编辑', '#auto_save_msg_edits'],
        ['删除消息前确认', '#confirm_message_delete'],
        ['启用滑动切换回复', '#swipes-checkbox'],
        ['启用手势', '#gestures-checkbox', change],
        ['示例消息行为', '#example_messages_behavior', change],
    ]);

    const characters = ui.section('角色');
    fields(ui, characters, [
        ['角色副标题', '#aux_field', change],
        ['导入角色标签', '#tag_import_setting', change],
        ['模糊搜索', '#fuzzy_search_checkbox'],
        ['优先使用角色提示词', '#prefer_character_prompt'],
        ['优先使用角色越狱提示词', '#prefer_character_jailbreak'],
        ['避免剧透', '#spoiler_free_mode'],
    ]);

    const themes = ui.section('主题文件');
    actions(ui, themes, [
        ['导入 UI 主题', '#ui_preset_import_button', '导入'],
        ['导出 UI 主题', '#ui_preset_export_button', '导出'],
        ['更新当前主题', '#ui-preset-update-button', '更新'],
        ['另存为新主题', '#ui-preset-save-button', '另存'],
    ]);
    ui.field(themes, '自定义 CSS', '#customCSS', input);
}

const pages = {
    'left-nav-panel': renderAiPage,
    rm_api_block: renderApiPage,
    AdvancedFormatting: renderFormattingPage,
    'user-settings-block': renderPreferencesPage,
};

export function renderConfigurationPage(ui) {
    pages[ui.source.id]?.(ui);
}
