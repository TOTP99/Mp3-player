/**
 * audio-fx.js — 轻量音效解锁状态点（右下角）
 *
 * 灰 = 核心脚本未就绪
 * 橙 = 已加载但未解锁
 * 绿 = 已解锁（AudioContext running + MediaElement 已接）
 *
 * 点击圆点：真实手势内强制 resume + 静音 priming，不改现有播放逻辑。
 * 仅观察 + 手动兜底，不干预正常 play/pause/切歌/后台接力。
 */
(function () {
  "use strict";

  var DOT_ID = "ph-audio-fx-dot";
  var POLL_MS = 900;
  var unlockedOnce = false;

  function scriptsReady() {
    return (
      typeof bgMusic !== "undefined" &&
      bgMusic &&
      bgMusic.audio &&
      typeof createAudioEnhancer === "function"
    );
  }

  function isUnlocked() {
    if (!scriptsReady()) return false;
    try {
      var ctx = bgMusic.ctx;
      if (!ctx) return false;
      // running + 已连接 MediaElementSource 即视为解锁
      return ctx.state === "running" && !!bgMusic._connected;
    } catch (e) {
      return false;
    }
  }

  function ensureDot() {
    var el = document.getElementById(DOT_ID);
    if (el) return el;
    el = document.createElement("button");
    el.id = DOT_ID;
    el.type = "button";
    el.setAttribute("aria-label", "音效解锁状态");
    el.title = "音效解锁";
    el.style.cssText =
      "position:fixed;right:10px;bottom:max(10px,env(safe-area-inset-bottom));" +
      "width:22px;height:22px;border-radius:50%;border:1.5px solid rgba(255,255,255,.25);" +
      "padding:0;margin:0;z-index:9999;cursor:pointer;opacity:.85;" +
      "box-shadow:0 1px 4px rgba(0,0,0,.45);transition:background .25s,border-color .25s,opacity .2s;" +
      "-webkit-tap-highlight-color:transparent;touch-action:manipulation;";
    document.body.appendChild(el);
    el.addEventListener("click", onDotClick);
    return el;
  }

  function setColor(el, state) {
    // state: "gray" | "orange" | "green"
    var bg = "#666";
    var border = "rgba(255,255,255,.2)";
    if (state === "orange") {
      bg = "#e68a00";
      border = "rgba(255,180,60,.55)";
    } else if (state === "green") {
      bg = "#2e9b4e";
      border = "rgba(120,220,150,.5)";
    }
    el.style.background = bg;
    el.style.borderColor = border;
    el.dataset.state = state;
  }

  function refresh() {
    var el = ensureDot();
    if (!scriptsReady()) {
      setColor(el, "gray");
      return;
    }
    // #6：按实时状态着色，不锁死绿；iOS 打断后回橙，不误导
    if (isUnlocked()) {
      setColor(el, "green");
    } else {
      setColor(el, "orange");
    }
  }

  async function forceUnlock() {
    if (!scriptsReady()) return false;
    try {
      // 点击前是否正在播：正在播就不能被打断，也不能因点圆点而开始播
      var wasPlaying = false;
      try { wasPlaying = bgMusic.isPlaying(); } catch (e) {}
      bgMusic.ensureAnalyser();
      if (bgMusic.ctx && bgMusic.ctx.state !== "running") {
        await bgMusic.ctx.resume();
      }
      // 静音 priming：仅在没在播时做（部分机型需要一次真实 play→pause 才放行）
      var a = bgMusic.audio;
      if (a && !wasPlaying) {
        var wasMuted = a.muted;
        a.muted = true;
        try {
          var p = a.play();
          if (p && typeof p.then === "function") {
            await p.catch(function () {});
          }
          a.pause();
        } catch (e) {}
        a.muted = wasMuted;
      }
      unlockedOnce = true;
      refresh();
      return true;
    } catch (e) {
      return false;
    }
  }

  function onDotClick(e) {
    e.preventDefault();
    e.stopPropagation();
    forceUnlock();
  }

  // 暴露最小 API，方便调试
  window.audioFx = {
    isUnlocked: isUnlocked,
    forceUnlock: forceUnlock,
    refresh: refresh,
  };

  function boot() {
    ensureDot();
    refresh();
    setInterval(refresh, POLL_MS);
    // 用户任意手势后也刷新一次（捕捉正常解锁）
    ["touchstart", "mousedown", "click"].forEach(function (ev) {
      document.addEventListener(
        ev,
        function () {
          setTimeout(refresh, 120);
        },
        { passive: true, once: false }
      );
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
