// Das Torfschiff – static client. All later content is AES-GCM encrypted; keys come from the correct answers.
(() => {
const T = window.TS_DATA, KEY = 'torfschiff.static.v1';
const $ = s => document.querySelector(s), app = $('#app'), voice = $('#voice');
const enc = new TextEncoder(), subtle = crypto.subtle;
const salt = new Uint8Array(T.salt.match(/../g).map(h => parseInt(h, 16)));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let st = null, LINES = {}, URLS = {}, BL = [], HINTS = {}, playing = false;

// ---------- crypto ----------
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function open(sealed, pass, iter) {
  const [iv, ct] = sealed.split('.').map(unb64);
  const base = await subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  const k = await subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const buf = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv }, k, ct));
  const n = new DataView(buf.buffer).getUint32(0), obj = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + n))), audio = buf.subarray(4 + n);
  for (const [id, L] of Object.entries(obj.lines)) { LINES[id] = L; URLS[id] = URL.createObjectURL(new Blob([audio.subarray(L.a[0], L.a[0] + L.a[1])], { type: 'audio/mpeg' })); }
  return obj;
}
const sha = async s => Array.from(new Uint8Array(await subtle.digest('SHA-256', enc.encode(s))), b => b.toString(16).padStart(2, '0')).join('');
async function loadBlobs() {
  if (!BL[0]) BL[0] = await open(T.blobs[0], 'start', 1000);
  for (let i = 1; i <= st.chain.length; i++) if (!BL[i]) BL[i] = await open(T.blobs[i], st.chain.slice(0, i).join('|'), T.iter);
}
async function loadHints(i) { if (!HINTS[i]) HINTS[i] = await open(T.hints[i], 'hint:' + i + ':' + T.salt, 1000); return HINTS[i].hints; }
const chapter = i => BL[i].chapter;
const finaleData = () => BL[T.chapters];

// ---------- normalisation ----------
function norm(s) { return String(s || '').toLowerCase().replace(/ß/g, 'ss').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u'); }
const compact = s => norm(s).replace(/[^a-z0-9]/g, '');
const tokens = s => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
const NUMW = { null: 0, eins: 1, ein: 1, eine: 1, zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwolf: 12, dreizehn: 13, vierzehn: 14, funfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20, einundzwanzig: 21, zweiundzwanzig: 22, dreiundzwanzig: 23, vierundzwanzig: 24, funfundzwanzig: 25, sechsundzwanzig: 26, siebenundzwanzig: 27, achtundzwanzig: 28, neunundzwanzig: 29, dreissig: 30 };
const FILL = new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'eine', 'einen', 'einem', 'einer', 'eines', 'antwort', 'ist', 'es', 'sind', 'nummer', 'nr', 'zahl', 'buchstabe', 'buchstaben', 'lautet', 'wir', 'sagen', 'glauben', 'denke', 'ich']);
function roman(s) { if (!/^[ivxlc]+$/.test(s) || s.length > 6) return null; const v = { i: 1, v: 5, x: 10, l: 50, c: 100 }; let n = 0; for (let i = 0; i < s.length; i++) { const a = v[s[i]], b = v[s[i + 1]] || 0; n += a < b ? -a : a; } return n; }
// returns a list of candidate numbers (a single letter like "l" may be the letter L=12 or roman 50)
function candidates(input) {
  const t = tokens(input).filter(w => !FILL.has(w)); if (!t.length) return [];
  const w = t.join(''), out = new Set();
  if (/^\d+$/.test(w)) out.add(+w);
  if (w in NUMW) out.add(NUMW[w]);
  if (/^[a-z]$/.test(w)) out.add(w.charCodeAt(0) - 96);
  const r = roman(w); if (r) out.add(r);
  if (t.length === 1 && /^\d+$/.test(t[0])) out.add(+t[0]);
  return [...out];
}

// ---------- state ----------
const fresh = () => ({ phase: 'title', ch: 0, chain: [], letters: [], hintLv: {}, hintsUsed: 0, wrong: 0, finWrongs: 0, remaining: T.timerSeconds, endAt: null,
  paused: false, midnight: false, queue: null, qi: 0, after: null, chat: {}, sOnce: false, formDone: {}, ask: false, house: '', place: '' });
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };

