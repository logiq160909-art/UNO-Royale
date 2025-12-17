window.addEventListener('load', async () => {
    // ВАШИ КЛЮЧИ SUPABASE (Оставьте их, но в продакшене лучше использовать .env)
    const supabaseUrl = 'https://wfjpudyikqphplxhovfm.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmanB1ZHlpa3FwaHBseGhvdmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc2NzEsImV4cCI6MjA4MTQ4MzY3MX0.AKgEfuvOYDQPlTf0NoOt5NDeldkSTH_XyFSH9EOIHmk';
    
    const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
    const socket = io();

    let user = null;
    let currentRoomId = null;
    let pendingIndex = null;

    const { data: { session } } = await supabase.auth.getSession();
    if(session) initLobby(session.user);

    // --- AUTH ---
    document.getElementById('auth-btn').onclick = async () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const msg = document.getElementById('msg');
        msg.innerText = "Подключение...";
        
        // Попытка входа
        let { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if(error) {
            // Если не вышло - пробуем регистрацию
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
             p = { id: u.id, username: u.email.split('@')[0], level: 1, xp: 0, wins: 0 };
             // Если таблицы нет или ошибка RLS, это может упасть, но для демо ок
             await supabase.from('profiles').insert([p]).catch(e => console.log('Profile exists or error'));
        }
        document.getElementById('u-name').innerText = p.username || u.email;
        document.getElementById('lvl-txt').innerText = `Lvl ${p.level || 1} • Wins: ${p.wins || 0}`;
        document.getElementById('xp-bar').style.width = ((p.xp || 0) % 100) + '%';
    }

    // --- LOBBY LOGIC ---
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

    // --- GAME UI LOGIC ---
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

    socket.on('updateState', renderGame);

    function renderGame(state) {
        // Определяем, чей ход
        const currentPlayer = state.players[state.turnIndex];
        const isMyTurn = currentPlayer.id === socket.id;

        // Обновляем шапку
        const statusDiv = document.getElementById('turn-txt');
        statusDiv.innerText = isMyTurn ? "ТВОЙ ХОД" : `Ходит: ${currentPlayer.name}`;
        statusDiv.style.color = isMyTurn ? '#34d399' : '#fff';

        // Индикатор направления
        const arrow = document.getElementById('direction-arrow');
        arrow.style.transform = state.direction === 1 ? 'rotate(0deg)' : 'rotate(180deg)';
        arrow.title = state.direction === 1 ? 'По часовой' : 'Против часовой';

        // Цвет стола
        document.getElementById('color-dot').style.background = getColorHex(state.currentColor);
        
        // Карта сброса
        if(state.topCard) {
            document.getElementById('pile').innerHTML = renderCard(state.topCard, false);
        }

        // Соперники (исключаем себя из общего списка для отображения сверху)
        document.getElementById('opponents').innerHTML = state.players
            .filter(p => p.id !== socket.id)
            .map(p => {
                const isActive = (p.id === currentPlayer.id) ? 'opp-active' : '';
                return `
                <div class="opp-pill ${isActive}">
                    <strong>${p.name}</strong>
                    <div style="font-size:0.8rem">🃏 ${p.handSize}</div>
                    ${p.unoSaid ? '<span style="color:#f09819; font-weight:bold">UNO!</span>' : ''}
                </div>
            `}).join('');

        // Моя рука (берем из state.me, который присылает сервер только нам)
        if (state.me && state.me.hand) {
            document.getElementById('hand').innerHTML = state.me.hand
                .map((c, i) => renderCard(c, true, i, state.me.hand.length))
                .join('');
            
            // Кнопка UNO
            const myPlayerInfo = state.players.find(p => p.id === socket.id);
            if(myPlayerInfo && state.me.hand.length === 2 && !myPlayerInfo.unoSaid && isMyTurn) {
                document.getElementById('uno-controls').classList.remove('hidden');
            } else {
                document.getElementById('uno-controls').classList.add('hidden');
            }
        }
    }

    function renderCard(card, isHand, index, total) {
        const colorClass = card.color === 'wild' ? 'wild' : card.color;
        const clickAttr = isHand ? `onclick="clickCard(${index}, '${card.color}')"` : '';
        
        // Расчет поворота для веера
        let style = '';
        if (isHand) {
            const angle = (index - (total - 1) / 2) * 5; // 5 градусов разброс
            style = `style="transform: rotate(${angle}deg); margin-bottom: ${Math.abs(angle)}px"`;
        }
        
        return `<div class="card ${colorClass}" ${clickAttr} ${style}>
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
        // Блокируем клик, если не наш ход (опционально, сервер все равно проверит)
        // if (document.getElementById('turn-txt').innerText !== "ТВОЙ ХОД") return;

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

    // Эффекты
    socket.on('unoEffect', (name) => {
        const flash = document.getElementById('uno-flash');
        flash.innerText = `${name} UNO!`;
        flash.classList.remove('hidden');
        setTimeout(() => flash.classList.add('hidden'), 2000);
    });

    socket.on('gameOver', async ({ winner, id }) => {
        const win = id === socket.id;
        alert(win ? "🏆 ПОБЕДА! +50 XP" : `Победил ${winner}`);
        if(user) {
             // Просто обновляем локально, серверной БД логики полной нет, но запрос отправим
             await supabase.from('profiles').update({ 
                 wins: win ? (user.wins || 0) + 1 : (user.wins || 0) 
             }).eq('id', user.id).catch(e => {});
        }
        location.reload();
    });
});