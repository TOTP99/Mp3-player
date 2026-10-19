/* bg-audio.js —— 后台音频接力（iOS 锁屏音乐不停）v4
 *
 * 问题：主播放走 Web Audio（MediaElementSource → 增强链），iPhone 锁屏时
 * AudioContext 被挂起，音乐停。iOS 只允许"已经在播"的音频进后台继续，
 * 不允许锁屏后再 play() 新音频。
 *
 * 方案：用户点播放后，接力 audio 静音并行同一首；锁屏时只做
 * relay.muted=false（改音量，不是启动播放），并暂停主 audio；
 * 回前台再把进度写回主 audio 并恢复增强链。
 *
 * v4 优化：
 * - 播放意图以 BGMusic._wantPlay / _userPaused 为准（shouldPlay）
 * - 仅 iOS / iPadOS 启用接力，其它平台不双播
 * - 回前台等主 audio 的 playing 再开并行，少用固定 800ms
 * - 后台切歌挂 onTrackChange，减少魔法延时
 * - 锁屏控制条暂停时同步主意图，避免回前台误播
 *
 * 本文件不改 game.js 结构，只做实例方法包装。
 */
(function () {
  'use strict';
  if (typeof bgMusic === 'undefined' || !bgMusic || !bgMusic.audio) return;

  // 仅 iOS 家族需要接力；Android / 桌面锁屏不挂起 Web Audio 到同一程度
  var isIOS = false;
  try {
    isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  } catch (e) {}
  if (!isIOS) return;

  var relayAudio = null;
  var relaying = false;   // 后台接力中（已取消静音）
  var syncBound = false;
  var trackHooked = false;
  var pendingParallelTimer = null;

  /** 统一播放意图：以 BGMusic 状态为准 */
  function shouldPlay() {
    try {
      if (!bgMusic.enabled) return false;
      if (bgMusic._userPaused) return false;
      if (typeof bgMusic._wantPlay === 'boolean') return !!bgMusic._wantPlay;
      // 兜底：主 audio 在播或刚被要求播
      return !!(bgMusic.audio && !bgMusic.audio.paused && !bgMusic.audio.ended);
    } catch (e) {
      return false;
    }
  }

  /** 控制中心 / 系统暂停接力：同步主意图，避免回前台误自动播 */
  function markUserPausedFromSystem() {
    try {
      bgMusic._userPaused = true;
      bgMusic._wantPlay = false;
    } catch (e) {}
    try { localStorage.setItem('bgMusicWasPlaying', '0'); } catch (e2) {}
  }

  function ensureRelayAudio() {
    if (relayAudio) return relayAudio;
    var a = new Audio();
    a.preload = 'auto';
    a.muted = true;
    a.addEventListener('ended', onRelayEnded);
    a.addEventListener('pause', function () {
      try {
        if (relaying && document.hidden) {
          relaying = false;
          markUserPausedFromSystem();
        }
      } catch (e) {}
    });
    relayAudio = a;
    return a;
  }

  function bindSync() {
    if (syncBound) return;
    syncBound = true;
    try {
      bgMusic.audio.addEventListener('timeupdate', function () {
        try {
          if (!relayAudio || relaying) return;
          if (!shouldPlay()) return;
          var main = bgMusic.audio;
          if (!main.src) return;
          if (relayAudio.src !== main.src) {
            relayAudio.src = main.src;
            try { relayAudio.currentTime = main.currentTime || 0; } catch (e) {}
            var p = relayAudio.play();
            if (p && p.catch) p.catch(function () {});
            return;
          }
          var drift = Math.abs((relayAudio.currentTime || 0) - (main.currentTime || 0));
          if (drift > 0.75 && !main.paused) {
            try { relayAudio.currentTime = main.currentTime || 0; } catch (e) {}
          }
          if (!main.paused && relayAudio.paused && relayAudio.src) {
            var p2 = relayAudio.play();
            if (p2 && p2.catch) p2.catch(function () {});
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  /** 挂切歌回调：后台播完/跳歌后对齐接力，少用固定延时 */
  function bindTrackChange() {
    if (trackHooked) return;
    if (typeof bgMusic.onTrackChange !== 'function') return;
    trackHooked = true;
    bgMusic.onTrackChange(function () {
      try {
        if (!document.hidden || !shouldPlay()) return;
        // 主已切到新曲：接力跟上并保持取消静音
        var main = bgMusic.audio;
        if (!main || !main.src) return;
        var a = ensureRelayAudio();
        if (a.src !== main.src) {
          a.src = main.src;
          try { a.currentTime = 0; } catch (e) {}
        }
        a.muted = false;
        var p = a.play();
        if (p && p.catch) p.catch(function () {});
        relaying = true;
        try { main.pause(); } catch (e) {}
      } catch (e) {}
    });
  }

  function clearPendingParallel() {
    if (pendingParallelTimer) {
      clearTimeout(pendingParallelTimer);
      pendingParallelTimer = null;
    }
  }

  /** 用户手势内：启动静音并行（仅 shouldPlay 时） */
  function startParallel() {
    try {
      if (!shouldPlay()) return;
      var main = bgMusic.audio;
      if (!main || !main.src) return;
      var a = ensureRelayAudio();
      bindSync();
      bindTrackChange();
      if (a.src !== main.src) a.src = main.src;
      try { a.currentTime = main.currentTime || 0; } catch (e) {}
      a.muted = true;
      var p = a.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  /** 主 audio 真正 playing 后再并行；超时兜底 */
  function startParallelWhenPlaying() {
    clearPendingParallel();
    var main = bgMusic.audio;
    if (!main) {
      pendingParallelTimer = setTimeout(startParallel, 400);
      return;
    }
    var done = false;
    var finish = function () {
      if (done) return;
      done = true;
      try { main.removeEventListener('playing', onPlaying); } catch (e) {}
      clearPendingParallel();
      startParallel();
    };
    var onPlaying = function () { finish(); };
    try {
      main.addEventListener('playing', onPlaying);
    } catch (e) {}
    // 已在播则立刻；否则最多等 1.2s
    if (!main.paused && main.currentTime > 0) {
      finish();
      return;
    }
    pendingParallelTimer = setTimeout(finish, 1200);
  }

  function stopParallel() {
    clearPendingParallel();
    try {
      if (relayAudio) {
        relayAudio.muted = true;
        relayAudio.pause();
      }
    } catch (e) {}
    relaying = false;
  }

  function onHidden() {
    if (!shouldPlay()) return;
    try {
      var a = ensureRelayAudio();
      bindSync();
      // 关键：只取消静音，不调 play()（已在播，iOS 视为继续）
      // 若前台并行尚未就绪，尽量补一次 play（仍在 visibility 切换的短窗口内）
      if (a.paused && bgMusic.audio && bgMusic.audio.src) {
        if (a.src !== bgMusic.audio.src) a.src = bgMusic.audio.src;
        try { a.currentTime = bgMusic.audio.currentTime || 0; } catch (e) {}
        a.muted = false;
        var p = a.play();
        if (p && p.catch) p.catch(function () {});
      } else {
        a.muted = false;
      }
      relaying = true;
      // 暂停主 audio 释放 Web Audio；不改 _userPaused（不是用户点的暂停）
      try { bgMusic.audio.pause(); } catch (e) {}
    } catch (e) {}
  }

  function onVisible() {
    if (!relaying) return;
    relaying = false;
    try {
      var pos = relayAudio ? relayAudio.currentTime || 0 : 0;
      if (relayAudio) {
        relayAudio.muted = true;
        try { relayAudio.pause(); } catch (e) {}
      }
      if (shouldPlay()) {
        try { bgMusic.audio.currentTime = pos; } catch (e) {}
        try { bgMusic.tryPlay(); } catch (e) {}
        // 等主轨真正 playing 再开静音并行
        startParallelWhenPlaying();
      } else {
        stopParallel();
      }
    } catch (e) {}
  }

  function onRelayEnded() {
    if (!relaying) return;
    relaying = false;
    try { bgMusic._advance(); } catch (e) {}
    // 切歌后优先靠 onTrackChange 对齐；间距等待时用 songGap 兜底
    var gapMs = 200;
    try { gapMs += (bgMusic.songGap || 0) * 1000; } catch (e) {}
    setTimeout(function () {
      try {
        if (!document.hidden || !shouldPlay()) return;
        var main = bgMusic.audio;
        if (!relayAudio || !main || !main.src) return;
        if (relayAudio.src !== main.src) {
          relayAudio.src = main.src;
          try { relayAudio.currentTime = 0; } catch (e) {}
          var p = relayAudio.play();
          if (p && p.catch) p.catch(function () {});
        }
        relayAudio.muted = false;
        relaying = true;
        try { main.pause(); } catch (e) {}
      } catch (e) {}
    }, gapMs);
  }

  document.addEventListener('visibilitychange', function () {
    try {
      if (document.hidden) onHidden();
      else onVisible();
    } catch (e) {}
  });
  window.addEventListener('pagehide', function () {
    try { onHidden(); } catch (e) {}
  });
  window.addEventListener('pageshow', function () {
    try { if (!document.hidden) onVisible(); } catch (e) {}
  });

  /* 包装实例方法：意图仍由 BGMusic 自己维护，这里只跟并行 */
  var origPlay = bgMusic.play.bind(bgMusic);
  bgMusic.play = function () {
    var r = origPlay();
    // play() 内会把 _wantPlay=true、_userPaused=false
    setTimeout(function () {
      if (shouldPlay()) startParallel();
    }, 300);
    return r;
  };

  var origTryPlay = bgMusic.tryPlay ? bgMusic.tryPlay.bind(bgMusic) : null;
  if (origTryPlay) {
    bgMusic.tryPlay = function () {
      var r = origTryPlay();
      setTimeout(function () {
        if (shouldPlay()) startParallel();
      }, 300);
      return r;
    };
  }

  var origPause = bgMusic.pause.bind(bgMusic);
  bgMusic.pause = function () {
    stopParallel();
    return origPause();
  };

  function wrapSkip(orig) {
    return function () {
      var wasRelay = relaying;
      if (wasRelay) {
        relaying = false;
        try {
          if (relayAudio) {
            relayAudio.muted = true;
            relayAudio.pause();
          }
        } catch (e) {}
      }
      var r = orig();
      setTimeout(function () {
        startParallel();
        try {
          if (wasRelay && document.hidden && shouldPlay()) {
            if (relayAudio) {
              relayAudio.muted = false;
              relaying = true;
            }
            try { bgMusic.audio.pause(); } catch (e) {}
          }
        } catch (e) {}
      }, 600);
      return r;
    };
  }
  bgMusic.skipNext = wrapSkip(bgMusic.skipNext.bind(bgMusic));
  bgMusic.skipPrev = wrapSkip(bgMusic.skipPrev.bind(bgMusic));

  bgMusic.isRelaying = function () { return relaying; };
  bgMusic._bgAudioV = 4;
})();
