/* RK3588 算法智能监控 — 双路检测共用的场景状态 */
const Scene = (() => {
  "use strict";

  const ZONE = { x0: 0.58, x1: 0.8, z0: 0.42, z1: 0.56 };

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function make(partial) {
    return {
      phase: partial.id * 1.4,
      wasInside: false,
      inZone: false,
      visConf: partial.baseVis,
      irConf: partial.baseIr,
      temp: partial.baseTemp,
      ...partial,
    };
  }

  function create() {
    return {
      elapsed: 0,
      zone: ZONE,
      alarmActive: false,
      alarmBanner: "",
      lastAlarm: "",
      lastAlarmAt: 0,
      metricAccum: 0,
      metrics: {
        npu: 46,
        temp: 53.4,
        visFps: 25,
        irFps: 24.6,
        mem: 3.6,
        latency: 36,
      },
      objects: [
        make({ id: 1, type: "person", x: 0.2, z: 0.46, vx: 0.048, color: "#3c7dd9", baseVis: 0.93, baseIr: 0.9, baseTemp: 36.6 }),
        make({ id: 2, type: "person", x: 0.8, z: 0.3, vx: -0.036, color: "#d06a4f", baseVis: 0.9, baseIr: 0.86, baseTemp: 36.4 }),
        make({ id: 3, type: "person", x: 0.46, z: 0.64, vx: 0.032, color: "#2f9d74", baseVis: 0.88, baseIr: 0.84, baseTemp: 36.8 }),
        make({ id: 4, type: "person", x: 0.9, z: 0.52, vx: -0.044, color: "#c4a15a", baseVis: 0.91, baseIr: 0.89, baseTemp: 37.1 }),
        make({ id: 5, type: "car", x: 0.08, z: 0.8, vx: 0.085, color: "#2f3844", baseVis: 0.96, baseIr: 0.93, baseTemp: 54.2 }),
        make({ id: 6, type: "bike", x: 0.68, z: 0.72, vx: -0.046, color: "#c4554a", baseVis: 0.86, baseIr: 0.8, baseTemp: 36.5 }),
      ],
    };
  }

  function update(world, dt) {
    world.elapsed += dt;

    world.objects.forEach((obj) => {
      obj.visConf = clamp(obj.baseVis + Math.sin(world.elapsed * 1.6 + obj.id) * 0.012, 0.75, 0.99);
      obj.irConf = clamp(obj.baseIr + Math.cos(world.elapsed * 1.3 + obj.id * 0.7) * 0.014, 0.72, 0.99);
      obj.temp = obj.baseTemp + Math.sin(world.elapsed * 0.8 + obj.id) * (obj.type === "car" ? 1.6 : 0.12);
      obj.phase += dt * (obj.type === "person" ? 6.5 : 10) * (0.65 + Math.abs(obj.vx) * 12);
      obj.x += obj.vx * dt;
      if (obj.vx > 0 && obj.x > 1.15) obj.x = -0.15;
      if (obj.vx < 0 && obj.x < -0.15) obj.x = 1.15;

      const inside = obj.type === "person"
        && obj.x >= ZONE.x0 && obj.x <= ZONE.x1
        && obj.z >= ZONE.z0 && obj.z <= ZONE.z1;
      if (inside && !obj.wasInside) {
        const d = new Date();
        world.lastAlarm = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}  目标 #${pad(obj.id)} 进入禁区`;
        world.lastAlarmAt = Date.now();
      }
      obj.wasInside = inside;
      obj.inZone = inside;
    });

    const inside = world.objects.filter((obj) => obj.inZone);
    world.alarmActive = inside.length > 0;
    if (inside.length === 1) world.alarmBanner = `目标 #${pad(inside[0].id)} 位于禁区`;
    else if (inside.length > 1) world.alarmBanner = `${inside.length} 个目标位于禁区`;
    else world.alarmBanner = "";

    world.metricAccum += dt;
    if (world.metricAccum >= 0.5) {
      world.metricAccum = 0;
      const m = world.metrics;
      m.npu = clamp(m.npu + (Math.random() - 0.48) * 3.5, 38, 72);
      m.temp = clamp(m.temp + (Math.random() - 0.5) * 0.35, 49, 62);
      m.visFps = clamp(m.visFps + (Math.random() - 0.5) * 0.6, 23.4, 27.8);
      m.irFps = clamp(m.irFps + (Math.random() - 0.5) * 0.5, 22.8, 26.5);
      m.mem = clamp(m.mem + (Math.random() - 0.5) * 0.08, 3.1, 4.4);
      m.latency = clamp(m.latency + (Math.random() - 0.5) * 3, 28, 52);
    }
  }

  return { create, update };
})();
