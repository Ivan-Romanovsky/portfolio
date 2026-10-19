import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const EASE = 'expo.out';

gsap.registerPlugin(ScrollTrigger);

if (!reduce) {
  // smooth scroll, Bram-like weight
  const lenis = new Lenis({ lerp: 0.085, smoothWheel: true, anchors: { offset: -16 } });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  // masked lines: the hero plays on load, everything else when it enters the viewport
  document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
    const lines = el.querySelectorAll('.line > span');
    const inHero = !!el.closest('[data-hero]');
    gsap.to(lines, {
      yPercent: 0, y: 0, duration: 1.1, ease: EASE, stagger: 0.08, delay: inHero ? 0.25 : 0,
      startAt: { yPercent: 105 },
      scrollTrigger: inHero ? undefined : { trigger: el, start: 'top 88%', once: true },
    });
  });

  // statement: words go from pale to ink while scrolling, then the mint marker draws in
  document.querySelectorAll<HTMLElement>('[data-words]').forEach((p) => {
    const tl = gsap.timeline({ scrollTrigger: { trigger: p, start: 'top 80%', end: 'bottom 55%', scrub: true } });
    tl.fromTo(p.querySelectorAll('.w'), { color: '#cdcbc3' }, { color: '#161614', stagger: 0.05, ease: 'none' });
    const mark = p.querySelector('.mark');
    if (mark) tl.fromTo(mark, { backgroundSize: '0% .4em' }, { backgroundSize: '100% .4em', ease: 'none', duration: 0.5 }, '>-0.3');
  });

  // covers drift inside their frames: depth without moving the layout
  document.querySelectorAll<HTMLElement>('[data-parallax]').forEach((el) => {
    gsap.fromTo(el, { yPercent: -4 }, { yPercent: 4, ease: 'none', scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } });
  });

  // magnetic round CTA
  if (fine) document.querySelectorAll<HTMLElement>('[data-magnet]').forEach((el) => {
    const xTo = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3.out' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3.out' });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - r.left - r.width / 2) * 0.35);
      yTo((e.clientY - r.top - r.height / 2) * 0.35);
    });
    el.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
  });
}

// mint "View" bubble that trails the cursor over cases
const bub = document.querySelector<HTMLElement>('.cbub');
if (bub && fine) {
  const P = { x: 0, y: 0 }, B = { x: 0, y: 0 };
  let on = false, s = 0;
  const hit = (x: number, y: number) => !!document.elementFromPoint(x, y)?.closest('[data-cbub]');
  addEventListener('pointermove', (e) => { P.x = e.clientX; P.y = e.clientY; on = hit(P.x, P.y); }, { passive: true });
  ScrollTrigger.addEventListener('scrollEnd', () => { on = hit(P.x, P.y); });
  gsap.ticker.add(() => {
    B.x += (P.x - B.x) * 0.2; B.y += (P.y - B.y) * 0.2;
    s += ((on ? 1 : 0) - s) * (reduce ? 1 : 0.18);
    bub.style.transform = `translate(${B.x}px,${B.y}px) scale(${s.toFixed(3)})`;
  });
}