// ---------- timer ----------
const remaining = () => st.endAt && !st.paused ? Math.max(0, Math.round((st.endAt - Date.now()) / 1000)) : st.remaining;
const fmt = r => String(Math.floor(r / 60)).padStart(2, '0') + ':' + String(r % 60).padStart(2, '0');
function pause() { if (['title', 'end'].includes(st.phase)) return; st.remaining = remaining(); st.endAt = null; st.paused = true; save(); voice.pause(); tick(); $('#pauseOverlay').classList.remove('hidden'); }
function resume() { st.paused = false; st.endAt = Date.now() + st.remaining * 1000; save(); $('#pauseOverlay').classList.add('hidden'); if (playing && voice.src && voice.paused && !voice.ended) voice.play().catch(() => {}); }
function tick() {
  if (!st || st.phase === 'title') return;
  const r = remaining(), t = $('#timer'); t.textContent = fmt(r); t.classList.toggle('low', r < 300);
  $('#hintcount').textContent = '✦ ' + st.hintsUsed;
  if (r === 0 && !st.midnight && !playing && !st.queue && ['chapter', 'finale'].includes(st.phase)) {
    st.midnight = true; st.remaining = 0; st.endAt = null; save(); playQueue([BL[0].midnight], st.phase);
  }
}
setInterval(tick, 500);

// ---------- audio + subtitles ----------
function playQueue(ids, after, sources) { st.queue = ids.map((id, i) => ({ id, source: sources && sources[i] })); st.qi = 0; st.after = after; save(); runQueue(); }
function runQueue() {
  if (!st.queue || st.qi >= st.queue.length) { const a = st.after; st.queue = null; playing = false; save(); return go(a); }
  playing = true;
  const it = st.queue[st.qi], L = LINES[it.id] || { name: '', text: '' };
  app.innerHTML = `${lettersBar()}<div class="sublines"><div class="speaker">${esc(L.name)}</div><div class="subtitle">${esc(L.text)}</div>${it.source ? `<div class="source">Quelle: ${esc(it.source)}</div>` : ''}</div>
  <div class="row"><button id="skip">Weiter</button><button id="replay" class="ghost">↺ Nochmal</button></div>`;
  const adv = () => { voice.onended = null; voice.pause(); st.qi++; save(); runQueue(); };
  $('#skip').onclick = adv; $('#replay').onclick = () => { voice.currentTime = 0; voice.play().catch(() => {}); };
  if (URLS[it.id]) { voice.src = URLS[it.id]; voice.onended = () => setTimeout(adv, 600); if (!st.paused) voice.play().catch(() => showTap(() => voice.play().catch(() => {}))); }
}
function showTap(fn) { const o = $('#tapOverlay'); o.classList.remove('hidden'); $('#tapBtn').onclick = () => { o.classList.add('hidden'); fn && fn(); }; }

// ---------- flow ----------
function go(step) {
  if (step === 'enterChapter') { st.phase = 'chapter'; st.wrong = 0; save(); return playQueue(chapter(st.ch).lines, chapter(st.ch).form && !st.formDone[st.ch] ? 'form' : 'chapter'); }
  if (step === 'enterFinale') { st.phase = 'finale'; save(); return playQueue(finaleData().finale.intro, 'finale'); }
  if (step) st.phase = step;
  if (step === 'end') { st.remaining = remaining(); st.endAt = null; voice.pause(); }
  save(); render();
}
function render() {
  $('#bar').classList.toggle('hidden', st.phase === 'title');
  if (st.queue && st.qi < st.queue.length) { app.innerHTML = lettersBar(); return showTap(runQueue); }
  ({ title: vTitle, chapter: vChapter, form: vForm, finale: vFinale, end: vEnd }[st.phase] || vTitle)();
  tick();
}
const lettersBar = () => st.phase === 'title' ? '' : `<div class="letters">${Array.from({ length: T.chapters }, (_, i) => `<span class="${st.letters[i] ? 'on' : ''}">${esc(st.letters[i] || '_')}</span>`).join('')}</div><div class="rule">A=1 · B=2 · C=3 … Z=26</div>`;

