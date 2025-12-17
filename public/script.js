window.addEventListener('load', async () => {
    const supabaseUrl = 'https://wfjpudyikqphplxhovfm.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmanB1ZHlpa3FwaHBseGhvdmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc2NzEsImV4cCI6MjA4MTQ4MzY3MX0.AKgEfuvOYDQPlTf0NoOt5NDeldkSTH_XyFSH9EOIHmk';
    const lib = window.supabase || window.supabasejs;
    const supabase = lib.createClient(supabaseUrl, supabaseKey);
    const socket = io();

    let currentUser = null, activeRoomId = null, pendingCardIndex = null;

    const { data: { session } } = await supabase.auth.getSession();
    if (session) showLobby(session.user);

    async function showLobby(user) {
        currentUser = user;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('lobby-screen').classList.remove('hidden');
        const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        if (p) {
            document.getElementById('prof-name').innerText = p.username;
            document.getElementById('xp-fill').style.width = (p.xp % 100) + "%";
        }
    }

    document.getElementById('auth-btn').onclick = async () => {
        const email = document.getElementById('email').value, pass = document.getElementById('password').value;
        const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (!error) showLobby(data.user);
    };

    document.getElementById('confirm-create').onclick = () => {
        socket.emit('createRoom', { name: document.getElementById('room-name').value, password: document.getElementById('room-pass').value });
        document.getElementById('modal-create').classList.add('hidden');
    };

    socket.on('roomCreated', id => joinRoom(id, false));

    window.joinRoom = (id, isPrivate) => {
        activeRoomId = id;
        socket.emit('joinRoom', { roomId: id, password: isPrivate ? prompt('Пароль') : null, username: currentUser.email.split('@')[0] });
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
    };

    socket.on('updateState', state => {
        const me = state.players.find(p => p.id === socket.id);
        if (!me) return;

        document.getElementById('turn-txt').innerText = state.players[state.turnIndex].id === socket.id ? "ТВОЙ ХОД" : "ЖДИ";
        document.getElementById('color-dot').style.backgroundColor = `var(--${state.currentColor})`;
        
        document.getElementById('discard-pile').innerHTML = `<div class="card ${state.topCard.color}"><span>${state.topCard.value}</span></div>`;
        
        document.getElementById('player-hand').innerHTML = me.hand.map((c, i) => 
            `<div class="card ${c.color}" onclick="handleCardClick(${i}, '${c.color}')"><span>${c.value}</span></div>`
        ).join('');
    });

    window.handleCardClick = (index, color) => {
        if (color === 'wild') {
            pendingCardIndex = index;
            document.getElementById('color-picker').classList.remove('hidden');
        } else {
            socket.emit('playCard', { roomId: activeRoomId, cardIndex: index });
        }
    };

    window.selectColor = (color) => {
        socket.emit('playCard', { roomId: activeRoomId, cardIndex: pendingCardIndex, chosenColor: color });
        document.getElementById('color-picker').classList.add('hidden');
    };

    document.getElementById('uno-btn').onclick = () => socket.emit('sayUno', activeRoomId);
    document.getElementById('draw-btn').onclick = () => socket.emit('drawCard', activeRoomId);
    document.getElementById('draw-pile').onclick = () => socket.emit('drawCard', activeRoomId);

    socket.on('unoEffect', name => alert(name + " крикнул UNO!"));
    socket.on('gameOver', ({ winner }) => { alert("ПОБЕДА: " + winner); location.reload(); });
});