// src/types.ts
var ErrorCode = /* @__PURE__ */ ((ErrorCode2) => {
  ErrorCode2[ErrorCode2["OK"] = 0] = "OK";
  ErrorCode2[ErrorCode2["UNKNOWN_ERROR"] = 1001] = "UNKNOWN_ERROR";
  ErrorCode2[ErrorCode2["ENGINE_INIT_FAILED"] = 1002] = "ENGINE_INIT_FAILED";
  ErrorCode2[ErrorCode2["WEBGL_UNSUPPORTED"] = 1003] = "WEBGL_UNSUPPORTED";
  ErrorCode2[ErrorCode2["CONTEXT_LOST"] = 1004] = "CONTEXT_LOST";
  ErrorCode2[ErrorCode2["ASSET_LOAD_FAILED"] = 1005] = "ASSET_LOAD_FAILED";
  ErrorCode2[ErrorCode2["ENGINE_DESTROYED"] = 1006] = "ENGINE_DESTROYED";
  ErrorCode2[ErrorCode2["COMMAND_NOT_FOUND"] = 2001] = "COMMAND_NOT_FOUND";
  ErrorCode2[ErrorCode2["INVALID_PARAMS"] = 2002] = "INVALID_PARAMS";
  ErrorCode2[ErrorCode2["COMMAND_TIMEOUT"] = 2003] = "COMMAND_TIMEOUT";
  ErrorCode2[ErrorCode2["ENGINE_NOT_READY"] = 2004] = "ENGINE_NOT_READY";
  ErrorCode2[ErrorCode2["COMMAND_REJECTED"] = 2005] = "COMMAND_REJECTED";
  ErrorCode2[ErrorCode2["QUEUE_OVERFLOW"] = 2006] = "QUEUE_OVERFLOW";
  ErrorCode2[ErrorCode2["SCENE_NOT_FOUND"] = 3001] = "SCENE_NOT_FOUND";
  ErrorCode2[ErrorCode2["SCENE_LOAD_FAILED"] = 3002] = "SCENE_LOAD_FAILED";
  ErrorCode2[ErrorCode2["CAMERA_PARAM_OUT_OF_RANGE"] = 3003] = "CAMERA_PARAM_OUT_OF_RANGE";
  ErrorCode2[ErrorCode2["ROAM_PATH_INVALID"] = 3004] = "ROAM_PATH_INVALID";
  ErrorCode2[ErrorCode2["ENTITY_NOT_FOUND"] = 4001] = "ENTITY_NOT_FOUND";
  ErrorCode2[ErrorCode2["LAYER_NOT_FOUND"] = 4002] = "LAYER_NOT_FOUND";
  ErrorCode2[ErrorCode2["LAYER_OPERATION_FAILED"] = 4003] = "LAYER_OPERATION_FAILED";
  ErrorCode2[ErrorCode2["ENTITY_OPERATION_FAILED"] = 4004] = "ENTITY_OPERATION_FAILED";
  ErrorCode2[ErrorCode2["EFFECT_NOT_SUPPORTED"] = 5001] = "EFFECT_NOT_SUPPORTED";
  ErrorCode2[ErrorCode2["COVERING_NOT_FOUND"] = 5002] = "COVERING_NOT_FOUND";
  ErrorCode2[ErrorCode2["HEATMAP_DATA_INVALID"] = 5003] = "HEATMAP_DATA_INVALID";
  ErrorCode2[ErrorCode2["RESOURCE_LIMIT_EXCEEDED"] = 5004] = "RESOURCE_LIMIT_EXCEEDED";
  ErrorCode2[ErrorCode2["UNKNOWN_EVENT"] = 6001] = "UNKNOWN_EVENT";
  ErrorCode2[ErrorCode2["LISTENER_LIMIT_EXCEEDED"] = 6002] = "LISTENER_LIMIT_EXCEEDED";
  return ErrorCode2;
})(ErrorCode || {});

// src/core/errors.ts
var TwinError = class extends Error {
  constructor(code, message, details) {
    super(`[${code}] ${message}`);
    this.name = "TwinError";
    this.code = code;
    this.details = details;
  }
};
function toTwinError(err) {
  if (err instanceof TwinError) return err;
  if (err instanceof Error) return new TwinError(1001 /* UNKNOWN_ERROR */, err.message);
  return new TwinError(1001 /* UNKNOWN_ERROR */, String(err));
}
function errCommandNotFound(command) {
  return new TwinError(2001 /* COMMAND_NOT_FOUND */, `\u547D\u4EE4\u672A\u6CE8\u518C: ${command}`);
}

