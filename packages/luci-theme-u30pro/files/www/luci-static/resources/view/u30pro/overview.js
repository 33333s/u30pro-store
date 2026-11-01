'use strict';
'require view';
'require rpc';
'require ui';
'require poll';

/* Overview of the U30 Pro theme: the front of the device, its screen showing the on-device home page (drawn here from the same feed the
 * screen program gets, tools/ui/pages.h page_home, whether the real screen is on or not), and tiles for the network, Wi-Fi, battery,
 * screen, NFC, messages and system.  The screen and the function key open System > Device, the tiles their LuCI pages, NFC a dialog. */

var callState = rpc.declare({ object: 'u30pro-dashboard', method: 'state' });
var callGet = rpc.declare({ object: 'u30pro-native-control', method: 'get' });
var callCell = rpc.declare({ object: 'u30pro-native-control', method: 'cellular_action', params: [ 'action' ] });
var callWifi = rpc.declare({ object: 'u30pro-native-control', method: 'wifi_toggle' });
var callScreen = rpc.declare({ object: 'u30pro-native-control', method: 'set_screen_power', params: [ 'action' ] });
var callNfc = rpc.declare({ object: 'u30pro-dashboard', method: 'nfc_set', params: [ 'enabled' ] });
/* the wallpaper of the screen (System > Screen wallpaper; firmware with u30pro-wallpaper) */
var callWp = rpc.declare({ object: 'u30pro-wallpaper', method: 'get' });
var callWpImage = rpc.declare({ object: 'u30pro-wallpaper', method: 'image' });

var LINK = { network: 'admin/modem/overview', wifi: 'admin/network/wireless', battery: 'admin/status/u30pro-battery',
	screen: 'admin/system/u30pro-device', key: 'admin/system/u30pro-device', sms: 'admin/modem/sms', system: 'admin/status/overview' };

/* ------------------------------------------------------------------ helpers */
function icon(name) {
	var s = E('span', { 'class': 'u-ic', 'aria-hidden': 'true' });
	s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
		((window.U30_ICONS || {})[name] || '') + '</svg>';
	return s;
}
function num(v) { return typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && v !== '' && isFinite(+v) ? +v : null); }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function txt(el, s) { s = String(s); if (el.textContent !== s) el.textContent = s; }
function fmtRate(bps) {
	if (bps == null) return [ '–', 'B/s' ];
	if (bps < 1000) return [ String(Math.round(bps)), 'B/s' ];
	if (bps < 1e6) { var k = bps / 1e3; return [ k < 10 ? k.toFixed(1) : k.toFixed(0), 'KB/s' ]; }
	if (bps < 1e9) { var m = bps / 1e6; return [ m < 10 ? m.toFixed(1) : m.toFixed(0), 'MB/s' ]; }
	return [ (bps / 1e9).toFixed(1), 'GB/s' ];
}
function fmtSleep(s) {
	if (s == null) return '–';
	if (s === 0) return _('Always on');
	return s < 60 ? _('%d s').format(s) : _('%d min').format(s / 60);
}
function fmtDur(s) {
	if (s == null) return '–';
	if (s >= 86400) return _('%d d %d h').format(Math.floor(s / 86400), Math.floor(s % 86400 / 3600));
	if (s >= 3600) return _('%d h %d min').format(Math.floor(s / 3600), Math.floor(s % 3600 / 60));
	return _('%d min').format(Math.floor(s / 60));
}
function rgb(hex) { var v = parseInt(hex.slice(1), 16); return [ v >> 16 & 255, v >> 8 & 255, v & 255 ]; }
function css(c, a) { return a == null || a >= 255 ? 'rgb(' + c.join(',') + ')' : 'rgba(' + c.join(',') + ',' + (a / 255).toFixed(3) + ')'; }
/* gx_mix of the screen program: fg over bg with alpha a (0..255) */
function mix(bg, fg, a) { return [ 0, 1, 2 ].map(function(i) { return Math.round((bg[i] * (255 - a) + fg[i] * a) / 255); }); }
function fail(e) { ui.addNotification(null, E('p', {}, (e && e.message) || String(e)), 'error'); }

