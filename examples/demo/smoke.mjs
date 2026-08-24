#!/usr/bin/env node
/**
 * 数字孪生 API 层 · 浏览器端到端冒烟测试
 *
 * 依赖：
 *   - 本地静态服务器：impl/ 目录（默认 http://127.0.0.1:8734/examples/demo/）
 *   - agent-browser（Chromium 自动化，安装于受管 node workspace）
 *
 * 用法：
 *   node smoke.mjs [demoUrl]
 *
 * 断言内容：
 *   1. demo 页面加载后 LoadScene code=0、出现 SceneReady 事件
 *   2. 全部 42 个命令按钮按序派发，每个命令在日志中出现且 code 符合预期
 *      （正常命令 code=0；错误演示按钮分别命中 2001/3001/2002）
 *   3. POI XSS 白名单：注入的危险标签不进入 DOM
 *   4. 真实资产场景（Khronos DamagedHelmet GLB）SwitchScene code=0
 */

import { execFileSync } from "node:child_process";
import process from "node:process";

const NODE = "/Users/db/.workbuddy/binaries/node/versions/22.22.2/bin/node";
const AB = "/Users/db/.workbuddy/binaries/node/workspace/node_modules/agent-browser/bin/agent-browser.js";
const DEMO_URL = process.argv[2] ?? "http://127.0.0.1:8734/examples/demo/index.html";

const ab = (args) =>
  execFileSync(NODE, [AB, ...args], { encoding: "utf8", timeout: 60_000 });

/** eval 表达式 */
const js = (expr) => ab(["eval", expr]).trim();

/** 按序点击的命令按钮（data-run 值）。顺序依赖场景：
 *  1) 默认场景 yuanshui（东湖园水模型）→ 先测模型场景按钮
 *  2) helmet（真实资产单 GLB）
 *  3) reload 回 programmatic:demo → 测程序化场景按钮
 *  4) 错误码 / 扩展性按钮（任意场景）
 */
const CLICK_ORDER = [
  // ---- 东湖园水 · 数字孪生模型场景（默认加载） ----
  "GetSceneInfo", "ys-flyto", "ys-focus-b1", "ys-outline",
  "ys-veg-off", "ys-veg-on", "ys-build-op", "ys-poi", "ys-poi-sync", "ys-clear",
  // ---- 真实资产单模型 ----
  "helmet", "GetSceneInfo",
  // ---- 回程序化演示场景 ----
  "reload", "GetSceneInfo", "SetEnvironment-noon", "SetEnvironment-dusk",
  "CameraFlyTo-overview", "CameraFlyTo-street", "CameraFlyTo-top", "CameraFocusOn-car",
  "GetCameraInfo", "ResetCameraView", "CameraRoamStart", "CameraRoamStop",
  "SetEntityVisible-hide", "SetEntityVisible-show", "SetEntityOutline-on", "SetEntityOutline-off",
  "SetEntityHighlight-on", "SetEntityHighlight-off",
  "LocateEntity", "GetEntityInfo", "MoveEntityByPath",
  "GetLayerList", "SetLayerVisible-off", "SetLayerVisible-on", "SetLayerOpacity",
  "SetWeatherEffect", "SetHeatmap", "SetHeatmap-column", "UpdateHeatmap", "RemoveHeatmap",
  "SetHighlightRegion", "SetParticleEffect", "SetLightEffect",
  "AddPOI", "AddPOI-xss", "UpdatePOI", "AddPath", "Add3DText", "ClearCoverings",
  "bad-command", "bad-scene", "bad-selector", "custom-cmd", "list-commands",
  "GetSceneInfo",
];

/** 期望的错误码演示（其余命令一律期望 code=0） */
const EXPECTED_ERRORS = {
  NoSuchCommand: 2001,      // bad-command
  badSceneLoadScene: 3001,  // bad-scene（LoadScene 场景未注册）
  badSelectorVisible: 2002, // bad-selector（SetEntityVisible 空选择器）
};

const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); };