function vTitle() {
  app.innerHTML = `<h1 id="ttl">${esc(T.title)}<span class="r">.</span></h1><div class="sub">${esc(T.subtitle)}</div>
  ${T.players ? `<p class="center">${esc(T.players)}</p>` : ''}<p class="center dim">Stift, Papier, ein Handy, Ton an.</p><div class="center" style="margin-top:2em"><button class="primary" id="start">Start</button></div>`;
  $('#start').onclick = () => {
    voice.src = URLS[BL[0].prolog[0]]; voice.play().catch(() => {});
    st.phase = 'prolog'; st.endAt = Date.now() + st.remaining * 1000; save(); $('#bar').classList.remove('hidden');
    playQueue(BL[0].prolog, 'enterChapter');
  };
}
function transcript(ids) { return `<div class="transcript">${ids.map(id => LINES[id] ? `<p><span class="who">${esc(LINES[id].name)}</span>${esc(LINES[id].text)}</p>` : '').join('')}</div>`; }

function vChapter() {
  const c = chapter(st.ch), lv = st.hintLv[st.ch] || 0, ids = c.form ? [...c.lines, ...c.form.after] : c.lines;
  app.innerHTML = `${lettersBar()}<h2>${esc(c.title)}</h2>
  <div class="row" style="margin-top:0"><button class="ghost" id="rep">▶ Abspielen</button></div>${transcript(ids)}
  <label for="ans">Antwort</label><input id="ans" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Zahl oder Buchstabe">
  <div class="feedback" id="fb"></div>
  <div class="row"><button class="primary" id="go">Prüfen</button><button class="ghost" id="hint" ${lv >= c.hintCount ? 'disabled' : ''}>Hinweis (${lv}/${c.hintCount})</button></div>
  <ol class="hints" id="hl"></ol>${chatBox(c)}`;
  if (lv) loadHints(st.ch).then(h => { $('#hl') && ($('#hl').innerHTML = h.slice(0, lv).map(id => `<li>${esc(LINES[id].text)}</li>`).join('')); });
  const check = async () => {
    const v = $('#ans').value; if (!v.trim()) return;
    $('#go').disabled = true;
    let hit = null;
    for (const n of candidates(v)) if (await sha(T.salt + ':' + st.ch + ':' + n) === T.answerHashes[st.ch]) { hit = n; break; }
    if (hit == null) {
      $('#go').disabled = false; st.wrong++; save(); $('#ans').value = '';
      $('#fb').textContent = LINES[c.wrong].text; voice.src = URLS[c.wrong]; voice.onended = null; voice.play().catch(() => {});
      return;
    }
    st.chain.push(hit); save();
    try { await loadBlobs(); } catch (e) { st.chain.pop(); save(); $('#go').disabled = false; $('#fb').textContent = 'Fehler beim Öffnen. Nochmal versuchen.'; return; }
    const b = BL[st.chain.length]; st.letters[st.ch] = b.letter; const wasLast = st.ch === T.chapters - 1;
    if (!wasLast) st.ch++;
    save();
    playQueue([b.ok, b.interlude], wasLast ? 'enterFinale' : 'enterChapter', [null, b.interludeSource]);
  };
  $('#go').onclick = check; $('#ans').onkeydown = e => { if (e.key === 'Enter') check(); };
  $('#rep').onclick = () => playQueue(ids, 'chapter');
  $('#hint').onclick = async () => {
    const h = await loadHints(st.ch), lv2 = (st.hintLv[st.ch] || 0); if (lv2 >= h.length) return;
    st.hintLv[st.ch] = lv2 + 1; st.hintsUsed++; save(); playQueue([h[lv2]], 'chapter');
  };
  bindChat(c);
}

