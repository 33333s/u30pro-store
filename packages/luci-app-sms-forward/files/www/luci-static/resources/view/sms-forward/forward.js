'use strict';
'require view';
'require form';
'require rpc';
'require poll';
'require ui';
'require u30pro.kit as kit';

/* Cellular > SMS forwarding: the state of the forwarder (ubus sms_forward, /usr/sbin/sms-forward) as tiles, its settings and its channels as a
 * form of /etc/config/sms_forward (section main, sections channel with an option type).  The forwarder reads the settings again through
 * its procd reload trigger after Save & Apply. */
var callStatus = rpc.declare({ object: 'sms_forward', method: 'status' });
var callTest = rpc.declare({ object: 'sms_forward', method: 'test', params: [ 'channel' ] });
var callPoll = rpc.declare({ object: 'sms_forward', method: 'poll' });

var TYPES = [
	[ 'telegram', _('Telegram bot') ],
	[ 'bark', _('Bark (iOS)') ],
	[ 'pushplus', _('PushPlus') ],
	[ 'serverchan', _('ServerChan') ],
	[ 'dingtalk', _('DingTalk robot') ],
	[ 'wecom', _('WeCom robot') ],
	[ 'feishu', _('Feishu / Lark robot') ],
	[ 'webhook', _('Webhook (custom HTTP)') ],
	[ 'sms', _('SMS to another number') ]
];

function ago(t) {
	if (!t) return _('never');
	var s = Math.max(0, Math.floor(Date.now() / 1000) - t);
	return s < 60 ? _('%d s ago').format(s) : s < 3600 ? _('%d min ago').format(Math.floor(s / 60)) : new Date(t * 1000).toLocaleString();
}

function required(section_id, v) {
	return v !== '' ? true : _('Expecting: %s').format(_('non-empty value'));
}

