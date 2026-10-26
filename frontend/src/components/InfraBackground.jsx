import { useEffect, useRef } from 'react';

// Infrastructure-inventory backdrop: servers, switches and databases drifting slowly, linked to their
// neighbours, with data packets travelling along the links and status LEDs blinking.
const KINDS = ['server', 'server', 'switch', 'db'];

function makeNodes(w, h) {
  const n = Math.max(14, Math.min(40, Math.round((w * h) / 42000)));
  return Array.from({ length: n }, (_, i) => ({
    x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
    kind: KINDS[i % KINDS.length], phase: Math.random() * Math.PI * 2, blink: 0.6 + Math.random() * 1.4,
  }));
}

function drawNode(ctx, n, t, color) {
  const s = n.kind === 'switch' ? 11 : 13;
  ctx.save(); ctx.translate(n.x, n.y);
  ctx.fillStyle = 'rgba(10, 28, 31, 0.85)'; ctx.strokeStyle = color; ctx.lineWidth = 1.2;
  if (n.kind === 'db') {                                   // cylinder
    ctx.beginPath(); ctx.ellipse(0, -s * 0.7, s * 0.8, s * 0.35, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-s * 0.8, -s * 0.7); ctx.lineTo(-s * 0.8, s * 0.7); ctx.ellipse(0, s * 0.7, s * 0.8, s * 0.35, 0, Math.PI, 0, true); ctx.lineTo(s * 0.8, -s * 0.7); ctx.fill(); ctx.stroke();
  } else {                                                 // rack unit / switch
    ctx.beginPath(); ctx.roundRect(-s, -s * 0.7, s * 2, s * 1.4, 3); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    if (n.kind === 'server') { ctx.moveTo(-s * 0.6, -s * 0.2); ctx.lineTo(s * 0.2, -s * 0.2); ctx.moveTo(-s * 0.6, s * 0.25); ctx.lineTo(s * 0.2, s * 0.25); }
    else for (let i = -2; i <= 2; i++) { ctx.moveTo(i * s * 0.4, s * 0.1); ctx.lineTo(i * s * 0.4, s * 0.4); }
    ctx.stroke();
  }
  const on = Math.sin(t * n.blink + n.phase) > -0.2;       // status LED
  ctx.fillStyle = on ? '#4ade80' : 'rgba(74, 222, 128, 0.18)';
  ctx.beginPath(); ctx.arc(n.kind === 'db' ? 0 : s * 0.62, n.kind === 'db' ? -s * 0.7 : -s * 0.05, 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export default function InfraBackground({ color = '#3fb7c4' }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; const ctx = canvas.getContext('2d');
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0; let h = 0; let nodes = []; let packets = []; let raf = 0; let last = 0;
    const LINK = 200;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1; w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); nodes = makeNodes(w, h); packets = [];
    };
    const links = () => {
      const out = [];
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
        if (d < LINK) out.push([nodes[i], nodes[j], d]);
      }
      return out;
    };

    const frame = (ms) => {
      const t = ms / 1000; const dt = Math.min(0.05, (ms - last) / 1000 || 0.016); last = ms;
      ctx.clearRect(0, 0, w, h);
      if (!still) for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < -20 || n.x > w + 20) n.vx *= -1;
        if (n.y < -20 || n.y > h + 20) n.vy *= -1;
      }
      const ls = links();
      ctx.lineWidth = 1;
      for (const [a, b, d] of ls) { ctx.strokeStyle = `rgba(63, 183, 196, ${0.28 * (1 - d / LINK)})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      // data packets
      if (!still && ls.length && packets.length < 28 && Math.random() < 0.08) { const [a, b] = ls[Math.floor(Math.random() * ls.length)]; packets.push({ a, b, p: 0, speed: 0.25 + Math.random() * 0.35 }); }
      packets = packets.filter((k) => k.p < 1);
      for (const k of packets) {
        k.p += k.speed * dt;
        const x = k.a.x + (k.b.x - k.a.x) * k.p; const y = k.a.y + (k.b.y - k.a.y) * k.p;
        ctx.fillStyle = '#9be7ef'; ctx.shadowColor = '#3fb7c4'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      }
      for (const n of nodes) drawNode(ctx, n, t, color);
      if (!still) raf = requestAnimationFrame(frame);
    };

    resize(); raf = requestAnimationFrame(frame);
    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [color]);
  return <canvas ref={ref} className="infra-bg" aria-hidden="true" />;
}
