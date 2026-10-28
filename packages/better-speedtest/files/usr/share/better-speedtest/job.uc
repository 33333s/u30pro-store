/* better-speedtest as one background job, shared by the web page (rpcd luci.better-speedtest) and the screen (u30pro-screen-better-speedtest):
 * start runs "better-speedtest test --json" detached in its own session, its NDJSON goes to /run/better-speedtest/out.ndjson, and when it
 * ends /usr/libexec/better-speedtest/bst finish adds the result to the history (/etc/better-speedtest/history.json, the last 20).
 * The settings of the test are uci better-speedtest.main.  Only one test runs at a time. */
import { readfile, writefile, mkdir, stat, unlink, rename, popen } from 'fs';
import { cursor } from 'uci';

const RUN = '/run/better-speedtest', OUT = RUN + '/out.ndjson', ERR = RUN + '/err.log', PIDF = RUN + '/pid', JOB = RUN + '/job.json';
const BIN = '/usr/bin/better-speedtest', BST = '/usr/libexec/better-speedtest/bst';
const HIST = '/etc/better-speedtest/history.json', HMAX = 20;
const SOURCES = [ 'auto', 'cnspeed', 'cdn', 'ookla' ], DIRECTIONS = [ 'both', 'down', 'up' ];

function json_file(p) { try { return json(readfile(p) || 'null'); } catch (e) { return null; } }
function q(s) { return "'" + replace('' + s, "'", "'\\''") + "'"; }
function save_json(p, v) { writefile(p + '.tmp', sprintf('%J', v)); rename(p + '.tmp', p); }
function num(v, lo, hi) { let n = type(v) == 'int' ? v : (type(v) == 'string' && match(v, /^[0-9]+$/) ? int(v) : null); return n != null && n >= lo && n <= hi ? n : null; }
function run(cmd) { let p = popen(cmd, 'r'); if (!p) return null; let t = p.read('all'); return p.close() == 0 ? t : null; }

/* the settings, checked; o: the raw values (uci or a request), defaults for what is missing; {error} for a wrong value */
function check(o) {
	let r = { src: o.src ?? 'auto', node: o.node ?? '', direction: o.direction ?? 'both', duration: num(o.duration ?? 10, 5, 60), multi: num(o.multi ?? 1, 1, 4) };
	if (index(SOURCES, r.src) < 0) return { error: 'Unknown test source' };
	if (index(DIRECTIONS, r.direction) < 0) return { error: 'Unknown test direction' };
	if (r.duration == null) return { error: 'The duration must be 5 to 60 seconds' };
	if (r.multi == null) return { error: 'Use 1 to 4 sources at once' };
	/* a node is a name, city or address as the program lists them: printable, no control characters */
	if (type(r.node) != 'string' || length(r.node) > 80 || index(r.node, chr(0)) >= 0 || match(r.node, /[\x01-\x1f\x7f]/)) return { error: 'Invalid node' };
	return r;
}

function settings() {
	let s = cursor().get_all('better-speedtest', 'main') ?? {};
	let r = check(s);
	return r.error ? check({}) : r;
}

function save(o) {
	let r = check(o);
	if (r.error) return r;
	let c = cursor();
	c.set('better-speedtest', 'main', 'better-speedtest');
	for (let k in [ 'src', 'node', 'direction', 'duration', 'multi' ])
		c.set('better-speedtest', 'main', k, '' + r[k]);
	c.commit('better-speedtest');
	return r;
}

/* the job's session leader while it runs (the test and then the history entry) */
function running() {
	let pid = num(trim(readfile(PIDF) ?? ''), 1, 4194304);
	if (pid == null) return 0;
	let cmd = readfile('/proc/' + pid + '/cmdline') ?? '';
	return index(cmd, 'better-speedtest') >= 0 ? pid : 0;
}

