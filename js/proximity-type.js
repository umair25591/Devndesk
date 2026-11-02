/*
 * Proximity type: each letter of .pt-stage swells (weight, width, colour, glow) as the pointer gets close.
 * Sets --k (0..1 closeness) on every .pt-l; all the visuals live in css/proximity-type.css.
 */
(() => {
  const stage = document.querySelector('.pt-stage');
  if (!stage) return;

  const hero = stage.closest('.pt-hero') || stage;                    // gets --sx/--sy and .is-hot
  const glowBox = hero.querySelector('.mi-invert-fix') || hero;       // the layer the glow is drawn on
  const letters = [...stage.querySelectorAll('.pt-l')];
  let px = 0, py = 0, raf = 0;

  const update = () => {
    raf = 0;
    const R = 0.26 * Math.min(innerWidth, innerHeight); // 26vmin falloff radius
    for (const l of letters) {
      const r = l.getBoundingClientRect();
      const d = Math.hypot(px - (r.left + r.width / 2), py - (r.top + r.height / 2));
      l.style.setProperty('--k', Math.max(0, Math.min(1, 1 - d / R)).toFixed(3));
    }
    const s = glowBox.getBoundingClientRect();
    hero.style.setProperty('--sx', px - s.left + 'px');
    hero.style.setProperty('--sy', py - s.top + 'px');
  };

  const track = (e) => {
    px = e.clientX; py = e.clientY;
    stage.classList.add('is-hot');
    hero.classList.add('is-hot');
    if (!raf) raf = requestAnimationFrame(update);
  };

  const release = () => {
    cancelAnimationFrame(raf); raf = 0;
    stage.classList.remove('is-hot');
    hero.classList.remove('is-hot');
    for (const l of letters) l.style.removeProperty('--k'); // falls back to 0 -> slow settle
  };

  stage.addEventListener('pointerenter', track);
  stage.addEventListener('pointermove', track);
  stage.addEventListener('pointerleave', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') release(); }); // touch: let go = settle
})();