// src/core/registry.ts
var COMMAND_NAME_RE = /^[A-Z][A-Za-z0-9]*(\.[A-Z][A-Za-z0-9]*)*$/;
var CommandRegistry = class {
  constructor() {
    this.commands = /* @__PURE__ */ new Map();
  }
  register(def, opts = {}) {
    if (!COMMAND_NAME_RE.test(def.name)) {
      throw new TwinError(
        2002 /* INVALID_PARAMS */,
        `\u547D\u4EE4\u540D ${def.name} \u4E0D\u5408\u6CD5\uFF1A\u9700 PascalCase\uFF0C\u81EA\u5B9A\u4E49\u547D\u4EE4\u987B\u5E26\u4E1A\u52A1\u524D\u7F00\uFF08\u5982 Biz.PatrolMode\uFF09`
      );
    }
    const existing = this.commands.get(def.name);
    if (existing?.protected || existing && opts.internal && !def.protected) {
      throw new TwinError(2005 /* COMMAND_REJECTED */, `\u5185\u7F6E\u547D\u4EE4 ${def.name} \u4E0D\u53EF\u8986\u76D6`);
    }
    if (existing && !existing.protected && opts.internal) {
      throw new TwinError(2005 /* COMMAND_REJECTED */, `\u547D\u4EE4 ${def.name} \u5DF2\u88AB\u81EA\u5B9A\u4E49\u6CE8\u518C\u5360\u7528`);
    }
    this.commands.set(def.name, { ...def, protected: def.protected ?? opts.internal });
  }
  unregister(command) {
    const def = this.commands.get(command);
    if (!def) return;
    if (def.protected) {
      throw new TwinError(2005 /* COMMAND_REJECTED */, `\u5185\u7F6E\u547D\u4EE4 ${command} \u4E0D\u53EF\u6CE8\u9500`);
    }
    this.commands.delete(command);
  }
  get(command) {
    return this.commands.get(command);
  }
  list() {
    return [...this.commands.values()].map((d) => ({
      name: d.name,
      category: d.category,
      since: d.since,
      deprecated: Boolean(d.deprecated),
      queue: d.queue ?? "parallel",
      internal: Boolean(d.protected)
    }));
  }
  /** 元数据导出：驱动文档站点与 IDE 提示同源（设计文档 §8） */
  exportMeta() {
    return JSON.stringify(this.list(), null, 2);
  }
};

// src/core/queue.ts
var CommandQueue = class {
  constructor(maxQueue = 500) {
    this.maxQueue = maxQueue;
    this.serialChain = Promise.resolve();
    this.pendingLatest = /* @__PURE__ */ new Map();
    this.length = 0;
  }
  get currentLength() {
    return this.length;
  }
  async run(def, task) {
    if (this.length >= this.maxQueue) {
      throw new TwinError(2006 /* QUEUE_OVERFLOW */, `\u547D\u4EE4\u961F\u5217\u5DF2\u8FBE\u4E0A\u9650 ${this.maxQueue}\uFF0C\u62D2\u7EDD\u5165\u961F`);
    }
    this.length += 1;
    try {
      switch (def.queue ?? "parallel") {
        case "serial":
          return await this.runSerial(task);
        case "latest":
          return await this.runLatest(def.name, task);
        default:
          return await task(new AbortController().signal);
      }
    } finally {
      this.length -= 1;
    }
  }
  runSerial(task) {
    const next = this.serialChain.then(
      () => task(new AbortController().signal),
      () => task(new AbortController().signal)
      // 前序失败不阻断后续（失败隔离）
    );
    this.serialChain = next.catch(() => void 0);
    return next;
  }
  runLatest(name, task) {
    this.pendingLatest.get(name)?.abort();
    const controller = new AbortController();
    this.pendingLatest.set(name, controller);
    return task(controller.signal).finally(() => {
      if (this.pendingLatest.get(name) === controller) this.pendingLatest.delete(name);
    });
  }
  abortAll() {
    for (const controller of this.pendingLatest.values()) controller.abort();
    this.pendingLatest.clear();
  }
};

