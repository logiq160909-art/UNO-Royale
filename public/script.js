window.addEventListener('load', async () => {
    // ВСТАВЬ СВОИ КЛЮЧИ SUPABASE ЗДЕСЬ
    const supabaseUrl = 'https://wfjpudyikqphplxhovfm.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmanB1ZHlpa3FwaHBseGhvdmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc2NzEsImV4cCI6MjA4MTQ4MzY3MX0.AKgEfuvOYDQPlTf0NoOt5NDeldkSTH_XyFSH9EOIHmk';
    
    const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
    const socket = io();

    let user = null;
    let currentRoomId = null;
    let pendingIndex = null;

    const { data: { session } } = await supabase.auth.getSession();
    if(session) initLobby(session.user);

    document.getElementById('auth-btn').onclick = async () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const msg = document.getElementById('msg');
        msg.innerText = "Подключение...";
        
        let { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if(error) {
            let { data: up, error: upErr } = await supabase.auth.signUp({ email, password });
            if(upErr) return msg.innerText = upErr.message;
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
        document.getElementById('lvl-txt').innerText = `Lvl ${p.level} • Wins: ${p.wins}`;
        document.getElementById('xp-bar').style.width = (p.xp % 100) + '%';
    }

    // ЛОББИ
    socket.on('roomsList', list => {
        const container = document.getElementById('rooms-list');
        if(list.length === 0) container.innerHTML = '<div style="text-align:center; opacity:0.5; padding:20px">Нет столов</div>';
        else container.innerHTML = list.map(r => `
            <div class="room-item">
                <div>
                    <strong>${r.name}</strong>
                    <div style="font-size:0.8rem; opacity:0.7">${r.players}/4 игроков</div>
                </div>
                <button class="ios-btn small" onclick="tryJoin('${r.id}', ${r.isPrivate}, this)">Войти</button>
            </div>
        `).join('');
    });

    window.tryJoin = (id, isPriv, btn) => {
        btn.disabled = true;
        btn.innerText = "Wait...";
        let pass = isPriv ? prompt('Пароль') : null;
        socket.emit('joinRoom', { roomId: id, password: pass, username: document.getElementById('u-name').innerText });
        setTimeout(() => { btn.disabled = false; btn.innerText = "Войти"; }, 2000);
    };

    socket.on('errorMsg', msg => alert(msg));
    
    socket.on('joinSuccess', (roomId) => {
        currentRoomId = roomId;
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
    });

    window.openModal = () => document.getElementById('modal-create').classList.remove('hidden');
    window.closeModals = () => document.querySelectorAll('.overlay').forEach(e => e.classList.add('hidden'));

    document.getElementById('create-confirm').onclick = () => {
        socket.emit('createRoom', { 
            name: document.getElementById('r-name').value, 
            password: document.getElementById('r-pass').value 
        });
        closeModals();
    };

    socket.on('roomCreated', id => {
        socket.emit('joinRoom', { roomId: id, password: document.getElementById('r-pass').value, username: document.getElementById('u-name').innerText });
    });

    // ИГРА
    socket.on('updateState', renderGame);
    socket.on('initGame', renderGame);

    function renderGame(state) {
        const me = state.fullPlayersForLogic.find(p => p.id === socket.id);
        if(!me) return;

        const isTurn = state.fullPlayersForLogic[state.turnIndex].id === socket.id;
        const statusDiv = document.getElementById('turn-txt');
        statusDiv.innerText = isTurn ? "ТВОЙ ХОД" : `Ходит: ${state.fullPlayersForLogic[state.turnIndex].name}`;
        statusDiv.style.color = isTurn ? '#34d399' : '#fff';

        // Цвет стола
        const colorHex = getColorHex(state.currentColor);
        document.getElementById('color-dot').style.background = colorHex;
        
        // Карта сброса
        if(state.topCard) {
            document.getElementById('pile').innerHTML = renderCard(state.topCard, false);
        }

        // Соперники
        document.getElementById('opponents').innerHTML = state.fullPlayersForLogic
            .filter(p => p.id !== socket.id)
            .map(p => `
                <div class="opp-pill">
                    <strong>${p.name}</strong>
                    <div style="font-size:0.8rem">🃏 ${p.handSize}</div>
                    ${p.unoSaid ? '<span style="color:#f09819">UNO!</span>' : ''}
                </div>
            `).join('');

        // Моя рука (исправлен рендеринг)
        document.getElementById('hand').innerHTML = me.hand.map((c, i) => renderCard(c, true, i)).join('');

        // Кнопка UNO
        if(isTurn && me.hand.length === 2) document.getElementById('uno-controls').classList.remove('hidden');
        else document.getElementById('uno-controls').classList.add('hidden');
    }

    function renderCard(card, isHand, index) {
        const colorClass = card.color === 'wild' ? 'wild' : card.color;
        const clickAttr = isHand ? `onclick="clickCard(${index}, '${card.color}')"` : '';
        // Добавляем небольшой поворот для красоты в руке
        const rotate = isHand ? `style="transform: rotate(${(index - 3) * 2}deg)"` : '';
        
        return `<div class="card ${colorClass}" ${clickAttr} ${rotate}>
            <span>${card.value}</span>
        </div>`;
    }

    function getColorHex(name) {
        if(name==='red') return '#ff5e62';
        if(name==='blue') return '#00c6ff';
        if(name==='green') return '#56ab2f';
        if(name==='yellow') return '#f09819';
        return '#ffffff';
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
        alert(win ? "🏆 ПОБЕДА! +50 XP" : `Победил ${winner}`);
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