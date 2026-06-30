// server.js — backend del selector de usuarios + control de inicio de la rifa
//
// Estado compartido en memoria, sincronizado en vivo por WebSocket (Socket.io)
// a todos los navegadores conectados. Se respalda a disco (state.json) para
// no perder la lista/los reclamos si el servidor se reinicia.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123'; // ¡cámbialo en producción!
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'state.json');
const MAX_ATTEMPTS = 2;

// juegos donde un puntaje MENOR es mejor (ej: milisegundos de reacción) — debe
// coincidir con los `lowerIsBetter:true` definidos en juego.html
const LOWER_IS_BETTER_GAMES = new Set(['reflejos', 'memoria']);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
let state = {
  users: [],
  claims: {},
  started: false,
  today: {
    gameId: null,
    results: {},
  },
  wheel: {
    names: [],
    spinId: 0,
    winnerIndex: null,
  },
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      state = { ...state, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error('No se pudo leer state.json, se arranca limpio.', e.message);
  }
}
function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('No se pudo guardar state.json', e.message);
  }
}
loadState();
// asegura que la forma de "today" exista siempre, incluso si el state.json
// guardado es de una versión anterior sin este campo
if (!state.today || typeof state.today !== 'object') state.today = { gameId: null, results: {} };
if (!state.today.results) state.today.results = {};

function bestScoreFor(gameId, scores) {
  if (!scores.length) return null;
  const vals = scores.map(s => s.score);
  return LOWER_IS_BETTER_GAMES.has(gameId) ? Math.min(...vals) : Math.max(...vals);
}

function computeLeaderboard() {
  const gameId = state.today.gameId;
  const entries = Object.entries(state.today.results)
    .filter(([, scores]) => scores.length > 0)
    .map(([name, scores]) => ({ name, best: bestScoreFor(gameId, scores), attempts: scores.length }));
  const lowerBetter = LOWER_IS_BETTER_GAMES.has(gameId);
  entries.sort((a, b) => lowerBetter ? a.best - b.best : b.best - a.best);
  return entries;
}

function publicState() {
  // lo que ve cualquier visitante: nombres y cuáles ya están tomados
  return {
    users: state.users,
    takenNames: Object.keys(state.claims),
    started: state.started,
    today: {
      gameId: state.today.gameId,
      results: state.today.results, // necesario para que cada jugador sepa sus propios intentos/puntaje
      leaderboard: computeLeaderboard(),
    },
    wheel: state.wheel,
  };
}

function broadcast() {
  io.emit('state', publicState());
}

// ---------------------------------------------------------------------------
// Socket.io — usuarios normales
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.emit('state', publicState());

  socket.on('claim', ({ name, sessionId }) => {
    if (!name || !sessionId) return;
    const ownerOfName = state.claims[name];
    if (ownerOfName && ownerOfName !== sessionId) {
      socket.emit('claimResult', { ok: false, reason: 'Ese usuario ya fue tomado por otra persona.' });
      return;
    }
    if (!state.users.includes(name)) {
      socket.emit('claimResult', { ok: false, reason: 'Ese usuario no existe en la lista de hoy.' });
      return;
    }
    state.claims[name] = sessionId;
    saveState();
    socket.emit('claimResult', { ok: true, name });
    broadcast();
  });

  // Nota: deliberadamente NO existe una forma de que el jugador se libere a sí
  // mismo. Una vez reclamado un nombre, solo el administrador puede liberarlo
  // (vía /api/admin/release/:name), tal como se requiere.
});

// ---------------------------------------------------------------------------
// Registro de intentos — ESTA es la validación real (no se puede manipular
// desde el navegador): el servidor es la única fuente de verdad sobre cuántos
// intentos lleva cada jugador. Cualquier llamada que no cumpla las reglas se
// rechaza, sin excepción.
// ---------------------------------------------------------------------------
app.post('/api/attempt', (req, res) => {
  const { name, sessionId, score } = req.body || {};

  if (!name || !sessionId || typeof score !== 'number' || Number.isNaN(score)) {
    return res.status(400).json({ error: 'Datos de intento inválidos.' });
  }
  if (!state.started) {
    return res.status(409).json({ error: 'El juego de hoy todavía no ha iniciado.' });
  }
  if (!state.today.gameId) {
    return res.status(409).json({ error: 'El administrador todavía no ha definido el reto de hoy.' });
  }
  // el nombre debe seguir reclamado por exactamente esta sesión — evita que
  // alguien mande resultados a nombre de otro jugador, o que un jugador cuyo
  // reclamo fue liberado por el admin siga reportando puntajes
  if (state.claims[name] !== sessionId) {
    return res.status(403).json({ error: 'Esta sesión no corresponde a ese usuario.' });
  }

  const existing = state.today.results[name] || [];
  if (existing.length >= MAX_ATTEMPTS) {
    return res.status(409).json({ error: 'Ya usaste tus 2 intentos de hoy.', leaderboard: computeLeaderboard() });
  }

  existing.push({ score, ts: Date.now() });
  state.today.results[name] = existing;
  saveState();
  broadcast();

  res.json({
    ok: true,
    attemptsUsed: existing.length,
    attemptsLeft: MAX_ATTEMPTS - existing.length,
    best: bestScoreFor(state.today.gameId, existing),
  });
});

