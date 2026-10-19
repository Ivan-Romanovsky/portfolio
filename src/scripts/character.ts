/**
 * Character that turns its head toward the cursor: the Framer / "mascot follows the cursor" approach
 * (cursor drives the time of a head-turn video), with the seek latency taken out.
 *
 * public/character (tools/gaze/clip.py + Real-ESRGAN + encode.swift, from assets/character/source/look8.mp4):
 *   base.webp   the whole room, neutral pose, enhanced: a plain <img>
 *   head.mp4    the head square, original frames enhanced with Real-ESRGAN x4plus
 *   clip.json   head box in scene pixels, fps, 8 segments [first, last]: neutral -> extreme
 *
 * On load the video is stepped through once and every frame is kept as an ImageBitmap, sized to the
 * pixels the head really occupies on this screen. After that nothing seeks: each animation frame
 * draws from memory. The position along a segment is fractional; two neighbouring video frames
 * (1/24 s apart) are cross-faded by that fraction while moving, so motion is continuous, and at rest
 * it settles on one crisp frame. Every segment starts with the same neutral frame, so changing
 * direction (always through the center) is seamless.
 */

type Clip = { w: number; h: number; box: [number, number, number, number]; fps: number; frames: number; seg: Record<string, [number, number]>; src?: number[] };

const SECTORS = ['right', 'downright', 'down', 'downleft', 'left', 'upleft', 'up', 'upright'];
const STIFF = 170;        // spring along a segment: higher = snappier
const DEAD = 0.05;        // no reaction this close to the face (fraction of the screen)

export async function mountCharacter(root: HTMLElement) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!('createImageBitmap' in window)) return;
  const src = root.dataset.src!;
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
  const cx = canvas.getContext('2d')!;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const C: Clip = await (await fetch(src + 'clip.json')).json();

  const frames: (ImageBitmap | undefined)[] = new Array(C.frames);
  let decodedUpTo = -1;

  const start = async () => {
    // decode at the size the head is shown at on this screen (capped by the source)
    const css = canvas.getBoundingClientRect().width;
    const lowMem = ((navigator as any).deviceMemory ?? 8) <= 4;
    // 127 decoded frames live in memory: ~1.75x of the CSS size is sharp on retina and keeps it near 300 MB
    const size = Math.round(Math.min(css * Math.min(lowMem ? 1.25 : 1.75, devicePixelRatio || 1), 880));
    canvas.width = canvas.height = Math.max(240, size);

    const blob = await (await fetch(src + 'head.mp4')).blob();
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.src = URL.createObjectURL(blob);
    await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(); });
    const opts: ImageBitmapOptions = { resizeWidth: canvas.width, resizeHeight: canvas.height, resizeQuality: 'high' };
    for (let i = 0; i < C.frames; i++) {
      await new Promise<void>((res) => { v.onseeked = () => res(); v.currentTime = (i + 0.5) / C.fps; });
      frames[i] = await createImageBitmap(v, opts);
      decodedUpTo = i;
      if (i === 0) { draw(0, 0); canvas.classList.add('on'); requestAnimationFrame(frame); }
    }
    URL.revokeObjectURL(v.src);
  };
  if (document.readyState === 'complete') start(); else addEventListener('load', start, { once: true });

  // ---- input ----
  let px = innerWidth / 2, py = innerHeight * 0.4, moved = false, lookUntil = 0;
  addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') { px = e.clientX; py = e.clientY; moved = true; } }, { passive: true });
  addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { px = e.clientX; py = e.clientY; lookUntil = performance.now() + 1800; } }, { passive: true });
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(root);
  let face = { x: 0, y: 0 };
  const measure = () => { const r = canvas.getBoundingClientRect(); face = { x: r.left + r.width / 2, y: r.top + r.height * 0.45 }; };
  measure();
  addEventListener('resize', measure, { passive: true });
  addEventListener('scroll', measure, { passive: true });

  // ---- drawing: frame index + fraction toward the next one ----
  let drawnKey = '';
  function draw(i: number, frac: number) {
    const key = `${i}:${frac.toFixed(2)}`;
    if (key === drawnKey || !frames[i]) return;
    drawnKey = key;
    cx.globalAlpha = 1;
    cx.drawImage(frames[i]!, 0, 0, canvas.width, canvas.height);
    const next = frames[i + 1];
    // blend only frames that follow each other in the source video (1/24 s apart); across a skipped
    // blink or the jump at a segment start, blending would double the eyes, so it snaps instead
    const adjacent = !C.src || C.src[i + 1] - C.src[i] === 1;
    if (frac > 0.01 && next && adjacent) { cx.globalAlpha = frac; cx.drawImage(next, 0, 0, canvas.width, canvas.height); cx.globalAlpha = 1; }
  }

  // ---- motion: one direction at a time, change of direction through the neutral frame ----
  let dir = 'left', p = 0, vp = 0, prev = performance.now();
  let idle = { u: 0, v: 0 }, nextIdle = 0;
  const w = Math.sqrt(STIFF);
  const debug: number[][] | null = location.search.includes('gaze-debug') ? ((window as any).__gaze = []) : null;

  const target = (now: number) => {
    const idleNow = coarse ? now > lookUntil : !moved;
    if (idleNow) {
      if (now > nextIdle) {
        idle = Math.random() < 0.35 ? { u: 0, v: 0 } : { u: (Math.random() * 2 - 1) * 0.8, v: (Math.random() * 2 - 1) * 0.6 };
        nextIdle = now + 2200 + Math.random() * 2600;
      }
      return idle;
    }
    return { u: (px - face.x) / innerWidth, v: (py - face.y) / innerHeight };
  };

  function frame(now: number) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    if (!visible) return;
    const t = target(now);
    const mag = Math.hypot(t.u, t.v * 1.2);
    const want = SECTORS[(Math.round(Math.atan2(t.v, t.u) / (Math.PI / 4)) + 8) % 8];
    let pT = mag < DEAD ? 0 : Math.min(1, (mag - DEAD) / 0.38);
    if (want !== dir) pT = 0;                                    // back to the neutral frame first
    vp += (w * w * (pT - p) - 2 * w * vp) * dt;
    p = Math.max(0, Math.min(1, p + vp * dt));
    if (want !== dir && p < 0.02 && C.seg[want][1] <= decodedUpTo) { dir = want; p = 0; vp = 0; }

    const [a, b] = C.seg[dir];
    let pos = a + p * (b - a);
    pos = Math.min(pos, decodedUpTo);
    let i = Math.floor(pos), frac = pos - i;
    if (Math.abs(vp) < 0.02) { i = Math.round(pos); frac = 0; }   // at rest: one crisp frame
    if (i >= b) { i = b; frac = 0; }
    draw(i, frac);
    if (debug) debug.push([now, pos, i + frac]);
  }
}
