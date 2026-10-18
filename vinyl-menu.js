/* vinyl-menu.js —— 长按唱片设置菜单（歌曲间距 + 语言筛选）
 *
 * 语言映射 SONG_LANG：曲号 -> 'zh'|'en'|'ja'|'other'
 * 无标签的暂归 'other'，听到后按曲号改这里即可。
 */
(function () {
  'use strict';

  var SONG_LANG = {
    1: 'zh', 4: 'zh', 5: 'zh', 11: 'zh', 13: 'zh', 14: 'zh', 15: 'zh',
    18: 'zh', 19: 'zh', 20: 'zh', 22: 'zh', 23: 'zh', 28: 'zh', 30: 'zh',
    32: 'zh', 35: 'zh', 43: 'zh', 45: 'zh',
    2: 'en', 3: 'en', 7: 'en', 8: 'en', 12: 'en', 16: 'en', 17: 'en',
    21: 'en', 24: 'en', 25: 'en', 26: 'en', 27: 'en', 31: 'en', 33: 'en',
    34: 'en', 36: 'en', 37: 'en', 38: 'en', 39: 'en', 40: 'en', 41: 'en', 46: 'en',
    9: 'ja', 10: 'ja', 29: 'ja', 42: 'ja'
    // 6 法语、44、47 归 other；置信度低的可手动纠正
  };

  var LANGS = [
    ['all', '全部'],
    ['zh', '中文'],
    ['en', '英文'],
    ['ja', '日语'],
    ['other', '其他']
  ];
  var LANG_NAME = { all: '全部', zh: '中文', en: '英文', ja: '日语', other: '其他' };

  function songLang(num) {
    return SONG_LANG[num] || 'other';
  }

  /* 语言过滤：返回该语言的曲号列表（all 则返回 null 表示不过滤） */
  function langList(lang) {
    if (!lang || lang === 'all') return null;
    var out = [];
    var max = 47; // 实际曲目数
    try { if (typeof bgMusic !== "undefined" && bgMusic.songLangMax) max = bgMusic.songLangMax; } catch (e) {}
    for (var i = 1; i <= max; i++) {
      if (songLang(i) === lang) out.push(i);
    }
    return out.length ? out : null;
  }

  function getLang() {
    try { return localStorage.getItem('bgMusicLang') || 'all'; } catch (e) { return 'all'; }
  }
  function setLang(l) {
    try { localStorage.setItem('bgMusicLang', l); } catch (e) {}
    try { if (typeof bgMusic !== "undefined") bgMusic.songLang = l; } catch (e) {}
  }

  function closeMenu() {
    var ov = document.getElementById('ph-vinyl-menu-ov');
    if (ov) ov.remove();
  }

  function rowBtn(label, active, onclick) {
    var b = document.createElement('button');
    b.textContent = label + (active ? ' ✓' : '');
    b.style.cssText = 'display:block;width:100%;margin:7px 0;padding:10px 0;font-size:15px;' +
      'letter-spacing:2px;color:' + (active ? '#1a1410' : '#e8c56a') + ';' +
      'background:' + (active ? '#e8c56a' : 'transparent') + ';' +
      'border:1px solid #8a6d3b;border-radius:8px;cursor:pointer;';
    b.addEventListener('click', function (e) { e.stopPropagation(); onclick(); });
    return b;
  }

  function sectionTitle(t) {
    var d = document.createElement('div');
    d.textContent = t;
    d.style.cssText = 'color:#e8c56a;font-size:14px;letter-spacing:4px;margin:12px 0 4px;' +
      'border-bottom:1px solid rgba(138,109,59,.4);padding-bottom:6px;text-align:left;';
    return d;
  }

  function showMenu() {
    closeMenu();
    var ov = document.createElement('div');
    ov.id = 'ph-vinyl-menu-ov';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10001;' +
      'display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#1a1410;border:1px solid #8a6d3b;border-radius:12px;' +
      'padding:18px 22px;min-width:250px;max-height:80vh;overflow-y:auto;' +
      'box-shadow:0 8px 30px rgba(0,0,0,.6);';
    var title = document.createElement('div');
    title.textContent = '唱片设置';
    title.style.cssText = 'color:#e8c56a;font-size:16px;letter-spacing:4px;margin-bottom:6px;text-align:center;';
    box.appendChild(title);

    // 1. 歌曲间距
    box.appendChild(sectionTitle('歌曲间距'));
    var curGap = 0;
    try { curGap = typeof bgMusic !== "undefined" ? (bgMusic.songGap || 0) : 0; } catch (e) {}
    [[0, '关闭'], [3, '3 秒'], [6, '6 秒'], [9, '9 秒']].forEach(function (opt) {
      box.appendChild(rowBtn(opt[1], opt[0] === curGap, function () {
        try { bgMusic.setSongGap(opt[0]); } catch (e) {}
        showMenu(); // 刷新高亮
      }));
    });

    // 2. 语言筛选
    box.appendChild(sectionTitle('语言筛选'));
    var curLang = getLang();
    LANGS.forEach(function (l) {
      var list = langList(l[0]);
      var suffix = l[0] === 'all' ? '' : ' (' + (list ? list.length : 0) + ')';
      box.appendChild(rowBtn(l[1] + suffix, l[0] === curLang, function () {
        setLang(l[0]);
        showMenu();
      }));
    });

    ov.appendChild(box);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeMenu(); });
    document.body.appendChild(ov);
  }

  /* 长按唱片 0.6s 弹出 */
  function init() {
    var vinyl = document.getElementById('ph-vinyl');
    if (!vinyl) return;
    var timer = null, sx = 0, sy = 0;
    function start(x, y) {
      sx = x; sy = y;
      timer = setTimeout(showMenu, 600);
    }
    function move(x, y) {
      if (timer && Math.hypot(x - sx, y - sy) > 12) { clearTimeout(timer); timer = null; }
    }
    function end() { if (timer) { clearTimeout(timer); timer = null; } }
    vinyl.addEventListener('touchstart', function (e) {
      var t = e.touches[0]; start(t.clientX, t.clientY);
    }, { passive: true });
    vinyl.addEventListener('touchmove', function (e) {
      var t = e.touches[0]; move(t.clientX, t.clientY);
    }, { passive: true });
    vinyl.addEventListener('touchend', end);
    vinyl.addEventListener('touchcancel', end);
    vinyl.addEventListener('mousedown', function (e) { start(e.clientX, e.clientY); });
    vinyl.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
    vinyl.addEventListener('mouseup', end);
    vinyl.addEventListener('mouseleave', end);
  }

  /* 对外：game.js 用 */
  window.VinylMenu = {
    songLang: songLang,
    langList: langList,
    getLang: getLang,
    setLang: setLang,
    langName: function (l) { return LANG_NAME[l] || l; },
    close: closeMenu
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
