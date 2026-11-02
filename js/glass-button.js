import * as THREE from 'three';

/*
 * 3D glass buttons: an extruded, bevelled rounded slab with a frosted-glass shader, a 3D label and arrow.
 * It tilts toward the cursor, lifts on hover and dips on press.
 * Idea and slab/label approach from the "Fintar" hero pen by Shakuro; here every button gets its own small
 * transparent canvas on top of a normal <a> (which stays the real, clickable, focusable element).
 *
 * Usage:  <a class="gb" data-glass-btn="lime|clear" href="..."><span>Label</span></a>
 * (+ an arrow <svg> inside if you want the arrow). See css/glass-button.css.
 */

const FOV = 16;
const PAD = 48; // canvas bleed around the button: room for tilt, lift and glow

const THEMES = {
  // primary: lime glass, dark label
  lime: { tint: '#d8ff36', alpha: 0.95, ink: '#0b0d02', inkHover: '#000000', accent: '#ffffff', glow: '#d8ff36', glowRest: 0.2, labelShadow: 0.14 },
  // secondary: clear smoked glass, white label that turns lime on hover
  clear: { tint: '#ffffff', alpha: 0.1, ink: '#ffffff', inkHover: '#d8ff36', accent: '#d8ff36', glow: '#d8ff36', glowRest: 0.0, labelShadow: 0 },
};

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const C = (hex) => new THREE.Color(hex);

/* ---------------- slab geometry ---------------- */

function roundedRect(w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  const x = -w / 2, y = -h / 2;
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  const pts = [];
  for (const p of s.getPoints(24)) if (!pts.length || p.distanceTo(pts[pts.length - 1]) > 1e-3) pts.push(p);
  if (pts.length > 2 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-3) pts.pop();
  return new THREE.Shape(pts);
}

function slabGeometry(w, h) {
  const bevel = Math.min(h * 0.14, 8);
  const depth = h * 0.22;
  const radius = h * 0.26;
  const iw = Math.max(w - bevel * 2, 1), ih = Math.max(h - bevel * 2, 1);
  const geo = new THREE.ExtrudeGeometry(roundedRect(iw, ih, Math.max(radius - bevel, 0.5)), {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 8, curveSegments: 24,
  });
  geo.translate(0, 0, -depth / 2);
  return { geo, front: depth / 2 + bevel, bevel, radius: Math.min(radius, h / 2) };
}

/* ---------------- shaders ---------------- */

const glassVert = /* glsl */`
  varying vec3 vWorld;
  varying vec3 vN;
  varying vec3 vNObj;
  varying vec3 vPos;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vNObj = normal;
    vPos = position;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// Frosted glass for a dark page: no scene to refract, so the slab is a tinted translucent body with a
// soft vertical sheen, a studio reflection that grows toward the edges, and speculars on the bevel
// from a white key light, an accent light and the cursor.
const glassFrag = /* glsl */`
  uniform vec3 uTint;
  uniform float uAlpha;
  uniform vec3 uAccent;
  uniform vec3 uPointerPos;
  uniform float uHover;
  uniform vec2 uHalf;
  varying vec3 vWorld;
  varying vec3 vN;
  varying vec3 vNObj;
  varying vec3 vPos;

  float spec(vec3 n, vec3 l, vec3 v, float p) { return pow(max(dot(n, normalize(l + v)), 0.0), p); }

  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vWorld);
    float ndv = clamp(dot(n, v), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 3.0);
    float bevelK = smoothstep(0.02, 0.35, 1.0 - normalize(vNObj).z);
    float gy = clamp(vPos.y / (uHalf.y * 2.0) + 0.5, 0.0, 1.0); // 0 bottom .. 1 top

    // body: tint with a soft light-from-above sheen
    vec3 col = uTint * mix(0.92, 1.08, gy);

    // studio reflection: brighter sky above, darker floor below, stronger at grazing angles
    vec3 r = reflect(-v, n);
    vec3 env = mix(vec3(0.06, 0.06, 0.08), vec3(1.0), smoothstep(-0.3, 0.9, r.y));
    col = mix(col, env, 0.05 + 0.5 * fres);

    // lights
    float key = spec(n, normalize(vec3(-0.35, 1.0, 0.9)), v, 70.0) * 0.9 * bevelK;
    float acc = spec(n, normalize(vec3(0.7, -0.6, 0.8)), v, 36.0) * (0.15 + 0.85 * bevelK);
    float cur = spec(n, normalize(uPointerPos - vWorld), v, 110.0) * (0.12 + 1.1 * uHover) * mix(0.18, 1.0, bevelK);
    col += vec3(1.0) * key;
    col += uAccent * acc * 0.8;
    col += vec3(1.0, 0.98, 1.0) * cur;
    col += vec3(1.0) * fres * 0.12;

    // edges and speculars are more opaque than the frosted face
    float a = uAlpha + bevelK * 0.3 + fres * 0.45 + (key + cur) * 0.5;
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

