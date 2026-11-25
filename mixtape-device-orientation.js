const radians = Math.PI / 180;
const deadZone = radians;
const maxTilt = 0.20;

function deviceBasis(alpha, beta, gamma) {
    const sx = Math.sin(beta * radians), cx = Math.cos(beta * radians);
    const sy = Math.sin(gamma * radians), cy = Math.cos(gamma * radians);
    const sz = Math.sin(alpha * radians), cz = Math.cos(alpha * radians);

    // DeviceOrientation specifies an intrinsic Z-X′-Y″ rotation. These are
    // the resulting local screen axes and outward normal in reference space.
    return {
        right: [cz * cy - sz * sx * sy, sz * cy + cz * sx * sy, -cx * sy],
        up: [-sz * cx, cz * cx, sx],
        normal: [cz * sy + sz * sx * cy, sz * sy - cz * sx * cy, cx * cy],
    };
}

function dot(left, right) {
    return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

export function createDeviceOrientation(win, { onTilt, onStatus } = {}) {
    const doc = win.document;
    const sensor = win.DeviceOrientationEvent;
    const touch = win.navigator.maxTouchPoints > 0 || win.matchMedia('(pointer: coarse)').matches;
    const secure = win.isSecureContext;
    const supported = touch && secure && !!sensor;
    const requestPermission = supported && typeof sensor.requestPermission === 'function';
    const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
    const lifecycle = new win.AbortController();
    const options = { signal: lifecycle.signal, passive: true };
    let status = supported ? (requestPermission ? 'prompt' : 'listening') : touch && !secure ? 'insecure' : 'unavailable';
    let permitted = supported && !requestPermission;
    let active = false;
    let listening = false;
    let baseline;
    let sentPitch = 0;
    let sentYaw = 0;

    function setStatus(next) {
        if (status === next) return;
        status = next;
        onStatus?.(status);
    }

    function emitTilt(pitch, yaw) {
        if (pitch === 0 && yaw === 0) {
            if (sentPitch === 0 && sentYaw === 0) return;
        } else if (Math.hypot(pitch - sentPitch, yaw - sentYaw) < 0.002) return;
        sentPitch = pitch;
        sentYaw = yaw;
        onTilt?.(pitch, yaw);
    }

    function reset() {
        baseline = undefined;
        emitTilt(0, 0);
        if (permitted) setStatus('listening');
    }

    function handleOrientation({ alpha, beta, gamma }) {
        if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return;
        const hasHeading = Number.isFinite(alpha);
        if (baseline?.hasHeading && !hasHeading) return;
        const screenAngle = win.screen?.orientation?.angle ?? win.orientation ?? 0;
        const { right, up, normal } = deviceBasis(hasHeading ? alpha : 0, beta, gamma);
        if (!baseline || baseline.screenAngle !== screenAngle || baseline.hasHeading !== hasHeading) {
            const sin = Math.sin(screenAngle * radians), cos = Math.cos(screenAngle * radians);
            baseline = {
                screenAngle, hasHeading, normal,
                right: right.map((axis, index) => axis * cos - up[index] * sin),
                up: up.map((axis, index) => axis * cos + right[index] * sin),
            };
            emitTilt(0, 0);
            setStatus('active');
            return;
        }

        // Comparing normals ignores rotation around the display's own normal.
        const horizontal = dot(baseline.right, normal);
        const vertical = dot(baseline.up, normal);
        const lateral = Math.hypot(horizontal, vertical);
        const angle = Math.atan2(lateral, dot(baseline.normal, normal));
        if (angle <= deadZone || lateral < 1e-6) {
            emitTilt(0, 0);
            return;
        }
        const strength = Math.min(maxTilt, (angle - deadZone) * 0.65) / lateral;
        const pitch = Math.abs(vertical) < 1e-6 ? 0 : -vertical * strength;
        const yaw = Math.abs(horizontal) < 1e-6 ? 0 : horizontal * strength;
        emitTilt(pitch, yaw);
    }

    function canListen() {
        return active && !doc.hidden && !reduced.matches && !doc.body.classList.contains('reduced-motion');
    }

    function sync() {
        const next = permitted && canListen();
        if (next === listening) return;
        listening = next;
        if (listening) win.addEventListener('deviceorientation', handleOrientation, options);
        else win.removeEventListener('deviceorientation', handleOrientation);
        reset();
    }

    const bodyObserver = supported ? new win.MutationObserver(sync) : null;
    if (supported) {
        bodyObserver.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
        reduced.addEventListener('change', sync, options);
        doc.addEventListener('visibilitychange', sync, options);
        win.screen?.orientation?.addEventListener?.('change', reset, options);
        win.addEventListener('orientationchange', reset, options);
    }

    return {
        get status() { return status; },
        setActive(next) {
            if (lifecycle.signal.aborted) return;
            active = next;
            sync();
        },
        async enable() {
            if (!supported || lifecycle.signal.aborted || !canListen()) return false;
            if (permitted) return true;
            if (status !== 'prompt' && status !== 'denied') return false;
            const previousStatus = status;
            setStatus('prompting');
            try {
                // Invoke directly in the click handler's call stack for browsers that require activation.
                const result = await sensor.requestPermission();
                if (lifecycle.signal.aborted) return false;
                permitted = result === 'granted';
                setStatus(permitted ? 'listening' : 'denied');
                sync();
                return permitted;
            } catch (error) {
                if (!lifecycle.signal.aborted) setStatus(error?.name === 'NotAllowedError' ? previousStatus : 'denied');
                return false;
            }
        },
        reset,
        dispose() {
            active = false;
            sync();
            lifecycle.abort();
            bodyObserver?.disconnect();
        },
    };
}
