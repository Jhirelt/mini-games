// ruleta.js — ruleta de premios sincronizada en vivo entre todos los conectados.
// El servidor decide el ganador (state.wheel.winnerIndex) y todos los navegadores
// animan hacia el mismo resultado al mismo tiempo, usando state.wheel.spinId
// como disparador (cada giro nuevo trae un spinId distinto).

const socket = io();

const stage = document.getElementById('stage');
const emptyMsg = document.getElementById('emptyMsg');
const svg = document.getElementById('wheelSvg');
const statusText = document.getElementById('statusText');
const winnerText = document.getElementById('winnerText');

let lastSpinId = 0;
let currentNames = [];
let totalSpins = 0; // vueltas completas acumuladas, para que cada giro se sienta continuo

function polar(cx, cy, r, angleDeg) {
  const rad = (Math.PI / 180) * angleDeg;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function colorFor(i, n) {
  const hue = Math.round((360 / n) * i);
  return `hsl(${hue}, 82%, 56%)`;
}

function renderWheel(names) {
  currentNames = names;
  const n = names.length;
  svg.innerHTML = '';
  if (!n) return;
  const seg = 360 / n;
  const cx = 100, cy = 100, r = 100;

  for (let i = 0; i < n; i++) {
    const a0 = i * seg, a1 = (i + 1) * seg;
    const p0 = polar(cx, cy, r, a0);
    const p1 = polar(cx, cy, r, a1);
    const largeArc = seg > 180 ? 1 : 0;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${cx},${cy} L${p0.x},${p0.y} A${r},${r} 0 ${largeArc} 1 ${p1.x},${p1.y} Z`);
    path.setAttribute('fill', colorFor(i, n));
    path.setAttribute('stroke', 'rgba(0,0,0,.25)');
    path.setAttribute('stroke-width', '0.6');
    svg.appendChild(path);

    // etiqueta con el nombre, orientada radialmente hacia afuera
    const mid = a0 + seg / 2;
    const labelR = r * 0.62;
    const lp = polar(cx, cy, labelR, mid);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', lp.x);
    text.setAttribute('y', lp.y);
    text.setAttribute('font-size', n > 24 ? '4.2' : n > 14 ? '5.2' : '6.5');
    text.setAttribute('fill', '#10131a');
    text.setAttribute('font-weight', '700');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('transform', `rotate(${mid}, ${lp.x}, ${lp.y})`);
    text.textContent = names[i];
    svg.appendChild(text);
  }
}

function spinTo(winnerIndex, n) {
  const seg = 360 / n;
  const winnerCenter = winnerIndex * seg + seg / 2;
  totalSpins += 6; // vueltas extra para que se sienta como giro real
  const rotation = totalSpins * 360 - winnerCenter;
  svg.style.transform = `rotate(${rotation}deg)`;
}

socket.on('state', (s) => {
  const wheel = s.wheel || { names: [], spinId: 0, winnerIndex: null };

  if (!wheel.names.length) {
    stage.classList.add('hidden');
    emptyMsg.classList.remove('hidden');
    statusText.textContent = '';
    winnerText.textContent = '';
    return;
  }

  emptyMsg.classList.add('hidden');
  stage.classList.remove('hidden');

  // si la lista de nombres cambió de tamaño/contenido, hay que redibujar la ruleta
  const sameNames = wheel.names.length === currentNames.length &&
    wheel.names.every((nm, i) => nm === currentNames[i]);
  if (!sameNames) {
    renderWheel(wheel.names);
    svg.style.transition = 'none';
    svg.style.transform = 'rotate(0deg)';
    totalSpins = 0;
  }

  if (wheel.spinId > lastSpinId) {
    lastSpinId = wheel.spinId;
    winnerText.textContent = '';
    statusText.textContent = 'Girando…';
    svg.style.transition = 'transform 4.5s cubic-bezier(.12,.8,.1,1)';
    spinTo(wheel.winnerIndex, wheel.names.length);
    setTimeout(() => {
      statusText.textContent = '¡Tenemos ganador!';
      winnerText.textContent = '🎉 ' + wheel.names[wheel.winnerIndex];
    }, 4600);
  } else if (wheel.spinId === 0) {
    statusText.textContent = 'Esperando a que el administrador gire la ruleta…';
  }
});
