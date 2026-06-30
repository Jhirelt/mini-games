// admin.js — lógica del panel de administración

let adminKey = sessionStorage.getItem('rifa_admin_key') || '';

// debe coincidir exactamente con los ids/nombres definidos en juego.html
const GAMES = [
  { id: 'reflejos', name: 'Reflejos', lowerIsBetter: true },
  { id: 'memoria', name: 'Memoria', lowerIsBetter: true },
  { id: 'serpiente', name: 'Serpiente' },
  { id: 'apilar', name: 'Apilar Tiles' },
  { id: 'centro', name: 'Centro' },
  { id: 'doodle', name: 'Doodle Jump' },
  { id: 'naves', name: 'Naves Espaciales' },
  { id: 'zigzag', name: 'Zigzag' },
];
const todayGameSelect = document.getElementById('todayGameSelect');
GAMES.forEach(g => {
  const opt = document.createElement('option');
  opt.value = g.id; opt.textContent = g.name;
  todayGameSelect.appendChild(opt);
});

const screenLogin = document.getElementById('screenLogin');
const screenAdmin = document.getElementById('screenAdmin');

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

async function tryLogin() {
  try {
    const data = await apiGet('/api/admin/state');
    sessionStorage.setItem('rifa_admin_key', adminKey);
    screenLogin.classList.add('hidden');
    screenAdmin.classList.remove('hidden');
    renderState(data);
    startPolling();
  } catch (e) {
    document.getElementById('loginMsg').textContent = 'Llave incorrecta o servidor no disponible.';
  }
}

document.getElementById('loginBtn').addEventListener('click', () => {
  adminKey = document.getElementById('adminKey').value.trim();
  tryLogin();
});

// si ya había una llave guardada en esta pestaña, entra directo
if (adminKey) tryLogin();

document.getElementById('saveNamesBtn').addEventListener('click', async () => {
  const raw = document.getElementById('namesInput').value;
  const names = raw.split('\n').map(s => s.trim()).filter(Boolean);
  if (!names.length) { alert('Escribe al menos un nombre.'); return; }
  if (!confirm(`Esto reemplaza la lista con ${names.length} nombre(s) y borra los reclamos del día. ¿Continuar?`)) return;
  const data = await apiPost('/api/admin/users', { names });
  renderState(data.state);
});

document.getElementById('saveWheelBtn').addEventListener('click', async () => {
  const raw = document.getElementById('wheelNamesInput').value;
  const names = raw.split('\n').map(s => s.trim()).filter(Boolean);
  if (!names.length) { alert('Escribe al menos un nombre.'); return; }
  if (names.length > 40) { alert('Máximo 40 nombres en la ruleta.'); return; }
  try {
    await apiPost('/api/admin/wheel/names', { names });
    document.getElementById('wheelMsg').textContent = `Ruleta cargada con ${names.length} nombre(s).`;
  } catch (e) {
    document.getElementById('wheelMsg').textContent = 'Error: ' + e.message;
  }
});

document.getElementById('spinBtn').addEventListener('click', async () => {
  if (!confirm('¿Girar la ruleta de premios ahora? El resultado se transmite a todos los que tengan la pantalla abierta.')) return;
  try {
    await apiPost('/api/admin/wheel/spin');
    document.getElementById('wheelMsg').textContent = 'Ruleta girando — revisa la pantalla en /ruleta.html';
  } catch (e) {
    document.getElementById('wheelMsg').textContent = 'Error: ' + e.message;
  }
});

document.getElementById('openTestBtn').addEventListener('click', ()=>{
  window.open(`juego.html?admin=${encodeURIComponent(adminKey)}`, '_blank');
});

