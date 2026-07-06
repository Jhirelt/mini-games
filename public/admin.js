// admin.js — panel de administración con resultados en vivo via Socket.io

const GAMES = [
  { id: 'reflejos',  name: 'Reflejos',      lowerIsBetter: true,  unit: 'ms'  },
  { id: 'memoria',   name: 'Memoria',       lowerIsBetter: true,  unit: 's'   },
  { id: 'serpiente', name: 'Serpiente',     lowerIsBetter: false, unit: ''    },
  { id: 'apilar',    name: 'Apilar Tiles',  lowerIsBetter: false, unit: ''    },
  { id: 'centro',    name: 'Centro',        lowerIsBetter: false, unit: '%'   },
  { id: 'doodle',    name: 'Doodle Jump',   lowerIsBetter: false, unit: ''    },
  { id: 'naves',     name: 'Naves',         lowerIsBetter: false, unit: 's'   },
  { id: 'zigzag',    name: 'Zigzag',        lowerIsBetter: false, unit: 's'   },
];

let adminKey = sessionStorage.getItem('rifa_admin_key') || '';
let socket = null;
let lastState = null;

// ── DOM refs ──
const screenLogin = document.getElementById('screenLogin');
const screenAdmin = document.getElementById('screenAdmin');
const todayGameSelect = document.getElementById('todayGameSelect');
GAMES.forEach(g => {
  const opt = document.createElement('option');
  opt.value = g.id; opt.textContent = g.name;
  todayGameSelect.appendChild(opt);
});

// ── API helpers ──
async function apiGet(path) {
  const res = await fetch(path + '?key=' + encodeURIComponent(adminKey));
  if (!res.ok) throw new Error((await res.json()).error || 'Error');
  return res.json();
}
async function apiPost(path, body) {
  const res = await fetch(path + '?key=' + encodeURIComponent(adminKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Error');
  return res.json();
}

// ── Login ──
async function tryLogin() {
  try {
    const data = await apiGet('/api/admin/state');
    sessionStorage.setItem('rifa_admin_key', adminKey);
    screenLogin.classList.add('hidden');
    screenAdmin.classList.remove('hidden');
    renderState(data);
    connectSocket();
  } catch {
    document.getElementById('loginMsg').textContent = 'Llave incorrecta o servidor no disponible.';
  }
}
document.getElementById('loginBtn').addEventListener('click', () => {
  adminKey = document.getElementById('adminKey').value.trim();
  tryLogin();
});
document.getElementById('adminKey').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('loginBtn').click(); });
if (adminKey) tryLogin();

// ── Socket para resultados en vivo ──
function connectSocket() {
  socket = io();
  socket.on('state', s => {
    lastState = s;
    renderState(s);
    document.getElementById('liveIndicator').style.display = 'flex';
    document.getElementById('liveIndicator').style.alignItems = 'center';
    document.getElementById('liveIndicator').style.gap = '8px';
  });
}

// ── Formateo de puntaje con décimas si aplica ──
function formatScore(score, game) {
  if (score == null) return '—';
  if (!game) return String(score);
  // juegos que se miden en segundos: mostrar con décima
  if (game.unit === 's' || game.id === 'naves' || game.id === 'zigzag') {
    return score.toFixed(1) + 's';
  }
  if (game.unit === 'ms') return score + ' ms';
  if (game.unit === '%') return score.toFixed(2) + '%';
  return String(score);
}

// ── Render principal ──
function renderState(state) {
  // no pisamos campos que el usuario está editando
  const namesInput = document.getElementById('namesInput');
  const wheelInput = document.getElementById('wheelNamesInput');
  if (document.activeElement !== namesInput) namesInput.value = state.users.join('\n');
  if (state.wheel && document.activeElement !== wheelInput && !wheelInput.value)
    wheelInput.value = state.wheel.names.join('\n');
  if (state.today?.gameId && document.activeElement !== todayGameSelect)
    todayGameSelect.value = state.today.gameId;

  // estado del botón de inicio
  const startBtn = document.getElementById('startBtn');
  startBtn.textContent = state.started ? '✔ Juego iniciado' : 'Iniciar juego para todos';
  startBtn.disabled = state.started;

  // label del reto de hoy
  const g = GAMES.find(x => x.id === state.today?.gameId);
  document.getElementById('liveGameLabel').textContent =
    g ? `Reto de hoy: ${g.name}` : 'Reto de hoy: no definido';

  renderConnectedGrid(state);
  renderLiveResults(state);
}