return view.extend({
	load: function() {
		return callStatus().catch(function() { return null; });
	},

	render: function(st) {
		var tiles = E('div'), logBox = E('div');

		function draw(s) {
			if (!s) {
				tiles.replaceChildren(kit.tiles([ { icon: 'message-square', label: _('Forwarder'), value: _('Not running'), tone: 'warn',
					meta: _('Service sms-forward') } ]));
				return;
			}
			tiles.replaceChildren(kit.tiles([
				{ icon: 'message-square', label: _('Forwarding'), value: s.enabled ? _('On') : _('Off'),
					chip: s.enabled ? kit.chip(_('Running'), 'ok') : kit.chip(_('Idle')),
					meta: _('%d channels · every %d s').format(s.channels, s.interval) },
				{ icon: 'send', label: _('Forwarded'), value: String(s.forwarded), meta: _('%d failed deliveries').format(s.failed) },
				{ icon: 'refresh-cw', label: _('Last scan'), value: ago(s.last_scan), meta: _('%d scans since start').format(s.scans) },
				{ icon: 'triangle-alert', label: _('Last error'), value: s.last_error ? _('Error') : _('None'), tone: s.last_error ? 'warn' : '',
					meta: s.last_error || (s.pending ? _('%d messages waiting for a retry').format(s.pending) : '') }
			]));
			logBox.replaceChildren(kit.kv((s.log || []).slice(-12).reverse().map(function(l) {
				return [ new Date(l.time * 1000).toLocaleTimeString(), E('span', { 'class': l.level === 'error' ? 'k-tone-bad' : '' }, l.text) ];
			})));
		}

		draw(st);
		poll.add(function() { return callStatus().then(draw, function() { draw(null); }); }, 5);

		var m = new form.Map('sms_forward', _('SMS forwarding'),
			_('Incoming SMS are sent on to the channels below. Messages that were already in the modem when forwarding started are not sent.'));

		var s = m.section(form.NamedSection, 'main', 'main', _('Settings'));
		var o = s.option(form.Flag, 'enabled', _('Forward incoming SMS'));
		o.rmempty = false;
		o = s.option(form.Value, 'interval', _('Check every (s)'), _('The modem storage is also read at once when the modem reports a new message.'));
		o.datatype = 'range(10,3600)';
		o.placeholder = '30';
		o = s.option(form.TextValue, 'template', _('Message format'),
			_('Placeholders: {text} the SMS, {from} the sender, {time} its time, {device} this router\'s name.'));
		o.rows = 3;
		o.placeholder = '{text}\n\n{from} · {time} · {device}';
		o = s.option(form.DynamicList, 'allow_from', _('Only from'), _('Forward only messages whose sender contains one of these. Empty: every sender.'));
		o = s.option(form.DynamicList, 'deny_from', _('Never from'));
		o = s.option(form.DynamicList, 'deny_text', _('Never containing'));
		o = s.option(form.Value, 'partial_wait', _('Wait for missing parts (s)'),
			_('A long message arrives in parts; when some are still missing after this time it is sent as it is.'));
		o.datatype = 'range(0,3600)';
		o.placeholder = '180';
		o = s.option(form.Value, 'retries', _('Retries per channel'));
		o.datatype = 'range(0,20)';
		o.placeholder = '3';

		s = m.section(form.GridSection, 'channel', _('Channels'), _('Save & Apply before testing a new or changed channel.'));
		s.addremove = true;
		s.anonymous = true;
		s.sortable = true;
		s.nodescriptions = true;
		s.addbtntitle = _('Add channel');
		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = o.enabled;
		o.editable = true;
		o.rmempty = false;
		o = s.option(form.ListValue, 'type', _('Type'));
		TYPES.forEach(function(t) { o.value(t[0], t[1]); });
		o.default = 'telegram';
		o = s.option(form.Value, 'label', _('Name'));
		o.placeholder = _('optional');

		/* every type has its own option names (an option that is hidden is removed on save, so two fields must never share a name) */
		function field(name, title, types, opts) {
			var f = s.option(opts && opts.cls || form.Value, name, title, opts && opts.descr);
			f.modalonly = true;
			types.forEach(function(t) { f.depends('type', t); });
			if (opts && opts.required) f.validate = required;
			if (opts && opts.password) f.password = true;
			if (opts && opts.placeholder) f.placeholder = opts.placeholder;
			return f;
		}
		field('tg_token', _('Bot token'), [ 'telegram' ], { required: true, password: true, placeholder: '123456:ABC-DEF…' });
		field('tg_chat', _('Chat ID'), [ 'telegram' ], { required: true });
		field('tg_api', _('API address'), [ 'telegram' ], { placeholder: 'https://api.telegram.org', descr: _('Change only to use a relay of the Bot API.') });
		field('bark_key', _('Device key'), [ 'bark' ], { required: true, password: true });
		field('bark_server', _('Server'), [ 'bark' ], { placeholder: 'https://api.day.app' });
		field('pp_token', _('Token'), [ 'pushplus' ], { required: true, password: true });
		field('sc_key', _('SendKey'), [ 'serverchan' ], { required: true, password: true });
		field('dt_url', _('Webhook address'), [ 'dingtalk' ], { required: true, placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=…' });
		field('wecom_url', _('Webhook address'), [ 'wecom' ], { required: true, placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…' });
		field('fs_url', _('Webhook address'), [ 'feishu' ], { required: true, placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/…' });
		field('secret', _('Signing secret'), [ 'dingtalk', 'feishu' ], { password: true, descr: _('Only when the robot uses signature security.') });
		field('url', _('URL'), [ 'webhook' ], { required: true, placeholder: 'https://example.com/hook',
			descr: _('With GET the placeholders {from} {text} {time} {device} {message} can be part of the URL.') });
		o = field('method', _('Method'), [ 'webhook' ], { cls: form.ListValue });
		o.value('post', 'POST');
		o.value('get', 'GET');
		o = field('content_type', _('Body format'), [ 'webhook' ], { cls: form.ListValue });
		o.value('json', 'JSON');
		o.value('form', _('Form (URL encoded)'));
		field('body', _('Body template'), [ 'webhook' ], { cls: form.TextValue,
			descr: _('Empty: all fields. The values are escaped for the chosen format; {message} is the formatted message.') });
		field('title', _('Title'), [ 'bark', 'pushplus', 'serverchan' ], { placeholder: 'SMS {from}' });
		field('number', _('Phone number'), [ 'sms' ], { required: true, descr: _('Sent from this SIM; each forwarded message costs an SMS.') });

		o = s.option(form.Button, '_test', _('Test'));
		o.inputtitle = _('Send test');
		o.inputstyle = 'action';
		o.onclick = function(ev, section_id) {
			return callTest(section_id).then(function(r) {
				ui.addNotification(null, E('p', r && r.ok ? _('The test message was delivered.') : _('Test failed: %s').format((r && r.error) || _('no answer'))),
					r && r.ok ? 'info' : 'warning');
			});
		};

		return kit.formPage(m, [ tiles,
			kit.card({ title: _('Recent events'), icon: 'list', body: logBox, actions: [
				E('button', { 'class': 'btn cbi-button cbi-button-action', 'click': ui.createHandlerFn(this, function() {
					return callPoll().then(function() { return callStatus().then(draw); });
				}) }, _('Check now'))
			] })
		], [ 'sliders-horizontal', 'send' ]);
	}
});
