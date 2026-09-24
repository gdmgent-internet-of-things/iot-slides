// Voronoi sensor network: every presentation is a clickable cell, surrounded by
// smaller "ambient" nodes that drift around. Data pulses travel between neighbours.
import { Delaunay } from 'https://cdn.jsdelivr.net/npm/d3-delaunay@6/+esm';

const SVG_NS = 'http://www.w3.org/2000/svg';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const darkMode = matchMedia('(prefers-color-scheme: dark)');

// Small seeded random, so the layout is the same on every visit
function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function polygonCentroid(poly) {
  let x = 0, y = 0, area = 0;
  for (let i = 0, n = poly.length - 1; i < n; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[i + 1];
    const f = x0 * y1 - x1 * y0;
    area += f;
    x += (x0 + x1) * f;
    y += (y0 + y1) * f;
  }
  return area ? [x / (3 * area), y / (3 * area)] : poly[0];
}

// Split a title into lines of roughly `max` characters
function wrap(title, max = 14) {
  const lines = [];
  let line = '';
  for (const word of title.split(/\s+/)) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function startNetwork(stage, slides) {
  const canvas = stage.querySelector('canvas');
  const svg = stage.querySelector('svg');
  const ctx = canvas.getContext('2d');

  let width = 0, height = 0, spacing = 0, colors;
  let delaunay, voronoi;
  const pulses = [];
  let lastSpawn = 0;
  let hovered = -1;
  let running = false;

  // Presentation nodes wander around a fixed home position
  const pres = slides.map((slide, i) => ({
    ...slide,
    x: 0, y: 0, hx: 0, hy: 0,
    phase: i * 1.7, speed: 0.8 + (i % 3) * 0.15,
    flash: 0,
  }));
  let ambient = [];

  // SVG cells: <a><path/><text/></a> per presentation
  const cells = pres.map((p, i) => {
    const a = document.createElementNS(SVG_NS, 'a');
    a.setAttribute('href', p.url);
    a.setAttribute('class', 'cell');
    a.setAttribute('aria-label', p.title);
    a.style.setProperty('--i', i);
    const path = document.createElementNS(SVG_NS, 'path');
    const text = document.createElementNS(SVG_NS, 'text');
    a.append(path, text);
    a.addEventListener('pointerenter', () => { hovered = i; });
    a.addEventListener('pointerleave', () => { hovered = -1; });
    a.addEventListener('focus', () => { hovered = i; });
    a.addEventListener('blur', () => { hovered = -1; });
    svg.append(a);
    return { a, path, text };
  });

  function readColors() {
    const css = getComputedStyle(document.documentElement);
    colors = {
      net: css.getPropertyValue('--net').trim(),
      accent: css.getPropertyValue('--accent').trim(),
      accent2: css.getPropertyValue('--accent-2').trim(),
    };
  }

  function layout() {
    const rect = stage.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    spacing = Math.sqrt((width * height) / pres.length);
    const margin = Math.min(spacing * 0.35, 90);
    const rand = seeded(7);

    // Spread the presentations evenly with a few rounds of Lloyd relaxation
    let pts = pres.map(() => [margin + rand() * (width - 2 * margin), margin + rand() * (height - 2 * margin)]);
    for (let k = 0; k < 60; k++) {
      const v = Delaunay.from(pts).voronoi([0, 0, width, height]);
      pts = pts.map((pt, i) => {
        const [cx, cy] = polygonCentroid(v.cellPolygon(i));
        return [Math.min(width - margin, Math.max(margin, cx)), Math.min(height - margin, Math.max(margin, cy))];
      });
    }
    pres.forEach((p, i) => {
      [p.hx, p.hy] = pts[i];
      p.x = p.hx;
      p.y = p.hy;
    });

    // Ambient nodes fill the gaps and give the grid its "electric" texture
    const count = Math.max(10, Math.min(45, Math.round((width * height) / 30000)));
    ambient = Array.from({ length: count }, () => {
      const angle = rand() * Math.PI * 2;
      const speed = 0.1 + rand() * 0.2;
      return { x: rand() * width, y: rand() * height, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, flash: 0 };
    });
    pulses.length = 0;

    // Labels scale with the cell size
    const fontSize = Math.max(13, Math.min(22, spacing / 10));
    cells.forEach(({ text }, i) => {
      text.replaceChildren();
      text.setAttribute('font-size', fontSize);
      const lines = wrap(pres[i].title);
      lines.forEach((line, j) => {
        const tspan = document.createElementNS(SVG_NS, 'tspan');
        tspan.setAttribute('x', 0);
        tspan.setAttribute('dy', j === 0 ? `${-(lines.length - 1) * 0.6}em` : '1.2em');
        tspan.textContent = line;
        text.append(tspan);
      });
    });
  }

  function move(time) {
    const amp = Math.min(22, spacing * 0.08);
    for (const p of pres) {
      p.x = p.hx + amp * Math.sin(time * 0.00021 * p.speed + p.phase);
      p.y = p.hy + amp * Math.cos(time * 0.00017 * p.speed + p.phase * 1.3);
      p.flash *= 0.95;
    }
    // Keep ambient nodes away from the labels so every presentation keeps a big cell
    const keepOut = spacing * 0.5;
    for (const n of ambient) {
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < 0 || n.x > width) n.vx *= -1;
      if (n.y < 0 || n.y > height) n.vy *= -1;
      for (const p of pres) {
        const dx = n.x - p.x;
        const dy = n.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < keepOut) {
          n.x += (dx / d) * (keepOut - d) * 0.08;
          n.y += (dy / d) * (keepOut - d) * 0.08;
        }
      }
      n.flash *= 0.95;
    }
  }

  const node = (i) => (i < pres.length ? pres[i] : ambient[i - pres.length]);

  function spawnPulse(from, time) {
    const neighbours = [...delaunay.neighbors(from)];
    if (!neighbours.length) return;
    const to = neighbours[Math.floor(Math.random() * neighbours.length)];
    // Some messages hop on to a further neighbour, like a mesh network relaying data
    pulses.push({ from, to, t: 0, speed: 0.006 + Math.random() * 0.01, hops: Math.floor(Math.random() * 3) });
    lastSpawn = time;
  }

  function draw() {
    const points = [...pres, ...ambient].flatMap((n) => [n.x, n.y]);
    delaunay = new Delaunay(points);
    voronoi = delaunay.voronoi([0, 0, width, height]);

    ctx.clearRect(0, 0, width, height);

    // All cell edges: the electric grid
    ctx.beginPath();
    voronoi.render(ctx);
    ctx.strokeStyle = colors.net;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Data pulses with a short glowing trail
    ctx.lineCap = 'round';
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      const a = node(p.from);
      const b = node(p.to);
      p.t += p.speed;
      const head = Math.min(p.t, 1);
      const tail = Math.max(head - 0.35, 0);
      const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(tail, 'transparent');
      grad.addColorStop(head, colors.accent);
      ctx.beginPath();
      ctx.moveTo(a.x + (b.x - a.x) * tail, a.y + (b.y - a.y) * tail);
      ctx.lineTo(a.x + (b.x - a.x) * head, a.y + (b.y - a.y) * head);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      if (p.t >= 1) {
        b.flash = 1;
        const next = [...delaunay.neighbors(p.to)].filter((n) => n !== p.from);
        if (p.hops > 0 && next.length) {
          pulses[i] = { from: p.to, to: next[Math.floor(Math.random() * next.length)], t: 0, speed: p.speed, hops: p.hops - 1 };
        } else {
          pulses.splice(i, 1);
        }
      }
    }

    // Ambient nodes, with a ring when a message arrives
    for (const n of ambient) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, 1.8 + n.flash * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = n.flash > 0.05 ? colors.accent : colors.accent2;
      ctx.globalAlpha = 0.5 + n.flash * 0.5;
      ctx.fill();
      if (n.flash > 0.05) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, 4 + (1 - n.flash) * 14, 0, Math.PI * 2);
        ctx.strokeStyle = colors.accent;
        ctx.globalAlpha = n.flash * 0.5;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Presentation cells and labels
    pres.forEach((p, i) => {
      cells[i].path.setAttribute('d', voronoi.renderCell(i));
      cells[i].text.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
      // A pulse arriving at a presentation makes its cell light up briefly
      cells[i].a.classList.toggle('pulse', p.flash > 0.3);
    });
  }

  let loop = 0; // bumped on restart so an old animation loop stops

  function frame(id, time) {
    if (id !== loop) return;
    move(time);
    draw();
    if (time - lastSpawn > (hovered >= 0 ? 90 : 200)) {
      spawnPulse(hovered >= 0 ? hovered : Math.floor(Math.random() * (pres.length + ambient.length)), time);
    }
    requestAnimationFrame((t) => frame(id, t));
  }

  function start() {
    readColors();
    layout();
    running = !reduceMotion.matches;
    const id = ++loop;
    if (running) requestAnimationFrame((t) => frame(id, t));
    else draw(); // one still frame, no movement
  }

  new ResizeObserver(() => {
    layout();
    if (!running) draw();
  }).observe(stage);
  darkMode.addEventListener('change', () => { readColors(); if (!running) draw(); });
  reduceMotion.addEventListener('change', start);

  start();
}