function vForm() {
  const c = chapter(st.ch);
  app.innerHTML = `${lettersBar()}<h2>${esc(c.title)}</h2>${transcript(c.lines)}
  <label for="hn">Hausnummer</label><input id="hn" inputmode="numeric" autocomplete="off" value="${esc(st.house)}">
  <label for="pl">Platz</label><input id="pl" autocomplete="off" value="${esc(st.place)}">
  <div class="row"><button class="primary" id="go">Weiter</button><button class="ghost" id="rep">▶ Abspielen</button></div>`;
  $('#rep').onclick = () => playQueue(c.lines, 'form');
  $('#go').onclick = () => {
    st.house = $('#hn').value; st.place = $('#pl').value; st.formDone[st.ch] = true; save();
    const n = candidates(st.house)[0];
    playQueue(n === c.form.houseNumber ? c.form.after : [c.form.n6, ...c.form.after], 'chapter');
  };
}

// ---------- finale ----------
function gate(text, g) {
  const c = compact(text), t = tokens(text);
  const sub = l => l.some(w => c.includes(compact(w))), tok = l => l.some(w => t.includes(w));
  const wrongNamed = sub(g.wrongNames);
  const liar = tok(g.liarWords) || sub(['lugt', 'lugner', 'gelogen']);
  const identity = sub(g.strong) || tok(g.strongTokens) || (tok(g.dTokens) && !wrongNamed) || (liar && tok(g.subjects)) || (liar && !wrongNamed);
  const dAndO = t.includes('d') && t.includes('o');
  const proof = sub(g.proofSubs) || tok(g.proofTokens) || dAndO || ((sub(g.proofGate) || tok(g.proofGateTokens)) && (sub(g.proofTime) || tok(['nie']))) || /d\s*(\.\.\.|…|-|_)\s*o/i.test(text);
  if (identity && proof) return 'pass';
  if (wrongNamed) return 'wrong';
  if (identity) return 'proof';
  return 'wrong';
}
function vFinale() {
  const F = finaleData().finale;
  app.innerHTML = `${lettersBar()}<h2>Finale</h2><div class="row" style="margin-top:0"><button class="ghost" id="rep">▶ Abspielen</button></div>${transcript(F.intro)}
  <div class="choices"><button id="c1">${esc(F.choices[0])}</button><button id="c2" class="${st.ask ? 'primary' : ''}">${esc(F.choices[1])}</button><button id="c3" class="ghost">${esc(F.choices[2])}</button></div>
  <div id="askbox" class="${st.ask ? '' : 'hidden'}"><label for="fin">${esc(F.question)}</label><textarea id="fin" autocomplete="off" spellcheck="false"></textarea>
  <div class="feedback" id="fb"></div><div class="row"><button class="primary" id="go">Anklagen</button></div></div>`;
  $('#rep').onclick = () => playQueue(F.intro, 'finale');
  $('#c1').onclick = () => playQueue(F.fail, 'finale');
  $('#c3').onclick = () => playQueue(F.nudge, 'finale');
  $('#c2').onclick = () => { st.ask = true; save(); $('#askbox').classList.remove('hidden'); $('#c2').classList.add('primary'); $('#fin').focus(); };
  $('#go').onclick = () => {
    const text = $('#fin').value.trim(); if (!text) return;
    const r = gate(text, F.gate);
    if (r === 'pass') return playQueue(F.win, 'end');
    if (r === 'proof') return playQueue(F.proof, 'finale');
    st.finWrongs++; save();
    playQueue(st.finWrongs === 2 ? [...F.wrong, ...F.nudge] : F.wrong, 'finale');
  };
}
function vEnd() {
  const E = finaleData().end;
  app.innerHTML = `<h1 style="margin-top:12vh;font-size:1.9rem">${esc(E.text)}</h1>
  <p class="center">Verbleibende Zeit: <b>${fmt(st.remaining)}</b><br>Hinweise genutzt: <b>${st.hintsUsed}</b></p>
  <div class="center"><button id="hist">Die wahre Geschichte</button></div><div id="h"></div>`;
  $('#hist').onclick = () => {
    $('#h').innerHTML = `<h2>Die wahre Geschichte</h2><ol class="facts">${E.history.map(f => `<li>${esc(f)}</li>`).join('')}</ol>
    <h2>Quellen</h2><ol class="facts">${E.sources.map(s => `<li><small><a style="color:inherit" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></small></li>`).join('')}</ol>`;
  };
}

