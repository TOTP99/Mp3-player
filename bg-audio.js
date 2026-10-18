/* bg-audio.js —— 后台音频接力（iOS 锁屏音乐不停）
 *
 * 问题：主播放走 Web Audio（MediaElementSource → 增强链），iPhone 锁屏时
 * AudioContext 被挂起，音乐会停。iOS Safari 又不支持 Wake Lock API。
 *
 * 方案：页面进后台且正在播放时，用一个原生 <audio>（不走 Web Audio，
 * iOS 后台播放正常）无缝接力；回前台再把位置还给主 audio。
 * 本文件不改 game.js，只做实例方法包装。
 */
(function () {
  'use strict';
  if (typeof bgMusic === 'undefined' || !bgMusic || !bgMusic.audio) return;

  var relayAudio = null;   // 接力用的原生 Audio
  var relaying = false;    // 是否正在接力
  var relayWantPlay = false;

  function ensureRelayAudio() {
    if (relayAudio) return relayAudio;
    var a = new Audio();
    a.preload = 'auto';
    a.addEventListener('ended', onRelayEnded);
    relayAudio = a;
    return a;
  }

  function startRelay() {
    if (relaying) return;
    var main = bgMusic.audio;
    if (!main || main.paused || main.ended || !main.src) return;
    try {
      var a = ensureRelayAudio();
      if (a.src !== main.src) a.src = main.src;
      try { a.currentTime = main.currentTime || 0; } catch (e) {}
      var p = a.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
      main.pause();
      relaying = true;
      relayWantPlay = true;
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
    // 后台播完一首：让主实例切下一首，再重新接力
    relaying = false;
    relayWantPlay = false;
    try {
      bgMusic._advance();
    } catch (e) {}
    setTimeout(function () {
      try {
        if (document.hidden && bgMusic.enabled && !bgMusic.audio.paused) {
          startRelay();
        } else {
          relayWantPlay = false;
        }
      } catch (e) {}
    }, 900);
  }

  /* 进/出后台切换 */
  document.addEventListener('visibilitychange', function () {
    try {
      if (document.hidden) {
        if (bgMusic.isPlaying()) startRelay();
      } else if (relaying) {
        var pos = stopRelay();
        var want = relayWantPlay;
        relayWantPlay = false;
        if (want && bgMusic.enabled) {
          try { bgMusic.audio.currentTime = pos; } catch (e) {}
          bgMusic.tryPlay();
        }
      }
    } catch (e) {}
  });

  /* 包装实例方法：后台时锁屏控制条操作要作用到接力 audio */
  var origPause = bgMusic.pause.bind(bgMusic);
  bgMusic.pause = function () {
    if (relaying) {
      stopRelay();
      relayWantPlay = false;
    }
    return origPause();
  };

  var origSkipNext = bgMusic.skipNext.bind(bgMusic);
  bgMusic.skipNext = function () {
    var wasRelay = relaying;
    if (wasRelay) { stopRelay(); relayWantPlay = false; }
    var r = origSkipNext();
    if (wasRelay) {
      setTimeout(function () {
        try { if (document.hidden && bgMusic.enabled) startRelay(); } catch (e) {}
      }, 600);
    }
    return r;
  };

  var origSkipPrev = bgMusic.skipPrev.bind(bgMusic);
  bgMusic.skipPrev = function () {
    var wasRelay = relaying;
    if (wasRelay) { stopRelay(); relayWantPlay = false; }
    var r = origSkipPrev();
    if (wasRelay) {
      setTimeout(function () {
        try { if (document.hidden && bgMusic.enabled) startRelay(); } catch (e) {}
      }, 600);
    }
    return r;
  };

  /* 对外查询：是否在后台接力（调试用） */
  bgMusic.isRelaying = function () { return relaying; };
})();
