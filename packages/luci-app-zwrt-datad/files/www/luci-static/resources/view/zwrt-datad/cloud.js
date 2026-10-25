'use strict';
'require view';
'require poll';
'require rpc';

/* Services > Cloud management: zwrt-datad's connection to NMS (MQTT), its quick connect with the credential NMS shows, and its settings.
 * Back end: /usr/libexec/rpcd/luci.zwrt-datad (datad's local API on 127.0.0.1:9460) */
var callGet = rpc.declare({ object: 'luci.zwrt-datad', method: 'get' });
var callQuick = rpc.declare({ object: 'luci.zwrt-datad', method: 'quick_connect', params: [ 'credential' ] });
var callSet = rpc.declare({ object: 'luci.zwrt-datad', method: 'set', params: [ 'config' ] });
var callDisable = rpc.declare({ object: 'luci.zwrt-datad', method: 'disable' });

function safe(p) {
	return p.catch(function(e) { return { error: e && e.message ? e.message : String(e) }; });
}

var STATES = {
	disabled: _('Off'),
	starting: _('Starting'),
	connecting: _('Connecting'),
	enrolling: _('Connected, waiting for the binding in NMS'),
	connected: _('Connected'),
	retrying: _('Retrying'),
	reconfiguring: _('Applying the settings'),
	error: _('Error')
};

function table(rows) {
	return E('table', { 'class': 'table' }, rows.map(function(r) {
		return E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td left', 'width': '33%' }, r[0]), E('td', { 'class': 'td left' }, r[1]) ]);
	}));
}

function text(v) {
	return v === null || v === undefined || v === '' ? '—' : String(v);
}

function when(ts) {
	return ts ? new Date(ts * 1000).toLocaleString() : '—';
}

