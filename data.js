// 데이터 읽기 계층.
// 화면(app.js)은 이 파일의 "데이터 소스"만 부릅니다.
// 나중에 시트 대신 DB/API로 바꿀 때는 SheetsSource와 같은 모양의 새 소스만 만들면 화면은 그대로 둘 수 있습니다.
//
// 데이터 소스가 돌려주는 공통 형식
//   getOps()  -> { media: ['메타', ...], rows: [{ company, status, cells:{매체:값}, lastDate, note }] }
//   getPerf() -> { missing: bool, records: [{ date:'YYYY-MM-DD', company, media,
//                                             impressions, clicks, spend, conversions, revenue }] }
(function () {
  var cfg = window.APP_CONFIG;
  var API = 'https://sheets.googleapis.com/v4/spreadsheets/';

  function normDate(v) {
    var m = String(v || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (!m) return '';
    return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }
  function num(v) {
    var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  }

  // ---- 운영 현황 상태 분류 ----
  function statusKey(s) {
    s = String(s || '');
    if (s.indexOf('①') === 0) return 'live';
    if (s.indexOf('②') === 0) return 'est';
    if (s.indexOf('③') === 0) return 'stop';
    if (s.indexOf('④') === 0) return 'unset';
    return 'other';
  }
  function cellClass(v) {
    v = String(v || '');
    if (!v) return 'c-empty';
    if (/^LIVE/i.test(v)) return 'c-live';
    if (/^멈춤/.test(v)) return 'c-stop';
    if (/까지/.test(v)) return 'c-est';
    if (v.indexOf('△') >= 0) return 'c-warn';
    if (v.indexOf('?') >= 0) return 'c-unk';
    if (/탭만/.test(v)) return 'c-tab';
    return 'c-other';
  }

  // ---- 시트 값 -> 공통 형식 ----
  function parseOps(values) {
    var head = (values[0] || []).map(function (s) { return String(s).trim(); });
    var iCompany = head.indexOf('업체');
    var iStatus = head.indexOf('상태');
    if (iCompany < 0 || iStatus < 0) throw new Error('운영 현황 탭에서 "업체", "상태" 제목 줄을 찾지 못했습니다.');
    var iLast = head.indexOf('마지막 데이터일');
    var iNote = head.indexOf('비고');
    var mediaEnd = iLast >= 0 ? iLast : head.length;
    var mediaIdx = [];
    for (var i = iStatus + 1; i < mediaEnd; i++) if (head[i]) mediaIdx.push(i);
    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var v = values[r] || [];
      var company = String(v[iCompany] || '').trim();
      if (!company) continue;
      var cells = {};
      mediaIdx.forEach(function (idx) { cells[head[idx]] = String(v[idx] || '').trim(); });
      rows.push({
        company: company,
        status: String(v[iStatus] || '').trim(),
        cells: cells,
        lastDate: iLast >= 0 ? String(v[iLast] || '').trim() : '',
        note: iNote >= 0 ? String(v[iNote] || '').trim() : ''
      });
    }
    return { media: mediaIdx.map(function (i) { return head[i]; }), rows: rows };
  }

  var ALIAS = {
    date: ['일자', '날짜', 'date'],
    company: ['업체', '브랜드', '업체명', 'company'],
    media: ['매체', 'media'],
    impressions: ['노출', '노출수', 'impressions'],
    clicks: ['클릭', '클릭수', 'clicks'],
    spend: ['광고비', '비용', 'spend'],
    conversions: ['전환', '전환수', 'conversions'],
    revenue: ['매출', '전환매출', 'revenue']
  };
  function parsePerf(values) {
    var head = (values[0] || []).map(function (s) { return String(s).trim().toLowerCase(); });
    var col = {};
    Object.keys(ALIAS).forEach(function (k) {
      for (var i = 0; i < ALIAS[k].length; i++) {
        var idx = head.indexOf(ALIAS[k][i].toLowerCase());
        if (idx >= 0) { col[k] = idx; break; }
      }
    });
    if (col.date == null || col.company == null || col.spend == null) {
      throw new Error('성과 탭에 "일자", "업체", "광고비" 제목 줄이 필요합니다.');
    }
    var records = [];
    for (var r = 1; r < values.length; r++) {
      var v = values[r] || [];
      var date = normDate(v[col.date]);
      var company = String(v[col.company] || '').trim();
      if (!date || !company) continue;
      records.push({
        date: date,
        company: company,
        media: col.media != null ? String(v[col.media] || '').trim() || '기타' : '전체',
        impressions: col.impressions != null ? num(v[col.impressions]) : 0,
        clicks: col.clicks != null ? num(v[col.clicks]) : 0,
        spend: num(v[col.spend]),
        conversions: col.conversions != null ? num(v[col.conversions]) : 0,
        revenue: col.revenue != null ? num(v[col.revenue]) : 0
      });
    }
    return { missing: false, records: records };
  }

  // ---- 실제 시트 소스 (구글 로그인 토큰으로 읽기 전용 조회) ----
  function SheetsSource(token) { this.token = token; this.label = '실제 시트 연결'; this.demo = false; }
  SheetsSource.prototype._get = function (tab, range) {
    var url = API + cfg.SPREADSHEET_ID + '/values/' + encodeURIComponent("'" + tab + "'!" + range) + '?valueRenderOption=FORMATTED_VALUE';
    return fetch(url, { headers: { Authorization: 'Bearer ' + this.token } }).then(function (res) {
      if (res.ok) return res.json().then(function (j) { return j.values || []; });
      return res.json().catch(function () { return {}; }).then(function (j) {
        var err = new Error((j.error && j.error.message) || ('HTTP ' + res.status));
        err.status = res.status;
        throw err;
      });
    });
  };
  SheetsSource.prototype.getOps = function () {
    return this._get(cfg.OPS_TAB, 'A1:Z300').then(parseOps);
  };
  SheetsSource.prototype.getPerf = function () {
    return this._get(cfg.PERF_TAB, 'A1:L100000').then(parsePerf).catch(function (e) {
      if (e.status === 400) return { missing: true, records: [] }; // 탭이 아직 없음
      throw e;
    });
  };

  // ---- 데모 소스 (가짜 데이터. 실제 업체 정보 없음) ----
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function pad(n) { return ('0' + n).slice(-2); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  var DEMO_MEDIA = ['메타', '구글', 'N브랜드검색', 'N파워링크', 'N쇼핑검색', 'GFA', '틱톡', '지그재그', '카카오모먼트', '모비온'];
  var DEMO_STATUS = ['① 라이브 (데모)', '② 라이브 추정 (데모)', '③ 데이터 멈춤', '④ 미세팅 (양식만)'];

  function DemoSource() { this.label = '데모 데이터 (가짜)'; this.demo = true; this._rand = mulberry32(20261105); }
  DemoSource.prototype.getOps = function () {
    var rand = mulberry32(7), now = new Date(), y = new Date(now.getTime() - 86400000);
    var yd = pad(y.getMonth() + 1) + '/' + pad(y.getDate());
    var rows = [];
    for (var i = 1; i <= 24; i++) {
      var sk = i % 10 < 5 ? 0 : i % 10 < 7 ? 1 : i % 10 < 9 ? 2 : 3;
      var cells = {};
      DEMO_MEDIA.forEach(function (m, mi) {
        var run = mi === 0 ? sk < 3 : rand() < 0.25;
        if (!run || sk === 3) { cells[m] = (sk === 3 && rand() < 0.2) ? '탭만' : ''; return; }
        cells[m] = sk === 0 ? 'LIVE' : sk === 1 ? yd + '까지' : '멈춤 ' + pad(y.getMonth() + 1) + '/' + pad(1 + Math.floor(rand() * 20));
      });
      rows.push({
        company: '데모브랜드 ' + pad(i), status: DEMO_STATUS[sk], cells: cells,
        lastDate: sk === 3 ? '' : ymd(y), note: sk === 2 ? '데모용 메모' : ''
      });
    }
    return Promise.resolve({ media: DEMO_MEDIA, rows: rows });
  };
  DemoSource.prototype.getPerf = function () {
    var rand = mulberry32(99), records = [], today = new Date();
    var mediaPool = ['메타', '구글', 'N파워링크', 'GFA', '틱톡'];
    for (var b = 1; b <= 20; b++) {
      var scale = 80000 + rand() * 900000;
      var medias = mediaPool.filter(function (m, i) { return i === 0 || rand() < 0.4; });
      for (var d = 30; d >= 1; d--) {
        var date = new Date(today.getTime() - d * 86400000);
        medias.forEach(function (m) {
          var spend = Math.round(scale * (0.4 + rand()) * (m === '메타' ? 1 : 0.4));
          var imp = Math.round(spend * (40 + rand() * 60));
          var clicks = Math.round(imp * (0.008 + rand() * 0.02));
          var conv = Math.round(clicks * (0.01 + rand() * 0.04));
          records.push({
            date: ymd(date), company: '데모브랜드 ' + pad(b), media: m, impressions: imp, clicks: clicks,
            spend: spend, conversions: conv, revenue: Math.round(spend * (1.5 + rand() * 4))
          });
        });
      }
    }
    return Promise.resolve({ missing: false, records: records });
  };

  window.DATA = { SheetsSource: SheetsSource, DemoSource: DemoSource, statusKey: statusKey, cellClass: cellClass, parseOps: parseOps, parsePerf: parsePerf };
})();