// src/core/event-bus.ts
var MAX_LISTENERS_PER_EVENT = 200;
var DEFAULT_THROTTLE = {
  SceneHover: 100,
  EntityHover: 100,
  CameraChanged: 50,
  SceneLoadingProgress: 100
};
var TwinEventBus = class {
  constructor(throttle = DEFAULT_THROTTLE) {
    this.throttle = throttle;
    this.listeners = /* @__PURE__ */ new Map();
    this.lastEmit = /* @__PURE__ */ new Map();
    this.timers = /* @__PURE__ */ new Map();
  }
  on(event, listener) {
    let set = this.listeners.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.listeners.set(event, set);
    }
    if (set.size >= MAX_LISTENERS_PER_EVENT) {
      throw new TwinError(
        6002 /* LISTENER_LIMIT_EXCEEDED */,
        `\u4E8B\u4EF6 ${event} \u76D1\u542C\u5668\u5DF2\u8FBE\u4E0A\u9650 ${MAX_LISTENERS_PER_EVENT}`
      );
    }
    const wrapped = listener;
    set.add(wrapped);
    return () => set.delete(wrapped);
  }
  once(event, listener) {
    const off = this.on(event, ((payload) => {
      off();
      listener(payload);
    }));
    return off;
  }
  off(event, listener) {
    this.listeners.get(event)?.delete(listener);
  }
  emit(event, payload) {
    const interval = this.throttle[event] ?? 0;
    if (interval > 0) {
      const now = Date.now();
      const last = this.lastEmit.get(event);
      if (last && now - last.at < interval) {
        this.scheduleTrailing(event, payload, interval);
        return;
      }
      this.lastEmit.set(event, { at: now, payload });
    }
    this.dispatch(event, payload);
  }
  scheduleTrailing(event, payload, interval) {
    const last = this.lastEmit.get(event);
    if (last) last.payload = payload;
    if (this.timers.has(event)) return;
    const timer = setTimeout(() => {
      this.timers.delete(event);
      const l = this.lastEmit.get(event);
      if (l) {
        this.lastEmit.set(event, { at: Date.now(), payload: l.payload });
        this.dispatch(event, l.payload);
      }
    }, interval);
    this.timers.set(event, timer);
  }
  dispatch(event, payload) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[DigitalTwin] \u4E8B\u4EF6 ${event} \u76D1\u542C\u5668\u5F02\u5E38:`, err);
      }
    }
  }
  clear() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.listeners.clear();
    this.lastEmit.clear();
  }
};

// src/core/envelope.ts
var seq = 0;
var rand = () => {
  try {
    return crypto.randomUUID();
  } catch {
    seq += 1;
    return `req-${Date.now().toString(36)}-${seq}`;
  }
};
function ok(ctx, data) {
  return {
    code: 0 /* OK */,
    message: "ok",
    data,
    command: ctx.command,
    requestId: ctx.requestId ?? rand(),
    elapsed: Date.now() - (ctx.startedAt ?? Date.now())
  };
}
function fail(ctx, err) {
  const twinErr = toTwinError(err);
  return {
    code: twinErr.code,
    message: twinErr.message,
    command: ctx.command,
    requestId: ctx.requestId ?? rand(),
    elapsed: Date.now() - (ctx.startedAt ?? Date.now())
  };
}

// src/core/validate.ts
var isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function validateParams(schema, params) {
  const errors = [];
  if (schema === void 0) return errors;
  if (params === void 0 || params === null) {
    const required = Object.entries(schema).filter(([, s]) => s.required);
    for (const [key] of required) {
      errors.push({ path: `/${key}`, rule: "required", detail: "\u7F3A\u5C11\u5FC5\u586B\u53C2\u6570" });
    }
    return errors;
  }
  if (!isPlainObject(params)) {
    errors.push({ path: "/", rule: "type", detail: `\u671F\u671B object\uFF0C\u5B9E\u9645 ${typeof params}` });
    return errors;
  }
  const walk = (props, obj, base) => {
    for (const [key, rule] of Object.entries(props)) {
      const path = `${base}/${key}`;
      const value = obj[key];
      if (value === void 0) {
        if (rule.required) errors.push({ path, rule: "required", detail: "\u7F3A\u5C11\u5FC5\u586B\u53C2\u6570" });
        continue;
      }
      validateValue(rule, value, path, errors);
    }
  };
  const validateValue = (rule, value, path, out) => {
    const t = rule.type;
    if (t === "number" && typeof value !== "number") {
      out.push({ path, rule: "type", detail: `\u671F\u671B number\uFF0C\u5B9E\u9645 ${typeof value}` });
      return;
    }
    if (t === "string" && typeof value !== "string") {
      out.push({ path, rule: "type", detail: `\u671F\u671B string\uFF0C\u5B9E\u9645 ${typeof value}` });
      return;
    }
    if (t === "boolean" && typeof value !== "boolean") {
      out.push({ path, rule: "type", detail: `\u671F\u671B boolean\uFF0C\u5B9E\u9645 ${typeof value}` });
      return;
    }
    if (t === "array") {
      if (!Array.isArray(value)) {
        out.push({ path, rule: "type", detail: `\u671F\u671B array\uFF0C\u5B9E\u9645 ${typeof value}` });
        return;
      }
      if (rule.items) {
        value.forEach((item, i) => validateValue(rule.items, item, `${path}/${i}`, out));
      }
      return;
    }
    if (t === "object") {
      if (!isPlainObject(value)) {
        out.push({ path, rule: "type", detail: `\u671F\u671B object\uFF0C\u5B9E\u9645 ${typeof value}` });
        return;
      }
      if (rule.properties) walk(rule.properties, value, path);
      return;
    }
    if (typeof value === "number") {
      if (rule.min !== void 0 && value < rule.min) {
        out.push({ path, rule: "min", detail: `${value} < ${rule.min}` });
      }
      if (rule.max !== void 0 && value > rule.max) {
        out.push({ path, rule: "max", detail: `${value} > ${rule.max}` });
      }
    }
    if (typeof value === "string" && rule.enum && !rule.enum.includes(value)) {
      out.push({ path, rule: "enum", detail: `${value} \u4E0D\u5728 [${rule.enum.join(", ")}] \u5185` });
    }
  };
  walk(schema, params, "");
  return errors;
}

// src/core/scheduler.ts
var Scheduler = class {
  constructor(registry, queue, deps) {
    this.registry = registry;
    this.queue = queue;
    this.deps = deps;
    this.destroyed = false;
  }
  markDestroyed() {
    this.destroyed = true;
    this.queue.abortAll();
  }
  async execute(command, params) {
    const startedAt = Date.now();
    const def = this.registry.get(command);
    if (!def) {
      return fail({ command, startedAt }, errCommandNotFound(command));
    }
    if (this.destroyed) {
      return fail(
        { command, startedAt },
        new TwinError(1006 /* ENGINE_DESTROYED */, "\u5B9E\u4F8B\u5DF2\u9500\u6BC1")
      );
    }
    if (this.deps.requiresEngine(def) && !this.deps.isReady()) {
      return fail(
        { command, startedAt },
        new TwinError(2004 /* ENGINE_NOT_READY */, `\u547D\u4EE4 ${command} \u9700\u8981\u573A\u666F\u5C31\u7EEA\u540E\u6267\u884C\uFF08\u5148\u5B8C\u6210 LoadScene\uFF09`)
      );
    }
    const validationErrors = validateParams(def.params, params);
    if (validationErrors.length > 0) {
      return fail({ command, startedAt }, toTwinError(invalid(command, validationErrors)));
    }
    if (def.deprecated) {
      this.deps.logger.warn(
        `\u547D\u4EE4 ${command} \u81EA ${def.deprecated.since} \u8D77\u5F03\u7528${def.deprecated.useInstead ? `\uFF0C\u8BF7\u6539\u7528 ${def.deprecated.useInstead}` : ""}`
      );
    }
    const timeout = def.timeout ?? this.deps.defaultTimeout;
    const runController = new AbortController();
    const timer = timeout > 0 ? setTimeout(() => runController.abort(), timeout) : null;
    try {
      const requestId = `req-${command}-${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
      const ctx = {
        ...this.deps.context,
        signal: runController.signal,
        requestId
      };
      const raw = await this.queue.run(def, async (queueSignal) => {
        if (queueSignal.aborted) runController.abort();
        else queueSignal.addEventListener("abort", () => runController.abort());
        return await Promise.race([
          def.handler(ctx, params),
          new Promise((_, reject) => {
            if (runController.signal.aborted) reject(abortError(command));
            else runController.signal.addEventListener("abort", () => reject(abortError(command)));
          })
        ]);
      });
      return ok({ command, startedAt, requestId }, raw);
    } catch (err) {
      const twinErr = toTwinError(err);
      if (twinErr.code === 2003 /* COMMAND_TIMEOUT */) {
        return fail(
          { command, startedAt },
          new TwinError(2003 /* COMMAND_TIMEOUT */, `\u547D\u4EE4 ${command} \u6267\u884C\u8D85\u65F6\uFF08${timeout}ms\uFF09`)
        );
      }
      this.deps.logger.error(`\u547D\u4EE4 ${command} \u5931\u8D25: ${twinErr.message}`);
      return fail({ command, startedAt }, twinErr);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
};
function abortError(command) {
  return new TwinError(2003 /* COMMAND_TIMEOUT */, `\u547D\u4EE4 ${command} \u88AB\u53D6\u6D88`);
}
function invalid(command, errors) {
  const first = errors[0];
  return new TwinError(
    2002 /* INVALID_PARAMS */,
    `${command} \u53C2\u6570\u6821\u9A8C\u5931\u8D25 \u2014 ${first.path} ${first.rule}: ${first.detail}`,
    errors
  );
}

