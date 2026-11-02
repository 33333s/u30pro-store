/* Delivery of one message through one channel of /etc/config/sms_forward.
 *   send(channel, msg) -> { ok, error?, http? }
 * channel: a UCI section of type channel, its option type: webhook | telegram | bark | pushplus | serverchan | dingtalk | wecom | feishu | sms
 * msg: { from, text, time, device } (time: the sender's timestamp as the modem gives it)
 * HTTP goes through curl (HTTPS with the system CA bundle); the request body is written to a file in /tmp/sms-forward (mode 700), so
 * nothing of the message ends up on a command line (a GET webhook carries it in its URL, as configured). */
import { readfile, writefile, unlink, mkdir, popen } from 'fs';
import * as digest from 'digest';

const CURL = '/usr/bin/curl', TMP = '/tmp/sms-forward';

function hex_bin(h) {
	let s = '';
	for (let i = 0; i < length(h); i += 2)
		s += chr(hex(substr(h, i, 2)));
	return s;
}

/* HMAC-SHA256 as raw bytes (RFC 2104) */
function hmac_sha256(key, msg) {
	if (length(key) > 64) key = hex_bin(digest.sha256(key));
	let ipad = '', opad = '';
	for (let i = 0; i < 64; i++) {
		let k = i < length(key) ? ord(key, i) : 0;
		ipad += chr(k ^ 0x36);
		opad += chr(k ^ 0x5c);
	}
	return hex_bin(digest.sha256(opad + hex_bin(digest.sha256(ipad + msg))));
}

function urlencode(s) {
	let out = '';
	for (let i = 0; i < length(s); i++) {
		let c = ord(s, i);
		if ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || index('-_.~', chr(c)) >= 0)
			out += chr(c);
		else
			out += sprintf('%%%02X', c);
	}
	return out;
}

function json_escape(s) {
	return substr(sprintf('%J', '' + s), 1, -1);
}

/* {from} {text} {time} {device} {message} in a template; enc escapes the values (URL or JSON) */
function fill(tpl, msg, enc) {
	return replace(tpl, /\{(from|text|time|device|message)\}/g, (all, k) => enc ? enc('' + (msg[k] ?? '')) : '' + (msg[k] ?? ''));
}

function now_ms() {
	let t = clock(false);
	return t[0] * 1000 + int(t[1] / 1000000);
}

function shq(s) {
	return "'" + replace('' + s, "'", "'\\''") + "'";
}

let seq = 0;

/* POST (or GET when body is null) url with curl (it sends a Content-Length; uclient-fetch always sends chunked request bodies, which
 * some small webhook servers do not read); returns { ok, http, body }.  Body and answer go through files in TMP (mode 700). */
function http(url, body, ctype, timeout) {
	mkdir(TMP, 0700);
	let base = sprintf('%s/%d-%d', TMP, time(), ++seq), outname = base + '.out', inname = base + '.in', codename = base + '.code';
	let argv = [ CURL, '-sS', '-m', '' + (timeout ?? 20), '-A', 'sms-forward', '-o', outname, '-w', '%{http_code}' ];
	if (body != null) {
		if (!writefile(inname, body)) return { ok: false, error: 'Cannot create a temporary file' };
		push(argv, '-H', 'Content-Type: ' + ctype, '--data-binary', '@' + inname);
	}
	push(argv, '--', url);
	let p = popen(join(' ', map(argv, shq)) + ' 2>' + shq(codename + '.err'), 'r');
	let code = p ? int(trim(p.read('all') ?? '')) : 0;
	let rc = p ? p.close() : -1;
	let resp = readfile(outname) ?? '', err = trim(readfile(codename + '.err') ?? '');
	for (let f in [ outname, inname, codename + '.err' ]) unlink(f);
	if (rc != 0) return { ok: false, http: code, error: err || sprintf('curl failed (%d)', rc), body: substr(resp, 0, 600) };
	return { ok: code >= 200 && code < 300, http: code, body: substr(resp, 0, 600), error: code >= 200 && code < 300 ? null : sprintf('HTTP %d', code) };
}

/* the services answer HTTP 200 with an error code in the body: look at the usual fields */
function check_json(r, okfield, okvalue) {
	if (!r.ok) return { ok: false, error: r.error || 'HTTP request failed', body: r.body };
	let j = null;
	try { j = json(r.body); } catch (e) { j = null; }
	if (okfield && (type(j) != 'object' || j[okfield] != okvalue))
		return { ok: false, error: 'The service refused the message', body: r.body };
	return { ok: true, body: r.body };
}

function title_of(ch, msg) {
	return fill(ch.title || 'SMS {from}', msg);
}

