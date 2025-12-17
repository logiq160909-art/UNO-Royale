window.addEventListener('load', () => {
    const socket = io();
    let currentRoomId = null, pendingIdx = null;

    // Вход (упрощенная авторизация для примера)
    document.getElementById('auth-btn').onclick = () => {
        const name = document.getElementById('email').value.split('@')[0] || 'Игрок';
        document.getElementById('u-name').innerText = name;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('lobby-screen').classList.remove('hidden');
    };

    socket.on('roomsList', list => {
        document.getElementById('rooms-list').innerHTML = list.map(r => `
            <div style="display:flex; justify-content:space-between; padding:10px; background:rgba(255,255,255,0.05); margin-bottom:5px; border-radius:10px;">
                <span>${r.name} (${r.players}/4)</span>
                <button class="ios-btn small primary" onclick="join('${r.id}')">Войти</button>
            </div>`).join('');
    });

    window.join = (id) => socket.emit('joinRoom', { roomId: id, username: document.getElementById('u-name').innerText });
    window.openModal = () => socket.emit('createRoom', { name: 'Мой стол' });

    socket.on('joinSuccess', id => {
        currentRoomId = id;
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
    });

    socket.on('updateState', state => {
        const isMyTurn = state.opponents[state.turnIndex].id === socket.id;
        document.getElementById('turn-txt').innerText = isMyTurn ? "ТВОЙ ХОД" : `Ходит: ${state.opponents[state.turnIndex].name}`;
        document.getElementById('color-dot').style.background = getColor(state.currentColor);
        
        if (state.topCard) {
            document.getElementById('pile').innerHTML = `<div class="card ${state.topCard.color}"><span>${state.topCard.value}</span></div>`;
        }

        // Противники (Видим кол-во карт)
        document.getElementById('opponents').innerHTML = state.opponents
            .filter(p => p.id !== socket.id)
            .map(p => `<div class="opp-pill"><b>${p.name}</b><br>Карты: ${p.handSize}</div>`).join('');

        // Своя рука
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

    document.getElementById('draw-btn').onclick = () => socket.emit('drawCard', currentRoomId);
    document.getElementById('bot-btn').onclick = () => socket.emit('addBot', currentRoomId);
    
    socket.on('gameOver', d => { alert("Победил: " + d.winner); location.reload(); });
    function getColor(n) { return {red:'#ff5e62', blue:'#00c6ff', green:'#56ab2f', yellow:'#f09819'}[n] || '#fff'; }
});