const flatVert = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

// soft glow / drop shadow under the slab (rounded-rect SDF)
const glowFrag = /* glsl */`
  uniform vec2 uHalf;
  uniform vec2 uSize;
  uniform float uRadius;
  uniform float uLift;
  uniform float uAmount;
  uniform vec3 uColor;
  varying vec2 vUv;
  float sdRound(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  void main() {
    vec2 p = (vUv - 0.5) * uSize + vec2(0.0, 6.0 + uLift * 0.5);
    float d = sdRound(p, uHalf, uRadius);
    float a = (1.0 - smoothstep(-6.0, 22.0 + uLift, d)) * uAmount;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

const labelFrag = /* glsl */`
  uniform sampler2D map;
  uniform vec3 uInk;
  uniform vec3 uInkHover;
  uniform float uHover;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float a = texture2D(map, vUv).a;
    gl_FragColor = vec4(mix(uInk, uInkHover, uHover), a * uOpacity);
    #include <colorspace_fragment>
  }
`;

function labelMaterial(map, ink, inkHover, opacity = 1) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: { map: { value: map }, uInk: { value: C(ink) }, uInkHover: { value: C(inkHover) }, uHover: { value: 0 }, uOpacity: { value: opacity } },
    vertexShader: flatVert, fragmentShader: labelFrag,
  });
}

/* ---------------- one button ---------------- */

const pointer = { x: -1e4, y: -1e4 };
addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true });

function makeButton(el) {
  const theme = THEMES[el.dataset.glassBtn] || THEMES.lime;
  const canvas = document.createElement('canvas');
  canvas.className = 'gb-canvas';
  canvas.setAttribute('aria-hidden', 'true');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power' });
  } catch (e) {
    console.warn('[glass-button] WebGL unavailable, keeping the normal button', e);
    return;
  }
  renderer.setClearColor(0x000000, 0);
  el.append(canvas);
  el.classList.add('gb-on');

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(FOV, 1, 1, 5000);
  const group = new THREE.Group();
  scene.add(group);

  const glassMat = new THREE.ShaderMaterial({
    transparent: true,
    vertexShader: glassVert, fragmentShader: glassFrag,
    uniforms: {
      uTint: { value: C(theme.tint) }, uAlpha: { value: theme.alpha }, uAccent: { value: C(theme.accent) },
      uPointerPos: { value: new THREE.Vector3(-1e4, -1e4, 90) }, uHover: { value: 0 }, uHalf: { value: new THREE.Vector2() },
    },
  });
  const glowMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: flatVert, fragmentShader: glowFrag,
    uniforms: {
      uHalf: { value: new THREE.Vector2() }, uSize: { value: new THREE.Vector2() }, uRadius: { value: 0 },
      uLift: { value: 0 }, uAmount: { value: 0 }, uColor: { value: C(theme.glow) },
    },
  });

  const S = { w: 0, h: 0, hover: 0, hoverT: 0, press: 0, pressT: 0, rx: 0, ry: 0, glass: null, glow: null, labels: [], arrow: null, running: false };

  const enter = () => { S.hoverT = 1; kick(); };
  const leave = () => { S.hoverT = 0; S.pressT = 0; kick(); };
  el.addEventListener('pointerenter', enter);
  el.addEventListener('pointerleave', leave);
  el.addEventListener('focus', () => { if (el.matches(':focus-visible')) enter(); });
  el.addEventListener('blur', leave);
  el.addEventListener('pointerdown', () => { S.pressT = 1; kick(); });
  addEventListener('pointerup', () => { if (S.pressT) { S.pressT = 0; kick(); } });

  function paintLabel(text, font, spacing, tw, h, pad, scale, blur) {
    const cv = document.createElement('canvas');
    cv.width = Math.ceil((tw + pad * 2) * scale);
    cv.height = Math.ceil((h + pad * 2) * scale);
    const g = cv.getContext('2d');
    g.scale(scale, scale);
    if (blur) g.filter = `blur(${blur}px)`;
    g.fillStyle = '#fff';
    g.font = font;
    if ('letterSpacing' in g) g.letterSpacing = spacing;
    g.textBaseline = 'alphabetic';
    const cap = g.measureText('H').actualBoundingBoxAscent || parseFloat(font) * 0.72;
    g.fillText(text, pad, pad + h / 2 + cap / 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 8;
    return tex;
  }

  function paintArrow(aw, h, pad, scale, lw) {
    const cv = document.createElement('canvas');
    cv.width = Math.ceil((aw + pad * 2) * scale);
    cv.height = Math.ceil((h + pad * 2) * scale);
    const g = cv.getContext('2d');
    g.scale(scale, scale);
    g.strokeStyle = '#fff';
    g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
    const y = pad + h / 2;
    g.beginPath();
    g.moveTo(pad + aw * 0.08, y); g.lineTo(pad + aw * 0.92, y);
    g.moveTo(pad + aw * 0.6, y - aw * 0.32); g.lineTo(pad + aw * 0.92, y); g.lineTo(pad + aw * 0.6, y + aw * 0.32);
    g.stroke();
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 8;
    return tex;
  }

  function dispose(obj) {
    obj.geometry?.dispose();
    if (obj.material && obj.material !== glassMat && obj.material !== glowMat) {
      obj.material.uniforms?.map?.value?.dispose();
      obj.material.dispose();
    }
  }

  function build() {
    const r = el.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    if (w < 4 || h < 4) return false;
    S.w = w; S.h = h;

    // canvas + camera: world units == CSS px at z = 0
    const cw = w + PAD * 2, ch = h + PAD * 2;
    const pr = Math.min(devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pr);
    renderer.setSize(cw, ch, false);
    canvas.style.cssText = `left:${-PAD}px;top:${-PAD}px;width:${cw}px;height:${ch}px;`;
    cam.aspect = cw / ch;
    const dist = (ch / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    cam.position.set(0, 0, dist);
    cam.near = dist * 0.3; cam.far = dist * 3;
    cam.updateProjectionMatrix();

    // rebuild contents
    for (const o of [...group.children]) { group.remove(o); dispose(o); }

    const { geo, front, bevel, radius } = slabGeometry(w, h);
    S.glass = new THREE.Mesh(geo, glassMat);
    glassMat.uniforms.uHalf.value.set(w / 2, h / 2);

    const gp = 60;
    S.glow = new THREE.Mesh(new THREE.PlaneGeometry(w + gp * 2, h + gp * 2), glowMat);
    S.glow.position.z = -front - 1;
    glowMat.uniforms.uHalf.value.set(w / 2, h / 2);
    glowMat.uniforms.uSize.value.set(w + gp * 2, h + gp * 2);
    glowMat.uniforms.uRadius.value = radius;
    group.add(S.glow, S.glass);

    // labels: positioned where the DOM text / arrow placeholder actually sit
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const spacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
    const span = el.querySelector('span');
    let text = (span || el).textContent.trim();
    if (cs.textTransform === 'uppercase') text = text.toUpperCase();
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = font;
    if ('letterSpacing' in probe) probe.letterSpacing = spacing;
    const tw = Math.ceil(probe.measureText(text).width);
    const pad = Math.ceil(fs * 0.6);
    const scale = Math.min(4, pr * 2);
    const cx = r.left + r.width / 2;
    const inside = front - Math.min(bevel, 8);
    S.labels = [];
    S.arrow = null;

    const spanRect = (span || el).getBoundingClientRect();
    const tx = spanRect.left + spanRect.width / 2 - cx;
    const plane = (pw) => new THREE.PlaneGeometry(pw + pad * 2, h + pad * 2);

    if (theme.labelShadow) {
      const sh = new THREE.Mesh(plane(tw), labelMaterial(paintLabel(text, font, spacing, tw, h, pad, scale, fs * 0.22), '#1a2100', '#1a2100', theme.labelShadow));
      sh.position.set(tx, -1.2, inside - 5);
      sh.renderOrder = 1;
      group.add(sh);
    }
    const label = new THREE.Mesh(plane(tw), labelMaterial(paintLabel(text, font, spacing, tw, h, pad, scale, 0), theme.ink, theme.inkHover));
    label.position.set(tx, 0, inside);
    label.renderOrder = 2;
    group.add(label);
    S.labels.push(label);

    const svg = el.querySelector('svg');
    if (svg) {
      const sr = svg.getBoundingClientRect();
      const aw = sr.width || 16;
      const arrow = new THREE.Mesh(plane(aw), labelMaterial(paintArrow(aw, h, pad, scale, 1.6), theme.ink, theme.inkHover));
      const ax = sr.left + sr.width / 2 - cx;
      arrow.position.set(ax, 0, inside);
      arrow.userData.baseX = ax;
      arrow.renderOrder = 2;
      group.add(arrow);
      S.labels.push(arrow);
      S.arrow = arrow;
    }
    return true;
  }

  const spring = (v, t, rate, dt) => v + (t - v) * (1 - Math.exp(-dt * rate));
  let last = 0;

  function frame(now) {
    const dt = Math.min((now - (last || now)) / 1000, 0.05) || 0.016;
    last = now;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;

    S.hover = spring(S.hover, S.hoverT, 9, dt);
    S.press = spring(S.press, S.pressT, 20, dt);
    const px = THREE.MathUtils.clamp((pointer.x - cx) / (r.width / 2), -1, 1);
    const py = THREE.MathUtils.clamp((cy - pointer.y) / (r.height / 2), -1, 1);
    S.ry = spring(S.ry, reduceMotion ? 0 : S.hoverT * px * 0.26, 7, dt);
    S.rx = spring(S.rx, reduceMotion ? 0 : -S.hoverT * py * 0.42, 7, dt);

    const lift = S.hover * 14 - S.press * 9;
    group.position.set(0, 0, lift);
    group.rotation.set(S.rx, S.ry, 0);
    group.scale.setScalar(1 + S.hover * 0.035 - S.press * 0.035);

    glassMat.uniforms.uHover.value = S.hover;
    glassMat.uniforms.uPointerPos.value.set(pointer.x - cx, cy - pointer.y, 90);
    glowMat.uniforms.uLift.value = Math.max(lift, 0);
    glowMat.uniforms.uAmount.value = theme.glowRest + S.hover * (el.dataset.glassBtn === 'clear' ? 0.14 : 0.2);
    for (const m of S.labels) m.material.uniforms.uHover.value = S.hover;
    if (S.arrow) S.arrow.position.x = S.arrow.userData.baseX + S.hover * 5 - S.press * 2;

    renderer.render(scene, cam);

    const settled = !S.hoverT && !S.pressT && S.hover < 0.003 && S.press < 0.003 && Math.abs(S.rx) < 0.002 && Math.abs(S.ry) < 0.002;
    if (settled) { S.running = false; last = 0; return; }
    requestAnimationFrame(frame);
  }

  function kick() {
    if (!S.w) return;
    if (!S.running) { S.running = true; requestAnimationFrame(frame); }
  }

  function rebuild() {
    if (build() && !S.running) { S.running = true; requestAnimationFrame(frame); }
  }

  rebuild();
  new ResizeObserver(() => { if (Math.abs(el.offsetWidth - S.w) > 1 || Math.abs(el.offsetHeight - S.h) > 1) rebuild(); }).observe(el);
  document.fonts?.ready.then(rebuild); // text metrics change once the webfont is in
  addEventListener('load', rebuild);   // the arrow <svg> is cloned in by main.js, so measure again once everything is in
}

const init = () => document.querySelectorAll('[data-glass-btn]').forEach(makeButton);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
