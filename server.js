const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const srv = http.createServer(app);
const io = new Server(srv);
app.use(express.static(path.join(__dirname, 'public')));

// ---- เก็บคะแนนเป็นไฟล์ JSON ในโฟลเดอร์ data (ไม่ใช้ DB) ----
const FILE = path.join(__dirname, 'data', 'scores.json');
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const save = (s) => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(s, null, 2)); };
const top = () => Object.entries(load()).sort((a, b) => b[1] - a[1]).slice(0, 5);

// ---- ห้องเกม (อยู่ในหน่วยความจำ) ----
const rooms = {};
const alive = (r) => r.players.filter((p) => p.alive);
const pub = (r) => ({
  code: r.code, phase: r.phase, host: r.host, holder: r.holder, msg: r.msg,
  players: r.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive })), top: top(),
});
const send = (r) => io.to(r.code).emit('state', pub(r));
const arm = (r) => { clearTimeout(r.t); r.t = setTimeout(() => boom(r), 8000 + Math.random() * 12000); };
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function boom(r) {
  const h = r.players.find((p) => p.id === r.holder);
  if (!h) return;
  h.alive = false;
  const a = alive(r);
  if (a.length <= 1) {
    r.phase = 'over'; r.holder = null;
    if (a[0]) {
      const s = load(); s[a[0].name] = (s[a[0].name] || 0) + 1; save(s);
      r.msg = `💥 ${h.name} ระเบิด! ผู้ชนะคือ ${a[0].name} 🏆`;
    } else r.msg = `💥 ${h.name} ระเบิด!`;
    return send(r);
  }
  r.msg = `💥 ${h.name} ระเบิด!`;
  r.holder = pick(a).id;
  send(r); arm(r);
}

io.on('connection', (socket) => {
  let room = null;

  socket.on('join', ({ name, code }) => {
    name = String(name || '').trim().slice(0, 12) || 'ไม่ระบุชื่อ';
    code = String(code || '').trim().toUpperCase().slice(0, 6);
    if (!code) return;
    const r = (rooms[code] ||= { code, players: [], phase: 'lobby', host: socket.id, holder: null, msg: 'รอเพื่อนเข้าห้อง…' });
    if (r.phase === 'playing') return socket.emit('err', 'ห้องนี้กำลังเล่นอยู่ รอรอบหน้านะ');
    socket.join(code); room = r;
    r.players.push({ id: socket.id, name, alive: true });
    send(r);
  });

  socket.on('start', () => {
    const r = room; if (!r || r.host !== socket.id || r.players.length < 2) return;
    r.players.forEach((p) => (p.alive = true));
    r.phase = 'playing'; r.holder = pick(r.players).id; r.msg = '🔥 ส่งระเบิดต่อเร็ว!';
    send(r); arm(r);
  });

  socket.on('pass', (to) => {
    const r = room; if (!r || r.phase !== 'playing' || r.holder !== socket.id || to === socket.id) return;
    const t = r.players.find((p) => p.id === to && p.alive);
    if (!t) return;
    r.holder = t.id; r.msg = ''; send(r);
  });

  socket.on('disconnect', () => {
    const r = room; if (!r) return;
    r.players = r.players.filter((p) => p.id !== socket.id);
    if (!r.players.length) { clearTimeout(r.t); delete rooms[r.code]; return; }
    if (r.host === socket.id) r.host = r.players[0].id;
    if (r.phase === 'playing') {
      const a = alive(r);
      if (a.length <= 1) { clearTimeout(r.t); r.phase = 'over'; r.holder = null; r.msg = 'เพื่อนออกเกม จบรอบ'; }
      else if (r.holder === socket.id) r.holder = pick(a).id;
    }
    send(r);
  });
});

const PORT = process.env.PORT || 3000;
srv.listen(PORT, () => console.log('Gamehang รันที่ http://localhost:' + PORT));