return view.extend({
	load: function() {
		return safe(callGet());
	},

	render: function(st) {
		var notice = E('div'), statusBox = E('div'), quickBox = E('div', { 'class': 'cbi-section' }), busy = false, buttons = [];
		var cfg = Object.assign({}, st.config || {});

		function note(msg, error) {
			notice.replaceChildren(E('div', { 'class': error ? 'alert-message warning' : 'alert-message success' }, msg));
		}

		function btn(label, cls, fn) {
			var b = E('button', { 'class': 'cbi-button ' + cls, 'type': 'button', 'click': function(ev) { ev.preventDefault(); fn(); } }, label);

			buttons.push(b);
			return b;
		}

		function run(promise, done) {
			if (busy)
				return;
			busy = true;
			buttons.forEach(function(b) { b.disabled = true; });
			return safe(promise).then(function(r) {
				busy = false;
				buttons.forEach(function(b) { b.disabled = false; });
				if (!r || r.error)
					note(_((r && r.error) || 'The request failed'), true);
				else
					note(done, false);
				return refresh(true);
			});
		}

		/* the settings form: one input per field of datad's configuration that the owner sets */
		function field(type, value, extra) {
			return E('input', Object.assign({ 'class': 'cbi-input-' + (type === 'checkbox' ? 'checkbox' : 'text'), 'type': type },
				type === 'checkbox' ? { 'checked': value ? '' : null } : { 'value': value == null ? '' : value }, extra || {}));
		}
		var fEnabled = field('checkbox'), fBroker = field('text'), fPlatform = field('text'), fUser = field('text');
		var fPassword = field('password', '', { 'autocomplete': 'new-password' });
		var fInterval = field('number', '', { 'min': 5, 'max': 3600 });
		var fRemote = field('checkbox'), fPanel = field('checkbox'), fShell = field('checkbox');
		var services = E('div');

		function fill() {
			fEnabled.checked = !!cfg.enabled;
			fBroker.value = cfg.broker || '';
			fPlatform.value = cfg.platform_url || '';
			fUser.value = cfg.username || '';
			fPassword.value = '';
			fPassword.placeholder = st.password_configured ? _('Unchanged (a password is stored)') : _('None stored');
			fInterval.value = cfg.report_interval_seconds || 30;
			fRemote.checked = !!cfg.remote_enabled;
			fPanel.checked = !!cfg.remote_panel_control_enabled;
			fShell.checked = !!cfg.remote_webshell_enabled;
			services.replaceChildren.apply(services, (cfg.services || []).map(function(s) {
				return E('div', {}, s.name + ' — ' + _('port') + ' ' + s.port + ' (' + s.kind + ')');
			}));
		}

		function save() {
			var next = Object.assign({}, cfg, {
				enabled: fEnabled.checked,
				broker: fBroker.value.trim(),
				platform_url: fPlatform.value.trim(),
				username: fUser.value.trim(),
				password: fPassword.value,
				report_interval_seconds: parseInt(fInterval.value, 10) || 30,
				remote_enabled: fRemote.checked,
				remote_panel_control_enabled: fPanel.checked,
				remote_webshell_enabled: fShell.checked
			});
			run(callSet(JSON.stringify(next)), _('Saved; the connection is set up again'));
		}

		var credential = E('textarea', { 'class': 'cbi-input-textarea', 'rows': 3, 'style': 'width:100%', 'spellcheck': 'false',
			'placeholder': _('Paste the credential NMS shows for the new device') });
		var bQuick = btn(_('Connect'), 'cbi-button-apply', function() {
			if (!credential.value.trim())
				return note(_('Paste the credential first'), true);
			run(callQuick(credential.value), _('Connecting to NMS; confirm the device in NMS'));
			credential.value = '';
		});
		quickBox.replaceChildren(
			E('h3', {}, _('Quick connect')),
			E('div', { 'class': 'cbi-section-descr' }, _('Create the device in NMS, then paste the credential it shows once (the MQTT user name and password). The device identity is made from the board serial number.')),
			credential,
			E('div', { 'class': 'cbi-page-actions' }, bQuick));
		var bSave = btn(_('Save'), 'cbi-button-apply', save);
		var bOff = btn(_('Disconnect'), 'cbi-button-negative', function() {
			if (window.confirm(_('Switch the cloud connection off? Remote access through NMS stops.')))
				run(callDisable(), _('The cloud connection is off'));
		});

		function draw() {
			var s = st.status || {}, d = st.datad || {};

			statusBox.replaceChildren(table([
				[ _('zwrt-datad'), d.running ? _('Running') + (d.version ? ' (' + d.version + ')' : '') : E('span', { 'style': 'color:#c00' }, _('Not running')) ],
				[ _('Connection'), [ STATES[s.state] || text(s.state), s.error ? E('div', { 'style': 'color:#c00' }, _(s.error)) : '' ] ],
				[ _('Last report'), when(s.last_report_at) ],
				[ _('NMS address'), text(cfg.platform_url) ],
				[ _('MQTT broker'), text(cfg.broker) ],
				[ _('MQTT user'), text(cfg.username) ],
				[ _('Device identity'), text(cfg.identity) ],
				[ _('Model'), text(cfg.model) ]
			]));
			/* quick connect is for a device without an account; to change the account, use the settings below */
			quickBox.style.display = cfg.enabled && cfg.username ? 'none' : '';
		}

		function refresh(reload) {
			return safe(callGet()).then(function(r) {
				st = r;
				cfg = Object.assign({}, r.config || {});
				draw();
				if (reload)
					fill();
			});
		}

		fill();
		draw();
		poll.add(function() { return refresh(false); }, 5);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Cloud management')),
			E('div', { 'class': 'cbi-map-descr' }, _('zwrt-datad connects the device to the NMS cloud platform over MQTT: status reports, remote access to this web interface and a remote terminal. Connected only means the MQTT link is up; the binding is confirmed in NMS.')),
			notice,
			E('div', { 'class': 'cbi-section' }, [ E('h3', {}, _('Status')), statusBox ]),
			quickBox,
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Settings')),
				table([
					[ _('Connect to NMS'), fEnabled ],
					[ _('MQTT broker'), fBroker ],
					[ _('NMS address'), fPlatform ],
					[ _('MQTT user'), fUser ],
					[ _('MQTT password'), fPassword ],
					[ _('Report interval (seconds)'), fInterval ],
					[ _('Remote access'), fRemote ],
					[ _('Remote panel control'), fPanel ],
					[ _('Remote terminal'), fShell ],
					[ _('Remote web back ends'), services ]
				]),
				E('div', { 'class': 'cbi-page-actions' }, [ bSave, ' ', bOff ])
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
