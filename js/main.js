/**
 * 可见光 / 红外 RTSP 经本地服务转发后播放。
 * 「同时播放」与两个单路按钮并排。点下去后主画面左右各一半同时播放。
 */
(() => {
  "use strict";

  const CHANNELS = {
    vis: {
      name: "CAM-01 可见光",
      model: "rtsp://192.168.137.100:3500/video11-live/video11",
      burn: "CAM-01",
    },
    ir: {
      name: "CAM-02 红外",
      model: "rtsp://192.168.137.100:3501/video0-live/video0",
      burn: "CAM-02",
    },
  };

  const STATE_TEXT = {
    idle: "未播放",
    connecting: "连接中",
    playing: "播放中",
    error: "连接失败",
  };

  const viewport = document.getElementById("viewport");
  const btnPlay = document.getElementById("btn-play");
  const btnFull = document.getElementById("btn-full");
  const alarm = document.getElementById("alarm");
  const alarmText = document.getElementById("alarm-text");
  let channel = "vis";
  let playing = false;

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatClock(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function renderHud() {
    const split = channel === "both";
    const meta = CHANNELS[split ? "vis" : channel];
    const clock = formatClock(new Date());
    document.getElementById("clock").textContent = clock;
    document.getElementById("osd-name").textContent = split ? "可见光 · 红外" : meta.name;
    document.getElementById("osd-model").textContent = split ? "左右各占一半" : meta.model;
    document.getElementById("burn").textContent = split
      ? `${clock}    CAM-01 / CAM-02    周界监控`
      : `${clock}    ${meta.burn}    周界监控`;
    document.getElementById("osd-live").hidden = !playing;
    document.querySelectorAll("img[data-role='main']").forEach((img) => {
      img.classList.toggle("is-on", playing && (split || img.dataset.ch === channel));
    });
  }

  function setChannel(next) {
    if (next !== "both" && !CHANNELS[next]) return;
    if (next === "both" && !ensurePlaying()) return;
    channel = next;
    viewport.dataset.ch = next;
    const title = next === "both" ? "同时播放" : next === "vis" ? "可见光" : "红外";
    document.title = `RK3588 算法智能监控 · ${title}`;
    document.getElementById("btn-play").setAttribute("aria-selected", next === "both" ? "true" : "false");
    document.getElementById("btn-vis").setAttribute("aria-selected", next === "vis" ? "true" : "false");
    document.getElementById("btn-ir").setAttribute("aria-selected", next === "ir" ? "true" : "false");
    document.querySelectorAll(".preview").forEach((el) => {
      const on = next === "both" || el.dataset.ch === next;
      el.classList.toggle("active", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
    renderHud();
  }

  function ensurePlaying() {
    if (playing) return true;
    if (location.protocol === "file:") {
      document.getElementById("placeholder").textContent = "请先双击「启动.bat」，再用浏览器打开 http://127.0.0.1:8080";
      return false;
    }
    const stamp = Date.now();
    document.querySelectorAll("img.stream").forEach((img) => {
      img.src = `/stream/${img.dataset.ch}?t=${stamp}`;
    });
    document.querySelectorAll("img[data-role='preview']").forEach((img) => img.classList.add("is-on"));
    playing = true;
    document.body.classList.add("is-playing");
    const chip = document.getElementById("run-chip");
    chip.textContent = "双路连接中";
    chip.classList.add("ok");
    return true;
  }

  function startBoth() {
    setChannel("both");
  }

  function applyStatus(status) {
    const names = ["vis", "ir"];
    names.forEach((name) => {
      const item = status[name] || { state: "idle", fps: 0, error: "" };
      const text = STATE_TEXT[item.state] || item.state;
      document.getElementById(`state-${name}`).textContent = text;
      document.getElementById(name === "vis" ? "m-vis" : "m-ir").textContent = text;
      document.getElementById(name === "vis" ? "vis-fps" : "ir-fps").textContent = item.fps ? `${item.fps.toFixed(1)} FPS` : "-- FPS";
      document.getElementById(name === "vis" ? "m-vfps" : "m-ifps").innerHTML = item.fps
        ? `${item.fps.toFixed(1)}<span class="unit">FPS</span>`
        : "--";
      const card = document.getElementById(`state-${name}`).closest(".source");
      card.classList.toggle("is-playing", item.state === "playing");
      card.classList.toggle("is-error", item.state === "error");
    });
    const failed = names.filter((name) => status[name] && status[name].state === "error");
    alarm.classList.toggle("is-on", failed.length > 0);
    alarmText.textContent = failed.map((name) => `${name === "vis" ? "可见光" : "红外"} ${status[name].error || "连接失败"}`).join(" · ");
    const chip = document.getElementById("run-chip");
    const foot = document.getElementById("foot-alarm");
    if (!playing) {
      chip.textContent = "未播放";
      chip.classList.remove("ok");
      foot.textContent = "等待播放";
      return;
    }
    if (names.every((name) => status[name] && status[name].state === "playing")) {
      chip.textContent = "双路播放";
      chip.classList.add("ok");
      foot.textContent = "可见光与红外同时播放";
    } else if (failed.length) {
      chip.textContent = "连接异常";
      chip.classList.remove("ok");
      foot.textContent = "视频流连接失败";
    } else {
      chip.textContent = "双路连接中";
      chip.classList.add("ok");
      foot.textContent = "正在连接两路视频";
    }
    document.getElementById("metric-foot").textContent = names
      .map((name) => `${name === "vis" ? "可见光" : "红外"} ${STATE_TEXT[status[name].state] || "--"}`)
      .join("  ·  ");
  }

  async function pollStatus() {
    if (location.protocol === "file:") return;
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) return;
      applyStatus(await response.json());
    } catch (error) {
      if (!playing) return;
      document.getElementById("metric-foot").textContent = "无法连接本地转发服务";
    }
  }

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else viewport.requestFullscreen();
  }

  btnPlay.addEventListener("click", startBoth);
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
    else if (event.key === "3" || (event.key === "Enter" && channel !== "both")) startBoth();
  });

  setChannel("vis");
  setInterval(renderHud, 1000);
  setInterval(pollStatus, 1000);
  pollStatus();
})();
