'use strict';
'require view';
'require rpc';

/* Services > zwrt-datad > Terminal: zwrt-datad's web shell (a login shell on the device) in xterm.js.  The back end gives a temporary datad
 * token (12 h); the browser connects to ws://<this host>:<LAN port>/webshell with it (protocols datad-webshell-v1 and datad-auth.<token>,
 * binary frames both ways, text frames {"type":"resize"}).  Back end: /usr/libexec/rpcd/luci.zwrt-datad, method terminal. */
var callTerminal = rpc.declare({ object: 'luci.zwrt-datad', method: 'terminal' });

function loadScript(src) {
	return new Promise(function(resolve, reject) {
		var s = document.createElement('script');
		s.src = src;
		s.onload = resolve;
		s.onerror = function() { reject(new Error(src)); };
		document.head.appendChild(s);
	});
}

function loadCss(href) {
	document.head.appendChild(E('link', { 'rel': 'stylesheet', 'href': href }));
}

return view.extend({
	load: function() {
		loadCss(L.resource('xterm/xterm.css'));
		return Promise.all([
			callTerminal().catch(function(e) { return { error: e && e.message ? e.message : String(e) }; }),
			loadScript(L.resource('xterm/xterm.js')).then(function() { return loadScript(L.resource('xterm/addon-fit.js')); })
		]);
	},

	render: function(data) {
		var t = data[0] || {}, state = E('span'), screen = E('div', { 'style': 'height:65vh;background:#000;padding:4px;margin-top:.5em' });
		var term = null, fit = null, ws = null;

		function say(msg, error) {
			state.replaceChildren(error ? E('span', { 'style': 'color:#c00' }, msg) : msg);
		}

		var bReconnect = E('button', { 'class': 'cbi-button cbi-button-action', 'type': 'button', 'style': 'margin-left:1em', 'click': function(ev) {
			ev.preventDefault();
			/* a fresh token: the old one may have expired */
			callTerminal().then(function(r) { t = r || {}; connect(); });
		} }, _('Reconnect'));

		function connect() {
			if (t.error || !t.token)
				return say(_(t.error || 'zwrt-datad gave no token'), true);
			if (!t.enabled)
				return say(_('The web shell of zwrt-datad is off (uci zwrt-datad.main.webshell)'), true);
			if (!t.lan)
				return say(_('zwrt-datad does not listen on the LAN address (uci zwrt-datad.main.lan)'), true);
			var host = location.hostname.indexOf(':') >= 0 ? '[' + location.hostname + ']' : location.hostname;
			if (ws)
				ws.close();
			say(_('Connecting…'));
			ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + host + ':' + t.port + '/webshell', [ 'datad-webshell-v1', 'datad-auth.' + t.token ]);
			ws.binaryType = 'arraybuffer';
			ws.onopen = function() {
				say(_('Connected'));
				fit.fit();
				ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
				term.focus();
			};
			ws.onmessage = function(ev) {
				term.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data));
			};
			ws.onclose = function(ev) {
				say(ev.code === 1000 ? _('The shell ended') : _('Disconnected') + (ev.reason ? ': ' + ev.reason : ''), ev.code !== 1000);
			};
		}

		window.setTimeout(function() {
			if (typeof Terminal !== 'function' || typeof FitAddon !== 'object')
				return say(_('The terminal could not be loaded'), true);
			term = new Terminal({ cursorBlink: true, fontSize: 14, scrollback: 5000,
				fontFamily: 'Menlo, Consolas, "DejaVu Sans Mono", "Courier New", monospace' });
			fit = new FitAddon.FitAddon();
			term.loadAddon(fit);
			term.open(screen);
			fit.fit();
			var enc = new TextEncoder();
			term.onData(function(d) {
				if (ws && ws.readyState === WebSocket.OPEN)
					ws.send(enc.encode(d));
			});
			term.onResize(function(size) {
				if (ws && ws.readyState === WebSocket.OPEN)
					ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
			});
			window.addEventListener('resize', function() { fit.fit(); });
			connect();
		}, 0);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Terminal')),
			E('div', { 'class': 'cbi-map-descr' }, _('A shell on the device through zwrt-datad (as root). It ends after 15 minutes without input; at most four at a time.')),
			E('div', {}, [ state, bReconnect ]),
			screen
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
