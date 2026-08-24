// 复现并捕获漫游期间抛出的渲染循环异常
import { execFileSync } from "node:child_process";

const NODE = "/Users/db/.workbuddy/binaries/node/versions/22.22.2/bin/node";
const AB = "/Users/db/.workbuddy/binaries/node/workspace/node_modules/.bin/agent-browser";
const URL = "http://127.0.0.1:8734/examples/demo/";

const ab = (args) => execFileSync(NODE, [AB, ...args], { encoding: "utf8", timeout: 60_000 });
const js = (expr) => ab(["eval", expr]).trim();
const click = (sel) => ab(["click", sel]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ab(["errors", "--clear"]);
ab(["console", "--clear"]);
ab(["open", URL]);
await sleep(3000);

// 额外保险：页面级 error 陷阱
js(`window.__errs = []; window.addEventListener('error', e => __errs.push(e.message + ' @ ' + (e.filename||'') + ':' + e.lineno + ':' + e.colno + (e.error && e.error.stack ? '\\n' + e.error.stack : ''))); window.addEventListener('unhandledrejection', e => __errs.push('REJECTION: ' + String(e.reason && e.reason.stack || e.reason))); 'ok'`);

click('button[data-run="CameraRoamStart"]');
await sleep(2000);
click('button[data-run="CameraRoamStop"]');
await sleep(300);
click('button[data-run="CameraFlyTo-street"]');
await sleep(2500);

console.log("---- page errors ----");
try { console.log(ab(["errors"])); } catch (e) { console.log("(errors cmd failed)"); }
console.log("---- window.__errs ----");
console.log(js(`JSON.stringify(__errs, null, 1)`));
console.log("---- animTime / fps ----");
console.log(js(`JSON.stringify({ animTime: __dbg.scene._animationTime, fps: __dbg.engine.getFps(), pos: __dbg.camera.position.asArray() })`));
