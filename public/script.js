window.addEventListener('load', async () => {
    const supabaseUrl = 'https://wfjpudyikqphplxhovfm.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmanB1ZHlpa3FwaHBseGhvdmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc2NzEsImV4cCI6MjA4MTQ4MzY3MX0.AKgEfuvOYDQPlTf0NoOt5NDeldkSTH_XyFSH9EOIHmk';
    const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
    const socket = io();

    let user = null;
    let currentRoomId = null;
    let pendingIndex = null;

    // АВТОРИЗАЦИЯ
    const { data: { session } } = await supabase.auth.getSession();
    if(session) initLobby(session.user);

    document.getElementById('auth-btn').onclick = async () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        document.getElementById('msg').innerText = "Загрузка...";
        
        let { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if(error) {
            let { data: up, error: upErr } = await supabase.auth.signUp({ email, password });
            if(upErr) return document.getElementById('msg').innerText = upErr.message;
            initLobby(up.user);
        } else {
            initLobby(data.user);
        }
    };

    async function initLobby(u) {
        user = u;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('lobby-screen').classList.remove('hidden');
        
        let { data: p } = await supabase.from('profiles').select('*').eq('id', u.id).single();
        if(!p) {
             p = { id: u.id, username: u.email.split('@')[0], level: 1, xp: 0 };
             await supabase.from('profiles').insert([p]);
        }
        document.getElementById('u-name').innerText = p.username;
        document.getElementById('lvl-txt').innerText = `Lvl ${p.level} | Побед: ${p.wins}`;
        document.getElementById('xp-bar').style.width = (p.xp % 100) + '%';
    }

    // ЛОББИ И ВХОД
    socket.on('roomsList', list => {
        document.getElementById('rooms-list').innerHTML = list.map(r => `
            <div class="room-card">
                <span>${r.name} (${r.players}/4) ${r.isPrivate?'🔒':''}</span>
                <button class="btn-main" style="width:80px" onclick="tryJoin('${r.id}', ${r.isPrivate}, this)">ВОЙТИ</button>
            </div>
        `).join('');
    });

    window.tryJoin = (id, isPriv, btnElement) => {
        // Блокируем кнопку, чтобы не нажать дважды
        btnElement.disabled = true;
        btnElement.innerText = "...";
        
        let pass = isPriv ? prompt('Пароль') : null;
        socket.emit('joinRoom', { roomId: id, password: pass, username: document.getElementById('u-name').innerText });
        
        // Если ошибка - разблокируем (придет событие errorMsg)
        setTimeout(() => { 
            btnElement.disabled = false; 
            btnElement.innerText = "ВОЙТИ";
        }, 3000);
    };

    socket.on('errorMsg', msg => alert(msg));
    
    // ВАЖНО: Переключение экрана только по сигналу успеха
    socket.on('joinSuccess', (roomId) => {
        currentRoomId = roomId;
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
    });

    window.openModal = () => document.getElementById('modal-create').classList.remove('hidden');
    window.closeModals = () => document.querySelectorAll('.overlay').forEach(e => e.classList.add('hidden'));

    document.getElementById('create-confirm').onclick = () => {
        const name = document.getElementById('r-name').value;
        const password = document.getElementById('r-pass').value;
        socket.emit('createRoom', { name, password });
        closeModals();
    };

    socket.on('roomCreated', id => {
        // Авто вход после создания
        socket.emit('joinRoom', { roomId: id, password: document.getElementById('r-pass').value, username: document.getElementById('u-name').innerText });
    });

    // ИГРА
    socket.on('updateState', renderGame);
    socket.on('initGame', renderGame);

    function renderGame(state) {
        const me = state.fullPlayersForLogic.find(p => p.id === socket.id);
        if(!me) return;

        const isTurn = state.fullPlayersForLogic[state.turnIndex].id === socket.id;
        document.getElementById('turn-txt').innerText = isTurn ? "ТВОЙ ХОД!" : "ЖДИ...";
        document.getElementById('color-dot').style.background = state.currentColor === 'wild' ? '#fff' : getColorHex(state.currentColor);
        
        // Карта на столе
        if(state.topCard) {
            document.getElementById('pile').innerHTML = `<div class="card ${state.topCard.color}"><span>${state.topCard.value}</span></div>`;
        }

        // Соперники
        document.getElementById('opponents').innerHTML = state.fullPlayersForLogic
            .filter(p => p.id !== socket.id)
            .map(p => `
                <div class="opp-card">
                    <div>${p.name}</div>
                    <div>Cards: ${p.hand.length}</div>
                    ${p.unoSaid ? '<b style="color:orange">UNO!</b>' : ''}
                </div>
            `).join('');

        // Рука
        document.getElementById('hand').innerHTML = me.hand.map((c, i) => `
            <div class="card ${c.color}" onclick="clickCard(${i}, '${c.color}')"><span>${c.value}</span></div>
        `).join('');

        // Кнопка UNO
        if(isTurn && me.hand.length === 2) document.getElementById('uno-controls').classList.remove('hidden');
        else document.getElementById('uno-controls').classList.add('hidden');
    }

    function getColorHex(name) {
        if(name==='red') return '#ff4757';
        if(name==='blue') return '#1e90ff';
        if(name==='green') return '#2ed573';
        if(name==='yellow') return '#ffa502';
        return '#fff';
    }

    window.clickCard = (i, color) => {
        if(color === 'wild') {
            pendingIndex = i;
            document.getElementById('modal-color').classList.remove('hidden');
        } else {
            socket.emit('playCard', { roomId: currentRoomId, cardIndex: i });
        }
    };

    window.pickColor = (c) => {
        socket.emit('playCard', { roomId: currentRoomId, cardIndex: pendingIndex, chosenColor: c });
        closeModals();
    };

    document.getElementById('draw-btn').onclick = () => socket.emit('drawCard', currentRoomId);
    document.getElementById('deck').onclick = () => socket.emit('drawCard', currentRoomId);
    document.getElementById('uno-btn').onclick = () => socket.emit('sayUno', currentRoomId);
    document.getElementById('bot-btn').onclick = () => socket.emit('addBot', currentRoomId);
    document.getElementById('logout-btn').onclick = async () => { await supabase.auth.signOut(); location.reload(); };

    socket.on('gameOver', async ({ winner, id }) => {
        const win = id === socket.id;
        alert(win ? "ПОБЕДА!" : "Победил " + winner);
        if(user) {
             let { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single();
             await supabase.from('profiles').update({ 
                 xp: p.xp + (win?50:10), 
                 level: Math.floor((p.xp + (win?50:10))/100)+1,
                 wins: win ? p.wins+1 : p.wins
             }).eq('id', user.id);
        }
        location.reload();
    });
});