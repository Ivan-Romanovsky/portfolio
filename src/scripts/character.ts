/**
 * Head that follows the cursor.
 * Frames: public/character/g_CC_RR.webp — a cols × rows grid of head poses generated with LivePortrait
 * (tools/gaze), cropped to the moving region. The base image (shoulders, backdrop) is a plain <img>,
 * the canvas on top only redraws the head.
 *
 * Feel: always one crisp frame (blending two generated frames looks soft), a critically damped spring
 * walks the head through neighbouring ~1° frames, following is deliberately approximate.
 */

type Grid = { cols: number; rows: number; w: number; h: number; box: number[] };

const STIFFNESS = 220 / 1.5; // tuned by eye in preview/gaze.html (softness 1.5)
const IDLE_MS = 3000;

export async function mountCharacter(root: HTMLElement) {
  const src = root.dataset.src!;
  const canvas = root.querySelector<HTMLCanvasElement>('canvas.head')!;
  const cx = canvas.getContext('2d')!;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;

  const G: Grid = await (await fetch(src + 'grid.json')).json();
  const { cols, rows } = G;
  const mc = (cols - 1) / 2, mr = (rows - 1) / 2;
  const pad = (n: number) => String(n).padStart(2, '0');
  const frames: (ImageBitmap | HTMLImageElement | undefined)[] = new Array(cols * rows);

  const load = (url: string) => new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = rej; i.src = url;
  });
  const bitmap = async (url: string) => {
    const img = await load(url);
    return 'createImageBitmap' in window ? createImageBitmap(img) : img;
  };

  // load center-out, so the head can start moving long before the edges arrive
  const ring = (k: number) => Math.max(Math.abs((k % cols) - mc) / mc, Math.abs(Math.floor(k / cols) - mr) / mr);
  const order = Array.from({ length: cols * rows }, (_, k) => k).sort((a, b) => ring(a) - ring(b));
  let reach = 0; // how far from the center (0..1) frames are already loaded in every direction
  let blink: ImageBitmap | HTMLImageElement | undefined;

  if (reduce) return; // the base image alone is the reduced-motion version

  const start = () => {
    (async () => {
      const queue = order.slice();
      const worker = async () => {
        while (queue.length) {
          const k = queue.shift()!;
          frames[k] = await bitmap(`${src}g_${pad(k % cols)}_${pad(Math.floor(k / cols))}.webp`).catch(() => undefined);
        }
      };
      // track reach in order so a slow request never lets the head wander into a hole
      const tick = setInterval(() => {
        let i = 0;
        while (i < order.length && frames[order[i]]) i++;
        reach = i >= order.length ? 1 : ring(order[i]) - 1e-6;
        if (reach >= 1) clearInterval(tick);
      }, 120);
      await Promise.all(Array.from({ length: 6 }, worker));
      blink = await bitmap(`${src}blink.webp`).catch(() => undefined);
    })();
    requestAnimationFrame(frame);
  };
  // the first screen comes first: frames start after the page has loaded
  if (document.readyState === 'complete') start(); else addEventListener('load', start, { once: true });

  // ---- input ----
  const P = { x: innerWidth / 2, y: innerHeight * 0.4 };
  let last = -1e9;
  let lookUntil = 0; // touch: look at the tap point for a moment
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    P.x = e.clientX; P.y = e.clientY; last = performance.now();
  }, { passive: true });
  addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    P.x = e.clientX; P.y = e.clientY; last = performance.now(); lookUntil = last + 1600;
  }, { passive: true });

  // phones: scrolling makes him glance down at the content, then he settles
  let scrollKick = 0, lastY = scrollY;
  addEventListener('scroll', () => {
    const dy = scrollY - lastY; lastY = scrollY;
    if (coarse) scrollKick = Math.max(-1, Math.min(1, scrollKick + dy / 400));
  }, { passive: true });

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(root);

  // ---- motion ----
  const S = { u: 0, v: 0, vu: 0, vv: 0 };
  const w = Math.sqrt(STIFFNESS);
  const spring = (x: number, vx: number, target: number, dt: number): [number, number] => {
    vx += (w * w * (target - x) - 2 * w * vx) * dt;
    return [x + vx * dt, vx];
  };
  const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
  // dead zone around the face, soft saturation: following is approximate on purpose
  const ease = (d: number, dz: number, amp: number) => {
    const m = Math.max(0, Math.abs(d) - dz) / (1 - dz);
    return Math.sign(d) * Math.tanh(m * 1.6) * amp;
  };

  let idleT = { u: 0, v: 0 }, nextIdle = 0, nextBlink = performance.now() + 2500, blinkStart = -1;
  let prev = performance.now(), drawn: number | 'blink' | -1 = -1;

  function frame(now: number) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    if (!visible || reach <= 0) return;

    const r = canvas.getBoundingClientRect();
    const fx = r.left + r.width / 2, fy = r.top + r.height * 0.45;
    let tu: number, tv: number;
    const active = coarse ? now < lookUntil : now - last < IDLE_MS;
    if (active) {
      tu = ease(clamp((P.x - fx) / (innerWidth * 0.5), -1, 1), 0.06, 1);
      tv = ease(clamp((P.y - fy) / (innerHeight * 0.5), -1, 1), 0.1, 0.9);
    } else {
      if (now > nextIdle) {
        idleT = { u: (Math.random() * 2 - 1) * 0.6, v: (Math.random() * 2 - 1) * 0.35 };
        nextIdle = now + 1800 + Math.random() * 2400;
      }
      tu = idleT.u; tv = idleT.v;
    }
    if (coarse) { tv = clamp(tv + scrollKick * 0.8, -1, 1); scrollKick *= 0.92; }
    tu = clamp(tu, -reach, reach); tv = clamp(tv, -reach, reach);

    [S.u, S.vu] = spring(S.u, S.vu, tu, dt);
    [S.v, S.vv] = spring(S.v, S.vv, tv, dt);

    const c = Math.round((clamp(S.u, -1, 1) + 1) / 2 * (cols - 1));
    const rr = Math.round((clamp(S.v, -1, 1) + 1) / 2 * (rows - 1));
    const centered = Math.abs(c - mc) <= 2 && Math.abs(rr - mr) <= 1;

    // blink: hard swap to the closed-eyes frame for ~120 ms, only when looking roughly straight
    if (now > nextBlink) { if (centered && blink) blinkStart = now; nextBlink = now + 2500 + Math.random() * 4000; }
    const blinking = blinkStart > 0 && now - blinkStart < 120 && centered;
    if (blinkStart > 0 && now - blinkStart >= 120) blinkStart = -1;

    // a frame that has not arrived yet falls back to the straight pose, so a blink never sticks
    const center = Math.round(mr) * cols + Math.round(mc);
    const k = frames[rr * cols + c] ? rr * cols + c : center;
    const key = blinking ? 'blink' : k;
    const img = blinking ? blink : frames[k];
    if (key !== drawn && img) { drawn = key; cx.drawImage(img, 0, 0); }
  }
}
