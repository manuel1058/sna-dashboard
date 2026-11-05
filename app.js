// 화면 계층: 로그인, 메뉴, 운영 현황, 광고 성과.
// 데이터는 항상 state.source(getOps / getPerf)로만 읽습니다.
(function () {
  var cfg = window.APP_CONFIG;
  var DATA = window.DATA;
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var fmt = function (n) { return Math.round(n).toLocaleString('ko-KR'); };
  var won = function (n) { return fmt(n) + '원'; };
  var pct = function (n, d) { return isFinite(n) ? n.toFixed(d == null ? 1 : d) + '%' : '-'; };

  var state = {
    source: null, token: null, tokenClient: null,
    ops: null, perf: null, route: 'ops',
    opsFilter: { status: 'all', media: 'all', q: '' },
    perfRange: { from: '', to: '' }
  };

  // ---------- 로그인 ----------
  function loginMsg(t) { $('#login-msg').textContent = t || ''; }

  function startLogin() {
    loginMsg('');
    if (!cfg.CLIENT_ID) { loginMsg('구글 로그인 설정이 아직 끝나지 않았습니다. 지금은 데모 화면만 볼 수 있습니다.'); return; }
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      loginMsg('구글 로그인 스크립트를 불러오는 중입니다. 잠시 후 다시 눌러 주세요.'); return;
    }
    if (!state.tokenClient) {
      state.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: cfg.CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
        callback: onToken,
        error_callback: function () { loginMsg('로그인이 취소되었거나 실패했습니다.'); }
      });
    }
    state.tokenClient.requestAccessToken({ prompt: '' });
  }
  function onToken(resp) {
    if (!resp || resp.error) { loginMsg('로그인에 실패했습니다. (' + esc(resp && resp.error) + ')'); return; }
    state.token = resp.access_token; // 메모리에만 보관. 저장하지 않음
    state.source = new DATA.SheetsSource(state.token);
    enter();
  }
  function startDemo() { state.source = new DATA.DemoSource(); enter(); }

  function logout(msg) {
    if (state.token && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(state.token, function () {}); } catch (e) {}
    }
    state.token = null; state.source = null; state.ops = null; state.perf = null;
    $('#app').hidden = true; $('#login').hidden = false;
    loginMsg(msg || '');
  }

  // ---------- 진입/데이터 로드 ----------
  function enter() {
    $('#login').hidden = true; $('#app').hidden = false;
    $('#mode-label').textContent = state.source.label;
    var banner = $('#banner');
    if (state.source.demo) {
      banner.hidden = false;
      banner.textContent = '데모 데이터입니다. 화면 구성을 보여 드리기 위한 가짜 숫자이며 실제 업체와 무관합니다.';
    } else { banner.hidden = true; }
    state.route = (location.hash.replace('#', '') === 'perf') ? 'perf' : 'ops';
    state.perfRange = { from: '', to: '' };
    reload();
  }

  function reload() {
    $('#view').innerHTML = '<div class="loading">데이터를 불러오는 중입니다…</div>';
    var src = state.source;
    var wrap = function (p) { return p.catch(function (e) { return { error: e }; }); };
    Promise.all([wrap(src.getOps()), wrap(src.getPerf())]).then(function (r) {
      state.ops = r[0]; state.perf = r[1];
      var expired = [r[0], r[1]].some(function (x) { return x.error && x.error.status === 401; });
      if (expired) { logout('로그인이 만료되었습니다. 다시 로그인해 주세요.'); return; }
      render();
    });
  }

  // ---------- 공통 렌더 ----------
  function render() {
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-route') === state.route);
    });
    $('#view').innerHTML = state.route === 'perf' ? perfHtml() : opsHtml();
    bindView();
  }

  function errorHtml(title, err) {
    var s = err && err.status, msg;
    if (s === 403) msg = '이 구글 계정에는 마스터 시트 <b>보기 권한</b>이 없습니다. 시트 관리자에게 이 계정으로 공유를 요청해 주세요.';
    else if (s === 404) msg = '시트를 찾을 수 없습니다. 시트 주소(ID) 설정을 확인해 주세요.';
    else if (s === 400) msg = '시트 탭 이름을 확인해 주세요. (' + esc(err.message) + ')';
    else msg = esc((err && err.message) || '알 수 없는 오류');
    return '<div class="eyebrow">' + esc(title) + '</div><div class="panel empty"><b>데이터를 불러오지 못했습니다.</b><br>' + msg + '</div>';
  }

  // ---------- 운영 현황 ----------
  function opsFiltered() {
    var f = state.opsFilter, q = f.q.trim().toLowerCase();
    return state.ops.rows.filter(function (r) {
      if (f.status !== 'all' && DATA.statusKey(r.status) !== f.status) return false;
      if (f.media !== 'all') { var c = r.cells[f.media]; if (!c || /탭만/.test(c)) return false; }
      if (q && (r.company + ' ' + r.note).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function opsTableHtml() {
    var d = state.ops, rows = opsFiltered();
    var order = { live: 0, est: 1, other: 2, stop: 3, unset: 4 };
    rows = rows.slice().sort(function (a, b) { return order[DATA.statusKey(a.status)] - order[DATA.statusKey(b.status)]; });
    if (!rows.length) return '<div class="empty">조건에 맞는 업체가 없습니다.</div>';
    var h = '<div class="table-wrap"><table><thead><tr><th class="first">업체</th><th>상태</th>';
    d.media.forEach(function (m) { h += '<th>' + esc(m) + '</th>'; });
    h += '<th>마지막 데이터일</th><th>비고</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var k = DATA.statusKey(r.status);
      h += '<tr><td class="first">' + esc(r.company) + '</td><td><span class="badge b-' + k + '">' + esc(r.status || '-') + '</span></td>';
      d.media.forEach(function (m) {
        var v = r.cells[m] || '';
        h += '<td class="cell ' + DATA.cellClass(v) + '">' + (v ? esc(v) : '·') + '</td>';
      });
      h += '<td>' + esc(r.lastDate || '-') + '</td><td>' + esc(r.note) + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  function opsHtml() {
    var d = state.ops;
    if (d.error) return errorHtml('운영 현황', d.error);
    var c = { live: 0, est: 0, stop: 0, unset: 0, other: 0 };
    d.rows.forEach(function (r) { c[DATA.statusKey(r.status)]++; });
    var f = state.opsFilter;
    var chip = function (key, label, n) {
      return '<button class="chip' + (f.status === key ? ' on' : '') + '" data-status="' + key + '">' + label + ' ' + n + '</button>';
    };
    var mediaOpts = '<option value="all">전체 매체</option>' + d.media.map(function (m) {
      return '<option value="' + esc(m) + '"' + (f.media === m ? ' selected' : '') + '>' + esc(m) + '</option>';
    }).join('');
    return '' +
      '<div class="eyebrow">OPERATIONS</div><h1>운영 현황</h1>' +
      '<p class="lead">업체별로 어떤 매체가 라이브인지, 데이터가 멈췄는지 한눈에 확인합니다.</p>' +
      '<div class="kpis">' +
        kpi('k-blue', '전체 업체', d.rows.length, '곳', '마스터 시트 기준') +
        kpi('k-green', '라이브', c.live, '곳', '어제 데이터 확인') +
        kpi('k-purple', '라이브 추정', c.est, '곳', '날짜까지 입력됨') +
        kpi('k-red', '데이터 멈춤', c.stop, '곳', '확인 필요') +
        kpi('k-gray', '미세팅', c.unset, '곳', '양식만 있음') +
      '</div>' +
      '<div class="panel">' +
        '<div class="filters">' +
          chip('all', '전체', d.rows.length) + chip('live', '라이브', c.live) + chip('est', '추정', c.est) +
          chip('stop', '멈춤', c.stop) + chip('unset', '미세팅', c.unset) +
          '<select id="f-media">' + mediaOpts + '</select>' +
          '<input type="text" id="f-q" placeholder="업체명 검색" value="' + esc(f.q) + '">' +
          '<span class="muted" id="ops-count"></span>' +
        '</div>' +
        '<div id="ops-table">' + opsTableHtml() + '</div>' +
        '<div class="legend"><span>색상: 초록 LIVE · 청록 "날짜까지" · 빨강 "멈춤" · 노랑 △ · 회색 ?/탭만</span>' +
        '<span>표시 값의 정확한 뜻은 시트 <b>' + esc(cfg.OPS_TAB) + '</b> 탭의 범례를 따릅니다.</span></div>' +
      '</div>';
  }

  function kpi(cls, title, value, unit, sub) {
    return '<div class="kpi ' + cls + '"><div class="t">' + esc(title) + '</div><div class="v">' + value +
      (unit ? '<small>' + esc(unit) + '</small>' : '') + '</div><div class="s">' + esc(sub) + '</div></div>';
  }

  // ---------- 광고 성과 ----------
  function shiftDate(s, days) {
    var d = new Date(s + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function sumBy(list, key) {
    var m = {};
    list.forEach(function (r) {
      var o = m[r[key]] || (m[r[key]] = { name: r[key], spend: 0, revenue: 0, clicks: 0, impressions: 0, conversions: 0 });
      o.spend += r.spend; o.revenue += r.revenue; o.clicks += r.clicks; o.impressions += r.impressions; o.conversions += r.conversions;
    });
    return Object.keys(m).map(function (k) { return m[k]; });
  }
  function metricRow(o, totalSpend, first) {
    var share = totalSpend ? o.spend / totalSpend * 100 : 0;
    return '<tr><td class="first">' + esc(o.name) + '</td>' +
      '<td class="num">' + fmt(o.spend) + '</td>' +
      '<td><div class="bar"><i style="width:' + Math.min(100, share).toFixed(1) + '%"></i></div></td>' +
      '<td class="num">' + pct(share) + '</td>' +
      '<td class="num">' + fmt(o.revenue) + '</td>' +
      '<td class="num">' + pct(o.spend ? o.revenue / o.spend * 100 : NaN, 0) + '</td>' +
      '<td class="num">' + fmt(o.clicks) + '</td>' +
      '<td class="num">' + pct(o.impressions ? o.clicks / o.impressions * 100 : NaN, 2) + '</td>' +
      '<td class="num">' + (o.clicks ? fmt(o.spend / o.clicks) : '-') + '</td>' +
      '<td class="num">' + fmt(o.conversions) + '</td>' +
      '<td class="num">' + (o.conversions ? fmt(o.spend / o.conversions) : '-') + '</td></tr>';
  }
  function metricTable(title, list, totalSpend) {
    list = list.slice().sort(function (a, b) { return b.spend - a.spend; });
    var h = '<div class="panel"><div class="panel-head"><div><h2>' + esc(title) + '</h2><div class="muted">광고비 많은 순</div></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th class="first">' + (title.indexOf('업체') === 0 ? '업체' : '매체') + '</th>' +
      '<th class="num">광고비(원)</th><th>비중</th><th class="num">%</th><th class="num">매출(원)</th><th class="num">ROAS</th>' +
      '<th class="num">클릭</th><th class="num">CTR</th><th class="num">CPC(원)</th><th class="num">전환</th><th class="num">CPA(원)</th></tr></thead><tbody>';
    list.forEach(function (o) { h += metricRow(o, totalSpend); });
    return h + '</tbody></table></div></div>';
  }
  function lineChart(points) {
    if (points.length < 2) return '<div class="muted">일별 추이를 그리려면 2일 이상의 데이터가 필요합니다.</div>';
    var W = 760, H = 190, P = 30, max = Math.max.apply(null, points.map(function (p) { return p.y; }).concat([1]));
    var sx = function (i) { return P + i * (W - 2 * P) / (points.length - 1); };
    var sy = function (v) { return H - P - (v / max) * (H - 2 * P); };
    var line = points.map(function (p, i) { return sx(i).toFixed(1) + ',' + sy(p.y).toFixed(1); }).join(' ');
    var area = sx(0).toFixed(1) + ',' + (H - P) + ' ' + line + ' ' + sx(points.length - 1).toFixed(1) + ',' + (H - P);
    var dots = points.map(function (p, i) {
      return '<circle cx="' + sx(i).toFixed(1) + '" cy="' + sy(p.y).toFixed(1) + '" r="3" fill="#4f5bd5"><title>' + esc(p.x) + ' · ' + won(p.y) + '</title></circle>';
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="일별 광고비 추이">' +
      '<line x1="' + P + '" y1="' + (H - P) + '" x2="' + (W - P) + '" y2="' + (H - P) + '" stroke="#e6e9f1"/>' +
      '<polygon points="' + area + '" fill="#eceefc"/><polyline points="' + line + '" fill="none" stroke="#4f5bd5" stroke-width="2"/>' + dots +
      '<text x="' + P + '" y="' + (H - 8) + '" font-size="11" fill="#6b7385">' + esc(points[0].x) + '</text>' +
      '<text x="' + (W - P) + '" y="' + (H - 8) + '" font-size="11" fill="#6b7385" text-anchor="end">' + esc(points[points.length - 1].x) + '</text>' +
      '<text x="' + P + '" y="14" font-size="11" fill="#6b7385">최대 ' + won(max) + '</text></svg>';
  }

  function perfEmptyHtml() {
    return '<div class="eyebrow">PERFORMANCE</div><h1>광고 성과</h1>' +
      '<div class="panel empty"><b>성과 데이터 탭이 아직 없습니다.</b><br>' +
      '마스터 시트에 <code>' + esc(cfg.PERF_TAB) + '</code> 탭이 생기면 이 화면이 자동으로 채워집니다.<br>' +
      '필요한 열: <code>일자</code> <code>업체</code> <code>매체</code> <code>노출</code> <code>클릭</code> <code>광고비</code> <code>전환</code> <code>매출</code><br>' +
      '메타 API 수집을 붙이면 이 탭에 매일 자동으로 쌓이도록 만들 계획입니다.</div>';
  }

  function perfHtml() {
    var p = state.perf;
    if (p.error) return errorHtml('광고 성과', p.error);
    if (p.missing) return perfEmptyHtml();
    var recs = p.records;
    if (!recs.length) return '<div class="eyebrow">PERFORMANCE</div><h1>광고 성과</h1><div class="panel empty">' + esc(cfg.PERF_TAB) + ' 탭에 읽을 수 있는 행이 없습니다.</div>';
    var dates = recs.map(function (r) { return r.date; }).sort();
    var minD = dates[0], maxD = dates[dates.length - 1];
    var rg = state.perfRange;
    if (!rg.to) { rg.to = maxD; rg.from = shiftDate(maxD, -6); if (rg.from < minD) rg.from = minD; }
    var list = recs.filter(function (r) { return r.date >= rg.from && r.date <= rg.to; });
    var spend = 0, revenue = 0, clicks = 0, imps = 0, conv = 0;
    list.forEach(function (r) { spend += r.spend; revenue += r.revenue; clicks += r.clicks; imps += r.impressions; conv += r.conversions; });
    var byDate = sumBy(list, 'date').sort(function (a, b) { return a.name < b.name ? -1 : 1; })
      .map(function (o) { return { x: o.name, y: o.spend }; });
    var companies = sumBy(list, 'company'), medias = sumBy(list, 'media');

    var today = new Date(), todayStr = today.getFullYear() + '-' + ('0' + (today.getMonth() + 1)).slice(-2) + '-' + ('0' + today.getDate()).slice(-2);
    var lag = Math.round((new Date(todayStr + 'T12:00:00') - new Date(maxD + 'T12:00:00')) / 86400000);
    var trust = '데이터 범위 ' + minD + ' ~ ' + maxD + ' · 전체 ' + fmt(recs.length) + '행 · 선택 기간 업체 ' + companies.length + '곳';
    if (lag >= 3 && !state.source.demo) trust += ' · <b style="color:#d8453b">최신 데이터가 ' + lag + '일 전입니다</b>';

    var preset = function (n, label) { return '<button class="chip" data-preset="' + n + '">' + label + '</button>'; };
    return '' +
      '<div class="eyebrow">PERFORMANCE</div><h1>광고 성과</h1>' +
      '<p class="lead">' + trust + '</p>' +
      '<div class="panel"><div class="filters">' +
        '<input type="date" id="p-from" value="' + esc(rg.from) + '" min="' + esc(minD) + '" max="' + esc(maxD) + '"> ~ ' +
        '<input type="date" id="p-to" value="' + esc(rg.to) + '" min="' + esc(minD) + '" max="' + esc(maxD) + '">' +
        '<button class="btn" id="p-apply">기간 적용</button>' + preset(7, '최근 7일') + preset(14, '최근 14일') + preset(30, '최근 30일') +
      '</div></div>' +
      '<div class="kpis">' +
        kpi('k-blue', '총 광고비', fmt(spend), '원', rg.from + ' ~ ' + rg.to) +
        kpi('k-green', '총 매출', fmt(revenue), '원', '입력된 매출 합계') +
        kpi('k-purple', 'ROAS', spend ? (revenue / spend * 100).toFixed(0) : '-', '%', '매출 ÷ 광고비') +
        kpi('k-orange', '전환', fmt(conv), '건', conv ? 'CPA ' + fmt(spend / conv) + '원' : 'CPA -') +
      '</div>' +
      '<div class="panel chart"><div class="panel-head"><div><h2>일별 광고비 추이</h2></div></div>' + lineChart(byDate) + '</div>' +
      metricTable('업체별 성과', companies, spend) +
      metricTable('매체별 성과', medias, spend);
  }

  // ---------- 이벤트 ----------
  function bindView() {
    var v = $('#view');
    v.querySelectorAll('[data-status]').forEach(function (b) {
      b.onclick = function () { state.opsFilter.status = b.getAttribute('data-status'); render(); };
    });
    var fm = $('#f-media');
    if (fm) fm.onchange = function () { state.opsFilter.media = fm.value; render(); };
    var fq = $('#f-q');
    var cnt = $('#ops-count');
    if (cnt) cnt.textContent = opsFiltered().length + '곳 표시';
    if (fq) fq.oninput = function () {
      state.opsFilter.q = fq.value;
      $('#ops-table').innerHTML = opsTableHtml();
      cnt.textContent = opsFiltered().length + '곳 표시';
    };
    var apply = $('#p-apply');
    if (apply) apply.onclick = function () {
      var f = $('#p-from').value, t = $('#p-to').value;
      if (f && t && f <= t) { state.perfRange = { from: f, to: t }; render(); }
    };
    v.querySelectorAll('[data-preset]').forEach(function (b) {
      b.onclick = function () {
        var dates = state.perf.records.map(function (r) { return r.date; }).sort();
        var maxD = dates[dates.length - 1], n = parseInt(b.getAttribute('data-preset'), 10);
        var from = shiftDate(maxD, -(n - 1));
        state.perfRange = { from: from < dates[0] ? dates[0] : from, to: maxD };
        render();
      };
    });
  }

  document.querySelectorAll('.nav-item').forEach(function (b) {
    b.onclick = function () {
      state.route = b.getAttribute('data-route');
      location.hash = state.route;
      if (state.ops) render();
    };
  });
  $('#btn-login').onclick = startLogin;
  $('#btn-demo').onclick = startDemo;
  $('#btn-reload').onclick = function () { if (state.source) reload(); };
  $('#btn-logout').onclick = function () { logout(''); };

  // 주소 끝에 ?demo=1 을 붙이면 로그인 없이 바로 데모 화면 (화면 확인용)
  if (/[?&]demo=1/.test(location.search)) startDemo();
})();
