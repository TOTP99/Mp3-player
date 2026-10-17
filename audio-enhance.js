/**
 * audio-enhance.js — 听感增强（高通/低通、presence/air、压缩、AGC、限幅）
 * 由 BGMusic.ensureAnalyser 接入；频谱 analyser 不经本模块。
 * 调参见 DEFAULTS；enh.setEnabled(false) / setWet(0) 可旁路。
 */
(function (global) {
  "use strict";

  var DEFAULTS = {
    highpassHz: 70,
    lowpassHz: 13000,
    compThreshold: -26,
    compKnee: 10,
    compRatio: 3.5,
    compAttack: 0.012,
    compRelease: 0.22,
    targetRms: 0.11,
    agcMin: 0.45,
    agcMax: 2.2,
    silenceRms: 0.015,
    agcSmooth: 0.06,
    wet: 1,
    presenceHz: 3200,
    presenceDb: 2.5,
    presenceQ: 1.0,
    airHz: 11000,
    airDb: 2.0,
  };

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /**
   * @param {AudioContext} ctx
   * @param {object} [opts] 覆盖 DEFAULTS
   */
  function createAudioEnhancer(ctx, opts) {
    if (!ctx) return null;
    var cfg = {};
    var k;
    for (k in DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) cfg[k] = DEFAULTS[k];
    }
    if (opts) {
      for (k in opts) {
        if (Object.prototype.hasOwnProperty.call(opts, k)) cfg[k] = opts[k];
      }
    }

    var highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = cfg.highpassHz;
    highpass.Q.value = 0.7;

    var lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = cfg.lowpassHz;
    lowpass.Q.value = 0.7;

    var compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = cfg.compThreshold;
    compressor.knee.value = cfg.compKnee;
    compressor.ratio.value = cfg.compRatio;
    compressor.attack.value = cfg.compAttack;
    compressor.release.value = cfg.compRelease;

    // 音高加强（听感 B）：presence 让人声更靠前清晰
    var presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = cfg.presenceHz;
    presence.gain.value = cfg.presenceDb;
    presence.Q.value = cfg.presenceQ;

    // 音高加强（听感 B）：air 让高频更通透有光泽
    var air = ctx.createBiquadFilter();
    air.type = "highshelf";
    air.frequency.value = cfg.airHz;
    air.gain.value = cfg.airDb;

    var agcGain = ctx.createGain();
    agcGain.gain.value = 1;

    // 末端限幅器：AGC 推高后收峰值，防数字削波
    var limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;

    // 在压缩后取样，用于 AGC（不送扬声器）
    var meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    meter.smoothingTimeConstant = 0.5;
    var meterData = new Uint8Array(meter.fftSize);

    var smoothGain = 1;
    var enabled = true;
    var agcTimer = 0;
    var connected = false;

    function readRms() {
      meter.getByteTimeDomainData(meterData);
      var sum = 0;
      var n = meterData.length;
      for (var i = 0; i < n; i++) {
        var v = (meterData[i] - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / n);
    }

    function agcTick() {
      if (!enabled || !connected) return;
      if (ctx.state !== "running") return;

      var rms = readRms();
      var desired;
      if (rms < cfg.silenceRms) {
        // 近静音：缓慢回到 1，避免把底噪抬成沙沙声
        desired = 1;
      } else {
        desired = cfg.targetRms / rms;
        desired = clamp(desired, cfg.agcMin, cfg.agcMax);
      }
      // 湿声比例：wet=0 时等价增益 1
      desired = 1 + (desired - 1) * cfg.wet;
      smoothGain += (desired - smoothGain) * cfg.agcSmooth;
      try {
        agcGain.gain.setTargetAtTime(smoothGain, ctx.currentTime, 0.12);
      } catch (e) {}
    }

    function startAgc() {
      if (agcTimer) return;
      // 用 setInterval 而不用 rAF：锁屏/后台时 rAF 停摆，音乐却继续播
      agcTimer = setInterval(agcTick, 120);
    }

    function stopAgc() {
      if (agcTimer) {
        clearInterval(agcTimer);
        agcTimer = 0;
      }
    }

    /**
     * 将 mediaElementSource 接到增强链，再输出到 masterGain（或 destination）
     * source 仍可另外 connect 到频谱 analyser
     */
    function connectFrom(source, destination) {
      if (!source || !destination || connected) return connected;
      try {
        source.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(presence);
        presence.connect(air);
        air.connect(compressor);
        compressor.connect(agcGain);
        agcGain.connect(limiter);
        limiter.connect(destination);
        compressor.connect(meter);
        connected = true;
        startAgc();
      } catch (e) {
        connected = false;
      }
      return connected;
    }

    function setEnabled(on) {
      enabled = !!on;
      if (!enabled) {
        smoothGain = 1;
        try {
          agcGain.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
        } catch (e) {}
      }
    }

    function setWet(w) {
      cfg.wet = clamp(Number(w) || 0, 0, 1);
    }

    // 音高加强（听感 B）运行时调节：presence/air 的 dB 数
    function setPresence(db) {
      cfg.presenceDb = Number(db) || 0;
      try {
        presence.gain.setTargetAtTime(cfg.presenceDb, ctx.currentTime, 0.05);
      } catch (e) {}
    }

    function setAir(db) {
      cfg.airDb = Number(db) || 0;
      try {
        air.gain.setTargetAtTime(cfg.airDb, ctx.currentTime, 0.05);
      } catch (e) {}
    }

    /** 切歌后可调用，避免沿用上一首的 AGC 增益 */
    function resetAgc() {
      smoothGain = 1;
      try {
        agcGain.gain.setValueAtTime(1, ctx.currentTime);
      } catch (e) {}
    }

    return {
      connectFrom: connectFrom,
      setEnabled: setEnabled,
      setWet: setWet,
      setPresence: setPresence,
      setAir: setAir,
      resetAgc: resetAgc,
      stop: stopAgc,
      get config() {
        return cfg;
      },
      get gain() {
        return smoothGain;
      },
    };
  }

  global.createAudioEnhancer = createAudioEnhancer;
  global.AudioEnhanceDefaults = DEFAULTS;
})(typeof window !== "undefined" ? window : this);
