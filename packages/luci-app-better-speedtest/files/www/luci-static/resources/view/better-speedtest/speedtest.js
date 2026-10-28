'use strict';
'require view';
'require rpc';
'require ui';

/* Services > Speed test: better-speedtest (multi-source: China mainland per-carrier nodes, CDNs, Speedtest.net).  The test runs as a
 * background job on the router (it goes on when the page is closed); the page follows its NDJSON events.
 * Back end: /usr/libexec/rpcd/luci.better-speedtest over /usr/share/better-speedtest/job.uc */
var callGet = rpc.declare({ object: 'luci.better-speedtest', method: 'get' });
var callStatus = rpc.declare({ object: 'luci.better-speedtest', method: 'status' });
var callStart = rpc.declare({ object: 'luci.better-speedtest', method: 'start', params: [ 'src', 'node', 'direction', 'duration', 'multi' ] });
var callStop = rpc.declare({ object: 'luci.better-speedtest', method: 'stop' });
var callNodes = rpc.declare({ object: 'luci.better-speedtest', method: 'nodes', params: [ 'src' ] });
var callLocation = rpc.declare({ object: 'luci.better-speedtest', method: 'location' });
var callClear = rpc.declare({ object: 'luci.better-speedtest', method: 'clear_history' });

var SOURCES = [ [ 'auto', _('Automatic (mainland China: per-carrier nodes; elsewhere: the fastest CDN or Speedtest.net server)') ],
	[ 'cnspeed', _('Mainland China per-carrier nodes (cnspeed)') ], [ 'cdn', _('CDN download sources') ], [ 'ookla', _('Speedtest.net servers') ] ];
var DIRECTIONS = [ [ 'both', _('Download and upload') ], [ 'down', _('Download only') ], [ 'up', _('Upload only') ] ];
var DL = '#2e86de', UL = '#e056a0';

function safe(p) {
	return p.catch(function(e) { return { error: e && e.message ? e.message : String(e) }; });
}
function mbps(v) {
	return typeof v === 'number' ? v.toFixed(1) + ' Mbps' : '—';
}
function ms(v) {
	return typeof v === 'number' ? v.toFixed(0) + ' ms' : '—';
}
function when(ts) {
	return ts ? new Date(ts * 1000).toLocaleString() : '—';
}
function select(choices, value) {
	return E('select', { 'class': 'cbi-input-select' }, choices.map(function(c) {
		return E('option', { 'value': c[0], 'selected': String(c[0]) === String(value) ? '' : null }, c[1]);
	}));
}
function row(label, field, help) {
	return E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, label),
		E('div', { 'class': 'cbi-value-field' }, [ field, help ? E('div', { 'class': 'cbi-value-description' }, help) : '' ]) ]);
}
function table(head, rows) {
	return E('table', { 'class': 'table' }, [ E('tr', { 'class': 'tr table-titles' }, head.map(function(h) { return E('th', { 'class': 'th' }, h); })) ]
		.concat(rows.map(function(r) {
			return E('tr', { 'class': 'tr' }, r.map(function(v, i) { return E('td', { 'class': 'td', 'data-title': head[i] }, v); }));
		})));
}

/* download and upload over the time of the test (seconds), upload after download */
function chart(events) {
	var dl = [], ul = [], max = 10;
	events.forEach(function(e) {
		if (e.phase === 'download') dl.push(e.mbps || 0);
		else if (e.phase === 'upload') ul.push(e.mbps || 0);
		if (e.phase === 'download' || e.phase === 'upload') max = Math.max(max, e.peak || 0, e.mbps || 0);
	});
	var n = Math.max(dl.length + ul.length, 10), W = 600, H = 160, top = Math.ceil(max * 1.15 / 10) * 10;
	function line(vals, off, color) {
		if (!vals.length) return '';
		var pts = vals.map(function(v, i) { return ((off + i + 1) * W / n).toFixed(1) + ',' + (H - v * H / top).toFixed(1); });
		pts.unshift((off * W / n).toFixed(1) + ',' + H);
		return '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round"/>';
	}
	/* SVG from markup: elements made by E() would be HTML elements, which the browser does not draw */
	var grid = [ 0.25, 0.5, 0.75 ].map(function(f) { return '<line x1="0" x2="' + W + '" y1="' + H * f + '" y2="' + H * f + '" stroke="#8884" stroke-width="1"/>'; });
	var svg = E('div');
	svg.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:100%;height:160px;display:block">' +
		grid.join('') + line(dl, 0, DL) + line(ul, dl.length, UL) + '</svg>';
	return E('div', {}, [ svg, E('div', { 'style': 'display:flex;justify-content:space-between;font-size:12px;color:#888' },
		[ E('span', {}, '0'), E('span', {}, _('Scale: %d Mbps').format(top)) ]) ]);
}

