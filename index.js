import { CLIENT_VERSION } from '/script.js';
import { mount } from './night-signal.js';

export { onDisable } from './night-signal.js';

export function onActivate() {
    mount({ deferStartup: true });
}

// SillyTavern 1.16 loads the entry module without invoking manifest hooks.
if (/^1\.16\./.test(CLIENT_VERSION.split(':')[1])) {
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.once(eventTypes.APP_READY, () => mount());
}
