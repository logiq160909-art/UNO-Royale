window.addEventListener('load', async () => {
    const supabaseUrl = 'https://wfjpudyikqphplxhovfm.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmanB1ZHlpa3FwaHBseGhvdmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc2NzEsImV4cCI6MjA4MTQ4MzY3MX0.AKgEfuvOYDQPlTf0NoOt5NDeldkSTH_XyFSH9EOIHmk';
    const lib = window.supabase || window.supabasejs;
    const supabase = lib.createClient(supabaseUrl, supabaseKey);
    const socket = io();
    let currentUser = null;
    let activeRoomId = null;

    // ПРОВЕРКА СЕССИИ (Пункт 2)
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        showLobby(session.user);
    }

    async function showLobby(user) {
        currentUser = user;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('lobby-screen').classList.remove('hidden');
        
        // Получаем статистику (Пункт 3)
        let { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        if(!profile) {
            const newProf = { id: user.id, username: user.email.split('@')[0] };
            await supabase.from('profiles').insert([newProf]);
            profile = newProf;
        }
        document.getElementById('prof-name').innerText = profile.username;
        document.getElementById('prof-lvl').innerText = profile.level || 1;
        document.getElementById('prof-wins').innerText = profile.wins || 0;
    }

    // ВХОД
    document.getElementById('auth-btn').onclick = async () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            await supabase.auth.signUp({ email, password });
            alert("Аккаунт создан! Нажмите войти.");
        } else {
            showLobby(data.user);
        }
    };

    // ВЫХОД
    document.getElementById('logout-btn').onclick = async () => {
        await supabase.auth.signOut();
        location.reload();
    };

    // КОМНАТЫ
    document.getElementById('create-room-trigger').onclick = () => document.getElementById('modal-create').classList.remove('hidden');
    
    document.getElementById('confirm-create').onclick = () => {
        const name = document.getElementById('new-room-name').value;
        const password = document.getElementById('new-room-pass').value;
        if(name) socket.emit('createRoom', { name, password });
        document.getElementById('modal-create').classList.add('hidden');
    };

    socket.on('roomsList', (rooms) => {
        const list = document.getElementById('rooms-list');
        list.innerHTML = rooms.map(r => `
            <div class="room-item">
                <span>${r.name} (${r.players}/4) ${r.isPrivate ? '🔒' : ''}</span>
                <button class="glow-btn" style="width:auto" onclick="joinRoom('${r.id}', ${r.isPrivate})">ВОЙТИ</button>
            </div>
        `).join('');
    });

    window.joinRoom = (id, isPrivate) => {
        let pass = isPrivate ? prompt('Введите пароль:') : null;
        activeRoomId = id;
        socket.emit('joinRoom', { roomId: id, password: pass, username: currentUser.email.split('@')[0] });
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
    };

    socket.on('initGame', (state) => updateUI(state));
    socket.on('updateState', (state) => updateUI(state));

    function updateUI(state) {
        const me = state.players.find(p => p.id === socket.id);
        if (!me) return;

        document.getElementById('turn-indicator').innerText = 
            state.players[state.turnIndex].id === socket.id ? "ВАШ ХОД!" : "ЖДИТЕ...";
        document.getElementById('color-dot').style.backgroundColor = `var(--${state.currentColor})`;

        const discard = document.getElementById('discard-pile');
        discard.innerHTML = `<div class="card ${state.topCard.color}"><span>${state.topCard.value}</span></div>`;

        const hand = document.getElementById('player-hand');
        hand.innerHTML = me.hand.map((c, i) => `
            <div class="card ${c.color}" onclick="playCard(${i})"><span>${c.value}</span></div>
        `).join('');
    }

    window.playCard = (i) => socket.emit('playCard', { roomId: activeRoomId, cardIndex: i });
    document.getElementById('draw-btn').onclick = () => socket.emit('drawCard', activeRoomId);
});

function closeModal() { document.querySelectorAll('.overlay').forEach(e => e.classList.add('hidden')); }