return view.extend({
	load: function() {
		return safe(callGet());
	},

	render: function(data) {
		var self = this, st = (data && data.settings) || {};
		var srcSel = select(SOURCES, st.src || 'auto');
		var nodeSel = E('select', { 'class': 'cbi-input-select' });
		var nodeNote = E('span', { 'style': 'margin-left:.5em;color:#888' });
		var dirSel = select(DIRECTIONS, st.direction || 'both');
		var durIn = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'min': '5', 'max': '60', 'value': st.duration || 10, 'style': 'width:6em' });
		var multiSel = select([ [ 1, '1' ], [ 2, '2' ], [ 3, '3' ], [ 4, '4' ] ], st.multi || 1);
		var startBtn = E('button', { 'class': 'cbi-button cbi-button-action important' }, _('Start test'));
		var stopBtn = E('button', { 'class': 'cbi-button cbi-button-negative', 'style': 'display:none' }, _('Stop'));
		var note = E('div');
		var place = E('div', { 'class': 'cbi-section-descr' }, _('Finding the location…'));
		var live = E('div'), result = E('div'), hist = E('div');
		var timer = null;

		function fillNodes(src, want) {
			nodeSel.replaceChildren(E('option', { 'value': '' }, _('The fastest (automatic)')));
			nodeNote.textContent = '';
			nodeSel.disabled = src === 'auto';
			if (src === 'auto') return Promise.resolve();
			nodeNote.textContent = _('Loading the nodes…');
			return safe(callNodes(src)).then(function(r) {
				nodeNote.textContent = r.error ? _(r.error) : _('%d nodes').format((r.nodes || []).length);
				var have = false;
				(r.nodes || []).forEach(function(n) {
					var where = [ n.carrier, n.province, n.city ].filter(function(x) { return x; }).join(' ');
					nodeSel.appendChild(E('option', { 'value': n.name }, where ? n.name + ' (' + where + ')' : n.name));
					if (n.name === want) have = true;
				});
				if (want && !have) nodeSel.appendChild(E('option', { 'value': want }, want));
				nodeSel.value = want || '';
			});
		}
		srcSel.addEventListener('change', function() { fillNodes(srcSel.value, ''); });

		function drawLive(s) {
			var ev = s.events || [], last = {}, msg = '';
			ev.forEach(function(e) {
				if (e.phase === 'download' || e.phase === 'upload') last[e.phase] = e;
				else if (e.msg && e.phase !== 'start') msg = e.msg;
			});
			var big = function(label, e, color) {
				return E('div', { 'style': 'flex:1;min-width:10em' }, [ E('div', { 'style': 'color:#888' }, label),
					E('div', { 'style': 'font-size:2em;font-weight:bold;color:' + color }, e ? mbps(e.mbps) : '—'),
					E('div', { 'style': 'color:#888' }, e ? _('Peak %s').format(mbps(e.peak)) : '') ]);
			};
			var job = s.job || {}, set = job.settings || {};
			var head = s.running ? _('Running since %s').format(when(job.started)) : (job.started ? _('Last test: %s').format(when(job.started)) : _('No test yet'));
			live.replaceChildren(
				E('p', {}, [ E('b', {}, head), set.src ? ' · ' + (SOURCES.filter(function(c) { return c[0] === set.src; })[0] || [ '', set.src ])[1] : '' ]),
				msg && s.running ? E('p', { 'style': 'color:#888' }, msg) : '',
				s.error && !s.running ? E('div', { 'class': 'alert-message warning' }, s.error === 'Stopped' ? _('The test was stopped.') : _(s.error)) : '',
				E('div', { 'style': 'display:flex;gap:1em;flex-wrap:wrap;margin:.5em 0' }, [ big(_('Download'), last.download, DL), big(_('Upload'), last.upload, UL) ]),
				ev.length ? chart(ev) : '');
			/* only the directions that were measured */
			var r = s.result, dir = set.direction || 'both';
			result.replaceChildren(r ? table([ _('Download'), _('Upload'), _('Latency'), _('Jitter'), _('Server') ], [ [
				dir === 'up' ? '—' : E('span', {}, [ E('b', { 'style': 'color:' + DL }, mbps(r.dl_avg)), E('br'), _('Peak %s').format(mbps(r.dl_peak)), r.dl_conns ? ' · ' + _('%d connections').format(r.dl_conns) : '' ]),
				dir === 'down' ? '—' : E('span', {}, r.ul_msg ? r.ul_msg : [ E('b', { 'style': 'color:' + UL }, mbps(r.ul_avg)), E('br'), _('Peak %s').format(mbps(r.ul_peak)), r.ul_conns ? ' · ' + _('%d connections').format(r.ul_conns) : '' ]),
				ms(r.ping), ms(r.jitter),
				E('span', {}, [ r.node || '—', E('br'), E('span', { 'style': 'color:#888' }, [ r.source, r.carrier, r.city ].filter(function(x) { return x; }).join(' · ')) ])
			] ]) : '');
			startBtn.style.display = s.running ? 'none' : '';
			stopBtn.style.display = s.running ? '' : 'none';
		}

		function drawHistory(h) {
			hist.replaceChildren(h && h.length ? table([ _('Time'), _('Server'), _('Download'), _('Upload'), _('Latency') ], h.map(function(x) {
				var d = (x.settings || {}).direction || 'both';
				return [ when(x.t), x.node || '—', d === 'up' ? '—' : mbps(x.dl_avg), d === 'down' ? '—' : (x.ul_msg ? x.ul_msg : mbps(x.ul_avg)), ms(x.ping) ];
			})) : E('em', {}, _('No results yet')));
		}

		/* while a test runs the page asks every second; it stops asking once the job has ended */
		function follow() {
			window.clearTimeout(timer);
			return safe(callStatus()).then(function(s) {
				if (s.error && s.running === undefined) { ui.addNotification(null, E('p', {}, s.error)); return; }
				drawLive(s);
				if (s.running) timer = window.setTimeout(follow, 1000);
				else return safe(callGet()).then(function(g) { drawHistory(g.history); });
			});
		}

		startBtn.addEventListener('click', function(ev) {
			ev.preventDefault();
			note.replaceChildren();
			startBtn.disabled = true;
			safe(callStart(srcSel.value, nodeSel.disabled ? '' : nodeSel.value, dirSel.value, parseInt(durIn.value, 10) || 0, parseInt(multiSel.value, 10))).then(function(r) {
				startBtn.disabled = false;
				if (r.error) note.replaceChildren(E('div', { 'class': 'alert-message warning' }, _(r.error)));
				else follow();
			});
		});
		stopBtn.addEventListener('click', function(ev) {
			ev.preventDefault();
			safe(callStop()).then(follow);
		});

		fillNodes(st.src || 'auto', st.node || '');
		drawLive((data && data.status) || {});
		drawHistory(data && data.history);
		if (data && data.status && data.status.running) follow();
		safe(callLocation()).then(function(l) {
			place.textContent = l.error ? _(l.error) : _('Public address %s · %s').format(l.ip || '—', [ l.carrier, l.province, l.city ].filter(function(x) { return x; }).join(' ') || '—');
		});

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Speed test')),
			E('div', { 'class': 'cbi-map-descr' }, _('Measures the router\'s own uplink with better-speedtest. A test downloads and uploads as fast as the link allows: on mobile data one test can use several hundred MB, more with a longer duration or several sources at once.')),
			E('div', { 'class': 'cbi-section' }, [ place,
				row(_('Source'), srcSel),
				row(_('Server'), E('span', {}, [ nodeSel, nodeNote ]), _('Only for a chosen source; automatic picks the fastest one.')),
				row(_('Direction'), dirSel),
				row(_('Duration'), E('span', {}, [ durIn, ' ', _('seconds per direction') ]), _('5 to 60. A short probe of the sources comes first.')),
				row(_('Sources at once'), multiSel, _('More than one adds up the throughput of the fastest sources, for links one server cannot fill.')),
				E('div', { 'class': 'cbi-page-actions' }, [ startBtn, ' ', stopBtn ]), note ]),
			E('div', { 'class': 'cbi-section' }, [ E('h3', {}, _('Test')), live, result ]),
			E('div', { 'class': 'cbi-section' }, [ E('h3', {}, _('History')), hist, E('div', { 'class': 'cbi-page-actions' }, [
				E('button', { 'class': 'cbi-button cbi-button-neutral', 'click': function(ev) {
					ev.preventDefault();
					return safe(callClear()).then(function() { drawHistory([]); });
				} }, _('Clear history')) ]) ])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
