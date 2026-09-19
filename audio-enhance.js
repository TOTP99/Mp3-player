/**
 * audio-enhance.js —— 背景音乐音质 / 响度处理（独立模块）
 *
 * 解决：
 * 1) 部分曲目底噪、嗡声偏大 → 高通去隆隆声 + 轻柔低通削刺耳高频
 * 2) 曲目之间音量忽高忽低 → 压缩器压峰值 + AGC 自动拉向目标响度
 *
 * 用法（由 BGMusic.ensureAnalyser 接入）：
 *   const enh = createAudioEnhancer(audioContext);
 *   enh.connectFrom(mediaElementSource, masterGainNode);
 *   // 频谱分析仍由外部 source → analyser，不经本模块
 *
 * 可调参数见 DEFAULTS；运行时 enh.setEnabled(false) 可旁路（仍保持连接结构时用 wet=0）。
 */
(function (global) {
  "use strict";

  var DEFAULTS = {
    // 高通：切掉低频隆隆 / 交流声一类噪声（Hz）
    highpassHz: 70,
    // 低通：略削超高频沙沙声（Hz）；过大等于没开
    lowpassHz: 13000,
    // 压缩：压住突然很大的段落
    compThreshold: -26,
    compKnee: 10,
    compRatio: 3.5,
    compAttack: 0.012,
    compRelease: 0.22,
    // AGC：目标 RMS（时间域 0~1 近似），越大整体越响
    targetRms: 0.11,
    // AGC 增益钳位，避免静音段被猛拉、爆音段被压没
    agcMin: 0.45,
    agcMax: 2.2,
    // 低于此 RMS 视为近静音，不再往上猛推（防放大底噪）
    silenceRms: 0.015,
    // AGC 平滑速度 0~1，越大跟得越快
    agcSmooth: 0.06,
    // 总湿声比例（1=全开增强，0=等于直通增益 1）
    wet: 1,
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

    var agcGain = ctx.createGain();
    agcGain.gain.value = 1;

    // 在压缩后取样，用于 AGC（不送扬声器）
    var meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    meter.smoothingTimeConstant = 0.5;
    var meterData = new Uint8Array(meter.fftSize);

    var smoothGain = 1;
    var enabled = true;
    var rafId = 0;
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
      rafId = requestAnimationFrame(agcTick);
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
      if (rafId) return;
      rafId = requestAnimationFrame(agcTick);
    }

    function stopAgc() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    }

    /**
     * 将 mediaElementSource 接到增强链，再输出到 masterGain（或 destination）
     * source 仍可另外 connect 到频谱 analyser
     */
    function connectFrom(source, destination) {
      if (!source || !destination || connected) return;
      try {
        source.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(compressor);
        compressor.connect(agcGain);
        agcGain.connect(destination);
        compressor.connect(meter);
        connected = true;
        startAgc();
      } catch (e) {
        connected = false;
      }
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
