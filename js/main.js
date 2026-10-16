/**
 * RK3588 算法智能监控台
 * 可见光 / 红外共用同一场景时钟，两路预览始终同时播放。
 * 主画面只切换显示通道，不会暂停另一路。
 */
(() => {
  "use strict";

  const CHANNELS = {
    vis: { name: "CAM-01 可见光", model: "yolov8s_vis_640.rknn", burn: "CAM-01" },
    ir: { name: "CAM-02 红外", model: "yolov8s_ir_640.rknn", burn: "CAM-02" },
  };

  const mainCanvas = document.getElementById("main-canvas");
  const visCanvas = document.getElementById("vis-canvas");
  const irCanvas = document.getElementById("ir-canvas");
  const viewport = document.getElementById("viewport");
  const alarm = document.getElementById("alarm");
  const alarmText = document.getElementById("alarm-text");
  const btnFull = document.getElementById("btn-full");

  const world = Scene.create();
  Render.init();
  let channel = "vis";
  let last = 0;

  function fit(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(rect.width * dpr));
    const h = Math.max(2, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d", { alpha: false });
    return { ctx, w, h };
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatClock(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function metric(value, unit) {
    return `${value}<span class="unit">${unit}</span>`;
  }

  function renderTargets() {
    const labels = { person: "人员", car: "车辆", bike: "非机动车" };
    const frag = document.createDocumentFragment();
    world.objects.forEach((obj) => {
      const row = document.createElement("div");
      row.className = "trow" + (obj.inZone ? " is-alarm" : "");
      const id = document.createElement("span");
      id.className = "tid";
      id.textContent = "#" + pad(obj.id);
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = labels[obj.type];
      if (obj.inZone) {
        const tag = document.createElement("em");
        tag.textContent = "禁区";
        name.appendChild(tag);
      }
      const conf = document.createElement("span");
      conf.className = "conf";
      const vis = document.createElement("b");
      vis.className = "c-vis";
      vis.textContent = obj.visConf.toFixed(2);
      const slash = document.createElement("i");
      slash.textContent = "/";
      const ir = document.createElement("b");
      ir.className = "c-ir";
      ir.textContent = obj.irConf.toFixed(2);
      conf.append(vis, slash, ir);
      const temp = document.createElement("span");
      temp.className = "temp";
      temp.textContent = obj.temp.toFixed(1) + "°C";
      row.append(id, name, conf, temp);
      frag.appendChild(row);
    });
    document.getElementById("target-list").replaceChildren(frag);
  }

  function renderHud() {
    const now = new Date();
    const clock = formatClock(now);
    const meta = CHANNELS[channel];
    const m = world.metrics;
    document.getElementById("clock").textContent = clock;
    document.getElementById("osd-name").textContent = meta.name;
    document.getElementById("osd-model").textContent = meta.model;
    document.getElementById("osd-count").textContent = `目标 ${world.objects.length}`;
    document.getElementById("osd-dual").textContent = `VIS ${m.visFps.toFixed(1)}  ·  IR ${m.irFps.toFixed(1)}`;
    document.getElementById("burn").textContent = `${clock}    ${meta.burn}    周界监控`;
    document.getElementById("vis-fps").textContent = m.visFps.toFixed(1) + " FPS";
    document.getElementById("ir-fps").textContent = m.irFps.toFixed(1) + " FPS";
    document.getElementById("m-npu").innerHTML = metric(m.npu.toFixed(0), "%");
    document.getElementById("m-temp").innerHTML = metric(m.temp.toFixed(1), "°C");
    document.getElementById("m-vfps").innerHTML = metric(m.visFps.toFixed(1), "FPS");
    document.getElementById("m-ifps").innerHTML = metric(m.irFps.toFixed(1), "FPS");
    document.getElementById("metric-foot").textContent = `内存 ${m.mem.toFixed(1)} / 8.0 GB  ·  推理延迟 ${m.latency.toFixed(0)} ms`;

    const count = document.getElementById("target-count");
    count.textContent = String(world.objects.length);
    count.classList.toggle("hot", world.alarmActive);
    alarm.classList.toggle("is-on", world.alarmActive);
    alarmText.textContent = world.alarmBanner;
    viewport.classList.toggle("alarm", world.alarmActive);

    const foot = document.getElementById("foot-alarm");
    foot.textContent = world.lastAlarm || "无活动告警";
    const recent = world.lastAlarmAt && Date.now() - world.lastAlarmAt < 8000;
    foot.classList.toggle("is-hot", world.alarmActive || recent);
    renderTargets();
  }

  function setChannel(next) {
    if (!CHANNELS[next]) return;
    channel = next;
    viewport.dataset.ch = next;
    document.title = `RK3588 算法智能监控 · ${next === "vis" ? "可见光" : "红外"}`;
    document.getElementById("btn-vis").setAttribute("aria-selected", next === "vis" ? "true" : "false");
    document.getElementById("btn-ir").setAttribute("aria-selected", next === "ir" ? "true" : "false");
    document.querySelectorAll(".preview").forEach((el) => {
      const on = el.dataset.ch === next;
      el.classList.toggle("active", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
    renderHud();
  }

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else viewport.requestFullscreen();
  }

  function paint() {
    const main = fit(mainCanvas);
    const vis = fit(visCanvas);
    const ir = fit(irCanvas);
    if (main) Render.draw(main.ctx, main.w, main.h, channel, world);
    if (vis) Render.draw(vis.ctx, vis.w, vis.h, "vis", world);
    if (ir) Render.draw(ir.ctx, ir.w, ir.h, "ir", world);
  }

  function frame(now) {
    if (!last) last = now;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    Scene.update(world, dt);
    paint();
    requestAnimationFrame(frame);
  }

  document.getElementById("btn-vis").addEventListener("click", () => setChannel("vis"));
  document.getElementById("btn-ir").addEventListener("click", () => setChannel("ir"));
  document.querySelectorAll(".preview").forEach((el) => {
    el.addEventListener("click", () => setChannel(el.dataset.ch));
  });
  btnFull.addEventListener("click", toggleFull);
  viewport.addEventListener("dblclick", (event) => {
    if (event.target.closest("button")) return;
    toggleFull();
  });
  document.addEventListener("fullscreenchange", () => {
    btnFull.textContent = document.fullscreenElement ? "退出全屏" : "全屏";
  });
  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "1") setChannel("vis");
    else if (event.key === "2") setChannel("ir");
    else if (event.key === "f" || event.key === "F") toggleFull();
  });

  setChannel("vis");
  setInterval(renderHud, 200);
  requestAnimationFrame(frame);
})();