// ── Grid de conexión: quién está conectado y quién no ──
function renderConnectedGrid(state) {
  const grid = document.getElementById('connectedGrid');
  const total = state.users.length;
  const connected = state.users.filter(n => state.claims[n]).length;
  document.getElementById('connectedInfo').textContent =
    total ? ` ${connected}/${total} conectados` : '';

  if (!total) {
    grid.innerHTML = '<p class="muted">No hay usuarios cargados.</p>';
    return;
  }

  const results = state.today?.results || {};
  const g = GAMES.find(x => x.id === state.today?.gameId);

  grid.innerHTML = state.users.map(name => {
    const claimed = !!state.claims[name];
    const attempts = results[name] || [];
    const best = attempts.length
      ? (g?.lowerIsBetter
          ? Math.min(...attempts.map(a => a.score))
          : Math.max(...attempts.map(a => a.score)))
      : null;
    const scoreStr = best !== null ? formatScore(best, g) : (claimed ? 'jugando...' : '—');
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:9px 12px;background:var(--surface-2);border-radius:8px;
                  margin-bottom:6px;border:1px solid var(--border);">
        <span>
          <span class="status-dot ${claimed ? 'dot-green' : 'dot-gray'}"></span>
          <b style="font-size:14px;">${name}</b>
        </span>
        <span style="display:flex;align-items:center;gap:12px;">
          <span style="font-family:monospace;font-size:13px;color:var(--accent);">${scoreStr}</span>
          <span style="color:var(--muted);font-size:11px;">${attempts.length}/2</span>
          ${claimed
            ? `<button class="ghost-btn release-btn" data-name="${name}"
                 style="padding:3px 9px;font-size:11px;">Liberar</button>`
            : ''}
        </span>
      </div>`;
  }).join('');

  grid.querySelectorAll('.release-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`¿Liberar a "${btn.dataset.name}"?`)) return;
      await apiPost(`/api/admin/release/${encodeURIComponent(btn.dataset.name)}`);
    });
  });
}

// ── Tabla de resultados en vivo (ranking) ──
function renderLiveResults(state) {
  const lb = state.today?.leaderboard || [];
  const g = GAMES.find(x => x.id === state.today?.gameId);
  const grid = document.getElementById('liveResultsGrid');

  if (!lb.length) {
    grid.innerHTML = '<p class="muted" style="font-size:13px;">Nadie ha jugado todavía.</p>';
    return;
  }

  grid.innerHTML = lb.map((entry, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const scoreStr = formatScore(entry.best, g);
    const rankClass = i < 3 ? `rank-${i + 1}` : '';
    return `
      <div class="attempt-row ${rankClass}">
        <span style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:18px;width:28px;text-align:center;">${medal}</span>
          <span class="name">${entry.name}</span>
        </span>
        <span style="display:flex;align-items:center;gap:14px;">
          <span class="score-big">${scoreStr}</span>
          <span class="attempts">${entry.attempts}/2 intentos</span>
          <button class="ghost-btn today-release-btn" data-name="${entry.name}"
                  style="padding:3px 9px;font-size:11px;">Reset</button>
        </span>
      </div>`;
  }).join('');

  grid.querySelectorAll('.today-release-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`¿Borrar intentos de "${btn.dataset.name}"?`)) return;
      await apiPost(`/api/admin/today/release/${encodeURIComponent(btn.dataset.name)}`);
    });
  });
}

// ── Botones de acción ──
document.getElementById('saveNamesBtn').addEventListener('click', async () => {
  const names = document.getElementById('namesInput').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!names.length) { alert('Escribe al menos un nombre.'); return; }
  if (!confirm(`Guardar lista con ${names.length} nombre(s) y reiniciar reclamos del día?`)) return;
  const data = await apiPost('/api/admin/users', { names });
  renderState(data.state);
});

document.getElementById('setTodayBtn').addEventListener('click', async () => {
  const gameId = todayGameSelect.value;
  const g = GAMES.find(x => x.id === gameId);
  if (!confirm(`Fijar "${g.name}" como reto de hoy? Borra los intentos actuales.`)) return;
  try {
    const data = await apiPost('/api/admin/today', { gameId });
    document.getElementById('todayMsg').textContent = `Reto fijado: ${g.name}`;
    renderState(data.state);
  } catch (e) {
    document.getElementById('todayMsg').textContent = 'Error: ' + e.message;
  }
});

document.getElementById('startBtn').addEventListener('click', async () => {
  if (!confirm('¿Iniciar el juego para todos?')) return;
  const data = await apiPost('/api/admin/start');
  renderState(data.state);
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('¿Reiniciar el día? Los reclamos se borran, la lista de nombres se mantiene.')) return;
  const data = await apiPost('/api/admin/reset', { keepUsers: true });
  renderState(data.state);
});

document.getElementById('saveWheelBtn').addEventListener('click', async () => {
  const names = document.getElementById('wheelNamesInput').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!names.length) { alert('Escribe al menos un nombre.'); return; }
  if (names.length > 40) { alert('Máximo 40 nombres.'); return; }
  try {
    await apiPost('/api/admin/wheel/names', { names });
    document.getElementById('wheelMsg').textContent = `Ruleta cargada: ${names.length} nombre(s).`;
  } catch (e) {
    document.getElementById('wheelMsg').textContent = 'Error: ' + e.message;
  }
});

document.getElementById('spinBtn').addEventListener('click', async () => {
  if (!confirm('¿Girar la ruleta ahora?')) return;
  try {
    await apiPost('/api/admin/wheel/spin');
    document.getElementById('wheelMsg').textContent = 'Girando — revisa la pantalla de ruleta.';
  } catch (e) {
    document.getElementById('wheelMsg').textContent = 'Error: ' + e.message;
  }
});

document.getElementById('openTestBtn').addEventListener('click', () => {
  window.open(`juego.html?admin=${encodeURIComponent(adminKey)}`, '_blank');
});
