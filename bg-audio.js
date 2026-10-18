/* bg-audio.js —— 后台音频接力（iOS 锁屏音乐不停）
 *
 * 问题：主播放走 Web Audio（MediaElementSource → 增强链），iPhone 锁屏时
 * AudioContext 被挂起，音乐会停。iOS Safari 又不支持 Wake Lock API。
 *
 * 方案：页面进后台时，用一个原生 <audio>（不走 Web Audio，iOS 后台播放
 * 正常）无缝接力；回前台再把位置还给主 audio。
 * 本文件不改 game.js，只做实例方法包装。
 *
 * v2 修复：
 * 1. iOS 锁屏瞬间可能先暂停主 audio，导致 isPlaying() 为 false —— 改用
 *    自维护的 wantPlay 标志，不依赖 isPlaying()
 * 2. 接力 audio 提前在用户手势里解锁（play→pause），避免后台 play() 被拒
 */
(function () {
  'use strict';
  if (typeof bgMusic === 'undefined' || !bgMusic || !bgMusic.audio) return;

  var relayAudio = null;   // 接力用的原生 Audio
  var relaying = false;    // 是否正在接力
  var wantPlay = false;    // 用户意图：是否想播（不受系统暂停影响）
  var relayUnlocked = false;

  function ensureRelayAudio() {
    if (relayAudio) return relayAudio;
    var a = new Audio();
    a.preload = 'auto';
    a.addEventListener('ended', onRelayEnded);
    relayAudio = a;
    return a;
  }

  /* 在用户手势里预解锁接力 audio（必须在 tap/click 上下文中调用） */
  function unlockRelay() {
    if (relayUnlocked) return;
    try {
      var a = ensureRelayAudio();
      a.muted = true;
      var p = a.play();
      var done = function () {
        try { a.pause(); } catch (e) {}
        a.muted = false;
        relayUnlocked = true;
      };
      if (p && typeof p.then === 'function') p.then(done, function () {
        try { a.muted = false; } catch (e) {}
      });
      else done();
    } catch (e) {}
  }

  function startRelay() {
    if (relaying) return;
    var main = bgMusic.audio;
    if (!main || !main.src) return;
    try {
      var a = ensureRelayAudio();
      if (a.src !== main.src) a.src = main.src;
      var pos = 0;
      try { pos = main.currentTime || 0; } catch (e) {}
      // 如果主 audio 刚被系统暂停，currentTime 仍有效
      try { a.currentTime = pos; } catch (e) {}
      var p = a.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function () {
          // 被拒则 600ms 后重试一次
          setTimeout(function () {
            if (!relaying && wantPlay && document.hidden) {
              try {
                var p2 = a.play();
                if (p2 && p2.catch) p2.catch(function () {});
                else { relaying = true; try { main.pause(); } catch (e) {} }
              } catch (e) {}
            }
          }, 600);
        });
      }
      relaying = true;
      try { if (!main.paused) main.pause(); } catch (e) {}
    } catch (e) {}
  }

  function stopRelay() {
    var pos = 0;
    try {
      if (relayAudio) {
        pos = relayAudio.currentTime || 0;
        relayAudio.pause();
      }
    } catch (e) {}
    relaying = false;
    return pos;
  }

  function onRelayEnded() {
    if (!relaying) return;
    relaying = false;
    try { bgMusic._advance(); } catch (e) {}
    setTimeout(function () {
      try {
        if (document.hidden && wantPlay && bgMusic.enabled) startRelay();
      } catch (e) {}
    }, 900);
  }

  /* 进/出后台切换：用 wantPlay 而不是 isPlaying() */
  function onHidden() {
    if (wantPlay && bgMusic.enabled) startRelay();
  }
  function onVisible() {
    if (relaying) {
      var pos = stopRelay();
      if (wantPlay && bgMusic.enabled) {
        try { bgMusic.audio.currentTime = pos; } catch (e) {}
        try { bgMusic.tryPlay(); } catch (e) {}
      }
    }
  }
  document.addEventListener('visibilitychange', function () {
    try {
      if (document.hidden) onHidden();
      else onVisible();
    } catch (e) {}
  });
  /* 兜底：部分 iOS 上 pagehide 比 visibilitychange 更可靠 */
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
    unlockRelay();
    return origPlay();
  };

  var origTryPlay = bgMusic.tryPlay ? bgMusic.tryPlay.bind(bgMusic) : null;
  if (origTryPlay) {
    bgMusic.tryPlay = function () {
      var r = origTryPlay();
      try { if (bgMusic.enabled) { wantPlay = true; unlockRelay(); } } catch (e) {}
      return r;
    };
  }

  var origPause = bgMusic.pause.bind(bgMusic);
  bgMusic.pause = function () {
    wantPlay = false;
    if (relaying) stopRelay();
    return origPause();
  };

  var origSkipNext = bgMusic.skipNext.bind(bgMusic);
  bgMusic.skipNext = function () {
    var wasRelay = relaying;
    if (wasRelay) stopRelay();
    wantPlay = true;
    unlockRelay();
    var r = origSkipNext();
    if (wasRelay) {
      setTimeout(function () {
        try { if (document.hidden && wantPlay && bgMusic.enabled) startRelay(); } catch (e) {}
      }, 600);
    }
    return r;
  };

  var origSkipPrev = bgMusic.skipPrev.bind(bgMusic);
  bgMusic.skipPrev = function () {
    var wasRelay = relaying;
    if (wasRelay) stopRelay();
    wantPlay = true;
    unlockRelay();
    var r = origSkipPrev();
    if (wasRelay) {
      setTimeout(function () {
        try { if (document.hidden && wantPlay && bgMusic.enabled) startRelay(); } catch (e) {}
      }, 600);
    }
    return r;
  };

  /* 调试：localStorage 记一次接力状态，方便定位 */
  bgMusic.isRelaying = function () { return relaying; };
})();