var THEMES = [ { a: '#38D0FF', b: '#FF7AC8' }, { a: '#4ADE80', b: '#FFC857' }, { a: '#FF9F43', b: '#6C8CFF' }, { a: '#A78BFA', b: '#2DD4BF' } ];
var C_TXT = rgb('#F2F6FA'), C_DIM = rgb('#93A4B8'), C_FAINT = rgb('#56677A'), C_OK = rgb('#4ADE80'), C_WARN = rgb('#FBBF24'), C_BAD = rgb('#F87171'), INK = rgb('#10151F');
var WDAY = [ '周日', '周一', '周二', '周三', '周四', '周五', '周六' ];
var FONT = (getComputedStyle(document.documentElement).getPropertyValue('--font-sans') || 'system-ui, sans-serif').trim();

/* ------------------------------------------------------------------ state */
var S = { st: null, nc: null, skew: 0, theme: 1 };
function feed(k) { var f = S.st && S.st.feed; return f ? f[k] : undefined; }
function feedNum(k) { return num(feed(k)); }
function battery() {
	var b = S.nc && S.nc.battery, c = S.nc && S.nc.charger;
	if (!b || !b.available) return null;
	return { pct: num(b.capacity_percent), charging: c && c.status === 'Charging', full: c && c.status === 'Full', online: c && c.online == 1,
		paused: c && c.charge_behaviour === 'inhibit-charge' };
}
function batteryState(b) {
	if (!b) return '–';
	if (b.charging) return _('Charging');
	if (b.full) return _('Full');
	if (b.online && b.paused) return _('Charging paused');
	return b.online ? _('External power') : _('On battery');
}
/* the operator line of the screen (its own Chinese text, as the device shows it) */
function cellText() {
	if (feed('cell_connected') == '1') return feed('op') || '已连接';
	var s = feed('cell_state');
	if (s === 'waiting-sim') return '无SIM卡';
	if (s === 'data-unavailable') return '无数据';
	if (!S.st || !S.st.feed || s == null) return '启动中';
	return '拨号中…';
}
function signalBars() {
	if (feed('cell_connected') != '1' || feed('have_sig') != '1') return 0;
	var r = feedNum('rsrp');
	return r == null ? 0 : r >= -85 ? 4 : r >= -95 ? 3 : r >= -105 ? 2 : r >= -115 ? 1 : 0;
}

/* ------------------------------------------------------------------ the screen */
function arc(ctx, cx, cy, r, w, a0, a1, col, alpha, round) {
	ctx.beginPath();
	ctx.arc(cx, cy, r, (a0 - 90) * Math.PI / 180, (a1 - 90) * Math.PI / 180);
	ctx.lineWidth = w; ctx.lineCap = round ? 'round' : 'butt'; ctx.strokeStyle = css(col, alpha); ctx.stroke();
}
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
function tri(ctx, p, col) { ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[2], p[3]); ctx.lineTo(p[4], p[5]); ctx.closePath(); ctx.fillStyle = css(col); ctx.fill(); }
function font(px, bold) { return (bold ? '700 ' : '500 ') + px + 'px ' + FONT; }

/* the wallpaper as tools/ui/wall.h shows it on the home page: dimmed, and the dial on a disc of thin glass (the blurred wallpaper under a
 * tinted pane, a rim lit from above).  The blur here is a down- and up-scale, which every browser's canvas can do. */
var TINT = [ '#161E2C', '#1C1C1E', '#E1E8F0', null ];
function wallpaper(ctx, wp, A) {
	var s = wp.settings || {}, dim = (s.dim != null ? s.dim : 30) / 100, clear = (s.glass != null ? s.glass : 50) / 100;
	var tint = TINT[s.tint || 0] ? rgb(TINT[s.tint || 0]) : A.map(function(v) { return Math.round(v * 2 / 5); });
	if (!wp.soft) {
		var n = Math.max(4, Math.round(240 / (4 + (s.blur != null ? s.blur : 50) / 5))), small = document.createElement('canvas');
		small.width = small.height = n;
		small.getContext('2d').drawImage(wp.img, 0, 0, n, n);
		wp.soft = small;
	}
	ctx.drawImage(wp.img, 0, 0, 240, 240);
	ctx.fillStyle = 'rgba(0,0,0,' + dim + ')'; ctx.fillRect(0, 0, 240, 240);
	ctx.save();
	ctx.beginPath(); ctx.arc(120, 120, 98, 0, 7); ctx.clip();
	ctx.imageSmoothingEnabled = true;
	ctx.drawImage(wp.soft, -6, -6, 252, 252);
	ctx.fillStyle = 'rgba(0,0,0,' + dim + ')'; ctx.fillRect(0, 0, 240, 240);
	var pane = (1 - clear) * .65 * .94;
	ctx.fillStyle = css(tint, Math.round(pane * 255)); ctx.fillRect(0, 0, 240, 240);
	ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(0, 0, 240, 240);
	ctx.restore();
	var rim = ctx.createLinearGradient(0, 22, 0, 218);
	rim.addColorStop(0, 'rgba(255,255,255,.5)'); rim.addColorStop(.5, 'rgba(255,255,255,.12)'); rim.addColorStop(1, 'rgba(255,255,255,.08)');
	ctx.beginPath(); ctx.arc(120, 120, 97.3, 0, 7); ctx.lineWidth = 1.4; ctx.strokeStyle = rim; ctx.stroke();
}

