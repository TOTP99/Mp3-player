/**
 * audio-enhance.js — 听感增强（高通/低通、presence/air、压缩、AGC、限幅）
 * 由 BGMusic.ensureAnalyser 接入；频谱 analyser 不经本模块。
 *
 * 干/湿双路并联：
 *   湿路 = 滤波 + presence/air + 压缩 + AGC + 限幅
 *   干路 = 原声直通
 * setEnabled(false) / setWet(0) 切换到干路，真正旁路全部处理（30ms 渐变）。
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

    // presence：人声更靠前清晰
    var presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = cfg.presenceHz;
    presence.gain.value = cfg.presenceDb;
    presence.Q.value = cfg.presenceQ;

    // air：高频更通透
    var air = ctx.createBiquadFilter();
    air.type = "highshelf";
    air.frequency.value = cfg.airHz;
    air.gain.value = cfg.airDb;

    var agcGain = ctx.createGain();
    agcGain.gain.value = 1;

    // 末端限幅：AGC 推高后收峰值
    var limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;

    // 干/湿输出增益（并联）
    var wetOut = ctx.createGain();
    var dryGain = ctx.createGain();

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
      // 静音/暂停：保持当前增益，不往 1 回拉（避免刚恢复的响度被冲掉）
      if (rms < cfg.silenceRms) return;
      var desired = clamp(cfg.targetRms / rms, cfg.agcMin, cfg.agcMax);
      desired = 1 + (desired - 1) * cfg.wet;
      smoothGain += (desired - smoothGain) * cfg.agcSmooth;
      try {
        agcGain.gain.setTargetAtTime(smoothGain, ctx.currentTime, 0.12);
      } catch (e) {}
    }

    function startAgc() {
      if (agcTimer) return;
      // setInterval：锁屏/后台时 rAF 停摆，音乐却继续播
      agcTimer = setInterval(agcTick, 120);
    }

    function stopAgc() {
      if (agcTimer) {
        clearInterval(agcTimer);
        agcTimer = 0;
      }
    }

    /** 按 enabled 切换干/湿；immediate=true 首次接线无渐变 */
    function applyBypass(immediate) {
      var w = enabled ? 1 : 0;
      var d = enabled ? 0 : 1;
      try {
        if (immediate) {
          wetOut.gain.value = w;
          dryGain.gain.value = d;
        } else {
          wetOut.gain.setTargetAtTime(w, ctx.currentTime, 0.03);
          dryGain.gain.setTargetAtTime(d, ctx.currentTime, 0.03);
        }
      } catch (e) {}
    }

    /**
     * 将 mediaElementSource 接到增强链，再输出到 masterGain（或 destination）
     * source 仍可另外 connect 到频谱 analyser
     */
    function connectFrom(source, destination) {
      if (!source || !destination || connected) return connected;
      try {
        // 湿路：滤波 → presence → air → 压缩 → AGC → 限幅
        source.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(presence);
        presence.connect(air);
        air.connect(compressor);
        compressor.connect(agcGain);
        agcGain.connect(limiter);
        limiter.connect(wetOut);
        wetOut.connect(destination);
        // 干路：原声直通
        source.connect(dryGain);
        dryGain.connect(destination);
        // AGC 计量（不送扬声器）
        compressor.connect(meter);
        connected = true;
        applyBypass(true);
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
      if (connected) applyBypass(false);
    }

    function setWet(w) {
      cfg.wet = clamp(Number(w) || 0, 0, 1);
      // wet=0 时也走干路，与 setEnabled(false) 一致
      if (cfg.wet <= 0.001) {
        enabled = false;
        if (connected) applyBypass(false);
      } else if (!enabled) {
        enabled = true;
        if (connected) applyBypass(false);
      }
    }

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
      get enabled() {
        return enabled;
      },
    };
  }

  global.createAudioEnhancer = createAudioEnhancer;
  global.AudioEnhanceDefaults = DEFAULTS;
})(typeof window !== "undefined" ? window : this);
