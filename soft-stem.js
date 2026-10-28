(() => {
  const canvas = document.getElementById('soft-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const hint = document.getElementById('soft-hint');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const N = 9;
  const BREAK_N = 10;
  const FG = '#ffffff';
  const BG = '#0d0f14';
  const INK = 'rgba(13, 20, 32, 0.85)';
  const CHIP = 'rgba(10, 16, 28, 0.74)';
  const ZONE = '#ffffff';
  const FORCE = '#ffffff';
  const DT = 1 / 120;
  const SPRING = 0.03;
  const DAMPING = 0.3;
  const ITER = 24;
  const FRICTION = 0.92;
  const SIGMA = 0.42;
  const HINT_START = 'Click and drag the strawberry. The sensors light up where you touch it.';

  const sensors = [];
  for (let row = 0; row < 7; row++) {
    const gy = -0.4 + row * 0.22;
    const off = row % 2 ? 0.12 : 0;
    for (let gx = -0.65; gx <= 0.65; gx += 0.25) {
      const x = gx + off;
      if ((x / 0.66) ** 2 + ((gy - 0.28) / 0.68) ** 2 <= 1) sensors.push([x, gy]);
    }
  }

  let W, H, s, L, R, D, rr, rrB, maxReach, anchor;
  let bx, run, bedH, bedTop, groundY, tx, ty, nx, ny;
  let pts, prev;
  const touch = new Array(N + 2).fill(false);
  let attached, dragging, tension, angle, spin, resetAt, grabbedOnce;
  let grabLocal = null;
  let fN = 0;
  let ptr = { x: 0, y: 0 };
  let visible = true, running = false, last = 0, acc = 0;

  function resize() {
    const w = Math.max(280, Math.round(canvas.getBoundingClientRect().width));
    if (W === w) return;
    W = w;
    s = Math.min(1, W / 760);
    H = Math.max(480, Math.round(820 * s));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.height = H + 'px';
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    L = 36 * s;
    R = 60 * s;
    D = 0.95 * R;
    rr = 7 * s;
    rrB = 0.72 * R;
    maxReach = N * L + D;
    bedH = 260 * s;
    run = 260 * s;
    groundY = H - 40 * s;
    bedTop = groundY - bedH;
    bx = W * 0.3;
    const len = Math.hypot(run, bedH);
    tx = run / len;
    ty = bedH / len;
    nx = ty;
    ny = -tx;
    anchor = { x: bx - 80 * s, y: bedTop - 30 * s };
    reset();
  }

  function pathPoint(dist, off) {
    const d0 = bx - anchor.x;
    if (dist <= d0) return { x: anchor.x + dist, y: bedTop - off };
    const u = dist - d0;
    return { x: bx + tx * u + nx * off, y: bedTop + ty * u + ny * off };
  }

  function reset() {
    const hover = reduceMotion ? 0 : 30 * s;
    pts = [{ x: anchor.x, y: anchor.y }];
    for (let i = 1; i <= N; i++) pts.push(pathPoint(i * L, rr + (hover * i) / N));
    pts.push(pathPoint(N * L + D, rrB + hover));
    prev = pts.map((p) => ({ x: p.x, y: p.y }));
    attached = true;
    dragging = false;
    tension = 0;
    angle = Math.atan2(pts[N + 1].y - pts[N].y, pts[N + 1].x - pts[N].x);
    spin = 0;
    resetAt = 0;
    if (hint) hint.textContent = grabbedOnce ? 'Grab it again and pull.' : HINT_START;
  }

  function collide(p, r) {
    let hit = false;
    if (p.y > groundY - r - 0.5) {
      hit = true;
      if (p.y > groundY - r) p.y = groundY - r;
    }
    if (p.x <= bx) {
      if (p.y > bedTop - r - 0.5) {
        hit = true;
        if (p.y > bedTop - r) p.y = bedTop - r;
      }
    } else if (p.x < bx + run) {
      const d = (p.x - bx) * nx + (p.y - bedTop) * ny;
      if (d < r + 0.5) {
        hit = true;
        if (d < r) {
          p.x += nx * (r - d);
          p.y += ny * (r - d);
        }
      }
    }
    return hit;
  }

  function berryToWorld(g) {
    const c = pts[N + 1], f = angle - Math.PI / 2;
    const cs = Math.cos(f), sn = Math.sin(f);
    return { x: c.x + R * (g.x * cs - g.y * sn), y: c.y + R * (g.x * sn + g.y * cs) };
  }

  function worldToBerry(p) {
    const c = pts[N + 1], f = angle - Math.PI / 2;
    const cs = Math.cos(f), sn = Math.sin(f);
    const dx = p.x - c.x, dy = p.y - c.y;
    return { x: (dx * cs + dy * sn) / R, y: (-dx * sn + dy * cs) / R };
  }

  function step() {
    const g = 0.64 * s;
    const end = attached ? N : N - 1;
    for (let i = 0; i <= end; i++) {
      const a = pts[i], b = pts[i + 1];
      const rest = i === N ? D : L;
      const pp = i === 0 ? { x: anchor.x - L, y: anchor.y } : pts[i - 1];
      const dx = a.x - pp.x, dy = a.y - pp.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const avx = i === 0 ? 0 : a.x - prev[i].x;
      const avy = i === 0 ? 0 : a.y - prev[i].y;
      const fx = SPRING * (a.x + (dx / d) * rest - b.x) - DAMPING * (b.x - prev[i + 1].x - avx);
      const fy = SPRING * (a.y + (dy / d) * rest - b.y) - DAMPING * (b.y - prev[i + 1].y - avy);
      prev[i + 1].x -= fx;
      prev[i + 1].y -= fy;
      if (i > 0) {
        prev[i].x += fx;
        prev[i].y += fy;
      }
    }

    for (let i = 1; i < pts.length; i++) {
      const p = pts[i], q = prev[i];
      const vx = (p.x - q.x) * 0.996;
      const vy = (p.y - q.y) * 0.996;
      q.x = p.x;
      q.y = p.y;
      p.x += vx;
      p.y += vy + g;
    }
    if (!attached) {
      angle += spin;
      spin *= 0.98;
    }

    if (dragging && attached && grabLocal) {
      const c = pts[N + 1];
      const gw = berryToWorld(grabLocal);
      c.x += (ptr.x - gw.x) * 0.5;
      c.y += (ptr.y - gw.y) * 0.5;
    }

    touch.fill(false);
    for (let it = 0; it < ITER; it++) {
      pts[0].x = anchor.x;
      pts[0].y = anchor.y;
      for (let i = 0; i <= end; i++) {
        const a = pts[i], b = pts[i + 1];
        const rest = i === N ? D : L;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const diff = (d - rest) / d;
        if (i === 0) {
          b.x -= dx * diff;
          b.y -= dy * diff;
        } else {
          a.x += dx * diff * 0.5;
          a.y += dy * diff * 0.5;
          b.x -= dx * diff * 0.5;
          b.y -= dy * diff * 0.5;
        }
      }
      for (let i = 1; i < pts.length; i++) {
        if (collide(pts[i], i === N + 1 ? rrB : rr)) touch[i] = true;
      }
    }
    for (let i = 1; i < pts.length; i++) {
      if (!touch[i]) continue;
      const p = pts[i], q = prev[i];
      q.x = p.x - (p.x - q.x) * FRICTION;
      q.y = p.y - (p.y - q.y) * FRICTION;
    }
    if (attached) angle = Math.atan2(pts[N + 1].y - pts[N].y, pts[N + 1].x - pts[N].x);
  }

  function detach(t) {
    attached = false;
    dragging = false;
    canvas.style.cursor = 'default';
    const c = pts[N + 1], q = prev[N + 1];
    spin = Math.max(-0.06, Math.min(0.06, (c.x - q.x) * 0.02));
    resetAt = t + 2400;
    if (hint) hint.textContent = 'Released at the abscission zone. Watch the stem recoil.';
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    ctx.lineTo(x + w, y + h - r);
    ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    ctx.lineTo(x + r, y + h);
    ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    ctx.lineTo(x, y + r);
    ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
    ctx.closePath();
  }

  function leafPath(len, w) {
    const M = 22;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let i = 1; i <= M; i++) {
      const t = i / M;
      ctx.lineTo(len * t, -w * Math.sin(Math.PI * Math.pow(t, 0.7)) * (1 - 0.3 * t) * (i % 2 ? 1 : 0.88));
    }
    for (let i = M - 1; i >= 1; i--) {
      const t = i / M;
      ctx.lineTo(len * t, w * Math.sin(Math.PI * Math.pow(t, 0.7)) * (1 - 0.3 * t) * (i % 2 ? 1 : 0.88));
    }
    ctx.closePath();
  }


  function drawLeaf(len, w) {
    leafPath(len, w);
    ctx.fillStyle = BG;
    ctx.fill();
    ctx.strokeStyle = FG;
    ctx.lineWidth = Math.max(1.25, 1.75 * s);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len * 0.95, 0);
    for (let k = 1; k <= 4; k++) {
      const x = len * (0.12 + k * 0.17);
      const hw = w * Math.sin(Math.PI * Math.pow(x / len, 0.75)) * 0.8;
      ctx.moveTo(x, 0);
      ctx.lineTo(x + len * 0.1, -hw);
      ctx.moveTo(x, 0);
      ctx.lineTo(x + len * 0.1, hw);
    }
    ctx.stroke();
  }

  function drawPlant(front) {
    const bxp = anchor.x, byp = anchor.y;
    const Z = 1.7 * s;
    const leaves = front
      ? [
          [-2.95, 4, 70, -0.35],
          [-0.2, 4, 70, 0.4],
          [-1.75, 4, 56, -0.1],
        ]
      : [
          [-2.7, 50, 66, -0.15],
          [-2.3, 82, 72, -0.1],
          [-1.9, 98, 74, 0],
          [-1.55, 104, 72, 0],
          [-1.2, 96, 72, 0.05],
          [-0.8, 78, 68, 0.12],
          [-0.45, 52, 62, 0.15],
        ];
    ctx.lineCap = 'round';
    leaves.forEach(([a, stem, size, droop], idx) => {
      const cs = Math.cos(a), sn = Math.sin(a);
      const ex = bxp + cs * stem * Z, ey = byp + sn * stem * Z;
      ctx.strokeStyle = FG;
      ctx.lineWidth = Math.max(2, 3.6 * s);
      ctx.beginPath();
      ctx.moveTo(bxp, byp);
      ctx.quadraticCurveTo(bxp + cs * stem * 0.45 * Z - sn * 8 * s, byp + sn * stem * 0.55 * Z + cs * 8 * s, ex, ey);
      ctx.stroke();
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(a + droop);
      drawLeaf(size * Z, size * 0.34 * Z);
      ctx.restore();
    });
  }

  function drawChip(lines, fs, x, y, align, color, weight) {
    const lh = fs * 1.3, pad = 6 * Math.max(s, 0.8);
    ctx.font = `${weight || 400} ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    let tw = 0;
    for (const ln of lines) tw = Math.max(tw, ctx.measureText(ln).width);
    const w = tw + pad * 2, h = lines.length * lh + pad;
    const x0 = align === 'right' ? x - w + pad : x - pad;
    roundRectPath(x0, y - h / 2, w, h, 6);
    ctx.fillStyle = CHIP;
    ctx.fill();
    ctx.fillStyle = color || FG;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    lines.forEach((ln, i) => ctx.fillText(ln, x, y + (i - (lines.length - 1) / 2) * lh));
  }

  function drawForceArrow(fs) {
    if (!grabLocal || fN < 0.03) return;
    const G = berryToWorld(grabLocal), P = pts[N];
    let ux = G.x - P.x, uy = G.y - P.y;
    const m = Math.hypot(ux, uy) || 1;
    ux /= m;
    uy /= m;
    const len = (24 + 6 * fN) * s;
    const ex = G.x + ux * len, ey = G.y + uy * len;
    ctx.globalAlpha = Math.min(1, fN / 0.15);
    ctx.lineWidth = Math.max(2, 2.6 * s);
    ctx.strokeStyle = FORCE;
    ctx.beginPath();
    ctx.moveTo(G.x, G.y);
    ctx.lineTo(ex, ey);
    ctx.moveTo(ex - ux * 9 * s + uy * 6 * s, ey - uy * 9 * s - ux * 6 * s);
    ctx.lineTo(ex, ey);
    ctx.lineTo(ex - ux * 9 * s - uy * 6 * s, ey - uy * 9 * s + ux * 6 * s);
    ctx.stroke();
    const side = ux < 0 ? 'right' : 'left';
    drawChip([`${fN.toFixed(2)} N`], fs, ex + (ux < 0 ? -4 : 4) * s, ey + (uy < 0 ? -12 : 12) * s, side, FG, 600);
    ctx.globalAlpha = 1;
  }




  function drawBackdrop(lw) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#12151b';
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.lineCap = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(W, groundY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    for (let x = bx + run + 24 * s; x < W; x += 46 * s) {
      ctx.beginPath();
      for (const [dx, h, lean] of [[-4, 22, -5], [0, 30, 1], [4, 20, 6]]) {
        ctx.moveTo(x + dx * s, groundY);
        ctx.quadraticCurveTo(x + dx * s, groundY - h * 0.6 * s, x + (dx + lean) * s, groundY - h * s);
      }
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(-2, groundY);
    ctx.lineTo(-2, bedTop);
    ctx.lineTo(bx, bedTop);
    ctx.lineTo(bx + run, groundY);
    ctx.closePath();
    ctx.fillStyle = '#17191d';
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = '#8a93a3';
    ctx.stroke();
  }

  function drawAbscission(P, u, t) {
    const pulse = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t / 260);
    ctx.save();
    ctx.translate(P.x, P.y);
    ctx.rotate(u + Math.PI / 2);
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = (4 + 6 * tension + 3 * pulse) * s;
    roundRectPath(-11 * s, -3.5 * s, 22 * s, 7 * s, 3.5 * s);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1.5, 2 * s);
    ctx.strokeStyle = BG;
    ctx.stroke();
    ctx.strokeStyle = ZONE;
    ctx.globalAlpha = 0.6 + 0.4 * pulse;
    ctx.lineWidth = Math.max(1.25, 1.5 * s);
    ctx.setLineDash([3 * s, 3 * s]);
    ctx.beginPath();
    ctx.arc(0, 0, 12 * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawBerry(C, lw) {
    const press = Math.min(1, fN / 0.25) * (0.5 + 0.5 * tension);
    ctx.save();
    ctx.translate(C.x, C.y);
    ctx.rotate(angle - Math.PI / 2);
    ctx.scale(R, R);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = FG;
    ctx.lineWidth = lw / R;

    ctx.beginPath();
    ctx.moveTo(0, -0.6);
    ctx.lineTo(0, -0.95);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -0.6);
    ctx.bezierCurveTo(0.95, -0.9, 1.15, 0.35, 0, 1.05);
    ctx.bezierCurveTo(-1.15, 0.35, -0.95, -0.9, 0, -0.6);
    ctx.fillStyle = BG;
    ctx.fill();
    ctx.stroke();

    for (const [sx, sy] of sensors) {
      let lit = 0;
      if (grabLocal) {
        const d2 = (sx - grabLocal.x) ** 2 + (sy - grabLocal.y) ** 2;
        lit = Math.exp(-d2 / (2 * SIGMA * SIGMA)) * press;
      }
      if (lit > 0.2) {
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 12 * s;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = FG;
      ctx.globalAlpha = 0.28 + 0.72 * lit;
      ctx.beginPath();
      ctx.arc(sx, sy, 0.04 + 0.08 * lit, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    ctx.lineWidth = lw / R;
    const sepals = [
      [-0.5, 0.62], [-2.6, 0.62], [0.2, 0.7], [2.95, 0.7],
      [0.85, 0.72], [2.3, 0.72], [1.57, 0.6],
    ];
    for (const [th, len] of sepals) {
      const w = 0.17;
      ctx.save();
      ctx.translate(0, -0.6);
      ctx.rotate(th);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(len * 0.25, -w * 1.5, len * 0.7, -w * 1.1, len, 0);
      ctx.bezierCurveTo(len * 0.7, w * 1.1, len * 0.25, w * 1.5, 0, 0);
      ctx.fillStyle = BG;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(len * 0.06, 0);
      ctx.lineTo(len * 0.88, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    const lw = Math.max(1.25, 1.75 * s);
    const fs = Math.max(12, Math.round(19 * s));
    const C = pts[N + 1], P = pts[N];

    drawBackdrop(lw);

    drawPlant(false);

    ctx.lineWidth = lw;
    ctx.strokeStyle = FG;
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[i + 1];
      ctx.save();
      ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
      const len = Math.hypot(b.x - a.x, b.y - a.y) - 4 * s, w = 13 * s, r = w / 2, h = len / 2;
      ctx.beginPath();
      ctx.moveTo(-h + r, -r);
      ctx.lineTo(h - r, -r);
      ctx.arc(h - r, 0, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(-h + r, r);
      ctx.arc(-h + r, 0, r, Math.PI / 2, Math.PI * 1.5);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, -r, 0, r);
      g.addColorStop(0, BG);
      g.addColorStop(0.5, BG);
      g.addColorStop(1, BG);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = FG;
    for (let i = 1; i < N; i++) {
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, 1.8 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = FG;
    ctx.beginPath();
    ctx.arc(anchor.x, anchor.y, 6 * s, 0, Math.PI * 2);
    ctx.fill();

    drawPlant(true);

    drawAbscission(P, Math.atan2(P.y - pts[N - 1].y, P.x - pts[N - 1].x), t);

    if (!grabbedOnce && attached) {
      ctx.globalAlpha = reduceMotion ? 0.8 : 0.55 + 0.35 * Math.sin(t / 300);
      ctx.strokeStyle = FG;
      ctx.shadowColor = INK;
      ctx.shadowBlur = 4;
      ctx.lineWidth = Math.max(1.5, 2 * s);
      ctx.setLineDash([4 * s, 5 * s]);
      ctx.beginPath();
      ctx.arc(C.x, C.y, R * 1.45, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    drawBerry(C, lw);
    drawForceArrow(fs);

    if (dragging && attached) {
      ctx.beginPath();
      ctx.arc(ptr.x, ptr.y, 5 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
  }

  function frame(t) {
    if (!visible) {
      running = false;
      return;
    }
    if (last) acc += Math.min((t - last) / 1000, 0.05);
    last = t;
    while (acc >= DT) {
      step();
      acc -= DT;
    }
    if (dragging && attached) {
      const dist = Math.hypot(ptr.x - anchor.x, ptr.y - anchor.y);
      tension = Math.max(0, Math.min(1, (dist - 0.85 * maxReach) / (0.15 * maxReach + 140 * s)));
      if (tension >= 1) detach(t);
    } else {
      tension *= 0.9;
    }
    const targetN = dragging ? 0.15 + (BREAK_N - 0.15) * tension : 0;
    fN += (targetN - fN) * 0.2;
    if (!attached && t > resetAt) reset();
    draw(t);
    requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    last = 0;
    requestAnimationFrame(frame);
  }

  function toLocal(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function overBerry(p) {
    const c = pts[N + 1];
    return attached && Math.hypot(p.x - c.x, p.y - c.y) < R * 1.4;
  }

  canvas.addEventListener('pointerdown', (e) => {
    const p = toLocal(e);
    if (!overBerry(p)) return;
    e.preventDefault();
    ptr = p;
    const g = worldToBerry(p);
    const m = Math.hypot(g.x, g.y);
    if (m > 1.1) {
      g.x *= 1.1 / m;
      g.y *= 1.1 / m;
    }
    grabLocal = g;
    dragging = true;
    grabbedOnce = true;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    if (hint) hint.textContent = 'Keep pulling. The stem flexes and the fruit lets go at about 10 N.';
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = toLocal(e);
    if (dragging) ptr = p;
    else canvas.style.cursor = overBerry(p) ? 'grab' : 'default';
  });

  const release = () => {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = 'default';
    if (hint && attached) hint.textContent = 'Grab it again and pull.';
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  window.addEventListener('resize', resize);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) start();
    }, { threshold: 0.05 }).observe(canvas);
  }

  resize();
  start();
})();
