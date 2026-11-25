const directionButtons = [
    [12, 'up'],
    [13, 'down'],
    [14, 'left'],
    [15, 'right'],
];
const actionButtons = [
    [0, 'confirm'],
    [1, 'back'],
    [4, 'previous-tab'],
    [5, 'next-tab'],
];

function readDirection(horizontal, vertical, threshold, held) {
    const isHorizontal = Math.abs(horizontal) > Math.abs(vertical);
    const axis = isHorizontal ? horizontal : vertical;
    const direction = isHorizontal
        ? (axis < 0 ? 'left' : 'right')
        : (axis < 0 ? 'up' : 'down');
    const limit = held.has(direction) ? Math.max(0, threshold - 0.1) : threshold;
    return axis !== 0 && Math.abs(axis) >= limit ? direction : null;
}

export function connectGamepad(window, { isActive, onInput, deadZone = 0.5 }) {
    if (!window.navigator.getGamepads) return () => {};

    let animation;
    let idle;
    let primed = false;
    let disposed = false;
    let held = new Set();

    function poll() {
        if (disposed) return;
        if (!isActive() || window.document?.hidden) {
            primed = false;
            held.clear();
            idle = window.setTimeout(poll, 200);
            return;
        }

        let gamepads;
        try {
            gamepads = window.navigator.getGamepads();
        } catch {
            // Some embedded browser contexts block gamepad access.
            return;
        }

        const threshold = side => typeof deadZone === 'function' ? deadZone(side) : deadZone;
        const pressed = new Set();
        for (const gamepad of gamepads) {
            if (!gamepad?.connected || gamepad.mapping !== 'standard') continue;

            let usesDpad = false;
            for (const [button, action] of directionButtons) {
                if (!gamepad.buttons[button]?.pressed) continue;
                pressed.add(action);
                usesDpad = true;
            }
            if (!usesDpad) {
                const [leftX = 0, leftY = 0, rightX = 0, rightY = 0] = gamepad.axes;
                const direction = readDirection(leftX, leftY, threshold('left'), held)
                    ?? readDirection(rightX, rightY, threshold('right'), held);
                if (direction) pressed.add(direction);
            }
            for (const [button, action] of actionButtons) {
                if (gamepad.buttons[button]?.pressed) pressed.add(action);
            }
        }

        if (primed) {
            for (const action of pressed) {
                if (!isActive() || disposed) break;
                if (!held.has(action)) onInput(action);
            }
        }
        held = pressed;
        primed = true;
        if (!disposed) animation = window.requestAnimationFrame(poll);
    }

    poll();
    return () => {
        disposed = true;
        window.cancelAnimationFrame(animation);
        window.clearTimeout(idle);
    };
}
