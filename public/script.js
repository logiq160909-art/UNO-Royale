window.addEventListener('load', async () => {
    const supabaseUrl = 'https://wfjpudyikqphplxhovfm.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmanB1ZHlpa3FwaHBseGhvdmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc2NzEsImV4cCI6MjA4MTQ4MzY3MX0.AKgEfuvOYDQPlTf0NoOt5NDeldkSTH_XyFSH9EOIHmk';
    const lib = window.supabase || window.supabasejs;
    const supabase = lib.createClient(supabaseUrl, supabaseKey);
    const socket = io();
    let currentUser = null, activeRoomId = null;

    const { data: { session } } = await supabase.auth.getSession();
    if (session) showLobby(session.user);

    async function showLobby(user) {
        currentUser = user;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('lobby-screen').classList.remove('hidden');
        let { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        if(!p) {
            p = { id: user.id, username: user.email.split('@')[0], level: 1, xp: 0, wins: 0 };
            await supabase.from('profiles').insert([p]);
        }
        renderStats(p.xp, p.level, p.wins, p.username);
    }

    function renderStats(xp, lvl, wins, name) {
        document.getElementById('prof-name').innerText = name;
        document.getElementById('prof-lvl').innerText = lvl;
        document.getElementById('prof-wins').innerText = wins;
        document.getElementById('xp-fill').style.width = (xp % 100) + "%";
        document.getElementById('xp-text').innerText = `${xp % 100} / 100 XP`;
    }

    document.getElementById('auth-btn').onclick = async () => {
        const email = document.getElementById('email').value, password = document.getElementById('password').value;
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { await supabase.auth.signUp({ email, password }); alert("Аккаунт создан! Нажмите войти."); }
        else showLobby(data.user);
    };

    document.getElementById('logout-btn').onclick = async () => { await supabase.auth.signOut(); location.reload(); };
    document.getElementById('create-btn').onclick = () => document.getElementById('modal-create').classList.remove('hidden');
    document.getElementById('confirm-create').onclick = () => {
        socket.emit('createRoom', { name: document.getElementById('room-name').value, password: document.getElementById('room-pass').value });
        document.getElementById('modal-create').classList.add('hidden');
    };

    socket.on('roomCreated', (id) => joinRoom(id, false));
    socket.on('roomsList', (rooms) => {
        document.getElementById('rooms-list').innerHTML = rooms.map(r => `
            <div class="room-item">
                <span>${r.name} (${r.players}/4) ${r.isPrivate ? '🔒' : ''}</span>
                <button class="game-btn" onclick="joinRoom('${r.id}', ${r.isPrivate})">ВОЙТИ</button>
            </div>
        `).join('');
    });

    window.joinRoom = (id, isPrivate) => {
        let pass = isPrivate ? prompt('Пароль:') : null;
        activeRoomId = id;
        socket.emit('joinRoom', { roomId: id, password: pass, username: currentUser.email.split('@')[0] });
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
    };

    document.getElementById('add-bot-btn').onclick = () => socket.emit('addBot', activeRoomId);

    socket.on('initGame', (state) => updateUI(state));
    socket.on('updateState', (state) => updateUI(state));

    function updateUI(state) {
        const me = state.players.find(p => p.id === socket.id);
        if (!me) return;
        const isMyTurn = state.players[state.turnIndex].id === socket.id;
        document.getElementById('turn-txt').innerText = isMyTurn ? "ВАШ ХОД!" : "ЖДИТЕ...";
        document.getElementById('color-dot').style.backgroundColor = `var(--${state.currentColor})`;
        document.getElementById('discard-pile').innerHTML = `<div class="card ${state.topCard.color}"><span>${state.topCard.value}</span></div>`;
        document.getElementById('player-hand').innerHTML = me.hand.map((c, i) => 
            `<div class="card ${c.color}" onclick="playCard(${i})"><span>${c.value}</span></div>`).join('');
    }

    window.playCard = (i) => socket.emit('playCard', { roomId: activeRoomId, cardIndex: i });
    document.getElementById('draw-btn').onclick = () => socket.emit('drawCard', activeRoomId);

    socket.on('gameOver', async ({ id }) => {
        const isWin = socket.id === id;
        alert(isWin ? "ПОБЕДА! +50 XP" : "ПОРАЖЕНИЕ +10 XP");
        let { data: p } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
        const newXp = p.xp + (isWin ? 50 : 10);
        await supabase.from('profiles').update({ xp: newXp, level: Math.floor(newXp/100)+1, wins: isWin ? p.wins+1 : p.wins }).eq('id', currentUser.id);
        location.reload();
    });
});