// ---------- chat (rule-based, in character, never confirms answers) ----------
const AI = ['bist du eine ki', 'bist du ki', 'bist du ein bot', 'bist du ein mensch', 'bist du echt', 'kunstliche intelligenz', 'chatgpt', 'bist du ein computer', 'bist du ein roboter', 'ich habe angst', 'mir ist das zu gruselig', 'ich will aufhoren'];
function reply(p, msg, seed, pid) {
  const m = norm(msg);
  if (AI.some(a => m.includes(a))) return BL[0].aiNotice;
  let pool = p.generic, trig = null;
  for (const t of p.triggers) {
    const hit = t.all ? t.all.every(g => g.some(k => m.includes(norm(k)))) : t.any.some(k => m.includes(norm(k)));
    if (hit) { trig = t; pool = t.replies; break; }
  }
  if (trig && trig.once) { if (st.sOnce) pool = trig.after; else { st.sOnce = true; return pool[0]; } }
  return pool[Math.abs(seed) % pool.length];
}
function chatBox(c) {
  if (!c.chat) return '';
  const log = (st.chat[st.ch] || []).slice(-12);
  return `<div class="chat"><div class="speaker">${esc(c.chatName)} fragen</div><div class="chatlog" id="clog">${log.map(x => `<div class="${x.me ? 'me' : 'them'}">${x.me ? '› ' : ''}${esc(x.t)}</div>`).join('')}</div>
  <div class="row" style="margin-top:0"><input id="cin" placeholder="Frage stellen …" autocomplete="off"><button class="ghost" id="csend">Fragen</button></div></div>`;
}
function bindChat(c) {
  if (!$('#cin')) return;
  const send = () => {
    const msg = $('#cin').value.trim(); if (!msg) return;
    const log = st.chat[st.ch] = st.chat[st.ch] || []; log.push({ me: 1, t: msg });
    log.push({ t: reply(c.chat, msg, log.length * 7 + msg.length, ['S', 'M', 'D', '', 'K'][st.ch]) }); save();
    const a = $('#ans').value; render(); $('#ans').value = a; const cl = $('#clog'); if (cl) cl.scrollTop = 1e6; $('#cin').focus();
  };
  $('#csend').onclick = send; $('#cin').onkeydown = e => { if (e.key === 'Enter') send(); };
}

// ---------- hidden restart: long-press title 3 s ----------
let lp = null;
document.addEventListener('pointerdown', e => { if (e.target.closest('#ttl, .ttl')) lp = setTimeout(() => { if (confirm('Spiel komplett neu starten?')) { try { localStorage.removeItem(KEY); } catch (x) {} location.reload(); } }, 3000); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => document.addEventListener(ev, () => clearTimeout(lp)));
document.addEventListener('contextmenu', e => { if (e.target.closest('#ttl, .ttl')) e.preventDefault(); });
$('#pauseBtn').onclick = pause; $('#resumeBtn').onclick = resume;

// ---------- boot ----------
(async () => {
  try { st = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  if (!st) st = fresh();
  try { await loadBlobs(); } catch (e) { st = fresh(); save(); await loadBlobs(); }
  for (let i = 0; i <= st.ch; i++) if (st.hintLv[i]) await loadHints(i);
  if (st.paused) $('#pauseOverlay').classList.remove('hidden');
  if (st.phase === 'prolog' && !st.queue) return go('enterChapter');
  render();
})().catch(e => { app.innerHTML = '<p class="center">Dieses Gerät kann das Spiel nicht öffnen. Bitte in Safari oder Chrome öffnen.</p>'; console.error(e); });
window.__ts = { get st() { return st; }, gate: (t) => gate(t, finaleData().finale.gate), candidates, lines: async () => { for (let i = 0; i < T.chapters; i++) await loadHints(i); return Object.fromEntries(Object.entries(LINES).map(([k, v]) => [k, { text: v.text, url: URLS[k] }])); } };
})();