function start(o) {
	if (running()) return { error: 'A test is already running' };
	let r = check(o ?? settings());
	if (r.error) return r;
	mkdir(RUN, 0755);
	unlink(OUT); unlink(ERR);
	let args = [ 'test', '--json', '--src', r.src, '--dur', '' + r.duration ];
	if (r.node != '') push(args, '--node', r.node);
	if (r.direction == 'down') push(args, '--no-upload');
	else if (r.direction == 'up') push(args, '--no-download');
	if (r.multi > 1) push(args, '--multi', '' + r.multi);
	save_json(JOB, { started: time(), settings: r });
	/* setsid: its own session, so stop ends the test and everything it started; the job writes nothing to the caller */
	let inner = 'cd /; ' + q(BIN) + ' ' + join(' ', map(args, q)) + ' >' + OUT + ' 2>' + ERR + ' </dev/null; exec ' + q(BST) + ' finish';
	let pid = num(trim(run('setsid sh -c ' + q(inner) + ' </dev/null >/dev/null 2>&1 & echo $!') ?? ''), 1, 4194304);
	if (pid == null) return { error: 'The test could not be started' };
	writefile(PIDF, '' + pid);
	return { started: true, settings: r };
}

function stop() {
	let pid = running();
	if (!pid) return { stopped: false };
	system('kill -TERM -- -' + pid + ' 2>/dev/null');
	let j = json_file(JOB);
	if (j) { j.stopped = time(); save_json(JOB, j); }
	return { stopped: true };
}

/* the job: the events so far (progress, messages), the result, an error */
function status() {
	let ev = [], result = null, error = null, done = false;
	for (let l in split(readfile(OUT) ?? '', '\n')) {
		l = trim(l);
		if (l == 'DONE') { done = true; continue; }
		if (substr(l, 0, 1) != '{') continue;
		let o = null;
		try { o = json(l); } catch (e) {}
		if (type(o) != 'object') continue;
		if (o.phase == 'result') result = o;
		else {
			if (o.phase == 'error') error = o.msg;
			push(ev, o);
		}
	}
	let job = json_file(JOB), busy = !!running();
	/* a job that ended without a result: the program's own complaint, or that it was stopped */
	if (!busy && job && !result && !error)
		error = job.stopped ? 'Stopped' : (trim(readfile(ERR) ?? '') || 'The test ended without a result');
	return { running: busy, job: job, events: ev, result: result, error: error };
}

/* the end of a job (bst finish): its result into the history */
function finish() {
	let s = status(), r = s.result, j = s.job;
	if (!r || !j) return;
	let h = json_file(HIST);
	if (type(h) != 'array') h = [];
	unshift(h, { t: j.started, settings: j.settings, node: r.node, source: r.source, carrier: r.carrier, city: r.city,
		dl_avg: r.dl_avg, dl_peak: r.dl_peak, ul_avg: r.ul_avg, ul_peak: r.ul_peak, ul_msg: r.ul_msg, ping: r.ping, jitter: r.jitter });
	mkdir('/etc/better-speedtest', 0755);
	save_json(HIST, slice(h, 0, HMAX));
}

function history() { let h = json_file(HIST); return type(h) == 'array' ? h : []; }
function clear_history() { unlink(HIST); return { cleared: true }; }

/* the program's answer to "nodes" or "ip", cached for 10 min (each asks the network) */
function cached(name, cmd) {
	let path = RUN + '/' + name + '.json', st = stat(path);
	if (st && time() - st.mtime < 600) { let v = json_file(path); if (v != null) return v; }
	let t = run(cmd + ' 2>/dev/null'), v = null;
	try { v = json(t ?? 'null'); } catch (e) {}
	if (v == null) return null;
	mkdir(RUN, 0755);
	save_json(path, v);
	return v;
}

/* the nodes of one source (cnspeed: the ones near the device's location), without their URLs */
function nodes(src) {
	if (index([ 'cnspeed', 'cdn', 'ookla' ], src) < 0) return { error: 'Unknown test source' };
	let v = cached('nodes-' + src, BIN + ' nodes --src ' + src);
	if (type(v) != 'array') return { error: 'The node list could not be fetched' };
	return { nodes: map(v, (n) => ({ name: n.name, source: n.source, carrier: n.carrier, province: n.province, city: n.city, region: n.region })) };
}

function location() {
	let v = cached('ip', BIN + ' ip');
	return type(v) == 'object' ? { ip: v.ip, carrier: v.carrier, province: v.province, city: v.city } : { error: 'The location could not be found' };
}

export { check, settings, save, running, start, stop, status, finish, history, clear_history, nodes, location };
