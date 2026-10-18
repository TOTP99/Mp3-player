/* bg-audio.js —— 后台音频接力（iOS 锁屏音乐不停）v3
 *
 * 问题：主播放走 Web Audio（MediaElementSource → 增强链），iPhone 锁屏时
 * AudioContext 被挂起，音乐停。iOS 只允许"已经在播"的音频进后台继续，
 * 不允许锁屏后再 play() 新音频（v1/v2 在此失败）。
 *
 * 方案：用户点播放时，接力 audio 就以静音方式并行播放同一首（保持位置
 * 同步）；锁屏时只做 relay.muted=false（改音量，不是启动播放，iOS 放行），
 * 并暂停主 audio；回前台再换回来。
 * 本文件不改 game.js，只做实例方法包装。
 */
(function () {
  'use strict';
  if (typeof bgMusic === 'undefined' || !bgMusic || !bgMusic.audio) return;

  var relayAudio = null;
  var relaying = false;   // 后台接力中（已取消静音）
  var wantPlay = false;
  var syncBound = false;

  function ensureRelayAudio() {
    if (relayAudio) return relayAudio;
    var a = new Audio();
    a.preload = 'auto';
    a.muted = true; // 前台全程静音并行
    a.addEventListener('ended', onRelayEnded);
    // 锁屏控制条暂停接力（iOS 直接操作 audio 元素）：同步用户意图
    a.addEventListener('pause', function () {
      try {
        if (relaying && document.hidden) {
          relaying = false;
          wantPlay = false;
          try { localStorage.setItem("bgMusicWasPlaying", "0"); } catch (e) {}
        }
      } catch (e) {}
    });
    relayAudio = a;
    return a;
  }

  /* 主 audio 的 timeupdate：保持接力位置同步 */
  function bindSync() {
    if (syncBound) return;
    syncBound = true;
    try {
      bgMusic.audio.addEventListener('timeupdate', function () {
        try {
          if (!relayAudio || relaying) return;
          var main = bgMusic.audio;
          if (!main.src) return;
          if (relayAudio.src !== main.src) {
            relayAudio.src = main.src;
            relayAudio.currentTime = main.currentTime || 0;
            var p = relayAudio.play();
            if (p && p.catch) p.catch(function () {});
            return;
          }
          var drift = Math.abs((relayAudio.currentTime || 0) - (main.currentTime || 0));
          if (drift > 0.75 && !main.paused) {
            relayAudio.currentTime = main.currentTime || 0;
          }
          // 主在播而接力停了（被系统掐了），补拉起来
          if (wantPlay && bgMusic.enabled && !main.paused && relayAudio.paused && relayAudio.src) {
            var p2 = relayAudio.play();
            if (p2 && p2.catch) p2.catch(function () {});
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  /* 用户手势内：启动静音并行 */
  function startParallel() {
    try {
      if (!wantPlay || !bgMusic.enabled) return; // 已暂停则不启动
      var main = bgMusic.audio;
      if (!main || !main.src) return;
      var a = ensureRelayAudio();
      bindSync();
      if (a.src !== main.src) a.src = main.src;
      try { a.currentTime = main.currentTime || 0; } catch (e) {}
      a.muted = true;
      var p = a.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  function stopParallel() {
    try {
      if (relayAudio) relayAudio.pause();
    } catch (e) {}
    relaying = false;
  }

  function onHidden() {
    if (!wantPlay || !bgMusic.enabled) return;
    try {
      var a = ensureRelayAudio();
      // 关键：只取消静音，不调 play()（已在播，iOS 视为继续）
      a.muted = false;
      relaying = true;
      try { bgMusic.audio.pause(); } catch (e) {}
    } catch (e) {}
  }

  function onVisible() {
    if (!relaying) return;
    relaying = false;
    try {
      var pos = relayAudio ? relayAudio.currentTime || 0 : 0;
      relayAudio.muted = true;
      relayAudio.pause();
      if (wantPlay && bgMusic.enabled) {
        try { bgMusic.audio.currentTime = pos; } catch (e) {}
        try { bgMusic.tryPlay(); } catch (e) {}
        // 回来后重建并行
        setTimeout(startParallel, 800);
      }
    } catch (e) {}
  }

  function onRelayEnded() {
    if (!relaying) return;
    relaying = false;
    try { bgMusic._advance(); } catch (e) {}
    setTimeout(function () {
      try {
        if (document.hidden && wantPlay && bgMusic.enabled) {
          // 新一首：主 audio 已切歌，把接力跟上并取消静音
          var main = bgMusic.audio;
          if (relayAudio && main.src && relayAudio.src !== main.src) {
            relayAudio.src = main.src;
            relayAudio.currentTime = 0;
            var p = relayAudio.play();
            if (p && p.catch) p.catch(function () {});
          }
          relayAudio.muted = false;
          relaying = true;
          try { main.pause(); } catch (e) {}
        }
      } catch (e) {}
    }, 900);
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

  /* 包装实例方法 */
  var origPlay = bgMusic.play.bind(bgMusic);
  bgMusic.play = function () {
    wantPlay = true;
    var r = origPlay();
    // 手势内启动并行（主 audio 已开始播）
    setTimeout(startParallel, 300);
    return r;
  };

  var origTryPlay = bgMusic.tryPlay ? bgMusic.tryPlay.bind(bgMusic) : null;
  if (origTryPlay) {
    bgMusic.tryPlay = function () {
      var r = origTryPlay();
      try {
        if (bgMusic.enabled) {
          wantPlay = true;
          setTimeout(startParallel, 300);
        }
      } catch (e) {}
      return r;
    };
  }

  var origPause = bgMusic.pause.bind(bgMusic);
  bgMusic.pause = function () {
    wantPlay = false;
    stopParallel();
    return origPause();
  };

  function wrapSkip(orig) {
    return function () {
      var wasRelay = relaying;
      if (wasRelay) {
        relaying = false;
        try { relayAudio.muted = true; relayAudio.pause(); } catch (e) {}
      }
      wantPlay = true;
      var r = orig();
      setTimeout(function () {
        startParallel();
        try {
          if (wasRelay && document.hidden && wantPlay && bgMusic.enabled) {
            relayAudio.muted = false;
            relaying = true;
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
})();