// src/core/builtins.ts
function createBuiltinCommands(engine, scenes) {
  const manifestFor = (sceneId) => {
    const manifest = scenes[sceneId];
    if (!manifest) {
      throw new TwinError(3001 /* SCENE_NOT_FOUND */, `\u573A\u666F ${sceneId} \u672A\u5728 scenes \u6E05\u5355\u4E2D\u6CE8\u518C`);
    }
    return manifest;
  };
  const def = (name, category, handler, extra = {}) => ({
    name,
    category,
    handler: (_ctx, params) => handler(params),
    protected: true,
    since: "1.0.0",
    ...extra
  });
  const requireSelector = (selector, command) => {
    const asRecord = selector;
    const valid = ["eids", "entityNames", "customIds"].filter(
      (key) => Array.isArray(asRecord[key]) && asRecord[key].length > 0
    );
    if (valid.length !== 1) {
      throw new TwinError(
        2002 /* INVALID_PARAMS */,
        `${command}: targets \u9009\u62E9\u5668\u5FC5\u987B\u4E14\u53EA\u80FD\u5305\u542B eids / entityNames / customIds \u4E4B\u4E00\uFF08\u975E\u7A7A\u6570\u7EC4\uFF09`
      );
    }
    return selector;
  };
  return [
    // ---- 场景（4）----
    def(
      "LoadScene",
      "scene",
      (p) => engine.loadScene(manifestFor(p.sceneId), p),
      { queue: "serial" }
    ),
    def(
      "SwitchScene",
      "scene",
      (p) => engine.switchScene(manifestFor(p.sceneId), p),
      { queue: "serial" }
    ),
    def("GetSceneInfo", "scene", () => engine.getSceneInfo()),
    def("SetEnvironment", "scene", (p) => engine.setEnvironment(p)),
    // ---- 相机（7）----
    def("CameraFlyTo", "camera", (p) => engine.cameraFlyTo(p), {
      queue: "latest"
    }),
    def("CameraFocusOn", "camera", (p) => engine.cameraFocusOn(p)),
    def(
      "CameraRoamStart",
      "camera",
      (p) => engine.cameraRoamStart(p)
    ),
    def("CameraRoamStop", "camera", () => engine.cameraRoamStop()),
    def("GetCameraInfo", "camera", () => engine.getCameraState()),
    def("SetCameraLimit", "camera", (p) => engine.setCameraLimit(p)),
    def("ResetCameraView", "camera", () => engine.resetCameraView()),
    // ---- 实体（6）----
    def(
      "SetEntityVisible",
      "entity",
      (p) => engine.setEntityVisible({ ...p, targets: requireSelector(p.targets, "SetEntityVisible") })
    ),
    def(
      "SetEntityOutline",
      "entity",
      (p) => engine.setEntityOutline({ ...p, targets: requireSelector(p.targets, "SetEntityOutline") })
    ),
    def(
      "SetEntityHighlight",
      "entity",
      (p) => engine.setEntityHighlight({ ...p, targets: requireSelector(p.targets, "SetEntityHighlight") })
    ),
    def(
      "LocateEntity",
      "entity",
      (p) => engine.locateEntity({ ...p, targets: requireSelector(p.targets, "LocateEntity") })
    ),
    def(
      "GetEntityInfo",
      "entity",
      (p) => engine.getEntityInfo(requireSelector(p, "GetEntityInfo"))
    ),
    def(
      "MoveEntityByPath",
      "entity",
      (p) => engine.moveEntityByPath({ ...p, targets: requireSelector(p.targets, "MoveEntityByPath") })
    ),
    // ---- 图层（3）----
    def("GetLayerList", "layer", () => engine.getLayerList()),
    def(
      "SetLayerVisible",
      "layer",
      (p) => engine.setLayerVisible(p)
    ),
    def("SetLayerOpacity", "layer", (p) => engine.setLayerOpacity(p)),
    // ---- 特效（7）----
    def("SetWeatherEffect", "effect", (p) => engine.setWeatherEffect(p)),
    def("SetHeatmap", "effect", (p) => engine.setHeatmap(p)),
    def("UpdateHeatmap", "effect", (p) => engine.updateHeatmap(p)),
    def("RemoveHeatmap", "effect", (p) => engine.removeHeatmap(p.heatmapId)),
    def("SetParticleEffect", "effect", (p) => engine.setParticleEffect(p)),
    def("SetLightEffect", "effect", (p) => engine.setLightEffect(p)),
    def("SetHighlightRegion", "effect", (p) => engine.setHighlightRegion(p)),
    // ---- 标注 / 覆盖物（6）----
    def("AddPOI", "covering", (p) => engine.addPOI(p)),
    def("UpdatePOI", "covering", (p) => engine.updatePOI(p)),
    def("AddPath", "covering", (p) => engine.addPath(p)),
    def("Add3DText", "covering", (p) => engine.add3DText(p)),
    def(
      "RemoveCovering",
      "covering",
      (p) => engine.removeCovering(p.coveringIds)
    ),
    def(
      "ClearCoverings",
      "covering",
      (p) => engine.clearCoverings(p.types)
    )
  ];
}