function drawScreen(cv) {
	var dpr = Math.min(window.devicePixelRatio || 1, 3), size = Math.round(cv.getBoundingClientRect().width * dpr);
	if (!size) return;
	if (cv.width !== size) { cv.width = size; cv.height = size; }
	var ctx = cv.getContext('2d'), th = THEMES[S.theme] || THEMES[1], A = rgb(th.a), B = rgb(th.b), i;
	ctx.setTransform(size / 240, 0, 0, size / 240, 0, 0);
	ctx.clearRect(0, 0, 240, 240);
	ctx.shadowColor = 'transparent';
	var wp = S.wp && S.wp.img && S.wp.img.complete && S.wp.img.naturalWidth ? S.wp : null;
	if (wp) wallpaper(ctx, wp, A);
	else {
		/* bg_build(): a radial gradient around (120, 112) falling off with d^2 over 150 px */
		var centre = mix(rgb('#152238'), A, 26), edge = rgb('#04070D'), g = ctx.createRadialGradient(120, 112, 0, 120, 112, 150);
		for (i = 0; i <= 10; i++) g.addColorStop(i / 10, css(mix(centre, edge, Math.round(i * i / 100 * 255))));
		ctx.fillStyle = g; ctx.fillRect(0, 0, 240, 240);
	}
	if (!S.st || S.st.now == null) return;

	var b = battery(), pct = b ? b.pct : null, charging = b && b.charging;
	if (pct != null) {
		var sweep = 260 * pct / 100, col = pct <= 15 ? C_BAD : pct <= 30 ? C_WARN : C_OK;
		arc(ctx, 120, 120, 104, 5, -130, 130, C_TXT, 24, true);
		if (sweep > 2) {
			arc(ctx, 120, 120, 104, 5, -130, -130 + sweep, col, 255, true);
			if (charging) {
				var a = -130 + ((Date.now() % 2400) / 2400 * (sweep + 40)) % (sweep + 40) - 20, a0 = Math.max(a, -130), a1 = Math.min(a + 22, -130 + sweep);
				if (a1 > a0 + 1) arc(ctx, 120, 120, 104, 5, a0, a1, C_TXT, 150, true);
			}
		}
	}
	/* over a wallpaper light text gets a one-pixel shadow (gx_shadow) */
	if (wp) { ctx.shadowColor = 'rgba(0,0,0,.53)'; ctx.shadowOffsetY = 1; ctx.shadowBlur = 0; }
	var t = new Date(Date.now() + S.skew + (S.st.tz_offset_s || 0) * 1000);
	ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
	ctx.fillStyle = css(C_TXT); ctx.font = font(52, true);
	ctx.fillText(pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()), 120, 97);
	ctx.fillStyle = css(C_DIM); ctx.font = font(14);
	ctx.fillText((t.getUTCMonth() + 1) + '月' + t.getUTCDate() + '日 ' + WDAY[t.getUTCDay()], 120, 120);

	var conn = feed('cell_connected') == '1', rat = feed('rat') || '', ct = cellText();
	ctx.font = font(14);
	var tw = ctx.measureText(ct).width, pw = conn && rat ? ctx.measureText(rat).width + 14 : 0, x = 120 - (pw + (pw ? 6 : 0) + 26 + tw) / 2;
	if (pw) {
		rrect(ctx, x, 131, pw, 19, 9.5); ctx.fillStyle = css(rat === '5G' ? B : A); ctx.fill();
		ctx.fillStyle = css(INK); ctx.textBaseline = 'middle'; ctx.fillText(rat, x + pw / 2, 141);
		x += pw + 6;
	}
	var lv = signalBars(), bw = 20 / 7;
	for (i = 0; i < 4; i++) {
		var bh = 17 * (.35 + .65 * i / 3);
		rrect(ctx, x + i * bw * 2, 149 - bh, bw, bh, bw * .4);
		ctx.fillStyle = i < lv ? css(conn ? A : C_FAINT) : css(C_TXT, 55); ctx.fill();
	}
	ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = css(conn ? C_TXT : C_DIM);
	ctx.fillText(ct, x + 26, 146);

	var rt = S.st.rates || {}, r1 = fmtRate(rt.rx_bps), r2 = fmtRate(rt.tx_bps);
	ctx.font = font(16, true); var n1 = ctx.measureText(r1[0]).width, n2 = ctx.measureText(r2[0]).width;
	ctx.font = font(13); var u1 = ctx.measureText(r1[1]).width, u2 = ctx.measureText(r2[1]).width;
	x = 120 - (12 + n1 + 2 + u1 + 16 + 12 + n2 + 2 + u2) / 2;
	tri(ctx, [ x, 166, x + 10, 166, x + 5, 173 ], A); x += 12;
	ctx.fillStyle = css(C_TXT); ctx.font = font(16, true); ctx.fillText(r1[0], x, 175); x += n1 + 2;
	ctx.fillStyle = css(C_DIM); ctx.font = font(13); ctx.fillText(r1[1], x, 175); x += u1 + 16;
	tri(ctx, [ x, 172, x + 10, 172, x + 5, 165 ], B); x += 12;
	ctx.fillStyle = css(C_TXT); ctx.font = font(16, true); ctx.fillText(r2[0], x, 175); x += n2 + 2;
	ctx.fillStyle = css(C_DIM); ctx.font = font(13); ctx.fillText(r2[1], x, 175);

	/* the footer: icons centred on the digits (189 .. 199 on baseline 199), as page_home draws them */
	var wifiOn = feed('wifi_active') == '1', wc = wifiOn ? A : C_FAINT;
	for (i = 1; i <= 3; i++) arc(ctx, 80, 198.9, 3.36 * i, 1.36, -45, 45, wc, 255, false);
	ctx.beginPath(); ctx.arc(80, 198.9, .96, 0, 7); ctx.fillStyle = css(wc); ctx.fill();
	ctx.font = font(14); ctx.fillStyle = css(wifiOn ? C_TXT : C_FAINT); ctx.fillText(String(feedNum('nclients') || 0), 91, 199);
	var bc = pct == null ? C_FAINT : pct <= 15 ? C_BAD : pct <= 30 ? C_WARN : C_OK;
	rrect(ctx, 109.75, 189.75, 11.5, 8.5, 2.25); ctx.lineWidth = 1.5; ctx.strokeStyle = css(C_TXT, 190); ctx.stroke();
	rrect(ctx, 122, 192, 2.5, 4, 1); ctx.fillStyle = css(C_TXT, 190); ctx.fill();
	if (pct > 0) { rrect(ctx, 111, 191, 9 * Math.min(pct, 100) / 100, 6, 1.5); ctx.fillStyle = css(bc); ctx.fill(); }
	ctx.fillStyle = css(C_TXT); ctx.fillText(pct != null ? pct + '%' : '--', 128, 199);
	if (charging) {
		tri(ctx, [ 168.9, 188, 164.7, 194.6, 168.6, 194.6 ], C_OK);
		tri(ctx, [ 167.1, 200, 171.3, 193.4, 167.4, 193.4 ], C_OK);
	} else if (feedNum('sms_unread') > 0) {
		rrect(ctx, 168.9, 190.7, 10.2, 6.6, 1.2); ctx.lineWidth = 1.8; ctx.strokeStyle = css(B); ctx.stroke();
		ctx.beginPath(); ctx.moveTo(168.6, 190.7); ctx.lineTo(174, 194.9); ctx.lineTo(179.4, 190.7); ctx.stroke();
	}
}

