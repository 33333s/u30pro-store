'use strict';
'require view';
'require form';
'require fs';
'require u30pro.kit as kit';

/* Network > Cellular QoS: a form of /etc/config/u30pro_qos (main: up, down = off, fq_codel or cake; up_kbit, down_kbit = cake's bandwidth,
 * 0 automatic; delay) and, above it, what each direction runs now: /usr/sbin/u30pro-qos records what it set up in
 * /run/u30pro-qos.applied, u30pro-qosd the automatic rates in /run/u30pro-qos.status.  /etc/init.d/u30pro-qos applies the settings
 * through its procd reload trigger. */

/* key=value lines of a status file */
function parseStatus(text) {
	var st = {};
	String(text || '').split('\n').forEach(function(l) { var i = l.indexOf('='); if (i > 0) st[l.slice(0, i)] = l.slice(i + 1); });
	return st;
}

function rateText(kbit) {
	return kbit >= 1000 ? (kbit / 1000).toFixed(kbit >= 10000 ? 0 : 1) + ' Mbit/s' : Math.round(kbit) + ' kbit/s';
}

/* what one direction runs: off, fq_codel, or cake at a fixed rate or at the rate u30pro-qosd chose */
function queueTile(icon, label, mode, fixed, autoRate) {
	if (mode == 'fq_codel') return { icon: icon, label: label, value: 'fq_codel' };
	if (mode != 'cake') return { icon: icon, label: label, value: _('Off') };
	if (+fixed > 0) return { icon: icon, label: label, value: 'cake', meta: rateText(+fixed) };
	return { icon: icon, label: label, value: 'cake', meta: autoRate ? _('Automatic: %s').format(rateText(+autoRate)) : _('Automatic') };
}

function modeOption(s, name, title) {
	var o = s.option(form.ListValue, name, title);
	o.value('off', _('Off (default)'));
	o.value('fq_codel', 'fq_codel');
	o.value('cake', 'cake');
	o.default = 'off';
	return o;
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(fs.read('/run/u30pro-qos.applied'), ''),
			L.resolveDefault(fs.read('/run/u30pro-qos.status'), '')
		]);
	},

	render: function(data) {
		var applied = parseStatus(data[0]), auto = parseStatus(data[1]);
		var m = new form.Map('u30pro_qos', _('Cellular QoS'));

		var s = m.section(form.NamedSection, 'main', 'qos', _('Queueing on the cellular link'),
			_('Off by default. When the cellular link is full, its queue forms in the modem (upload) or at the base station (download), and everything else waits behind it: with a weak signal an upload delayed games and web pages by seconds. fq_codel only sorts the packets the router holds, which on a cellular link is almost never the queue that matters. cake also limits the rate a little below the link, so the queue moves to the router, where it is short and fair; with bandwidth 0 the router finds that rate itself from the round trip of a few pings, sent only while the link is busy. cake costs CPU time: on a fast download (hundreds of Mbit/s) it can take a core and limit the speed.'));
		modeOption(s, 'up', _('Upload'));
		var o = s.option(form.Value, 'up_kbit', _('Upload bandwidth (kbit/s)'), _('0 = automatic. A fixed value only helps while the link carries more than that.'));
		o.datatype = 'uinteger';
		o.placeholder = '0';
		o.depends('up', 'cake');
		modeOption(s, 'down', _('Download'));
		o = s.option(form.Value, 'down_kbit', _('Download bandwidth (kbit/s)'), _('0 = automatic. A fixed value only helps while the link carries more than that.'));
		o.datatype = 'uinteger';
		o.placeholder = '0';
		o.depends('down', 'cake');
		o = s.option(form.Value, 'delay', _('Delay limit (ms)'),
			_('Automatic bandwidth: how much the round trip may rise while the link is busy before the rate goes down. Lower keeps games smoother, higher keeps more of the speed. 20 to 500, default 60.'));
		o.datatype = 'range(20,500)';
		o.placeholder = '60';
		o.depends('up', 'cake');
		o.depends('down', 'cake');

		var tiles = kit.tiles([
			queueTile('upload', _('Upload queueing now'), applied.up, applied.up_kbit, auto.up_rate_kbit),
			queueTile('download', _('Download queueing now'), applied.down, applied.down_kbit, auto.down_rate_kbit)
		]);
		return kit.formPage(m, [ tiles ], [ 'activity' ]);
	}
});