function send(ch, msg, sms_send) {
	let text = msg.message ?? msg.text;
	let t = ch.type;
	if (t == 'webhook') {
		if (!match(ch.url || '', /^https?:\/\//)) return { ok: false, error: 'The URL must start with http:// or https://' };
		if ((ch.method || 'post') == 'get')
			return check_json(http(fill(ch.url, msg, urlencode), null), null);
		let ct = ch.content_type || 'json';
		let tpl = ch.body || (ct == 'json' ? '{"from":"{from}","text":"{text}","time":"{time}","device":"{device}","message":"{message}"}'
			: 'from={from}&text={text}&time={time}&device={device}&message={message}');
		let body = fill(tpl, msg, ct == 'json' ? json_escape : urlencode);
		return check_json(http(fill(ch.url, msg, urlencode), body, ct == 'json' ? 'application/json' : 'application/x-www-form-urlencoded'), null);
	}
	if (t == 'telegram') {
		if (!match(ch.tg_token || '', /^[0-9]+:[A-Za-z0-9_-]+$/) || !length(ch.tg_chat || '')) return { ok: false, error: 'Bot token and chat ID are required' };
		let base = rtrim(ch.tg_api || 'https://api.telegram.org', '/');
		return check_json(http(base + '/bot' + ch.tg_token + '/sendMessage', sprintf('%J', { chat_id: ch.tg_chat, text: text }), 'application/json'), 'ok', true);
	}
	if (t == 'bark') {
		if (!length(ch.bark_key || '')) return { ok: false, error: 'The device key is required' };
		let base = rtrim(ch.bark_server || 'https://api.day.app', '/');
		return check_json(http(base + '/' + urlencode(ch.bark_key), sprintf('%J', { title: title_of(ch, msg), body: text, group: 'SMS' }), 'application/json'), 'code', 200);
	}
	if (t == 'pushplus') {
		if (!length(ch.pp_token || '')) return { ok: false, error: 'The token is required' };
		return check_json(http('https://www.pushplus.plus/send', sprintf('%J', { token: ch.pp_token, title: title_of(ch, msg), content: text, template: 'txt' }), 'application/json'), 'code', 200);
	}
	if (t == 'serverchan') {
		if (!match(ch.sc_key || '', /^[A-Za-z0-9]+$/)) return { ok: false, error: 'The SendKey is required' };
		let k = ch.sc_key, url = match(k, /^sctp([0-9]+)t/) ? sprintf('https://%s.push.ft07.com/send/%s.send', match(k, /^sctp([0-9]+)t/)[1], k)
			: 'https://sctapi.ftqq.com/' + k + '.send';
		return check_json(http(url, 'title=' + urlencode(title_of(ch, msg)) + '&desp=' + urlencode(text), 'application/x-www-form-urlencoded'), 'code', 0);
	}
	if (t == 'dingtalk') {
		if (!match(ch.dt_url || '', /^https:\/\/oapi\.dingtalk\.com\//)) return { ok: false, error: 'The robot webhook address is required' };
		let url = ch.dt_url;
		if (length(ch.secret || '')) {
			let ts = '' + now_ms();
			url += (index(url, '?') >= 0 ? '&' : '?') + 'timestamp=' + ts + '&sign=' + urlencode(b64enc(hmac_sha256(ch.secret, ts + '\n' + ch.secret)));
		}
		return check_json(http(url, sprintf('%J', { msgtype: 'text', text: { content: text } }), 'application/json'), 'errcode', 0);
	}
	if (t == 'wecom') {
		if (!match(ch.wecom_url || '', /^https:\/\/qyapi\.weixin\.qq\.com\//)) return { ok: false, error: 'The robot webhook address is required' };
		return check_json(http(ch.wecom_url, sprintf('%J', { msgtype: 'text', text: { content: text } }), 'application/json'), 'errcode', 0);
	}
	if (t == 'feishu') {
		if (!match(ch.fs_url || '', /^https:\/\/open\.(feishu\.cn|larksuite\.com)\//)) return { ok: false, error: 'The robot webhook address is required' };
		let req = { msg_type: 'text', content: { text: text } };
		if (length(ch.secret || '')) {
			let ts = '' + time();
			req.timestamp = ts;
			req.sign = b64enc(hmac_sha256(ts + '\n' + ch.secret, ''));
		}
		return check_json(http(ch.fs_url, sprintf('%J', req), 'application/json'), 'code', 0);
	}
	if (t == 'sms') {
		if (!match(ch.number || '', /^\+?[0-9]{3,20}$/)) return { ok: false, error: 'A phone number is required' };
		let r = sms_send(ch.number, text);
		return r?.ok ? { ok: true } : { ok: false, error: r?.error || 'Sending the SMS failed' };
	}
	return { ok: false, error: 'Unknown channel type' };
}

export { send, fill, hmac_sha256, urlencode };