/* ------------------------------------------------------------------ the front of the device */
/* MU5358 outline, 10 units per mm: body 69.8 x 149 mm, the round window in the upper third, the function key above the power key on the
 * right edge, the NFC mark in the lower half.  The screen canvas sits in the same box as the drawing (the box keeps the drawing's
 * aspect ratio, so the canvas, placed in per cent of the box, stays on the window). */
var FIG = { w: 940, h: 1490, cx: 470, cy: 330, disc: 250, ring: 282, left: 120 };
function figure(go, nfc) {
	var ns = 'http://www.w3.org/2000/svg';
	function s(tag, attrs, kids) {
		var el = document.createElementNS(ns, tag);
		for (var k in attrs) {
			if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
			else el.setAttribute(k, attrs[k]);
		}
		(kids || []).forEach(function(c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
		return el;
	}
	function layer(kids) { return s('svg', { preserveAspectRatio: 'none', 'aria-hidden': 'true' }, kids); }
	function hot(cls, label, fn, kids) {
		var g = s('g', { 'class': 'u-hot ' + cls, tabindex: '0', role: 'button', 'aria-label': label, onclick: fn,
			onkeydown: function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } } }, kids);
		g.appendChild(s('title', {}, [ label ]));
		return g;
	}
	var back = layer([
		s('rect', { 'class': 'u-body', x: 121, y: 2, width: 698, height: 1486, rx: 112 }),
		s('circle', { 'class': 'u-line', cx: FIG.cx, cy: FIG.cy, r: FIG.ring }),
		s('circle', { 'class': 'u-knurl', cx: FIG.cx, cy: FIG.cy, r: (FIG.ring + FIG.disc) / 2, 'stroke-width': FIG.ring - FIG.disc - 6, 'stroke-dasharray': '2.2 5.2' }),
		s('circle', { 'class': 'u-disc', cx: FIG.cx, cy: FIG.cy, r: FIG.disc }),
		s('rect', { 'class': 'u-key', x: 817, y: 474, width: 17, height: 104, rx: 8 }),
		s('line', { 'class': 'u-lead', x1: 842, y1: 526, x2: 868, y2: 526 }),
		s('text', { 'class': 'u-lbl', x: 876, y: 538 }, [ _('Power') ])
	]);
	var nfcIc = s('g', { 'class': 'u-nfc-ic', transform: 'translate(434 990) scale(3)', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6,
		'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
	nfcIc.innerHTML = (window.U30_ICONS || {}).nfc || '';
	var front = layer([
		hot('u-hot-key', _('Function key'), function() { go('key'); }, [
			s('rect', { x: 800, y: 300, width: 140, height: 136, fill: 'transparent' }),
			s('rect', { 'class': 'u-hl', x: 817, y: 316, width: 17, height: 104, rx: 8 }),
			s('line', { 'class': 'u-lead', x1: 842, y1: 368, x2: 868, y2: 368 }),
			s('text', { 'class': 'u-lbl', x: 876, y: 380 }, [ _('Function') ])
		]),
		hot('u-hot-nfc', 'NFC', nfc, [
			s('rect', { 'class': 'u-hl', x: 405, y: 970, width: 130, height: 172, rx: 30 }),
			nfcIc,
			s('text', { 'class': 'u-lbl', x: 470, y: 1122, 'text-anchor': 'middle', style: 'font-size: 28px' }, [ 'NFC' ])
		]),
		hot('u-hot-screen', _('Screen'), function() { go('screen'); }, [ s('circle', { 'class': 'u-hl', cx: FIG.cx, cy: FIG.cy, r: FIG.disc - 2 }) ])
	]);
	front.removeAttribute('aria-hidden');
	var cv = E('canvas', { 'aria-hidden': 'true' }), R = FIG.disc * 240 / 216;
	var box = E('div', { 'class': 'u-dev-box' }, [ back, cv, front ]), dev = E('div', { 'class': 'u-dev' }, [ box ]);
	/* The drawing is cut to the body's left edge and the end of the key labels on the right (their width depends on the language), so the
	 * figure's box is exactly what is drawn and lines up with the title and the tiles.  The box's size goes through custom properties on
	 * the outer div: a styled div right above an svg gets a background from the Bootstrap cascade. */
	function fit(right) {
		var w = right - FIG.left;
		[ back, front ].forEach(function(l) { l.setAttribute('viewBox', FIG.left + ' 0 ' + w + ' ' + FIG.h); });
		dev.style.setProperty('--fig-w', String(w));
		cv.style.left = ((FIG.cx - R - FIG.left) / w * 100) + '%';
		cv.style.top = ((FIG.cy - R) / FIG.h * 100) + '%';
		cv.style.width = (2 * R / w * 100) + '%';
		cv.style.height = (2 * R / FIG.h * 100) + '%';
	}
	function centre() {
		var right = 822;
		Array.prototype.forEach.call(box.querySelectorAll('.u-lbl'), function(t) {
			try { var b = t.getBBox(); if (b.width && b.x > 600 && b.x + b.width > right) right = b.x + b.width; } catch (e) {}
		});
		fit(Math.ceil(right) + 4);
	}
	fit(1030);
	return { el: dev, canvas: cv, centre: centre };
}

/* ------------------------------------------------------------------ switches */
function sw(onchange) {
	var inp = E('input', { 'type': 'checkbox', 'role': 'switch' });
	inp.addEventListener('change', function() {
		var want = inp.checked;
		inp.disabled = true;
		Promise.resolve(onchange(want)).then(function(r) {
			if (r && (r.error || r.accepted === false)) throw new Error(r.error || r.message || _('Failed'));
		}).catch(function(e) { inp.checked = !want; fail(e); }).then(function() { inp.disabled = false; refreshSoon(); });
	});
	var el = E('label', { 'class': 'u-sw', 'click': function(ev) { ev.stopPropagation(); } }, [ inp, E('i') ]);
	el.set = function(v, dis) { if (!inp.disabled) inp.checked = !!v; if (dis != null) inp.disabled = !!dis; };
	return el;
}
var refreshSoon = function() {};

/* the wallpaper and its look; the picture is fetched again when it changes */
function wpRefresh() {
	return L.resolveDefault(callWp(), null).then(function(w) {
		if (!w || !w.picture) { S.wp = null; return; }
		var key = w.mtime + ':' + (w.settings ? [ w.settings.dim, w.settings.glass, w.settings.blur, w.settings.tint ].join(',') : '');
		if (S.wp && S.wp.key === key) return;
		if (S.wp && S.wp.mtime === w.mtime) { S.wp = { key: key, mtime: w.mtime, settings: w.settings, img: S.wp.img }; return; }
		return L.resolveDefault(callWpImage(), null).then(function(im) {
			if (!im || !im.data) { S.wp = null; return; }
			var img = new Image();
			return new Promise(function(resolve) {
				img.onload = img.onerror = resolve;
				img.src = 'data:' + (im.type || 'image/jpeg') + ';base64,' + im.data;
			}).then(function() { S.wp = { key: key, mtime: w.mtime, settings: w.settings, img: img }; });
		});
	});
}

return view.extend({
	load: function() {
		var p = [];
		if (!window.U30_ICONS) {
			/* another theme is active: the icons of this one */
			p.push(new Promise(function(resolve) {
				var s = document.createElement('script');
				s.src = L.resource('../u30pro/icons.js');
				s.onload = s.onerror = resolve;
				document.head.appendChild(s);
			}));
		}
		p.push(wpRefresh(), L.resolveDefault(callState(), null), L.resolveDefault(callGet(), null));
		return Promise.all(p);
	},

	render: function(data) {
		var self = this;
		S.st = data[data.length - 2]; S.nc = data[data.length - 1];
		if (S.st) S.skew = S.st.now * 1000 - Date.now();
		document.head.appendChild(E('link', { 'rel': 'stylesheet', 'href': L.resource('../u30pro/overview.css') + '?v=1.0-r2' }));
		var go = function(k) { location.href = L.url(LINK[k]); };
		var fig = figure(go, function() { self.nfcDialog(); });
		var E2 = {};
		/* every small tile has the same three rows: the header (icon, name, switch), one value, one line under it */
		function tile(cls, ic, title, extra, body, to) {
			var t = E('div', { 'class': 'u-tile ' + (cls || '') + (to ? ' tap' : ''), 'tabindex': to ? '0' : null, 'role': to ? 'link' : null }, [
				E('div', { 'class': 'u-tile-h' }, [ icon(ic), E('span', {}, [ title ]), E('span', { 'class': 'u-sp' }), extra || '' ]) ].concat(body));
			if (to) {
				t.addEventListener('click', function() { typeof to === 'function' ? to() : go(to); });
				t.addEventListener('keydown', function(e) { if (e.key === 'Enter' && e.target === t) (typeof to === 'function' ? to() : go(to)); });
			}
			return t;
		}
		function val() { return E('div', { 'class': 'u-val u-ellip' }); }
		function line(ic, kids) { return E('div', { 'class': 'u-meta' }, [ ic ? icon(ic) : '' ].concat(kids)); }
		E2.data = sw(function(on) { return callCell(on ? 'reconnect' : 'disconnect'); });
		E2.wifi = sw(function(on) { if (on === (feed('wifi_active') == '1')) return; return callWifi(); });
		E2.screen = sw(function(on) { return callScreen(on ? 'on' : 'off'); });
		E2.nfc = sw(function(on) { return callNfc(on ? '1' : '0'); });
		E2.rat = E('span', { 'class': 'u-pill' });
		E2.bars = E('span', { 'class': 'u-bars' }, [ 0, 1, 2, 3 ].map(function(i) { return E('i', { 'style': 'height:%d%%'.format(35 + 65 * i / 3) }); }));
		E2.op = val();
		E2.rx = E('b'); E2.rxu = E('small'); E2.tx = E('b'); E2.txu = E('small');
		E2.ssid = val(); E2.clients = E('span');
		E2.bat = val(); E2.batState = E('span', { 'class': 'u-ellip' }); E2.batBar = E('i');
		E2.scr = val(); E2.sleep = E('span');
		E2.nfcText = val(); E2.nfcAuth = E('span');
		E2.sms = val(); E2.smsTotal = E('span');
		E2.temp = val(); E2.up = E('span');

		var view = E('div', { 'class': 'u-ov' }, [
			E('h2', {}, [ _('Overview') ]),
			E('div', { 'class': 'u-ov-grid' }, [
				E('div', { 'class': 'u-ov-hero' }, [ fig.el ]),
				E('div', { 'class': 'u-tiles' }, [
					tile('wide', 'signal', _('Network'), E2.data, [ E('div', { 'class': 'u-net' }, [
						E('div', { 'class': 'u-net-l' }, [ E2.op, E('div', { 'class': 'u-meta' }, [ E2.rat, E2.bars ]) ]),
						E('div', { 'class': 'u-rates' }, [
							E('span', { 'class': 'u-rate down' }, [ icon('arrow-down'), E2.rx, E2.rxu ]),
							E('span', { 'class': 'u-rate up' }, [ icon('arrow-up'), E2.tx, E2.txu ]) ]) ]) ], 'network'),
					tile('', 'wifi', 'Wi-Fi', E2.wifi, [ E2.ssid, line('users', [ E2.clients ]) ], 'wifi'),
					tile('', 'battery', _('Battery'), null, [ E2.bat, line(null, [ E('div', { 'class': 'u-meter' }, [ E2.batBar ]), E2.batState ]) ], 'battery'),
					tile('', 'monitor', _('Screen'), E2.screen, [ E2.scr, line('moon', [ E2.sleep ]) ], 'screen'),
					tile('', 'nfc', 'NFC', E2.nfc, [ E2.nfcText, line('lock', [ E2.nfcAuth ]) ], function() { self.nfcDialog(); }),
					tile('', 'message-square', _('Messages'), null, [ E2.sms, line('inbox', [ E2.smsTotal ]) ], 'sms'),
					tile('', 'cpu', _('System'), null, [ E2.temp, line('clock', [ E2.up ]) ], 'system')
				])
			])
		]);

		function update() {
			var conn = feed('cell_connected') == '1', rat = feed('rat');
			E2.rat.style.display = conn && rat ? '' : 'none';
			txt(E2.rat, rat || '');
			E2.rat.className = 'u-pill' + (rat === '5G' ? ' alt' : '');
			var lv = signalBars();
			Array.prototype.forEach.call(E2.bars.children, function(b, i) { b.className = i < lv ? 'on' : ''; });
			txt(E2.op, cellText());
			var c = S.nc && S.nc.cellular;
			E2.data.set(c ? c.desired_up !== false : conn);
			var rt = (S.st && S.st.rates) || {}, a = fmtRate(rt.rx_bps), b = fmtRate(rt.tx_bps);
			txt(E2.rx, a[0]); txt(E2.rxu, a[1]); txt(E2.tx, b[0]); txt(E2.txu, b[1]);
			var wifiOn = feed('wifi_active') == '1';
			E2.wifi.set(wifiOn);
			txt(E2.ssid, wifiOn ? (feed('ssid') || 'Wi-Fi') : _('Off'));
			txt(E2.clients, _('%d clients').format(feedNum('nclients') || 0));
			var bt = battery();
			txt(E2.bat, bt && bt.pct != null ? bt.pct + '%' : '–');
			txt(E2.batState, batteryState(bt));
			E2.batState.className = 'u-ellip' + (bt && (bt.charging || bt.full) ? ' u-ok' : '');
			E2.batBar.style.width = ((bt && bt.pct) || 0) + '%';
			E2.batBar.className = bt && bt.pct <= 15 ? 'bad' : bt && bt.pct <= 30 ? 'warn' : '';
			var d = S.nc && S.nc.display;
			E2.screen.set(d ? d.screen_on : false, d ? !d.screen_control_available : true);
			txt(E2.scr, d ? (d.screen_on ? _('On') : _('Off')) : '–');
			txt(E2.sleep, fmtSleep(d && d.settings ? d.settings.sleep_s : null));
			var n = S.st && S.st.nfc;
			E2.nfc.set(n && n.enabled);
			txt(E2.nfcText, n && n.enabled ? ((n.tag && n.tag.ssid) || _('Empty')) : _('Off'));
			txt(E2.nfcAuth, n && n.enabled && n.tag && n.tag.ssid ? (n.tag.open ? _('Open') : 'WPA2') : '–');
			var unread = feedNum('sms_unread') || 0, total = feedNum('sms_total');
			txt(E2.sms, unread ? _('%d unread').format(unread) : _('No new messages'));
			txt(E2.smsTotal, total != null ? _('%d in total').format(total) : '–');
			var tc = S.nc && num(S.nc.soc_temperature_c);
			txt(E2.temp, tc != null ? tc.toFixed(0) + ' °C' : '–');
			txt(E2.up, fmtDur(S.st && S.st.uptime_s));
			drawScreen(fig.canvas);
		}
		this.update = update;

		/* the accent and the screen picture follow the on-device theme */
		function theme() {
			var th = S.st && S.st.panel && num(S.st.panel.theme);
			if (th == null || !THEMES[th]) return;
			S.theme = th;
			document.documentElement.setAttribute('data-accent', th);
			try { localStorage.setItem('u30.accent', String(th)); } catch (e) {}
		}
		var tick = 0;
		function poll1() {
			var withGet = tick % 2 === 0, withWp = tick++ % 5 === 4;
			return Promise.all([ L.resolveDefault(callState(), null), withGet ? L.resolveDefault(callGet(), null) : null, withWp ? wpRefresh() : null ]).then(function(r) {
				if (r[0]) { S.st = r[0]; S.skew = r[0].now * 1000 - Date.now(); }
				if (r[1]) S.nc = r[1];
				theme(); update();
			});
		}
		refreshSoon = function() { tick = 0; setTimeout(poll1, 800); };
		poll.add(poll1, 2);
		theme();
		update();

		/* the clock: one redraw a second, more often while the charging shimmer runs */
		var timer = null;
		function loop() {
			if (!document.body.contains(fig.canvas)) return;
			drawScreen(fig.canvas);
			var b = battery();
			timer = b && b.charging && !document.hidden ? requestAnimationFrame(loop) : setTimeout(loop, 1000 - (Date.now() + S.skew) % 1000 + 20);
		}
		setTimeout(loop, 50);
		requestAnimationFrame(fig.centre);
		window.addEventListener('resize', function() { drawScreen(fig.canvas); fig.centre(); });
		return view;
	},

	nfcDialog: function() {
		var n = (S.st && S.st.nfc) || {}, t = n.tag || {};
		var s = sw(function(on) {
			return callNfc(on ? '1' : '0').then(function(r) { if (r && r.tag) { S.st.nfc = { enabled: r.enabled, tag: r.tag }; paint(); } return r; });
		});
		var ssid = E('span'), auth = E('span');
		function paint() {
			var m = (S.st && S.st.nfc) || {}, g = m.tag || {};
			s.set(m.enabled);
			txt(ssid, g.ssid || (g.available ? _('Empty') : '–'));
			txt(auth, g.ssid ? (g.open ? _('Open') : 'WPA2') : '–');
		}
		paint();
		ui.showModal('NFC', [
			E('div', { 'class': 'u-ov u-nfc-dlg' }, [
				E('div', { 'class': 'u-kv' }, [ E('span', {}, [ _('Tap to connect') ]), s ]),
				E('div', { 'class': 'u-kv' }, [ E('span', {}, [ _('Network') ]), ssid ]),
				E('div', { 'class': 'u-kv' }, [ E('span', {}, [ _('Security') ]), auth ])
			]),
			E('div', { 'class': 'right' }, [ E('button', { 'class': 'btn', 'click': ui.hideModal }, [ _('Close') ]) ])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
