// Remielle desktop pet — DSH plugin, browser half (hand-written bundle).
//
// The pet is an imperative DOM widget appended to document.body (fixed
// position, viewport coordinates). The sidebar toggle stays a slot contribution.
//
// Behavior layers:
//   - harness phase -> action (projection feed)
//   - one-shot performances (celebrate/failed/tricks) with auto fallback
//   - expect countdown after work ends -> "waiting for confirmation"
//   - idle cycle: every 2-6s either a random trick (40%) or roaming (if on)
//   - right-click menu: tricks / free-roam / show-hide
window.__ModuleLoader__.load({
  id: "remielle-dsh",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");
    var jsxRuntime = require("react/jsx-runtime");

    var BASE = "/plugins/remielle-dsh/assets/";
    var ACTION_SRC = {
      idle: BASE + "gif/1.gif",
      expect: BASE + "gif/2.gif",
      pen_idle: BASE + "gif/3.gif",
      work: BASE + "gif/4.gif",
      smug: BASE + "gif/5.gif",
      intermittent: BASE + "gif/6.gif",
      think: BASE + "gif/7.gif",
      run_left: BASE + "png/run-left.png",
      run_right: BASE + "png/run-right.png",
      waving: BASE + "png/waving.png",
      failed: BASE + "png/failed.png",
      // 等待確認 reuses the expect GIF (user preference: it animates)
      waiting: BASE + "gif/2.gif",
    };
    var TRICK_LABELS = {
      expect: "期待",
      pen_idle: "鋼筆待機",
      work: "工作中",
      smug: "慶祝",
      intermittent: "間歇",
      think: "檢查中",
      failed: "失敗",
      waiting: "等待確認",
    };
    var TRICK_POOL = Object.keys(TRICK_LABELS);

    function phaseAction(phase) {
      switch (phase) {
        case "working": return "work";
        case "waiting": return "waiting";
        case "celebrate": return "smug";
        case "failed": return "failed";
        default: return "idle";
      }
    }

    var POS_KEY = "remielle-dsh.position.v4";
    var VIS_KEY = "remielle-dsh.visible.v4";
    var SETTINGS_KEY = "remielle-dsh.settings.v1";
    var DEFAULT_SETTINGS = {
      animateForHarness: true,
      expectTimeoutSeconds: 300,
      idleMinSeconds: 2,
      idleMaxSeconds: 6,
      trickChance: 0.4,
      celebrationCooldownSeconds: 30,
      freeRoam: false,
    };

    function readVisible() {
      try { return localStorage.getItem(VIS_KEY) !== "0"; } catch (e) { return true; }
    }
    function loadPos() {
      try {
        var p = JSON.parse(localStorage.getItem(POS_KEY) || "null");
        if (p && typeof p.x === "number" && typeof p.y === "number") return p;
      } catch (e) {}
      return null;
    }
    function loadSettings() {
      var s = {};
      for (var k in DEFAULT_SETTINGS) s[k] = DEFAULT_SETTINGS[k];
      try {
        var raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
        if (raw && typeof raw === "object") {
          for (var k2 in DEFAULT_SETTINGS) {
            if (typeof raw[k2] === typeof DEFAULT_SETTINGS[k2]) s[k2] = raw[k2];
          }
        }
      } catch (e) {}
      return s;
    }
    function saveSettings(s) {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
    }

    /** Imperative pet widget. */
    function startPet(ctx) {
      var host = document.createElement("div");
      host.setAttribute("data-remielle-pet", "true");
      host.style.cssText =
        "position:fixed;z-index:2147483000;pointer-events:auto;cursor:grab;user-select:none;";
      var img = document.createElement("img");
      img.draggable = false;
      img.alt = "Remielle";
      img.style.cssText = "width:120px;height:auto;display:block;";
      host.appendChild(img);
      document.body.appendChild(host);

      var sessions = ctx.sessions;
      var unsubFace = null;
      var visible = readVisible();
      var settings = loadSettings();

      // behavior state
      var phase = "idle";
      var display = "idle";
      var transientTimer = null;
      var expectTimer = null;
      var idleTimer = null;
      var roamRaf = null;
      var roaming = false;
      var roamDir = 1;
      var wasWorking = false;
      var lastCelebrateAt = 0;
      var lastFailedAt = 0;

      function setDisplay(a) {
        display = a;
        img.src = ACTION_SRC[a] || ACTION_SRC.idle;
      }
      function clearTransient() {
        if (transientTimer) { clearTimeout(transientTimer); transientTimer = null; }
      }
      function clearExpect() {
        if (expectTimer) { clearTimeout(expectTimer); expectTimer = null; }
      }
      function stopIdleCycle() {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      }
      function stopRoam() {
        roaming = false;
        if (roamRaf) { cancelAnimationFrame(roamRaf); roamRaf = null; }
      }

      function playTransient(action, ms, then) {
        clearTransient();
        setDisplay(action);
        transientTimer = setTimeout(function () {
          transientTimer = null;
          if (then) then();
        }, ms);
      }

      function afterTransient() {
        // one-shot phases (celebrate/failed) are consumed by their performance;
        // treat them as idle from here on so downstream logic sees the truth
        if (phase === "celebrate" || phase === "failed") phase = "idle";
        if (phase === "idle") {
          if (wasWorking) {
            wasWorking = false;
            startExpect();
          } else {
            refreshDisplay();
          }
        } else {
          onPhase(phase);
        }
      }

      function startExpect() {
        clearExpect();
        setDisplay("expect");
        var ms = Math.max(1, Number(settings.expectTimeoutSeconds) || 300) * 1000;
        expectTimer = setTimeout(function () {
          expectTimer = null;
          if (phase === "idle") {
            // idle after the expect countdown: settle into the pen-idle pose
            // and resume the ordinary idle cycle
            setDisplay("pen_idle");
            scheduleIdle();
          }
        }, ms);
      }

      function refreshDisplay() {
        if (phase === "working") { setDisplay("work"); return; }
        if (phase === "waiting") { setDisplay("waiting"); return; }
        if (transientTimer || expectTimer || roaming || idleTimer) return;
        setDisplay("pen_idle");
        scheduleIdle();
      }

      function scheduleIdle() {
        var lo = Math.max(0.5, Number(settings.idleMinSeconds) || 2);
        var hi = Math.max(lo, Number(settings.idleMaxSeconds) || 6);
        var delay = lo + Math.random() * (hi - lo);
        idleTimer = setTimeout(function () {
          idleTimer = null;
          idleTick();
        }, delay * 1000);
      }

      function idleTick() {
        if (phase !== "idle" || transientTimer || expectTimer || roaming) return;
        if (Math.random() < (Number(settings.trickChance) || 0)) {
          var trick = TRICK_POOL[Math.floor(Math.random() * TRICK_POOL.length)];
          playTransient(trick, 2200 + Math.random() * 900, function () {
            if (phase === "idle" && Math.random() < 0.4) idleTick();
            else refreshDisplay();
          });
        } else if (settings.freeRoam) {
          startRoam();
        } else {
          refreshDisplay();
        }
      }

      function startRoam() {
        stopRoam();
        roaming = true;
        roamDir = Math.random() < 0.5 ? -1 : 1;
        var SPEED = 150; // px per second
        var duration = 1500 + Math.random() * 1500;
        var started = performance.now();
        var last = started;
        var limit = Math.max(80, window.innerWidth - 140);
        setDisplay(roamDir === 1 ? "run_right" : "run_left");
        function frame(now) {
          if (!roaming) return;
          roamRaf = null;
          var dt = Math.min(50, now - last);
          last = now;
          var nx = pos.x + roamDir * (SPEED * dt) / 1000;
          if (nx <= 4) { nx = 4; roamDir = 1; setDisplay("run_right"); }
          else if (nx >= limit) { nx = limit; roamDir = -1; setDisplay("run_left"); }
          pos = { x: nx, y: pos.y };
          renderPos();
          if (now - started >= duration) {
            stopRoam();
            refreshDisplay();
            return;
          }
          roamRaf = requestAnimationFrame(frame);
        }
        roamRaf = requestAnimationFrame(frame);
      }

      function onPhase(p) {
        if (p === phase) {
          if (p === "idle") refreshDisplay();
          return;
        }
        phase = p;
        if (!settings.animateForHarness) {
          if (p === "idle") { clearTransient(); clearExpect(); refreshDisplay(); }
          return;
        }
        switch (p) {
          case "working":
            clearTransient(); clearExpect(); stopIdleCycle(); stopRoam();
            wasWorking = true;
            setDisplay("work");
            break;
          case "waiting":
            clearTransient(); clearExpect(); stopIdleCycle(); stopRoam();
            setDisplay("waiting");
            break;
          case "celebrate": {
            stopIdleCycle(); stopRoam(); clearExpect();
            var now = Date.now();
            if (now - lastCelebrateAt >= (Number(settings.celebrationCooldownSeconds) || 30) * 1000) {
              lastCelebrateAt = now;
              playTransient("smug", 3000, afterTransient);
            } else {
              afterTransient();
            }
            break;
          }
          case "failed": {
            stopIdleCycle(); stopRoam(); clearExpect();
            var now2 = Date.now();
            if (now2 - lastFailedAt >= (Number(settings.celebrationCooldownSeconds) || 30) * 1000) {
              lastFailedAt = now2;
              playTransient("failed", 3500, afterTransient);
            } else {
              afterTransient();
            }
            break;
          }
          case "idle":
            if (wasWorking) {
              wasWorking = false;
              startExpect();
            } else {
              refreshDisplay();
            }
            break;
        }
      }

      function rebind() {
        if (unsubFace) { unsubFace(); unsubFace = null; }
        var currentId = sessions.list.getSnapshot().current;
        if (!currentId) { onPhase("idle"); return; }
        var binding = sessions.binding(currentId);
        var face = binding && binding.session && binding.session.projections.faceOf("remielle");
        if (!face) { onPhase("idle"); return; }
        var apply = function () {
          var s = face.getSnapshot();
          onPhase(s && s.phase ? s.phase : "idle");
        };
        apply();
        unsubFace = face.subscribe(apply);
      }
      rebind();
      var unsubList = sessions.list.subscribe(rebind);

      // position
      var pos = loadPos() || { x: 8, y: 8 };
      function renderPos() {
        host.style.left = Math.max(0, pos.x) + "px";
        host.style.top = Math.max(0, pos.y) + "px";
      }
      renderPos();

      // drag
      var dragging = false, dx = 0, dy = 0;
      host.addEventListener("pointerdown", function (e) {
        if (e.button !== 0) return;
        dragging = true;
        dx = e.clientX - pos.x;
        dy = e.clientY - pos.y;
        try { host.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      });
      host.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        pos = { x: e.clientX - dx, y: e.clientY - dy };
        renderPos();
      });
      host.addEventListener("pointerup", function () {
        if (!dragging) return;
        dragging = false;
        try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (e) {}
      });
      host.addEventListener("click", function () {
        if (dragging) return;
        playTransient("smug", 2500, refreshDisplay);
      });

      // right-click menu
      var menu = null;
      var menuOutHandler = null;
      function closeMenu() {
        if (menuOutHandler) {
          window.removeEventListener("pointerdown", menuOutHandler);
          menuOutHandler = null;
        }
        if (menu) { menu.remove(); menu = null; }
      }
      function menuItem(label, onClick) {
        var row = document.createElement("div");
        row.textContent = label;
        row.style.cssText =
          "padding:6px 10px;border-radius:6px;cursor:pointer;white-space:nowrap;";
        row.addEventListener("mouseenter", function () {
          row.style.background = "var(--dsw-alias-fill-l2, rgba(255,255,255,0.08))";
        });
        row.addEventListener("mouseleave", function () {
          row.style.background = "transparent";
        });
        row.addEventListener("click", function () {
          closeMenu();
          onClick();
        });
        menu.appendChild(row);
        return row;
      }
      function openMenu(x, y) {
        closeMenu();
        menu = document.createElement("div");
        menu.setAttribute("data-remielle-menu", "true");
        menu.style.cssText =
          "position:fixed;z-index:2147483001;left:" + x + "px;top:" + y + "px;" +
          "background:var(--dsw-specific-menu, #1e1e2a);" +
          "border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.15));" +
          "border-radius:10px;padding:6px;min-width:150px;" +
          "box-shadow:0 8px 24px rgba(0,0,0,0.4);font-size:13px;" +
          "color:var(--dsw-alias-label-primary, #eee);";
        document.body.appendChild(menu);

        menuItem(visible ? "隱藏小蕾米" : "顯示小蕾米", function () {
          toggleVisible(!visible);
        });
        var roamRow = menuItem("自由移動" + (settings.freeRoam ? " ✓" : ""), function () {
          settings.freeRoam = !settings.freeRoam;
          saveSettings(settings);
          roamRow.textContent = "自由移動" + (settings.freeRoam ? " ✓" : "");
          if (settings.freeRoam) refreshDisplay();
        });

        var sep = document.createElement("div");
        sep.style.cssText =
          "height:1px;background:var(--dsw-alias-border-l2, rgba(255,255,255,0.1));margin:4px 6px;";
        menu.appendChild(sep);

        var title = document.createElement("div");
        title.textContent = "表演動作";
        title.style.cssText = "padding:2px 10px;opacity:0.6;font-size:11px;";
        menu.appendChild(title);

        for (var i = 0; i < TRICK_POOL.length; i++) {
          (function (name) {
            menuItem(TRICK_LABELS[name], function () {
              playTransient(name, 2500, refreshDisplay);
            });
          })(TRICK_POOL[i]);
        }

        menuOutHandler = function (e) {
          // clicks inside the menu (or on the pet that reopens it) keep it open
          if (menu && menu.contains(e.target)) return;
          closeMenu();
        };
        setTimeout(function () {
          window.addEventListener("pointerdown", menuOutHandler);
        }, 0);
      }
      host.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openMenu(e.clientX, e.clientY);
      });

      // visibility
      function toggleVisible(next) {
        visible = next;
        host.style.display = visible ? "" : "none";
        try { localStorage.setItem(VIS_KEY, visible ? "1" : "0"); } catch (e) {}
        window.dispatchEvent(new CustomEvent("remielle-visibility", { detail: visible }));
      }
      function onVis(e) {
        visible = e.detail !== false;
        host.style.display = visible ? "" : "none";
      }
      window.addEventListener("remielle-visibility", onVis);
      host.style.display = visible ? "" : "none";

      // live settings updates from the settings card
      function onSettings(e) {
        if (e.detail && typeof e.detail === "object") {
          for (var k in settings) {
            if (typeof e.detail[k] === typeof settings[k]) settings[k] = e.detail[k];
          }
          // restart in-flight timers so the new values take effect immediately
          if (expectTimer) startExpect();
          if (idleTimer && phase === "idle") {
            stopIdleCycle();
            scheduleIdle();
          }
          refreshDisplay();
        }
      }
      window.addEventListener("remielle-settings", onSettings);

      return function dispose() {
        unsubList();
        if (unsubFace) unsubFace();
        clearTransient(); clearExpect(); stopIdleCycle(); stopRoam();
        closeMenu();
        window.removeEventListener("remielle-visibility", onVis);
        window.removeEventListener("remielle-settings", onSettings);
        host.remove();
      };
    }

    // ---- settings section (settings.section slot) ----
    // DSH 0.1.1-rc.x's "Plugins" settings tab dispatches `settings.plugin.item`
    // by Host-served namespace (a card must declare `options.key` the Host
    // actually serves). Remielle's prefs are purely local (localStorage), so
    // it owns no Host namespace and its card is filtered out there. Instead it
    // registers a top-level `settings.section` — its own sub-page in Settings,
    // like other third-party plugins (e.g. dsh-better-sidebar). Persistence
    // stays local via the same CustomEvents the pet widget already listens to.
    function SettingsRow(label, control) {
      return jsxRuntime.jsx("label", {
        style: {
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 8, marginBottom: 10, fontSize: 13,
          color: "var(--dsw-alias-label-primary, #eee)",
        },
        children: [
          jsxRuntime.jsx("span", { children: label }),
          control,
        ],
      });
    }
    function SettingsSection() {
      var useState = react.useState;
      var [s, setS] = useState(loadSettings);
      var [vis, setVis] = useState(readVisible);
      function upd(key, val) {
        var next = {};
        for (var k in s) next[k] = s[k];
        next[key] = val;
        setS(next);
        saveSettings(next);
        window.dispatchEvent(new CustomEvent("remielle-settings", { detail: next }));
      }
      function updVis(next) {
        setVis(next);
        try { localStorage.setItem(VIS_KEY, next ? "1" : "0"); } catch (e) {}
        window.dispatchEvent(new CustomEvent("remielle-visibility", { detail: next }));
      }
      var inputStyle = {
        width: 76, padding: "3px 6px", fontSize: 13, borderRadius: 6,
        border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.15))",
        background: "var(--dsw-alias-fill-l1, rgba(255,255,255,0.04))",
        color: "var(--dsw-alias-label-primary, #eee)",
      };
      function numRow(label, key, min, max) {
        return SettingsRow(label, jsxRuntime.jsx("input", {
          type: "number",
          value: s[key],
          min: min,
          max: max,
          style: inputStyle,
          onChange: function (e) {
            var v = Number(e.target.value);
            if (!isFinite(v)) v = DEFAULT_SETTINGS[key];
            if (v < min) v = min;
            if (v > max) v = max;
            upd(key, v);
          },
        }));
      }
      var headingStyle = {
        color: "var(--dsw-alias-label-primary, #eee)",
        fontSize: 15, fontWeight: 600, lineHeight: 1.4, marginBottom: 4,
      };
      var descStyle = {
        color: "var(--dsw-alias-label-tertiary, #999)",
        fontSize: 13, lineHeight: 1.5, marginBottom: 14,
      };
      return jsxRuntime.jsx("div", {
        style: { display: "flex", flexDirection: "column", maxWidth: 560 },
        children: [
          jsxRuntime.jsx("div", { style: headingStyle, children: "Remielle 桌寵" }),
          jsxRuntime.jsx("div", {
            style: descStyle,
            children: "桌寵行為與 harness 動畫回應設定",
          }),
          SettingsRow("顯示小蕾米", jsxRuntime.jsx("input", {
            type: "checkbox",
            checked: !!vis,
            style: { cursor: "pointer" },
            onChange: function (e) { updVis(!!e.target.checked); },
          })),
          SettingsRow("Harness 動畫回應", jsxRuntime.jsx("input", {
            type: "checkbox",
            checked: !!s.animateForHarness,
            style: { cursor: "pointer" },
            onChange: function (e) { upd("animateForHarness", !!e.target.checked); },
          })),
          numRow("期待超時（秒）", "expectTimeoutSeconds", 10, 3600),
          numRow("行動間隔最短（秒）", "idleMinSeconds", 1, 60),
          numRow("行動間隔最長（秒）", "idleMaxSeconds", 1, 120),
          SettingsRow(
            "彩蛋機率 " + Math.round((Number(s.trickChance) || 0) * 100) + "%",
            jsxRuntime.jsx("input", {
              type: "range",
              min: 0,
              max: 100,
              value: Math.round((Number(s.trickChance) || 0) * 100),
              style: { width: 100, cursor: "pointer" },
              onChange: function (e) { upd("trickChance", (Number(e.target.value) || 0) / 100); },
            }),
          ),
          numRow("慶祝冷卻（秒）", "celebrationCooldownSeconds", 0, 3600),
        ],
      });
    }

    var inject = ["slots", "sessions"];

    function apply(ctx) {
      ctx.effect(function () {
        return startPet(ctx);
      }, "remielle-dsh: pet");
      ctx.effect(function () {
        return ctx.slots.inject("settings.section", function () {
          return ctx.slots.register({
            name: "settings.section",
            id: "remielle",
            order: 100,
            label: function () { return "Remielle 桌寵"; },
          }, SettingsSection);
        });
      }, "remielle-dsh: settings");
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
