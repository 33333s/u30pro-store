'use strict';
'require baseclass';
'require ui';

/* The menu of the U30 Pro theme: the first level with icons in the side rail, the second level under the open entry, the third and
 * fourth as tabs above the page (as the Bootstrap theme does).  On phones the rail is a drawer behind the menu button. */
var ICON = { u30pro: 'house', status: 'activity', system: 'settings', services: 'layout-grid', network: 'globe', modem: 'signal',
	vpn: 'shield', logout: 'log-out' };

function icon(name) {
	var s = document.createElement('span');
	s.className = 'u-ic';
	s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
		((window.U30_ICONS || {})[name] || (window.U30_ICONS || {})['circle-dot'] || '') + '</svg>';
	return s;
}

return baseclass.extend({
	__init__: function() {
		ui.menu.load().then(L.bind(this.render, this));
		this.renderRailFoot();
		var rail = document.getElementById('u-rail'), back = document.getElementById('u-backdrop'), btn = document.getElementById('u-menubtn');
		if (btn) {
			btn.appendChild(icon('menu'));
			btn.addEventListener('click', function() { document.body.classList.toggle('u-drawer'); });
		}
		if (back) back.addEventListener('click', function() { document.body.classList.remove('u-drawer'); });
		if (rail) rail.addEventListener('click', function(ev) { if (ev.target.closest('a[href]:not([href="#"])')) document.body.classList.remove('u-drawer'); });
	},

	render: function(tree) {
		var mode = tree.children[L.env.requestpath.length ? L.env.requestpath[0] : 'admin'] || tree.children.admin;
		if (!mode) return;
		this.renderMain(mode, L.env.requestpath[0] || 'admin');
		/* the tabs of the page: the children of the open second-level entry */
		if (L.env.dispatchpath.length >= 3) {
			var node = tree, url = '';
			for (var i = 0; i < 3 && node; i++) {
				node = node.children[L.env.dispatchpath[i]];
				url = url + (url ? '/' : '') + L.env.dispatchpath[i];
			}
			if (node) this.renderTabs(node, url, 0);
		}
	},

	renderMain: function(mode, base) {
		var nav = document.getElementById('u-menu'), self = this, logout = null;
		ui.menu.getChildren(mode).forEach(function(top) {
			if (top.name === 'logout') { logout = top; return; }
			var kids = ui.menu.getChildren(top), open = L.env.dispatchpath[1] === top.name;
			var link = E('a', { 'class': 'u-top-item' + (open ? ' open' : '') + (open && !kids.length ? ' active' : ''),
				'href': kids.length ? '#' : L.url(base, top.name) }, [ icon(ICON[top.name] || 'circle-dot'), E('span', {}, [ _(top.title) ]) ]);
			var group = E('div', { 'class': 'u-group' + (open ? ' open' : '') }, [ link ]);
			if (kids.length) {
				link.appendChild(E('span', { 'class': 'u-chev' }, [ icon('chevron-down') ]));
				link.addEventListener('click', function(ev) {
					ev.preventDefault();
					group.classList.toggle('open');
				});
				group.appendChild(E('div', { 'class': 'u-sub' }, kids.map(function(c) {
					var active = open && L.env.dispatchpath[2] === c.name;
					return E('a', { 'class': active ? 'active' : '', 'href': L.url(base, top.name, c.name) }, [ _(c.title) ]);
				})));
			}
			nav.appendChild(group);
		});
		if (logout) self.logout = E('a', { 'class': 'u-foot-item', 'href': L.url(base, 'logout'), 'title': _(logout.title) },
			[ icon('log-out'), E('span', {}, [ _(logout.title) ]) ]);
		var foot = document.getElementById('u-rail-foot');
		if (foot && self.logout) foot.appendChild(self.logout);
	},

	renderTabs: function(tree, url, level) {
		var container = document.getElementById('tabmenu'), ul = E('ul', { 'class': 'tabs' }), active = null;
		ui.menu.getChildren(tree).forEach(function(child) {
			var on = L.env.dispatchpath[3 + level] === child.name;
			ul.appendChild(E('li', { 'class': 'tabmenu-item-%s%s'.format(child.name, on ? ' active' : '') },
				[ E('a', { 'href': L.url(url, child.name) }, [ _(child.title) ]) ]));
			if (on) active = child;
		});
		if (!ul.children.length) return;
		container.appendChild(ul);
		container.style.display = '';
		if (active) this.renderTabs(active, url + '/' + active.name, level + 1);
	},

	/* light / dark / follow the system */
	renderRailFoot: function() {
		var foot = document.getElementById('u-rail-foot');
		if (!foot) return;
		var modes = [ [ 'auto', 'sun-moon', _('Auto') ], [ 'light', 'sun', _('Light') ], [ 'dark', 'moon', _('Dark') ] ];
		function current() { try { return localStorage.getItem('u30.theme') || 'auto'; } catch (e) { return 'auto'; } }
		var btn = E('button', { 'class': 'u-foot-item', 'type': 'button' });
		function paint() {
			var m = modes.filter(function(x) { return x[0] === current(); })[0] || modes[0];
			btn.innerHTML = '';
			btn.appendChild(icon(m[1]));
			btn.appendChild(E('span', {}, [ m[2] ]));
			btn.title = m[2];
		}
		btn.addEventListener('click', function() {
			var i = modes.map(function(x) { return x[0]; }).indexOf(current());
			try { localStorage.setItem('u30.theme', modes[(i + 1) % modes.length][0]); } catch (e) {}
			if (window.u30Appearance) window.u30Appearance();
			paint();
		});
		paint();
		foot.insertBefore(btn, foot.firstChild);
	}
});
