import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/*
 * Black chrome cubes floating in zero gravity — background of the #home hero.
 * Move the mouse to shove them, or grab one and throw it.
 * Based on a CodePen by Yugta Bista; adapted to sit behind the existing slider content.
 */
(() => {
  const home = document.getElementById('home');
  const cv = home && home.querySelector('.hero-cubes-gl');
  if (!home || !cv) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = home.clientWidth < 700;
  /* tweak here */
  const CFG = { count: small ? 15 : 26, fov: 32, drag: 0.35, spin: 0.25, bounce: 0.86, shoveR: 2.4, shove: 55, maxV: 16 };

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { console.warn('[hero-cubes] WebGL unavailable', e); return home.classList.add('nogl'); }

  renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  /* ---------- studio ---------- */
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(CFG.fov, 1, 0.1, 100);

  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-6, 9, 12); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 50 });
  scene.add(sun);

  const wall = new THREE.Mesh(new THREE.PlaneGeometry(90, 55), new THREE.ShadowMaterial({ opacity: 0.16 }));
  wall.position.z = -5; wall.receiveShadow = true; scene.add(wall);

  /* ---------- cubes ---------- */
  const rnd = (a, b) => a + Math.random() * (b - a);
  const geo = new RoundedBoxGeometry(1, 1, 1, 5, 0.09);
  const mat = new THREE.MeshPhysicalMaterial({ color: 0x080808, metalness: 1, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.15 });
  const cubes = Array.from({ length: CFG.count }, (_, i) => {
    const size = rnd(0.8, 1.9) * (small ? 0.62 : 1), mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.scale.setScalar(0);
    mesh.quaternion.setFromEuler(new THREE.Euler(rnd(0, 6.28), rnd(0, 6.28), rnd(0, 6.28)));
    scene.add(mesh);
    return { mesh, size, r: size * 0.66, m: size ** 3, ph: rnd(0, 6.28), delay: i * 0.05, hs: 1, held: false,
      v: new THREE.Vector3(), w: new THREE.Vector3(rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(-0.5, 0.5)) };
  });
  const meshes = cubes.map((c) => c.mesh);

  /* ---------- helpers ---------- */
  const [tmp, away, rel, vt, spin, ax, tg, off, d] = Array.from({ length: 9 }, () => new THREE.Vector3());
  const dq = new THREE.Quaternion();
  const lim = (v, m) => { const l = v.length(); if (l > m) v.multiplyScalar(m / l); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2; // easeOutBack
  const half = (c) => Math.tan((CFG.fov * Math.PI) / 360) * (camera.position.z - c.mesh.position.z);

  /* keep cubes in the visible frame, bouncing off its edges */
  const keepIn = (c) => {
    const p = c.mesh.position, h = half(c), bx = h * camera.aspect - c.r, by = h - c.r, e = CFG.bounce;
    if (p.x > bx) { p.x = bx; c.v.x = -Math.abs(c.v.x) * e; } else if (p.x < -bx) { p.x = -bx; c.v.x = Math.abs(c.v.x) * e; }
    if (p.y > by) { p.y = by; c.v.y = -Math.abs(c.v.y) * e; } else if (p.y < -by) { p.y = -by; c.v.y = Math.abs(c.v.y) * e; }
    if (p.z > 2.5) { p.z = 2.5; c.v.z = -Math.abs(c.v.z) * e; } else if (p.z < -3) { p.z = -3; c.v.z = Math.abs(c.v.z) * e; }
  };

  /* sphere-ish collisions with impulse, spin transfer; a held cube is kinematic */
  const collide = () => {
    for (let i = 0; i < cubes.length; i++) for (let j = i + 1; j < cubes.length; j++) {
      const a = cubes[i], b = cubes[j];
      d.subVectors(b.mesh.position, a.mesh.position);
      const dist = d.length(), min = a.r + b.r;
      if (dist >= min || dist < 1e-5) continue;
      d.divideScalar(dist);
      const ia = a.held ? 0 : 1 / a.m, ib = b.held ? 0 : 1 / b.m, is = ia + ib;
      if (!is) continue;
      const over = min - dist;
      a.mesh.position.addScaledVector(d, (-over * ia) / is); b.mesh.position.addScaledVector(d, (over * ib) / is);
      rel.subVectors(a.v, b.v);
      const rn = rel.dot(d);
      if (rn > 0) {
        const J = ((1 + CFG.bounce) * rn) / is;
        a.v.addScaledVector(d, -J * ia); b.v.addScaledVector(d, J * ib);
        vt.copy(rel).addScaledVector(d, -rn); spin.crossVectors(d, vt).multiplyScalar(-0.35);
        if (!a.held) a.w.addScaledVector(spin, 1 / a.size);
        if (!b.held) b.w.addScaledVector(spin, 1 / b.size);
      }
    }
  };

  /* ---------- pointer: shove, grab, fling ----------
   * Listeners live on the hero container (not the canvas) because the slider layers sit on top.
   * Mouse / pen only, so touch scrolling on phones is never blocked. */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const P = new THREE.Vector3(), prevP = new THREE.Vector3(), pv = new THREE.Vector3();
  let inside = false, held = null, havePrev = false;

  const aim = (e) => {
    const r = cv.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  const pick = () => ray.intersectObjects(meshes)[0];
  const isMouse = (e) => e.pointerType !== 'touch';

  home.addEventListener('pointerenter', (e) => isMouse(e) && (inside = true));
  home.addEventListener('pointerleave', (e) => { if (isMouse(e) && !held) inside = false; });
  home.addEventListener('pointermove', (e) => { if (isMouse(e)) { inside = true; aim(e); } });
  home.addEventListener('pointerdown', (e) => {
    if (!isMouse(e)) return;
    aim(e); inside = true;
    const h = pick();
    if (!h) return;
    home.setPointerCapture(e.pointerId);
    held = cubes.find((c) => c.mesh === h.object); held.held = true; held.v.set(0, 0, 0);
    plane.constant = -h.point.z;
    ray.ray.intersectPlane(plane, P); off.copy(held.mesh.position).sub(P);
    havePrev = false;
  });
  const release = (fling) => {
    if (!held) return;
    if (fling) {
      held.v.set(pv.x, pv.y, 0); lim(held.v, CFG.maxV);
      held.w.set(pv.y * 0.6, -pv.x * 0.6, rnd(-1, 1));
    }
    held.held = false; held = null; plane.constant = 0; havePrev = false;
  };
  home.addEventListener('pointerup', (e) => isMouse(e) && release(true));
  home.addEventListener('pointercancel', () => release(false));

  /* ---------- physics ---------- */
  let t = 0;
  const drift = reduced ? 0.4 : 1;
  const phys = (h) => {
    const act = inside && !held;
    for (const c of cubes) {
      const p = c.mesh.position;
      if (c.held) { tg.copy(P).add(off).sub(p).multiplyScalar(18); lim(tg, 28); c.v.copy(tg); }
      else {
        /* weightless drift */
        c.v.x += Math.sin(t * 0.3 + c.ph) * 0.22 * drift * h;
        c.v.y += Math.cos(t * 0.27 + c.ph * 1.3) * 0.22 * drift * h;
        c.v.z += Math.sin(t * 0.21 + c.ph * 0.7) * 0.12 * drift * h;
        if (act) { /* the pointer ray shoves anything near it */
          ray.ray.closestPointToPoint(p, tmp); away.subVectors(p, tmp);
          const dist = away.length(), R = CFG.shoveR + c.r;
          if (dist < R) {
            const f = (1 - dist / R) ** 2;
            away.z *= 0.3; away.normalize();
            c.v.addScaledVector(away, (CFG.shove * f * h) / Math.max(0.7, c.size));
            c.v.x += (pv.x - c.v.x) * f * 0.05; c.v.y += (pv.y - c.v.y) * f * 0.05;
            c.w.x += away.y * f * 8 * h; c.w.y -= away.x * f * 8 * h;
          }
        }
        c.v.multiplyScalar(Math.exp(-h * CFG.drag));
        c.w.x += Math.sin(t * 0.4 + c.ph) * 0.1 * drift * h; c.w.y += Math.cos(t * 0.33 + c.ph) * 0.1 * drift * h;
        c.w.multiplyScalar(Math.exp(-h * CFG.spin)); lim(c.w, 12);
      }
      lim(c.v, CFG.maxV);
      p.addScaledVector(c.v, h);
      const wl = c.w.length();
      if (wl > 1e-4) { dq.setFromAxisAngle(ax.copy(c.w).divideScalar(wl), wl * h); c.mesh.quaternion.premultiply(dq); }
      keepIn(c);
    }
    collide();
  };

  /* ---------- sizing + initial scatter ---------- */
  const resize = () => {
    const w = home.clientWidth, h = home.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.z = clamp(5.5 / (Math.tan((CFG.fov * Math.PI) / 360) * camera.aspect), 16, 30);
    camera.updateProjectionMatrix();
  };
  resize();
  new ResizeObserver(resize).observe(home);
  cubes.forEach((c) => { const h = half(c); c.mesh.position.set(rnd(-1, 1) * h * camera.aspect * 0.9, rnd(-1, 1) * h * 0.9, rnd(-2.5, 1.5)); });
  for (let i = 0; i < 80; i++) { collide(); cubes.forEach(keepIn); }

  /* ---------- loop (only runs while the hero is on screen) ---------- */
  let last = performance.now(), raf = 0, onScreen = true;
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.033, (now - last) / 1000); last = now; t += dt;

    /* pointer velocity in world units */
    if (inside && ray.ray.intersectPlane(plane, P)) {
      if (havePrev) pv.lerp(tmp.subVectors(P, prevP).divideScalar(Math.max(dt, 1e-3)), 0.35);
      prevP.copy(P); havePrev = true;
    } else pv.multiplyScalar(0.9);

    phys(dt / 2); phys(dt / 2);

    for (const c of cubes) {
      const pop = reduced ? 1 : ease(clamp((t - c.delay) / 0.9, 0, 1));
      c.hs += ((c.held ? 1.07 : 1) - c.hs) * 0.2;
      c.mesh.scale.setScalar(c.size * pop * c.hs);
    }
    renderer.render(scene, camera);
  };
  const sync = () => {
    cancelAnimationFrame(raf);
    if (onScreen && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
  };
  new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; sync(); }).observe(home);
  document.addEventListener('visibilitychange', sync);
  cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); onScreen = false; home.classList.add('nogl'); });
  sync();
})();