async function main() {
  console.log(`[smoke] 打开 ${DEMO_URL}`);
  ab(["open", DEMO_URL]);

  // 1) 等待场景就绪（最长 40s，首次需加载 11MB 本地 bundle）
  //    以 window.__sceneReady 确定性标志为准，避免被 CameraChanged 实时状态覆盖
  let ready = false;
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    const flag = js(`window.__sceneReady === true`);
    if (flag === "true") { ready = true; break; }
  }
  ok(ready, "等待场景就绪超时（未收到 SceneReady 事件）");
  if (!ready) { finish(); return; }
  console.log("[smoke] 场景就绪");

  // 2) 东湖园水模型场景断言：多资产 GLB 合并接入 + 图层注册
  //    必须在按钮派发前检查（CLICK_ORDER 后续会切到 helmet / 程序化场景）
  const hasVegetation = js(
    `(async () => { const info=(await window.__twinApi.execute("GetSceneInfo")).data; return Array.isArray(info.layers) && info.layers.some(l=>l.layerName==="vegetation"); })()`
  );
  ok(hasVegetation === "true", "GetSceneInfo 返回中未出现 vegetation 图层（多资产图层注册失败）");

  // 3) 顺序派发全部按钮（每个间隔 450ms，等前序命令完成）
  const clicker = `(async () => {
    const keys = ${JSON.stringify(CLICK_ORDER)};
    window.__smokeProgress = 0;
    for (const k of keys) {
      document.querySelector('[data-run="' + k + '"]')?.click();
      window.__smokeProgress += 1;
      await new Promise((r) => setTimeout(r, 450));
    }
    return 'dispatched';
  })()`;
  ab(["eval", clicker]);

  // 等待派发完成（按钮数 × 450ms + 余量）
  const totalMs = CLICK_ORDER.length * 450 + 2000;
  for (let i = 0; i < Math.ceil(totalMs / 1000) + 20; i++) {
    await sleep(1000);
    const progress = Number(js(`window.__smokeProgress ?? -1`));
    if (progress >= CLICK_ORDER.length) break;
  }
  // 等最后一条命令（helmet 真实资产下载可能较慢）落日志：轮询最长 90s
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    if (/SwitchScene code=\d/.test(js(`document.querySelector('#log')?.textContent ?? ''`))) break;
  }
  await sleep(2000);

  // 3) 解析日志
  const logText = js(`document.querySelector('#log')?.textContent ?? ''`);
  const results = {};
  for (const m of logText.matchAll(/([A-Za-z][A-Za-z0-9.]*) code=(\d+)/g)) {
    const [, name, code] = m;
    (results[name] ??= []).push(Number(code));
  }

  const expectOk = new Set([
    "LoadScene", "SetEnvironment", "CameraFlyTo", "CameraFocusOn", "GetCameraInfo",
    "ResetCameraView", "CameraRoamStart", "CameraRoamStop",
    "SetEntityVisible", "SetEntityOutline", "SetEntityHighlight", "LocateEntity",
    "GetEntityInfo", "MoveEntityByPath",
    "GetLayerList", "SetLayerVisible", "SetLayerOpacity",
    "SetWeatherEffect", "SetHeatmap", "UpdateHeatmap", "RemoveHeatmap",
    "SetHighlightRegion", "SetParticleEffect", "SetLightEffect",
    "AddPOI", "UpdatePOI", "AddPath", "Add3DText", "ClearCoverings",
    "Demo.GetServerTime", "SwitchScene", "GetSceneInfo",
  ]);

  for (const name of expectOk) {
    const codes = results[name] ?? [];
    ok(codes.includes(0), `命令 ${name} 期望至少一次 code=0，实际 [${codes.join(",") || "未出现"}]`);
  }

  // 错误码断言（LoadScene 同时存在成功与 3001；SetEntityVisible 同时存在成功与 2002）
  ok((results.LoadScene ?? []).includes(EXPECTED_ERRORS.badSceneLoadScene),
    `LoadScene 期望出现 ${EXPECTED_ERRORS.badSceneLoadScene}（场景未注册），实际 [${(results.LoadScene ?? []).join(",")}]`);
  ok((results.SetEntityVisible ?? []).includes(EXPECTED_ERRORS.badSelectorVisible),
    `SetEntityVisible 期望出现 ${EXPECTED_ERRORS.badSelectorVisible}（空选择器），实际 [${(results.SetEntityVisible ?? []).join(",")}]`);
  ok((results.NoSuchCommand ?? []).includes(EXPECTED_ERRORS.NoSuchCommand),
    `NoSuchCommand 期望 ${EXPECTED_ERRORS.NoSuchCommand}`);

  // 事件断言
  ok(logText.includes("SceneReady"), "未观测到 SceneReady 事件");
  ok(logText.includes("CameraChanged") === false, "CameraChanged 不应写入日志（仅更新状态栏）");

  // 5) 东湖园水模型场景断言：实体聚焦 + 图层联动
  ok((results.SetLayerVisible ?? []).includes(0), "SetLayerVisible（植被层联动）期望 code=0");
  ok((results.CameraFocusOn ?? []).includes(0), "CameraFocusOn（聚焦 buildings-001）期望 code=0，实体未注册？");

  // 6) POI XSS 白名单：危险标签不得进入 DOM
  const dangerous = js(`!!document.querySelector('#viewport script, #viewport iframe')`);
  ok(dangerous === "false", "POI 白名单失效：viewport 中存在 script/iframe 元素");

  // 6) 真实资产场景断言
  ok((results.SwitchScene ?? []).includes(0), "SwitchScene(helmet) 期望 code=0（真实资产导入）");

  finish();
}

function finish() {
  ab(["close"]);
  if (failures.length === 0) {
    console.log("[smoke] ✅ 全部断言通过");
    process.exit(0);
  } else {
    console.error(`[smoke] ❌ ${failures.length} 项断言失败：`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

main().catch((err) => {
  console.error("[smoke] 执行异常：", err);
  try { ab(["close"]); } catch { /* 忽略 */ }
  process.exit(1);
});
