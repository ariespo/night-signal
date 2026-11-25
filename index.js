import { mount } from './night-signal.js';

export { onDisable } from './night-signal.js';

export function onActivate() {
    mount({ deferStartup: true });
}