document.getElementById('setTodayBtn').addEventListener('click', async () => {
  const gameId = todayGameSelect.value;
  const g = GAMES.find(x => x.id === gameId);
  if (!confirm(`¿Fijar "${g.name}" como el reto de hoy? Esto borra los intentos/puntajes registrados hasta ahora.`)) return;
  try {
    const data = await apiPost('/api/admin/today', { gameId });
    document.getElementById('todayMsg').textContent = `Reto de hoy: ${g.name}`;
    renderState(data.state);
  } catch (e) {
    document.getElementById('todayMsg').textContent = 'Error: ' + e.message;
  }
});

document.getElementById('startBtn').addEventListener('click', async () => {
  if (!confirm('¿Iniciar el juego para todos los conectados ahora?')) return;
  const data = await apiPost('/api/admin/start');
  renderState(data.state);
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('Esto borra todos los reclamos de hoy (la lista de nombres se mantiene). ¿Continuar?')) return;
  const data = await apiPost('/api/admin/reset', { keepUsers: true });
  renderState(data.state);
});

function renderState(state) {
  const namesInput = document.getElementById('namesInput');
  const wheelInput = document.getElementById('wheelNamesInput');

  // nunca se sobreescribe un campo mientras el admin lo tiene enfocado (lo está
  // editando ahora mismo) — si no, el polling cada 2.5s borraba lo que escribías
  if (document.activeElement !== namesInput) {
    namesInput.value = state.users.join('\n');
  }
  if (state.wheel && document.activeElement !== wheelInput && wheelInput.value === '') {
    wheelInput.value = state.wheel.names.join('\n');
  }

  if (state.today && state.today.gameId && document.activeElement !== todayGameSelect) {
    todayGameSelect.value = state.today.gameId;
  }

  document.getElementById('startBtn').textContent = state.started ? '✔ Juego ya iniciado' : '▶ Iniciar juego para todos';
  document.getElementById('startBtn').disabled = state.started;

  const tbody = document.getElementById('statusTable');
  tbody.innerHTML = '';
  state.users.forEach(name => {
    const claimed = !!state.claims[name];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${name}</td>
      <td class="${claimed ? 'tag-ok' : 'tag-pending'}">${claimed ? 'Conectado' : 'Esperando…'}</td>
      <td>${claimed ? `<button data-name="${name}" class="ghost-btn release-btn">Liberar</button>` : ''}</td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('.release-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`¿Liberar a "${btn.dataset.name}"? Podrá volver a seleccionar usuario, pero conserva sus puntajes ya registrados.`)) return;
      await apiPost(`/api/admin/release/${encodeURIComponent(btn.dataset.name)}`);
      const data = await apiGet('/api/admin/state');
      renderState(data);
    });
  });

  renderLeaderboard(state);
}

function renderLeaderboard(state) {
  const lb = (state.today && state.today.leaderboard) || [];
  const gameId = state.today ? state.today.gameId : null;
  const g = GAMES.find(x => x.id === gameId);
  const tbody = document.getElementById('leaderboardTable');
  tbody.innerHTML = '';
  if (!lb.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">Todavía nadie ha intentado el reto de hoy.</td></tr>';
    return;
  }
  lb.forEach((entry, i) => {
    const tr = document.createElement('tr');
    const scoreLabel = g && g.lowerIsBetter ? `${entry.best} ms` : entry.best;
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${entry.name}</td>
      <td class="tag-ok">${scoreLabel}</td>
      <td>${entry.attempts}/2</td>
      <td><button data-name="${entry.name}" class="ghost-btn today-release-btn" style="font-size:11px;padding:4px 10px;">Reiniciar intentos</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('.today-release-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`¿Borrar los intentos de hoy de "${btn.dataset.name}"? Podrá volver a jugar sus 2 intentos.`)) return;
      await apiPost(`/api/admin/today/release/${encodeURIComponent(btn.dataset.name)}`);
      const data = await apiGet('/api/admin/state');
      renderState(data);
    });
  });
}

function startPolling() {
  setInterval(async () => {
    try {
      const data = await apiGet('/api/admin/state');
      renderState(data);
    } catch (e) { /* el servidor puede estar reiniciando, se reintenta solo */ }
  }, 2500);
}
