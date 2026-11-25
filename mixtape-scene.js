const vertex = `
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec2 a_uv;
uniform vec2 u_center;
uniform vec2 u_extent;
uniform vec2 u_view;
uniform float u_lens;
uniform vec3 u_angles;
uniform float u_scale;
uniform vec2 u_decalHeight;
varying vec3 v_normal;
varying vec3 v_front;
varying vec3 v_right;
varying vec3 v_up;
varying vec3 v_position;
varying vec2 v_uv;
void main() {
    float sx = sin(u_angles.x), cx = cos(u_angles.x);
    float sy = sin(u_angles.y), cy = cos(u_angles.y);
    float sz = sin(u_angles.z), cz = cos(u_angles.z);
    mat3 pitch = mat3(1., 0., 0., 0., cx, sx, 0., -sx, cx);
    mat3 yaw = mat3(cy, 0., -sy, 0., 1., 0., sy, 0., cy);
    mat3 roll = mat3(cz, sz, 0., -sz, cz, 0., 0., 0., 1.);
    mat3 attitude = roll * yaw * pitch;
    float y = u_decalHeight.x + (a_position.y - u_decalHeight.x) * u_decalHeight.y;
    vec3 local = vec3(a_position.x, y, a_position.z) * vec3(u_extent, u_extent.x) * u_scale;
    vec3 point = attitude * local;
    float w = 1. - point.z / u_lens;
    vec2 center = 2. * u_center / u_view - 1.;
    gl_Position = vec4(center * w + 2. * point.xy / u_view, -point.z / u_lens, w);
    v_normal = attitude * normalize(a_normal * vec3(1., u_extent.x / u_extent.y, 1.));
    v_front = attitude[2];
    v_right = attitude[0];
    v_up = attitude[1];
    v_position = point / u_extent.x;
    v_uv = a_uv;
}
`;

const fragment = `
precision mediump float;
uniform sampler2D u_texture;
uniform sampler2D u_surface;
uniform vec2 u_light;
uniform float u_cameraDistance;
uniform float u_opacity;
uniform float u_decal;
varying vec3 v_normal;
varying vec3 v_front;
varying vec3 v_right;
varying vec3 v_up;
varying vec3 v_position;
varying vec2 v_uv;

float softbox(vec2 offset, vec2 radius) {
    vec2 q = offset / radius;
    return exp(-dot(q, q));
}

void main() {
    vec4 image = texture2D(u_texture, v_uv);
    if (image.a < 0.025) discard;
    vec3 normal = normalize(v_normal);
    float wear = 0.;
    if (u_decal < 0.5) {
        // Original rear-cover BC5 normal (RG) and scratch mask (B), stored as linear data.
        vec3 surface = texture2D(u_surface, v_uv).rgb;
        vec2 tangentNormal = (surface.rg * 2. - 1.) * vec2(1., -1.);
        float frontFace = smoothstep(0.55, 1., dot(normal, v_front));
        normal = normalize(normal + frontFace * (v_right * tangentNormal.x + v_up * tangentNormal.y));
        wear = surface.b;
    }

    vec3 eye = normalize(vec3(0., 0., u_cameraDistance) - v_position);
    vec3 light = normalize(vec3(-0.65, 0.72, 1.5) - v_position);
    float diffuse = 0.88 + 0.12 * max(0., dot(normal, light));
    vec3 color = image.rgb * diffuse;

    // Cast the reflected view ray onto two fixed light panels. Their highlights
    // travel across the cover as the original geometry and its normals turn.
    vec3 ray = reflect(-eye, normal);
    vec2 hit = v_position.xy + ray.xy * ((1.35 - v_position.z) / max(0.05, ray.z));
    vec2 top = hit - (vec2(-1.27, 1.06) + u_light * vec2(0.22, 0.15));
    vec2 right = hit - (vec2(1.28, -0.79) + u_light * vec2(0.11, 0.22));
    float roughness = 0.176 + wear * 0.2384;
    float blur = 1. + (roughness - 0.176) * 4.;
    float key = 0.38 * softbox(top, vec2(0.59, 0.39) * blur)
              + 0.72 * softbox(top, vec2(0.19, 0.16) * blur);
    float fill = 0.31 * softbox(right, vec2(0.26, 0.57) * blur)
               + 0.25 * softbox(right, vec2(0.092, 0.43) * blur);
    float acrylic = pow(1. - clamp(abs(dot(normal, eye)), 0., 1.), 2.);
    float rim = acrylic * (0.08 + 0.25 * max(0., dot(normal, light)));
    float reflection = (key + fill) * smoothstep(0.04, 0.18, ray.z);
    float glint = (reflection + rim) * mix(1., 0.21, u_decal);
    glint += min(0.14, wear * 0.33) * min(1., reflection * 2.);
    color += (1. - color) * vec3(1., 0.82, 0.70) * glint;
    gl_FragColor = vec4(color, image.a * u_opacity);
}
`;