// ---------------------------------------------------------------------------
// Endpoints de administración (protegidos con ADMIN_KEY)
// ---------------------------------------------------------------------------
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'Llave de admin inválida.' });
  next();
}

// estado completo (incluye quién es cada nombre, útil para el panel admin)
app.get('/api/admin/state', requireAdmin, (req, res) => {
  res.json(state);
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { names } = req.body;
  if (!Array.isArray(names)) return res.status(400).json({ error: 'Se espera { names: string[] }' });
  state.users = [...new Set(names.map(n => String(n).trim()).filter(Boolean))];
  state.claims = {};
  state.started = false;
  state.today.results = {};
  saveState();
  broadcast();
  res.json({ ok: true, state });
});

// quita el reclamo de un nombre específico (por si alguien lo tomó por error)
app.post('/api/admin/release/:name', requireAdmin, (req, res) => {
  delete state.claims[req.params.name];
  saveState();
  broadcast();
  res.json({ ok: true, state });
});

// fija (o cambia) el minijuego del día — reinicia los intentos/resultados de hoy
app.post('/api/admin/today', requireAdmin, (req, res) => {
  const { gameId } = req.body || {};
  if (!gameId) return res.status(400).json({ error: 'Se espera { gameId: string }' });
  state.today = { gameId, results: {} };
  saveState();
  broadcast();
  res.json({ ok: true, state });
});

// borra los intentos de un jugador puntual en el reto de hoy (por si el admin
// necesita dejarlo reintentar), sin tener que liberar también su nombre
app.post('/api/admin/today/release/:name', requireAdmin, (req, res) => {
  delete state.today.results[req.params.name];
  saveState();
  broadcast();
  res.json({ ok: true, state });
});

// arranca el juego para todos los conectados
app.post('/api/admin/start', requireAdmin, (req, res) => {
  state.started = true;
  saveState();
  broadcast();
  res.json({ ok: true, state });
});

// reinicia todo para el día siguiente (mantiene o limpia la lista según se pida)
app.post('/api/admin/reset', requireAdmin, (req, res) => {
  const { keepUsers } = req.body || {};
  state.claims = {};
  state.started = false;
  state.today.results = {};
  if (!keepUsers) state.users = [];
  saveState();
  broadcast();
  res.json({ ok: true, state });
});

// carga (o reemplaza) los nombres que entran a la ruleta de premios — máx 40
app.post('/api/admin/wheel/names', requireAdmin, (req, res) => {
  const { names } = req.body;
  if (!Array.isArray(names)) return res.status(400).json({ error: 'Se espera { names: string[] }' });
  const clean = [...new Set(names.map(n => String(n).trim()).filter(Boolean))].slice(0, 40);
  if (!clean.length) return res.status(400).json({ error: 'La lista no puede estar vacía.' });
  state.wheel = { names: clean, spinId: 0, winnerIndex: null };
  saveState();
  broadcast();
  res.json({ ok: true, state });
});

// gira la ruleta: el servidor decide el ganador al azar y se transmite a todos
// los conectados, así todos ven la misma animación cayendo en el mismo resultado
app.post('/api/admin/wheel/spin', requireAdmin, (req, res) => {
  if (!state.wheel.names.length) return res.status(400).json({ error: 'Primero carga los nombres de la ruleta.' });
  state.wheel.winnerIndex = Math.floor(Math.random() * state.wheel.names.length);
  state.wheel.spinId += 1;
  saveState();
  broadcast();
  res.json({ ok: true, state });
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  console.log(`Panel admin: http://localhost:${PORT}/admin.html`);
  console.log(`ADMIN_KEY actual: ${ADMIN_KEY}  (cámbiala con la variable de entorno ADMIN_KEY)`);
});
