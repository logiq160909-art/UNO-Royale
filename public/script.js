const socket = io();
let currentRoomId = null, pendingIdx = null;

document.getElementById('start-btn').onclick = () => {
    const name = document.getElementById('username').value || 'Игрок';
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    socket.emit('createRoom', { name: "Стол " + name });
};

socket.on('roomCreated', id => {
    currentRoomId = id;
    socket.emit('joinRoom', { roomId: id, username: document.getElementById('username').value });
});

socket.on('updateState', state => {
    const isMyTurn = state.opponents[state.turnIndex].id === socket.id;
    document.getElementById('turn-txt').innerText = isMyTurn ? "ВАШ ХОД" : `Ходит: ${state.opponents[state.turnIndex].name}`;
    document.getElementById('color-dot').style.background = state.currentColor;
    
    if (state.topCard) {
        document.getElementById('pile').innerHTML = `<div class="card ${state.topCard.color}"><span>${state.topCard.value}</span></div>`;
    }

    document.getElementById('opponents').innerHTML = state.opponents
        .filter(p => p.id !== socket.id)
        .map(p => `<div class="opp-pill"><b>${p.name}</b><br>Карты: ${p.handSize}</div>`).join('');

    document.getElementById('hand').innerHTML = state.myHand.map((c, i) => 
        `<div class="card ${c.color}" onclick="useCard(${i}, '${c.color}')"><span>${c.value}</span></div>`).join('');
});

window.useCard = (i, color) => {
    if (color === 'wild') {
        pendingIdx = i;
        document.getElementById('modal-color').classList.remove('hidden');
    } else {
        socket.emit('playCard', { roomId: currentRoomId, cardIndex: i });
    }
};

window.pickColor = (c) => {
    socket.emit('playCard', { roomId: currentRoomId, cardIndex: pendingIdx, chosenColor: c });
    document.getElementById('modal-color').classList.add('hidden');
};

socket.on('gameOver', d => { alert("Победил: " + d.winner); location.reload(); });