'use strict';
'require view';
'require form';
'require rpc';
'require poll';
'require uci';
'require tools.widgets as widgets';
'require u30pro.kit as kit';

/* Network > TTL & Hop Limit: a form of /etc/config/ttl (main: enabled, ttl, hoplimit, network) and, above it, the devices that have the
 * rules with their packet counters (luci.ttl status, from nft).  /etc/init.d/ttl applies the settings through its procd reload trigger. */
var callStatus = rpc.declare({ object: 'luci.ttl', method: 'status' });

/* the chains of table netdev ttl: [{device, ttl, hop, packets}] */
function chains(st) {
	var out = {}, list = (st && st.rules && st.rules.nftables) || [];
	list.forEach(function(e) {
		if (e.chain && e.chain.dev) out[e.chain.name] = { device: e.chain.dev, packets: 0 };
		if (e.rule && out[e.rule.chain])
			(e.rule.expr || []).forEach(function(x) { if (x.counter) out[e.rule.chain].packets += x.counter.packets || 0; });
	});
	return Object.keys(out).map(function(k) { return out[k]; });
}

return view.extend({
	load: function() {
		return Promise.all([ callStatus().catch(function() { return null; }), uci.load('ttl') ]);
	},

	render: function(data) {
		var tiles = E('div');

		function draw(st) {
			var c = chains(st), on = uci.get('ttl', 'main', 'enabled') === '1';
			tiles.replaceChildren(kit.tiles([
				{ icon: 'hash', label: _('Rules'), value: st && st.active ? _('Active') : _('Off'),
					chip: st && st.active ? kit.chip(_('On'), 'ok') : kit.chip(on ? _('No device') : _('Off')),
					meta: c.length ? c.map(function(x) { return x.device; }).join(' · ') : _('No device has the rules') },
				{ icon: 'activity', label: _('Packets changed'), value: String(c.reduce(function(a, x) { return a + x.packets; }, 0)),
					meta: _('Since the rules were loaded') },
				{ icon: 'arrow-down-up', label: _('IPv4 TTL'), value: uci.get('ttl', 'main', 'ttl') || _('unchanged') },
				{ icon: 'globe', label: _('IPv6 hop limit'), value: uci.get('ttl', 'main', 'hoplimit') || _('unchanged') }
			]));
		}

		draw(data[0]);
		poll.add(function() { return callStatus().then(draw); }, 5);

		var m = new form.Map('ttl', _('TTL & Hop Limit'),
			_('Sets the TTL (IPv4) and hop limit (IPv6) of every packet that leaves through the chosen networks, so that the carrier sees the same value for the router and for the devices behind it. Flow offloading keeps working.'));
		var s = m.section(form.NamedSection, 'main', 'ttl', _('Settings'));
		var o = s.option(form.Flag, 'enabled', _('Enable'));
		o.rmempty = false;
		o = s.option(form.Value, 'ttl', _('IPv4 TTL'), _('Empty: leave the TTL as it is. Common values: 64 (Android, iOS, Linux) or 128 (Windows).'));
		o.datatype = 'range(1,255)';
		o.placeholder = '64';
		o = s.option(form.Value, 'hoplimit', _('IPv6 hop limit'), _('Empty: leave the hop limit as it is.'));
		o.datatype = 'range(1,255)';
		o.placeholder = '64';
		o = s.option(widgets.NetworkSelect, 'network', _('Networks'), _('Empty: the networks of the firewall zone wan (cellular, additional APNs, Wi-Fi uplink).'));
		o.multiple = true;
		o.nocreate = true;

		return kit.formPage(m, [ tiles ], [ 'sliders-horizontal' ]);
	}
});