// src/core/engine-stub.ts
function createStubEngine() {
  const notReady = (op) => {
    throw new TwinError(
      2004 /* ENGINE_NOT_READY */,
      `\u6869\u5F15\u64CE\u4E0D\u652F\u6301 ${op}\uFF1A\u8BF7\u63A5\u5165 @your-scope/digital-twin-core \u63D0\u4F9B\u7684 BabylonEngineFacade`
    );
  };
  let ready = false;
  return {
    isReady: () => ready,
    loadScene: async () => {
      ready = true;
      return { sceneId: "stub", ready: true, entityCount: 0, layers: [] };
    },
    switchScene: async (_m, _p) => notReady("switchScene"),
    getSceneInfo: () => ({ sceneId: "stub", ready, entityCount: 0, layers: [] }),
    setEnvironment: async () => notReady("setEnvironment"),
    cameraFlyTo: async () => notReady("cameraFlyTo"),
    cameraFocusOn: async () => notReady("cameraFocusOn"),
    cameraRoamStart: async (_p) => notReady("cameraRoamStart"),
    cameraRoamStop: async () => notReady("cameraRoamStop"),
    getCameraState: () => notReady("getCameraState"),
    setCameraLimit: async (_p) => notReady("setCameraLimit"),
    resetCameraView: async () => notReady("resetCameraView"),
    setEntityVisible: async (_p) => notReady("setEntityVisible"),
    setEntityOutline: async (_p) => notReady("setEntityOutline"),
    setEntityHighlight: async (_p) => notReady("setEntityHighlight"),
    locateEntity: async (_p) => notReady("locateEntity"),
    getEntityInfo: (_s) => notReady("getEntityInfo"),
    moveEntityByPath: async (_p) => notReady("moveEntityByPath"),
    getLayerList: () => [],
    setLayerVisible: async (_p) => notReady("setLayerVisible"),
    setLayerOpacity: async (_p) => notReady("setLayerOpacity"),
    setWeatherEffect: async (_p) => notReady("setWeatherEffect"),
    setHeatmap: async (_p) => notReady("setHeatmap"),
    updateHeatmap: async (_p) => notReady("updateHeatmap"),
    removeHeatmap: async () => notReady("removeHeatmap"),
    setParticleEffect: async (_p) => notReady("setParticleEffect"),
    setLightEffect: async (_p) => notReady("setLightEffect"),
    setHighlightRegion: async (_p) => notReady("setHighlightRegion"),
    addPOI: async (_p) => notReady("addPOI"),
    updatePOI: async (_p) => notReady("updatePOI"),
    addPath: async (_p) => notReady("addPath"),
    add3DText: async (_p) => notReady("add3DText"),
    removeCovering: async () => notReady("removeCovering"),
    clearCoverings: async () => notReady("clearCoverings"),
    dispose: async () => {
      ready = false;
    }
  };
}

