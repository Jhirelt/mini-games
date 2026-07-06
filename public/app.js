// app.js — lógica de la página del empleado

const PLAY_URL = 'juego.html';

function getSessionId() {
  let id = localStorage.getItem('rifa_session_id');
  if (!id) {
    id = 'sess_' + Math.random().toString(36).slice(2) + Date.now();
    localStorage.setItem('rifa_session_id', id);
  }
  return id;
}
const sessionId = getSessionId();
let myName = localStorage.getItem('rifa_my_name') || null;

const socket = io();

const screenJoin    = document.getElementById('screenJoin');
const screenWaiting = document.getElementById('screenWaiting');
const screenStarted = document.getElementById('screenStarted');
const userGrid      = document.getElementById('userGrid');
const joinMsg       = document.getElementById('joinMsg');

function showScreen(id) {
  [screenJoin, screenWaiting, screenStarted].forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

socket.on('state', (s) => {
  const stillMine = myName && s.takenNames.includes(myName);

  if (s.started && stillMine) {
    const results  = (s.today && s.today.results && s.today.results[myName]) || [];
    const attemptsUsed = results.length;
    const gameId   = s.today ? s.today.gameId : null;

    document.getElementById('meName2').textContent = myName;

    const link  = document.getElementById('playLink');
    const info  = document.getElementById('attemptsInfo');
    const title = document.getElementById('startedTitle');

    if (attemptsUsed >= 2) {
      const best = bestOf(results, gameId);
      title.textContent = '✅ Ya jugaste hoy';
      info.textContent  = `Usaste tus 2 intentos. Tu mejor puntaje: ${formatScore(best, gameId)}`;
      link.style.display = 'none';
    } else {
      title.textContent = '🎮 El juego ya comenzó';
      info.textContent  = attemptsUsed === 0
        ? 'Tienes 2 intentos disponibles.'
        : `Llevas ${attemptsUsed}/2 intentos. Te queda ${2 - attemptsUsed}.`;
      link.style.display = '';
      link.href = `${PLAY_URL}?name=${encodeURIComponent(myName)}&session=${encodeURIComponent(sessionId)}`;
    }
    renderLiveLeaderboard(s.today, gameId);
    showScreen('screenStarted');
    return;
  }

  if (stillMine) {
    document.getElementById('meName').textContent = myName;
    showScreen('screenWaiting');
    return;
  }

  myName = null;
  localStorage.removeItem('rifa_my_name');
  renderGrid(s.users, s.takenNames);
  showScreen('screenJoin');
});

const LOWER_IS_BETTER = new Set(['reflejos', 'memoria']);
function bestOf(results, gameId) {
  if (!results.length) return null;
  const vals = results.map(r => r.score);
  return LOWER_IS_BETTER.has(gameId) ? Math.min(...vals) : Math.max(...vals);
}
function formatScore(score, gameId) {
  if (score == null) return '—';
  return LOWER_IS_BETTER.has(gameId) ? `${score} ms` : `${score}`;
}

function renderGrid(users, taken) {
  userGrid.innerHTML = '';
  if (!users.length) {
    userGrid.innerHTML = '<p class="muted" style="grid-column:1/-1;">El administrador todavía no ha cargado la lista de hoy.</p>';
    return;
  }
  users.forEach(name => {
    const isTaken = taken.includes(name);
    const pill = document.createElement('div');
    pill.className = 'user-pill' + (isTaken ? ' taken' : '');
    pill.textContent = name;
    if (!isTaken) {
      pill.addEventListener('click', () => socket.emit('claim', { name, sessionId }));
    }
    userGrid.appendChild(pill);
  });
}

socket.on('claimResult', ({ ok, name, reason }) => {
  if (ok) {
    myName = name;
    localStorage.setItem('rifa_my_name', name);
    joinMsg.textContent = '';
  } else {
    joinMsg.textContent = reason;
  }
});

function renderLiveLeaderboard(today, gameId) {
  const body = document.getElementById('leaderboardBody');
  if (!body) return;
  const lb = (today && today.leaderboard) || [];
  if (!lb.length) {
    body.innerHTML = '<div class="empty">Todavía nadie ha intentado el reto de hoy.</div>';
    return;
  }
  const lowerBetter = LOWER_IS_BETTER.has(gameId);
  body.innerHTML = `
    <table>
      <thead><tr><th>#</th><th>Jugador</th><th>Mejor puntaje</th><th>Intentos</th></tr></thead>
      <tbody>
        ${lb.map((e, i) => `
          <tr class="${e.name === myName ? 'me-row' : ''}">
            <td>${i + 1}</td>
            <td>${e.name === myName ? 'Tú' : e.name}</td>
            <td>${e.best}${lowerBetter ? ' ms' : ''}</td>
            <td>${e.attempts}/2</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