const fallbackMesh = {
    positions: [-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    uvs: [0, 0, 1, 0, 0, 1, 1, 1],
    indices: [0, 1, 2, 2, 1, 3],
};

const decals = [
    { file: 'hot-stuff.webp', center: [0.53, 0.62], extent: [0.135, 0.157], aspect: 1 },
    { file: 'address-label.webp', center: [-0.57, -0.79], extent: [0.208, 0.121], aspect: 294 / 132 },
    { file: 'hot-shop.webp', center: [-0.11, -0.86], extent: [0.233, 0.098], aspect: 326 / 78 },
];

const hidden = { pitch: -0.28, yaw: 0.38, roll: -0.06, scale: 0.76, lift: 62, opacity: 0 };
const resting = { pitch: 0.015, yaw: -0.025, roll: 0.01, scale: 1, lift: 0, opacity: 1 };
const motion = { opening: 520, switching: 315, closing: 360 };
const maxCanvasPixels = 1_650_000;
const interpolate = (from, to, fraction) => from + (to - from) * fraction;
const ease = fraction => 1 - (1 - fraction) ** 3;
const limit = (value, max) => Math.max(-max, Math.min(max, value));

function getHardwareContext(canvas) {
    try {
        const gl = canvas.getContext('webgl', {
            alpha: true, antialias: true, premultipliedAlpha: false, failIfMajorPerformanceCaveat: true,
        });
        if (!gl) return null;
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
        if (!/swiftshader|llvmpipe|softpipe|lavapipe|software rasterizer|microsoft basic render driver|\bwarp\b/i.test(renderer)) return gl;
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
        // Browser settings may disable WebGL or renderer identification.
    }
    return null;
}

function projectBounds({ box, lens, pitch, yaw, roll, scale, lift }, extent) {
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2 + lift;
    const rx = extent[0] * box.width / 2 * scale;
    let halfHeight = extent[1] * box.height / 2;
    for (const { center, extent: size, aspect } of decals) {
        halfHeight = Math.max(halfHeight, Math.abs(center[1]) * box.height / 2 + size[0] * box.width / 2 / aspect);
    }
    const ry = halfHeight * scale;
    const rz = extent[2] * box.width / 2 * scale;
    const sx = Math.sin(pitch), cx = Math.cos(pitch);
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const sz = Math.sin(roll), cz = Math.cos(roll);
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;

    // Project the corners of a cuboid enclosing the mesh and the three decals.
    const sides = [-1, 1];
    for (const ySide of sides) {
        for (const zSide of sides) {
            const pitchY = ySide * ry * cx - zSide * rz * sx;
            const pitchZ = ySide * ry * sx + zSide * rz * cx;
            for (const xSide of sides) {
                const x = xSide * rx;
                const yawX = x * cy + pitchZ * sy;
                const yawZ = -x * sy + pitchZ * cy;
                const perspective = 1 / (1 - yawZ / lens);
                const px = centerX + (yawX * cz - pitchY * sz) * perspective;
                const py = centerY - (yawX * sz + pitchY * cz) * perspective;
                left = Math.min(left, px);
                right = Math.max(right, px);
                top = Math.min(top, py);
                bottom = Math.max(bottom, py);
            }
        }
    }
    return { left, top, right, bottom };
}

function shader(gl, type, source) {
    const result = gl.createShader(type);
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (gl.getShaderParameter(result, gl.COMPILE_STATUS)) return result;
    const reason = gl.getShaderInfoLog(result);
    gl.deleteShader(result);
    throw new Error(reason);
}

function buildProgram(gl) {
    const program = gl.createProgram();
    const vertexShader = shader(gl, gl.VERTEX_SHADER, vertex);
    const fragmentShader = shader(gl, gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
    const reason = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(reason);
}

function addMesh(gl, geometry) {
    const { positions, normals, uvs, indices } = geometry;
    if (!positions?.length || positions.length % 3 || positions.length !== normals?.length
        || uvs?.length !== positions.length / 3 * 2 || !indices?.length || positions.length / 3 > 65535) {
        throw new Error('Invalid jewel case geometry');
    }
    const buffers = new Map();
    function buffer(name, data, type) {
        const handle = gl.createBuffer();
        gl.bindBuffer(type, handle);
        gl.bufferData(type, data, gl.STATIC_DRAW);
        buffers.set(name, handle);
    }
    buffer('position', new Float32Array(positions), gl.ARRAY_BUFFER);
    buffer('normal', new Float32Array(normals), gl.ARRAY_BUFFER);
    buffer('uv', new Float32Array(uvs), gl.ARRAY_BUFFER);
    buffer('index', new Uint16Array(indices), gl.ELEMENT_ARRAY_BUFFER);
    return { buffers, count: indices.length };
}

function decalGeometry({ center, extent }, depth) {
    const [x, y] = center;
    const [w, h] = extent;
    return {
        ...fallbackMesh,
        positions: [x - w, y - h, depth, x + w, y - h, depth, x - w, y + h, depth, x + w, y + h, depth],
    };
}

function fetchJson(win, url, signal) {
    return win.fetch(url, { signal }).then(response => {
        if (!response.ok) throw new Error(`Jewel case request returned ${response.status}`);
        return response.json();
    });
}

function loadImage(win, src) {
    const image = new win.Image();
    image.src = src;
    return image.decode().then(() => image);
}

export function createJewelScene(surface, {
    resolveAsset = name => new URL(`./assets/mixtape/${name}`, import.meta.url),
    onPose,
} = {}) {
    const doc = surface.ownerDocument;
    const win = doc.defaultView;
    const canvas = doc.createElement('canvas');
    canvas.className = 'mt-scene-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.inset = 'auto';
    surface.prepend(canvas);
    surface.dataset.renderer = 'flat';
    surface.dataset.motion = 'idle';

    const resources = new AbortController();
    const eventOptions = { signal: resources.signal, passive: true };
    const reducedBySystem = win.matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = () => reducedBySystem.matches || doc.body.classList.contains('reduced-motion');
    let wasReduced = reduced();
    const gl = getHardwareContext(canvas);
    const objects = [];
    let program;
    let coverSurface;
    let uniforms;
    let attributes;
    let frame = 0;
    let active = false;
    let box;
    let region;
    const meshExtent = [1, 1, 0.002];
    let pose = { ...hidden };
    let transition;
    let tilt = [0, 0];
    let pointer = [0, 0];
    let manual = [0, 0];

    function setPhase(next) {
        surface.dataset.motion = next;
    }

    function requestDraw() {
        if (!resources.signal.aborted && !doc.hidden && !frame && (active || transition)) {
            frame = win.requestAnimationFrame(draw);
        }
    }

    function updateMotionPreference() {
        const next = reduced();
        if (wasReduced === next) return;
        wasReduced = next;
        requestDraw();
    }

    function fitCanvas(state) {
        const { innerWidth, innerHeight, devicePixelRatio = 1 } = win;
        const projected = projectBounds(state, meshExtent);
        const previous = region?.viewWidth === innerWidth && region.viewHeight === innerHeight ? region : null;
        const pad = 28;
        if (!previous || (previous.left > 0 && projected.left < previous.left + 2)
            || (previous.top > 0 && projected.top < previous.top + 2)
            || (previous.right < innerWidth && projected.right > previous.right - 2)
            || (previous.bottom < innerHeight && projected.bottom > previous.bottom - 2)) {
            // Keep a margin for normal rotation, grow only if the moving shell reaches it,
            // and reset on layout changes so the backing buffer is not resized every frame.
            const left = Math.max(0, Math.floor(Math.min(previous?.left ?? box.x - pad, projected.left - pad)));
            const top = Math.max(0, Math.floor(Math.min(previous?.top ?? box.y - pad, projected.top - pad)));
            const right = Math.min(innerWidth, Math.ceil(Math.max(previous?.right ?? box.x + box.width + pad, projected.right + pad)));
            const bottom = Math.min(innerHeight, Math.ceil(Math.max(previous?.bottom ?? box.y + box.height + pad, projected.bottom + pad)));
            const width = right - left;
            const height = bottom - top;
            region = { left, top, right, bottom, width, height, viewWidth: innerWidth, viewHeight: innerHeight };
            Object.assign(canvas.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
        }

        const { width, height } = region;
        const ratio = Math.min(devicePixelRatio, 1.65, Math.sqrt(maxCanvasPixels / (width * height)));
        const pixelWidth = Math.max(1, Math.floor(width * ratio));
        const pixelHeight = Math.max(1, Math.floor(height * ratio));
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    }

    function render(state) {
        if (!gl || !program || !objects.length || gl.isContextLost()) return;
        if (state.opacity > 0) fitCanvas(state);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        if (state.opacity <= 0) return;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(program);
        gl.uniform2f(uniforms.center, box.x + box.width / 2 - region.left, region.bottom - box.y - box.height / 2 - state.lift);
        gl.uniform2f(uniforms.extent, box.width / 2, box.height / 2);
        gl.uniform2f(uniforms.view, region.width, region.height);
        gl.uniform1f(uniforms.lens, state.lens);
        gl.uniform1f(uniforms.cameraDistance, state.lens / (box.width / 2));
        gl.uniform3f(uniforms.angles, state.pitch, state.yaw, state.roll);
        gl.uniform1f(uniforms.scale, state.scale);
        gl.uniform2f(uniforms.light, state.lightX, state.lightY);
        gl.uniform1f(uniforms.opacity, state.opacity);
        for (const object of objects) {
            gl.uniform1f(uniforms.decal, object.decal ? 1 : 0);
            const decal = object.decal;
            if (decal) {
                const stretch = decal.extent[0] * box.width / (decal.extent[1] * box.height * decal.aspect);
                gl.uniform2f(uniforms.decalHeight, decal.center[1], stretch);
            } else gl.uniform2f(uniforms.decalHeight, 0, 1);
            gl.bindTexture(gl.TEXTURE_2D, object.texture);
            for (const [key, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
                gl.bindBuffer(gl.ARRAY_BUFFER, object.buffers.get(key));
                gl.enableVertexAttribArray(attributes[key]);
                gl.vertexAttribPointer(attributes[key], size, gl.FLOAT, false, 0, 0);
            }
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, object.buffers.get('index'));
            gl.drawElements(gl.TRIANGLES, object.count, gl.UNSIGNED_SHORT, 0);
        }
    }

    function draw(now) {
        frame = 0;
        if (doc.hidden || !box) return;
        const still = reduced();
        if (transition) {
            const fraction = still ? 1 : Math.min(1, (now - transition.start) / transition.duration);
            for (const key of Object.keys(resting)) pose[key] = interpolate(transition.from[key], transition.to[key], ease(fraction));
            if (fraction === 1) {
                transition = undefined;
                setPhase(active ? 'ready' : 'idle');
                if (!active) surface.hidden = true;
            }
        }
        const target = active && !still ? [-pointer[1] * 0.035 + manual[0], pointer[0] * 0.06 + manual[1]] : [0, 0];
        for (let axis = 0; axis < 2; axis++) {
            if (still || Math.abs(tilt[axis] - target[axis]) < 0.0004) tilt[axis] = target[axis];
            else tilt[axis] = interpolate(tilt[axis], target[axis], 0.22);
        }
        const state = {
            ...pose, box, lens: Math.max(win.innerWidth, win.innerHeight) * 0.95,
            pitch: pose.pitch + tilt[0], yaw: pose.yaw + tilt[1],
            lightX: still ? 0 : pointer[0], lightY: still ? 0 : pointer[1],
        };
        onPose?.(state);
        render(state);
        if (transition || tilt.some((angle, axis) => Math.abs(angle - target[axis]) > 0.0004)) requestDraw();
    }

    function animate(next, target = resting) {
        setPhase(next);
        if (reduced()) {
            transition = undefined;
            pose = { ...target };
            setPhase(active ? 'ready' : 'idle');
            if (!active) surface.hidden = true;
        } else {
            transition = { from: { ...pose }, to: target, start: win.performance.now(), duration: motion[next] };
        }
        requestDraw();
    }

    function layout(nextBox) {
        if (!nextBox || nextBox.width < 1 || nextBox.height < 1) return;
        if (!box || box.x !== nextBox.x || box.y !== nextBox.y || box.width !== nextBox.width || box.height !== nextBox.height) {
            box = nextBox;
            region = undefined;
            for (const [name, value] of Object.entries(nextBox)) surface.style.setProperty(`--mt-scene-${name}`, `${value}px`);
        }
        requestDraw();
    }

    function makeTexture(image) {
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 0, 255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return texture;
    }

    function putImage(mesh, image, decal) {
        objects.push({ ...addMesh(gl, mesh), texture: makeTexture(image), decal });
    }

    async function prepare() {
        if (!gl) return;
        const meshRequest = fetchJson(win, resolveAsset('scene/jewel-case.json'), resources.signal).catch(() => null);
        const materialUrl = resolveAsset('jewel-surface.webp');
        const materialRequest = materialUrl ? loadImage(win, materialUrl).catch(() => null) : null;
        const images = await Promise.all(['jewel-case.webp', ...decals.map(item => item.file)].map(name => loadImage(win, resolveAsset(name))));
        const mesh = await meshRequest;
        const material = await materialRequest;
        if (resources.signal.aborted || gl.isContextLost()) return;
        program = buildProgram(gl);
        attributes = Object.fromEntries(['position', 'normal', 'uv'].map(name => [name, gl.getAttribLocation(program, `a_${name}`)]));
        uniforms = Object.fromEntries(['center', 'extent', 'view', 'lens', 'angles', 'scale', 'light', 'cameraDistance', 'surface', 'opacity', 'decal', 'decalHeight'].map(
            name => [name, gl.getUniformLocation(program, `u_${name}`)]));
        gl.useProgram(program);
        gl.uniform1i(uniforms.surface, 1);
        gl.activeTexture(gl.TEXTURE1);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        coverSurface = makeTexture(material);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
        gl.activeTexture(gl.TEXTURE0);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        const shell = mesh ?? fallbackMesh;
        putImage(shell, images[0], false);
        let surfaceDepth = 0;
        for (let vertex = 0; vertex < shell.positions.length; vertex += 3) {
            for (let axis = 0; axis < 3; axis++) {
                meshExtent[axis] = Math.max(meshExtent[axis], Math.abs(shell.positions[vertex + axis]));
            }
            surfaceDepth = Math.max(surfaceDepth, shell.positions[vertex + 2]);
        }
        const depth = surfaceDepth + 0.002;
        meshExtent[2] = Math.max(meshExtent[2], depth);
        for (const [index, decal] of decals.entries()) putImage(decalGeometry(decal, depth), images[index + 1], decal);
        surface.dataset.renderer = 'webgl';
        surface.dataset.geometry = mesh ? 'original' : 'textured-plane';
        surface.dataset.material = material ? 'original' : 'neutral';
        requestDraw();
    }

    canvas.addEventListener('webglcontextlost', () => {
        surface.dataset.renderer = 'flat';
        delete surface.dataset.geometry;
        delete surface.dataset.material;
        requestDraw();
    }, { signal: resources.signal });
    const reducedByHost = new win.MutationObserver(updateMotionPreference);
    reducedByHost.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    reducedBySystem.addEventListener('change', updateMotionPreference, eventOptions);
    doc.addEventListener('visibilitychange', requestDraw, eventOptions);
    doc.addEventListener('pointermove', event => {
        if (!active || event.pointerType === 'touch' || reduced()) return;
        const x = limit(event.clientX / win.innerWidth * 2 - 1, 1);
        const y = limit(1 - event.clientY / win.innerHeight * 2, 1);
        if (x === pointer[0] && y === pointer[1]) return;
        pointer = [x, y];
        requestDraw();
    }, eventOptions);
    void prepare().catch(error => {
        if (!resources.signal.aborted) console.warn('[Night Signal] Jewel case scene unavailable', error);
    });

    return {
        layout,
        show(targetBox, direction = 0) {
            layout(targetBox);
            const entering = !active;
            active = true;
            surface.hidden = false;
            if (!entering && direction && !reduced()) {
                pose.yaw += Math.sign(direction) * 0.17;
                pose.roll += Math.sign(direction) * 0.028;
                pose.scale *= 0.98;
            }
            animate(entering ? 'opening' : 'switching');
        },
        hide() {
            if (!active) return;
            active = false;
            manual = [0, 0];
            animate('closing', hidden);
        },
        rotate(dx, dy) {
            if (!active || reduced()) return;
            manual = [limit(manual[0] + dy, 0.22), limit(manual[1] + dx, 0.32)];
            requestDraw();
        },
        resetRotation() {
            manual = [0, 0];
            requestDraw();
        },
        dispose() {
            resources.abort();
            reducedByHost.disconnect();
            if (frame) win.cancelAnimationFrame(frame);
            if (gl && program && !gl.isContextLost()) {
                for (const object of objects) {
                    for (const handle of object.buffers.values()) gl.deleteBuffer(handle);
                    gl.deleteTexture(object.texture);
                }
                gl.deleteTexture(coverSurface);
                gl.deleteProgram(program);
            }
            canvas.remove();
        },
    };
}