// src/facade.ts
var SDK_VERSION = "0.1.0";
var LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
function createLogger(level) {
  const threshold = LEVEL_ORDER[level ?? "warn"];
  const method = {
    debug: "log",
    info: "info",
    warn: "warn",
    error: "error",
    silent: null
  };
  const log = (lv, msg, meta) => {
    const fn = method[lv];
    if (fn && LEVEL_ORDER[lv] >= threshold) console[fn]("[DigitalTwin]", msg, meta ?? "");
  };
  return {
    debug: (m, meta) => log("debug", m, meta),
    info: (m, meta) => log("info", m, meta),
    warn: (m, meta) => log("warn", m, meta),
    error: (m, meta) => log("error", m, meta)
  };
}
var activeInstance = null;
async function createDigitalTwin(options, internal = {}) {
  if (activeInstance) {
    console.warn("[DigitalTwin] \u68C0\u6D4B\u5230\u91CD\u590D\u521B\u5EFA\u5B9E\u4F8B\uFF1A\u5C06\u5148\u9500\u6BC1\u5DF2\u6709\u5B9E\u4F8B\uFF08\u5355\u5B9E\u4F8B\u8BBE\u8BA1\uFF09");
    await activeInstance.destroy();
  }
  const logger = createLogger(options.logLevel);
  const events = new TwinEventBus();
  const engine = typeof internal.engine === "function" ? internal.engine(events) : internal.engine ?? createStubEngine();
  const registry = new CommandRegistry();
  const queue = new CommandQueue();
  for (const def of createBuiltinCommands(engine, options.scenes)) {
    registry.register(def, { internal: true });
  }
  let destroyed = false;
  let sceneReady = false;
  const scheduler = new Scheduler(registry, queue, {
    logger,
    defaultTimeout: options.defaultTimeout ?? 1e4,
    isReady: () => engine.isReady(),
    // LoadScene/SwitchScene 是使引擎就绪的命令本身，执行前不要求就绪
    requiresEngine: (def) => def.category !== "custom" && def.name !== "LoadScene" && def.name !== "SwitchScene",
    context: { engine, logger }
  });
  const api = {
    execute: (async (command, ...args) => {
      const params = args[0];
      if (destroyed) {
        return {
          code: 1006 /* ENGINE_DESTROYED */,
          message: "[1006] \u5B9E\u4F8B\u5DF2\u9500\u6BC1\uFF0C\u8BF7\u91CD\u65B0 createDigitalTwin()",
          command,
          requestId: "n/a",
          elapsed: 0
        };
      }
      return scheduler.execute(command, params);
    }),
    on(event, listener) {
      return events.on(event, listener);
    },
    once(event, listener) {
      return events.once(event, listener);
    },
    off(event, listener) {
      events.off(event, listener);
    },
    registerCommand(definition) {
      if (destroyed) throw toTwinError(new Error("\u5B9E\u4F8B\u5DF2\u9500\u6BC1"));
      registry.register({ ...definition, protected: false });
    },
    unregisterCommand(command) {
      registry.unregister(command);
    },
    listCommands() {
      return registry.list();
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      scheduler.markDestroyed();
      events.emit("RuntimeWarning", { code: 1006, message: "\u5B9E\u4F8B\u9500\u6BC1" });
      events.clear();
      await engine.dispose();
      if (activeInstance === api) activeInstance = null;
    },
    get diagnostics() {
      return {
        version: SDK_VERSION,
        backend: "webgl2",
        fps: 0,
        queueLength: queue.currentLength,
        sceneReady,
        coverings: {}
      };
    }
  };
  activeInstance = api;
  sceneReady = engine.isReady();
  return api;
}
export {
  CommandRegistry,
  ErrorCode,
  TwinError,
  TwinEventBus,
  createDigitalTwin
};
//# sourceMappingURL=index.js.map
