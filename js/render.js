/* 可见光 / 红外两路检测结果绘制，坐标与场景状态同步 */
const Render = (() => {
  "use strict";

  const HORIZON = 0.34;
  const LABELS = { person: "人员", car: "车辆", bike: "非机动车" };
  const BUILDINGS = [
    { x: 0.02, w: 0.11, h: 0.46, tone: 0, lit: [1, 0, 1, 0, 1, 1, 0, 1, 0] },
    { x: 0.14, w: 0.08, h: 0.66, tone: 1, antenna: true, lit: [1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1] },
    { x: 0.24, w: 0.15, h: 0.5, tone: 0, lit: [0, 1, 1, 0, 1, 0, 1, 1, 0] },
    { x: 0.41, w: 0.09, h: 0.74, tone: 1, lit: [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0] },
    { x: 0.52, w: 0.17, h: 0.42, tone: 0, lit: [1, 1, 0, 1, 1, 0, 0, 1, 1] },
    { x: 0.71, w: 0.1, h: 0.6, tone: 1, lit: [0, 1, 1, 1, 0, 1, 0, 1, 1] },
    { x: 0.83, w: 0.14, h: 0.38, tone: 0, lit: [1, 0, 1, 1, 0, 1, 0, 1] },
  ];

  let thermal = null;
  let grainPattern = null;

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function createGrain(size) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 170 + Math.random() * 85;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function createThermal() {
    const w = 480;
    const h = 270;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#07010f");
    sky.addColorStop(0.3, "#160a2c");
    sky.addColorStop(0.4, "#3a1450");
    sky.addColorStop(0.72, "#4a1838");
    sky.addColorStop(1, "#240916");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
      const n = (Math.random() - 0.5) * 26;
      data[i] = clamp(data[i] + n, 0, 255);
      data[i + 1] = clamp(data[i + 1] + n * 0.4, 0, 255);
      data[i + 2] = clamp(data[i + 2] + n * 0.55, 0, 255);
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function init() {
    const grain = createGrain(96);
    const scratch = document.createElement("canvas");
    scratch.width = 1;
    scratch.height = 1;
    grainPattern = scratch.getContext("2d").createPattern(grain, "repeat");
    thermal = createThermal();
  }

  function project(x, z, w, h) {
    const horizon = h * HORIZON;
    const bottom = h * 0.84;
    const y = horizon + z * (bottom - horizon);
    const span = 0.74 + z * 0.38;
    return {
      x: w * 0.5 + (x - 0.5) * w * span,
      y,
      scale: (h / 900) * (0.58 + z * 1.02),
    };
  }

  function traceQuad(ctx, x0, z0, x1, z1, w, h) {
    const a = project(x0, z0, w, h);
    const b = project(x1, z0, w, h);
    const c = project(x1, z1, w, h);
    const d = project(x0, z1, w, h);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function heatBlob(ctx, x, y, rx, ry, inner, mid) {
    const r = Math.max(rx, ry, 1);
    const g = ctx.createRadialGradient(x, y, r * 0.08, x, y, r);
    g.addColorStop(0, inner);
    g.addColorStop(0.5, mid);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHills(ctx, w, horizon) {
    ctx.fillStyle = "#66717a";
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    const hills = [0.05, 0.14, 0.08, 0.2, 0.1, 0.16, 0.07, 0.13, 0.05];
    hills.forEach((height, i) => {
      ctx.lineTo((i / (hills.length - 1)) * w, horizon - height * horizon);
    });
    ctx.lineTo(w, horizon);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#59646a";
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    [0.02, 0.08, 0.04, 0.1, 0.05, 0.09, 0.03].forEach((height, i, arr) => {
      ctx.lineTo((i / (arr.length - 1)) * w, horizon - height * horizon * 0.55);
    });
    ctx.lineTo(w, horizon);
    ctx.closePath();
    ctx.fill();
  }

  function drawBuildings(ctx, w, horizon, mode) {
    BUILDINGS.forEach((b) => {
      const x = b.x * w;
      const bw = b.w * w;
      const bh = b.h * horizon * 0.92;
      const y = horizon - bh;
      if (mode === "vis") ctx.fillStyle = b.tone ? "#6d7780" : "#838d96";
      else ctx.fillStyle = b.tone ? "#351848" : "#452058";
      ctx.fillRect(x, y, bw, bh);
      ctx.fillStyle = mode === "vis" ? "#5d6770" : "#281038";
      ctx.fillRect(x, y, bw, Math.max(2, bh * 0.05));
      ctx.fillStyle = mode === "vis" ? "rgba(0,0,0,0.16)" : "rgba(0,0,0,0.28)";
      ctx.fillRect(x + bw * 0.78, y, bw * 0.22, bh);
      if (b.antenna) {
        ctx.fillStyle = mode === "vis" ? "#d5dbe0" : "#ffb15e";
        ctx.fillRect(x + bw * 0.48, y - bh * 0.12, Math.max(1.5, w * 0.002), bh * 0.12);
      }
      const cols = 3;
      const rows = Math.ceil(b.lit.length / cols);
      const padX = bw * 0.14;
      const cellW = (bw - padX * 2) / cols;
      const cellH = (bh * 0.75) / rows;
      b.lit.forEach((on, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const wx = x + padX + col * cellW + cellW * 0.2;
        const wy = y + bh * 0.16 + row * cellH;
        if (mode === "vis") ctx.fillStyle = on ? "#f0e2c4" : "#46515b";
        else ctx.fillStyle = on ? "#ffb15e" : "#240c30";
        ctx.fillRect(wx, wy, cellW * 0.5, cellH * 0.48);
      });
    });
  }

  function drawFence(ctx, w, h, mode) {
    const posts = [];
    for (let i = 0; i <= 11; i += 1) posts.push(project(0.03 + (0.94 * i) / 11, 0.16, w, h));
    ctx.save();
    ctx.lineCap = "butt";
    ctx.strokeStyle = mode === "vis" ? "rgba(214, 218, 220, 0.78)" : "rgba(186, 110, 150, 0.55)";
    ctx.lineWidth = Math.max(1, h * 0.0022);
    [0.42, 0.72].forEach((height) => {
      ctx.beginPath();
      posts.forEach((p, i) => {
        const y = p.y - 36 * p.scale * height;
        if (i === 0) ctx.moveTo(p.x, y);
        else ctx.lineTo(p.x, y);
      });
      ctx.stroke();
    });
    posts.forEach((p) => {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y - 42 * p.scale);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawBooth(ctx, w, h, mode) {
    const p = project(0.08, 0.58, w, h);
    const s = p.scale;
    ctx.fillStyle = mode === "vis" ? "#8b9298" : "#5a2848";
    ctx.fillRect(p.x, p.y - 52 * s, 30 * s, 52 * s);
    ctx.fillStyle = mode === "vis" ? "#b7dbe6" : "#ffb15e";
    ctx.fillRect(p.x + 5 * s, p.y - 38 * s, 14 * s, 11 * s);
    ctx.fillStyle = mode === "vis" ? "#5c656c" : "#2c1028";
    ctx.fillRect(p.x - 2 * s, p.y - 58 * s, 34 * s, 6 * s);
  }

  function drawPole(ctx, x, z, w, h, mode) {
    const p = project(x, z, w, h);
    const s = p.scale;
    const top = p.y - 108 * s;
    ctx.save();
    ctx.strokeStyle = mode === "vis" ? "#d5dbe0" : "#8a5878";
    ctx.lineWidth = Math.max(1.5, 2.4 * s);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, top);
    ctx.lineTo(p.x + 28 * s, top + 2 * s);
    ctx.stroke();
    if (mode === "vis") {
      const glow = ctx.createRadialGradient(p.x + 28 * s, top + 10 * s, 0, p.x + 28 * s, top + 10 * s, 42 * s);
      glow.addColorStop(0, "rgba(255, 214, 150, 0.38)");
      glow.addColorStop(1, "rgba(255, 214, 150, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x + 28 * s, top + 12 * s, 42 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffe3ad";
      ctx.beginPath();
      ctx.arc(p.x + 28 * s, top + 2 * s, 3.2 * s, 0, Math.PI * 2);
      ctx.fill();
    } else {
      heatBlob(ctx, p.x + 28 * s, top + 2 * s, 18 * s, 18 * s, "rgba(255,246,220,0.95)", "rgba(255,150,50,0.15)");
    }
    ctx.restore();
  }

  function drawPersonVis(ctx, obj) {
    const s = obj.scale;
    const swing = Math.sin(obj.phase) * 7 * s;
    ctx.save();
    ctx.translate(obj.sx, obj.sy);
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 12 * s, 4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#23272c";
    ctx.lineWidth = Math.max(1.6, 3 * s);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-3.5 * s, -30 * s);
    ctx.lineTo(-3.5 * s + swing, -1 * s);
    ctx.moveTo(3.5 * s, -30 * s);
    ctx.lineTo(3.5 * s - swing, -1 * s);
    ctx.moveTo(-7 * s, -50 * s);
    ctx.lineTo(-11 * s - swing * 0.45, -34 * s);
    ctx.moveTo(7 * s, -50 * s);
    ctx.lineTo(11 * s + swing * 0.45, -34 * s);
    ctx.stroke();
    ctx.fillStyle = obj.color;
    roundRect(ctx, -9 * s, -56 * s, 18 * s, 28 * s, 5 * s);
    ctx.fill();
    ctx.fillStyle = "#efd0b4";
    ctx.beginPath();
    ctx.arc(0, -62 * s, 5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a241f";
    ctx.beginPath();
    ctx.arc(0, -64 * s, 5.1 * s, Math.PI, 0);
    ctx.fill();
    ctx.restore();
  }

  function drawCarVis(ctx, obj) {
    const s = obj.scale;
    const dir = obj.vx >= 0 ? 1 : -1;
    ctx.save();
    ctx.translate(obj.sx, obj.sy);
    ctx.scale(dir, 1);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 42 * s, 6 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    [-24 * s, 22 * s].forEach((wx) => {
      ctx.fillStyle = "#171b20";
      ctx.beginPath();
      ctx.arc(wx, -8 * s, 8 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#aeb6bd";
      ctx.lineWidth = Math.max(1, 1.4 * s);
      ctx.beginPath();
      ctx.moveTo(wx, -8 * s);
      ctx.lineTo(wx + Math.cos(obj.phase) * 5 * s, -8 * s + Math.sin(obj.phase) * 5 * s);
      ctx.stroke();
    });
    ctx.fillStyle = "#2c3541";
    roundRect(ctx, -42 * s, -30 * s, 84 * s, 20 * s, 6 * s);
    ctx.fill();
    ctx.fillStyle = "#3c4c5f";
    roundRect(ctx, -16 * s, -42 * s, 36 * s, 16 * s, 4 * s);
    ctx.fill();
    ctx.fillStyle = "rgba(186, 220, 230, 0.9)";
    roundRect(ctx, -10 * s, -38 * s, 24 * s, 8 * s, 2 * s);
    ctx.fill();
    ctx.fillStyle = "#f3e2b0";
    ctx.fillRect(36 * s, -22 * s, 6 * s, 4 * s);
    ctx.fillStyle = "rgba(255, 226, 160, 0.22)";
    ctx.beginPath();
    ctx.ellipse(58 * s, -18 * s, 16 * s, 7 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBikeVis(ctx, obj) {
    const s = obj.scale;
    const dir = obj.vx >= 0 ? 1 : -1;
    ctx.save();
    ctx.translate(obj.sx, obj.sy);
    ctx.scale(dir, 1);
    ctx.strokeStyle = "#d7dee3";
    ctx.lineWidth = Math.max(1.4, 2 * s);
    [-16 * s, 16 * s].forEach((wx) => {
      ctx.beginPath();
      ctx.arc(wx, -10 * s, 10 * s, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.strokeStyle = obj.color;
    ctx.beginPath();
    ctx.moveTo(-16 * s, -10 * s);
    ctx.lineTo(2 * s, -28 * s);
    ctx.lineTo(16 * s, -10 * s);
    ctx.moveTo(2 * s, -28 * s);
    ctx.lineTo(-2 * s, -10 * s);
    ctx.stroke();
    ctx.fillStyle = "#2f8f6b";
    roundRect(ctx, -7 * s, -50 * s, 14 * s, 20 * s, 4 * s);
    ctx.fill();
    ctx.fillStyle = "#efd0b4";
    ctx.beginPath();
    ctx.arc(2 * s, -58 * s, 6 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPersonIr(ctx, obj) {
    const s = obj.scale;
    const swing = Math.sin(obj.phase) * 4 * s;
    heatBlob(ctx, obj.sx, obj.sy - 34 * s, 16 * s, 26 * s, "rgba(255,80,40,0.35)", "rgba(120,20,20,0)");
    heatBlob(ctx, obj.sx - 4 * s + swing, obj.sy - 14 * s, 6 * s, 16 * s, "rgba(255,150,70,0.85)", "rgba(160,30,20,0)");
    heatBlob(ctx, obj.sx + 4 * s - swing, obj.sy - 14 * s, 6 * s, 16 * s, "rgba(255,150,70,0.85)", "rgba(160,30,20,0)");
    heatBlob(ctx, obj.sx, obj.sy - 40 * s, 11 * s, 16 * s, "rgba(255,230,180,0.92)", "rgba(255,90,30,0)");
    heatBlob(ctx, obj.sx, obj.sy - 62 * s, 8 * s, 9 * s, "rgba(255,252,245,0.98)", "rgba(255,190,80,0.2)");
  }

  function drawCarIr(ctx, obj) {
    const s = obj.scale;
    const front = obj.vx >= 0 ? 26 * s : -26 * s;
    heatBlob(ctx, obj.sx, obj.sy - 16 * s, 46 * s, 16 * s, "rgba(190,40,40,0.4)", "rgba(80,10,20,0)");
    heatBlob(ctx, obj.sx + front, obj.sy - 18 * s, 14 * s, 10 * s, "rgba(255,250,235,0.98)", "rgba(255,140,40,0.2)");
    heatBlob(ctx, obj.sx - front * 0.7, obj.sy - 10 * s, 8 * s, 6 * s, "rgba(255,180,90,0.7)", "rgba(180,40,20,0)");
  }

  function drawBikeIr(ctx, obj) {
    const s = obj.scale;
    heatBlob(ctx, obj.sx, obj.sy - 28 * s, 18 * s, 22 * s, "rgba(255,120,50,0.45)", "rgba(120,20,20,0)");
    heatBlob(ctx, obj.sx + 2 * s, obj.sy - 52 * s, 8 * s, 9 * s, "rgba(255,250,240,0.95)", "rgba(255,170,60,0.2)");
    heatBlob(ctx, obj.sx - 14 * s, obj.sy - 10 * s, 6 * s, 6 * s, "rgba(255,190,100,0.7)", "rgba(160,40,20,0)");
    heatBlob(ctx, obj.sx + 14 * s, obj.sy - 10 * s, 6 * s, 6 * s, "rgba(255,190,100,0.7)", "rgba(160,40,20,0)");
  }

  function drawActor(ctx, obj, mode) {
    if (mode === "ir") {
      if (obj.type === "car") drawCarIr(ctx, obj);
      else if (obj.type === "bike") drawBikeIr(ctx, obj);
      else drawPersonIr(ctx, obj);
      return;
    }
    if (obj.type === "car") drawCarVis(ctx, obj);
    else if (obj.type === "bike") drawBikeVis(ctx, obj);
    else drawPersonVis(ctx, obj);
  }

  function boundsOf(obj) {
    const s = obj.scale;
    if (obj.type === "car") return { x: obj.sx - 50 * s, y: obj.sy - 48 * s, w: 100 * s, h: 52 * s };
    if (obj.type === "bike") return { x: obj.sx - 30 * s, y: obj.sy - 68 * s, w: 60 * s, h: 72 * s };
    return { x: obj.sx - 20 * s, y: obj.sy - 76 * s, w: 40 * s, h: 80 * s };
  }

  function drawCorners(ctx, box, color, lw) {
    const { x, y, w, h } = box;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.38;
    ctx.lineWidth = Math.max(1, lw * 0.55);
    ctx.strokeRect(x, y, w, h);
    ctx.globalAlpha = 1;
    const len = Math.max(7, Math.min(w, h) * 0.24);
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
    ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
    ctx.moveTo(x, y + h - len); ctx.lineTo(x, y + h); ctx.lineTo(x + len, y + h);
    ctx.moveTo(x + w - len, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - len);
    ctx.stroke();
  }

  function drawDetections(ctx, world, w, h, mode) {
    const compact = h < 520;
    const fontSize = compact ? Math.max(10, h * 0.038) : Math.max(13, Math.min(18, h * 0.022));
    const lw = compact ? 1.6 : Math.max(2, h * 0.0032);
    const placed = [];
    const ordered = world.objects.slice().sort((a, b) => b.sy - a.sy);
    const boxes = ordered.map((obj) => boundsOf(obj));
    ordered.forEach((obj, index) => {
      const box = boxes[index];
      const color = obj.inZone ? "#ff5d5d" : (mode === "vis" ? "#3ee0a0" : "#ffc56d");
      drawCorners(ctx, box, color, lw);
      const id = "#" + String(obj.id).padStart(2, "0");
      let text = id;
      if (!compact) {
        const conf = (mode === "vis" ? obj.visConf : obj.irConf).toFixed(2);
        text = `${id} ${LABELS[obj.type]} ${conf}`;
        if (mode === "ir") text += `  ${obj.temp.toFixed(1)}°C`;
        if (obj.inZone) text += " 禁区";
      }
      ctx.font = `600 ${fontSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      const padX = fontSize * 0.42;
      const tw = ctx.measureText(text).width;
      const tagW = tw + padX * 2;
      const th = fontSize + padX * 0.85;
      let lx = box.x;
      let ly = box.y - th - 4;
      if (lx + tagW > w - 4) lx = w - tagW - 4;
      if (lx < 4) lx = 4;
      const hits = (x, y) => {
        const pad = 4;
        if (placed.some((r) => x < r.x + r.w + pad && x + tagW + pad > r.x && y < r.y + r.h + pad && y + th + pad > r.y)) return true;
        return boxes.some((b, i) => i !== index && x < b.x + b.w && x + tagW > b.x && y < b.y + b.h && y + th > b.y);
      };
      let guard = 0;
      while (ly > 4 && hits(lx, ly) && guard < 8) {
        ly -= th + 5;
        guard += 1;
      }
      if (ly < 4 || hits(lx, ly)) ly = Math.min(h - th - 4, box.y + 4);
      placed.push({ x: lx, y: ly, w: tagW, h: th });
      ctx.fillStyle = "rgba(6, 8, 12, 0.78)";
      roundRect(ctx, lx, ly, tagW, th, 4);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(lx, ly, 3, th);
      ctx.fillStyle = "#f5f8fb";
      ctx.textBaseline = "middle";
      ctx.fillText(text, lx + padX + 1, ly + th / 2 + 0.5);
    });
  }

  function drawZone(ctx, world, w, h, mode) {
    const zone = world.zone;
    traceQuad(ctx, zone.x0, zone.z0, zone.x1, zone.z1, w, h);
    ctx.fillStyle = mode === "vis" ? "rgba(255, 70, 70, 0.16)" : "rgba(255, 196, 80, 0.14)";
    ctx.fill();
    ctx.strokeStyle = mode === "vis" ? "rgba(255, 96, 96, 0.9)" : "rgba(255, 214, 130, 0.9)";
    ctx.lineWidth = Math.max(1.25, h * 0.0024);
    ctx.setLineDash([Math.max(6, h * 0.012), Math.max(5, h * 0.009)]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (h < 520) return;
    const c = project((zone.x0 + zone.x1) / 2, (zone.z0 + zone.z1) / 2, w, h);
    ctx.font = `600 ${Math.max(12, h * 0.02)}px "Microsoft YaHei", sans-serif`;
    const text = "禁区";
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(8, 10, 14, 0.55)";
    roundRect(ctx, c.x - tw / 2 - 8, c.y - 11, tw + 16, 22, 4);
    ctx.fill();
    ctx.fillStyle = mode === "vis" ? "#ffd0d0" : "#ffe7c2";
    ctx.textBaseline = "middle";
    ctx.fillText(text, c.x - tw / 2, c.y + 1);
  }

  function drawRoad(ctx, w, h, mode) {
    traceQuad(ctx, -0.08, 0.66, 1.08, 0.76, w, h);
    ctx.fillStyle = mode === "vis" ? "#7a756c" : "rgba(70, 24, 58, 0.45)";
    ctx.fill();
    const farL = project(-0.12, 0.76, w, h);
    const farR = project(1.12, 0.76, w, h);
    ctx.beginPath();
    ctx.moveTo(farL.x, farL.y);
    ctx.lineTo(farR.x, farR.y);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = mode === "vis" ? "#343a40" : "rgba(16, 4, 14, 0.62)";
    ctx.fill();
    ctx.strokeStyle = mode === "vis" ? "rgba(220, 216, 206, 0.28)" : "rgba(255, 180, 120, 0.18)";
    ctx.lineWidth = Math.max(1, h * 0.002);
    ctx.beginPath();
    ctx.moveTo(farL.x, farL.y);
    ctx.lineTo(farR.x, farR.y);
    ctx.stroke();
    ctx.strokeStyle = mode === "vis" ? "rgba(230, 210, 150, 0.75)" : "rgba(255, 190, 110, 0.35)";
    ctx.lineWidth = Math.max(1.5, h * 0.003);
    ctx.setLineDash([Math.max(10, h * 0.018), Math.max(8, h * 0.014)]);
    ctx.beginPath();
    for (let i = 0; i <= 16; i += 1) {
      const p = project(-0.08 + (1.16 * i) / 16, 0.9, w, h);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawVisible(ctx, world, w, h) {
    const horizon = h * HORIZON;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#1b293b");
    sky.addColorStop(0.62, "#607482");
    sky.addColorStop(1, "#c5c9c2");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    drawHills(ctx, w, horizon);
    drawBuildings(ctx, w, horizon, "vis");
    const ground = ctx.createLinearGradient(0, horizon, 0, h);
    ground.addColorStop(0, "#9a978c");
    ground.addColorStop(0.42, "#6e726c");
    ground.addColorStop(1, "#2e3338");
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizon, w, h - horizon);
    drawRoad(ctx, w, h, "vis");
    drawZone(ctx, world, w, h, "vis");
  }

  function drawInfrared(ctx, world, w, h) {
    const horizon = h * HORIZON;
    const drift = Math.sin(world.elapsed * 0.35) * 6;
    if (thermal) ctx.drawImage(thermal, -12 + drift, -12, w + 24, h + 24);
    else {
      ctx.fillStyle = "#1a0b22";
      ctx.fillRect(0, 0, w, h);
    }
    drawBuildings(ctx, w, horizon, "ir");
    drawRoad(ctx, w, h, "ir");
    drawZone(ctx, world, w, h, "ir");
  }

  function drawVignette(ctx, w, h) {
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.4, w / 2, h * 0.45, h * 0.78);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.38)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function draw(ctx, w, h, mode, world) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, w, h);
    if (mode === "ir") drawInfrared(ctx, world, w, h);
    else drawVisible(ctx, world, w, h);

    world.objects.forEach((obj) => {
      const p = project(obj.x, obj.z, w, h);
      obj.sx = p.x;
      obj.sy = p.y;
      obj.scale = p.scale;
    });

    const layers = [
      { z: 0.16, draw: () => drawFence(ctx, w, h, mode) },
      { z: 0.58, draw: () => drawBooth(ctx, w, h, mode) },
      { z: 0.7, draw: () => drawPole(ctx, 0.22, 0.7, w, h, mode) },
      { z: 0.7, draw: () => drawPole(ctx, 0.8, 0.7, w, h, mode) },
    ];
    world.objects.forEach((obj) => {
      layers.push({ z: obj.z, draw: () => drawActor(ctx, obj, mode) });
    });
    layers.sort((a, b) => a.z - b.z);
    layers.forEach((layer) => layer.draw());

    if (mode === "vis" && grainPattern) {
      ctx.save();
      ctx.globalAlpha = 0.045;
      ctx.translate(Math.random() * 3, Math.random() * 3);
      ctx.fillStyle = grainPattern;
      ctx.fillRect(-4, -4, w + 8, h + 8);
      ctx.restore();
    }
    drawVignette(ctx, w, h);
    drawDetections(ctx, world, w, h, mode);
  }

  return { init, draw };
})();
