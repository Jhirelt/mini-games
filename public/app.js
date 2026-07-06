const PLAY_URL = 'juego.html';

function getSession() {
  let id = localStorage.getItem('rifa_session_id');
  if (!id) { id = 'sess_' + Math.random().toString(36).slice(2) + Date.now(); localStorage.setItem('rifa_session_id', id); }
  return id;
}
const sessionId = getSession();
let myName = localStorage.getItem('rifa_my_name') || null;
const socket = io();

const $ = id => document.getElementById(id);
const screens = ['screenJoin','screenWaiting','screenStarted'];
function show(id){ screens.forEach(s=>$(s).classList.add('hidden')); $(id).classList.remove('hidden'); }

const LOWER = new Set(['reflejos','memoria']);
function best(results,gameId){ if(!results.length) return null; const v=results.map(r=>r.score); return LOWER.has(gameId)?Math.min(...v):Math.max(...v); }
function fmt(score,gameId){ if(score==null) return '—'; if(LOWER.has(gameId)) return score+' ms'; if(['naves','zigzag','memoria'].includes(gameId)) return score+'s'; if(gameId==='centro') return score+'%'; return String(score); }

socket.on('state', s => {
  const stillMine = myName && (s.takenNames.includes(myName) || (s.claims && s.claims[myName]));

  if (s.started && stillMine) {
    const results  = (s.today?.results?.[myName]) || [];
    const used     = results.length;
    const gameId   = s.today?.gameId;
    $('meName2').textContent = myName;
    const link  = $('playLink');
    const info  = $('attemptsInfo');
    const title = $('startedTitle');
    if (used >= 2) {
      title.textContent = 'Ya jugaste hoy';
      const b = best(results,gameId);
      info.textContent = b!==null ? `Mejor puntaje: ${fmt(b,gameId)}` : 'Sin puntaje registrado.';
      link.style.display = 'none';
    } else {
      title.textContent = 'El juego comenzó';
      info.textContent = used===0 ? '2 intentos disponibles.' : `Intento ${used}/2 usado. Te queda 1.`;
      link.style.display = '';
      link.href = `${PLAY_URL}?name=${encodeURIComponent(myName)}&session=${encodeURIComponent(sessionId)}`;
    }
    renderBoard(s.today, gameId);
    show('screenStarted');
    return;
  }

  if (stillMine && !s.started) {
    $('meName').textContent = myName;
    show('screenWaiting');
    return;
  }

  // Si la sesión ya no está reclamada (admin la liberó), limpiar
  if (myName && !stillMine) {
    myName = null;
    localStorage.removeItem('rifa_my_name');
  }

  // pantalla de selección
  const hasList = s.users && s.users.length > 0;
  $('joinTitle').textContent = hasList ? '¿Quién eres?' : '¿Cómo te llamas?';
  $('joinSub').textContent   = hasList ? 'Elige tu nombre o escríbelo.' : 'Ingresa tu nombre para participar.';
  renderList(s.users||[], s.takenNames||[]);
  show('screenJoin');
});

function renderList(users, taken) {
  const list = $('userList');
  if (!users.length) { list.innerHTML = ''; return; }
  list.innerHTML = users.map(name => {
    const t = taken.includes(name);
    return `<div class="user-chip${t?' taken':''}" data-name="${name}">${name}</div>`;
  }).join('');
  list.querySelectorAll('.user-chip:not(.taken)').forEach(chip => {
    chip.addEventListener('click', () => { $('nameInput').value = chip.dataset.name; doClaim(); });
  });
}

function doClaim() {
  const name = $('nameInput').value.trim();
  if (!name) { $('joinMsg').textContent = 'Escribe tu nombre primero.'; return; }
  $('joinMsg').textContent = '';
  socket.emit('claim', { name, sessionId });
}

$('claimBtn').addEventListener('click', doClaim);
$('nameInput').addEventListener('keydown', e => { if(e.key==='Enter') doClaim(); });

socket.on('claimResult', ({ ok, name, reason }) => {
  if (ok) { myName = name; localStorage.setItem('rifa_my_name', name); $('joinMsg').textContent = ''; }
  else    { $('joinMsg').textContent = reason; }
});

function renderBoard(today, gameId) {
  const body = $('leaderboardBody'); if (!body) return;
  const lb = today?.leaderboard || [];
  if (!lb.length) { body.innerHTML = '<div class="empty">Nadie ha jugado todavía.</div>'; return; }
  const low = LOWER.has(gameId);
  body.innerHTML = `<table><thead><tr><th>#</th><th>Jugador</th><th>Puntaje</th><th>Intentos</th></tr></thead><tbody>
    ${lb.map((e,i) => `<tr class="${e.name===myName?'me-row':''}">
      <td>${i+1}</td><td>${e.name===myName?'Tú':e.name}</td>
      <td>${fmt(e.best,gameId)}</td><td>${e.attempts}/2</td>
    </tr>`).join('')}
  </tbody></table>`;
}
