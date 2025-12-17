window.addEventListener('load', async () => {
    // КОНФИГУРАЦИЯ
    const supabaseUrl = 'https://wfjpudyikqphplxhovfm.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmanB1ZHlpa3FwaHBseGhvdmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc2NzEsImV4cCI6MjA4MTQ4MzY3MX0.AKgEfuvOYDQPlTf0NoOt5NDeldkSTH_XyFSH9EOIHmk';
    
    // Безопасная загрузка библиотек
    const sbLib = window.supabase || window.supabasejs;
    if (!sbLib) return alert("Ошибка: Supabase не загрузился. Отключите AdBlock.");
    
    const supabase = sbLib.createClient(supabaseUrl, supabaseKey);
    const socket = io();

    // Состояние
    let currentUser = null;
    let currentRoomId = null;
    let pendingCardIndex = null; // Для Wild карты

    // 1. ПРОВЕРКА АВТОРИЗАЦИИ
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        initLobby(session.user);
    }

    // 2. ВХОД В СИСТЕМУ
    document.getElementById('login-btn').onclick = async () => {
        const email = document.getElementById('email').value;
        const pass = document.getElementById('password').value;
        const msg = document.getElementById('auth-msg');
        
        if(!email || !pass) return msg.innerText = "Введите Email и пароль";
        msg.innerText = "Загрузка...";

        // Пробуем войти
        let { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
        
        if (error) {
            // Если ошибка, пробуем создать аккаунт
            let { data: upData, error: upError } = await supabase.auth.signUp({ email, password: pass });
            if (upError) {
                msg.innerText = "Ошибка: " + upError.message;
            } else {
                alert("Аккаунт создан! Теперь вы вошли.");
                initLobby(upData.user);
            }
        } else {
            initLobby(data.user);
        }
    };

    async function initLobby(user) {
        currentUser = user;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('lobby-screen').classList.remove('hidden');
        
        // Загрузка профиля (XP, Wins)
        let { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        
        // Если профиля нет, создаем
        if (!prof) {
            prof = { id: user.id, username: user.email.split('@')[0], level: 1, xp: 0, wins: 0 };
            await supabase.from('profiles').insert([prof]);
        }

        // Рендер сайдбара
        document.getElementById('prof-name').innerText = prof.username;
        document.getElementById('prof-lvl-badge').innerText = "Lvl " + prof.level;
        document.getElementById('prof-wins').innerText = prof.wins;
        document.getElementById('xp-fill').style.width = (prof.xp % 100) + "%";
        document.getElementById('xp-text').innerText = `${prof.xp % 100} / 100 XP`;
    }

    // 3. ЛОББИ: СПИСОК КОМНАТ
    socket.on('roomsList', (rooms) => {
        const container = document.getElementById('rooms-list');
        if (rooms.length === 0) {
            container.innerHTML = `<div class="empty-msg" style="padding:20px; text-align:center; color:#aaa">Столов нет. Создайте первый!</div>`;
            return;
        }
        
        container.innerHTML = rooms.map(r => `
            <div class="room-item">
                <div>
                    <strong>${r.name}</strong>
                    <div style="font-size:0.8rem; color:#aaa">${r.players}/4 игроков ${r.isPrivate ? '🔒' : ''}</div>
                </div>
                <button class="btn-primary" onclick="joinRoomRequest('${r.id}', ${r.isPrivate})">ВОЙТИ</button>
            </div>
        `).join('');
    });

    // 4. СОЗДАНИЕ И ВХОД
    document.getElementById('open-create-modal').onclick = () => document.getElementById('modal-create').classList.remove('hidden');
    window.closeModals = () => document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));

    document.getElementById('confirm-create').onclick = () => {
        const name = document.getElementById('new-room-name').value;
        const pass = document.getElementById('new-room-pass').value;
        if(name) {
            socket.emit('createRoom', { name, password: pass });
            closeModals();
        }
    };

    socket.on('roomCreated', (id) => {
        joinRoomRequest(id, false);
    });

    window.joinRoomRequest = (id, isPrivate) => {
        let pass = null;
        if (isPrivate) pass = prompt("Введите пароль комнаты:");
        
        currentRoomId = id;
        socket.emit('joinRoom', { 
            roomId: id, 
            password: pass, 
            username: document.getElementById('prof-name').innerText 
        });
    };

    // Ошибки входа
    socket.on('errorMsg', (msg) => alert(msg));

    // Успешный вход -> Переключение экранов
    socket.on('updateState', (state) => {
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
        renderGame(state);
    });

    socket.on('initGame', (state) => renderGame(state));

    // 5. ИГРОВОЙ РЕНДЕР
    function renderGame(state) {
        // 1. Кто я?
        const me = state.fullPlayersForLogic.find(p => p.id === socket.id);
        if(!me) return;

        // 2. Верхняя панель
        const activePlayer = state.fullPlayersForLogic[state.turnIndex];
        const isMyTurn = activePlayer.id === socket.id;
        
        document.getElementById('turn-indicator').innerText = isMyTurn ? "ВАШ ХОД!" : `ХОДИТ: ${activePlayer.name}`;
        document.getElementById('turn-indicator').style.background = isMyTurn ? "var(--green)" : "var(--secondary)";
        
        // Цвет стола
        const colorDot = document.getElementById('current-color-dot');
        colorDot.style.background = `var(--${state.currentColor})`;
        
        // 3. Центр стола
        const discard = document.getElementById('discard-pile');
        if (state.topCard) {
            discard.innerHTML = renderCardHTML(state.topCard);
        }

        // 4. Соперники
        const oppContainer = document.getElementById('opponents-container');
        oppContainer.innerHTML = state.fullPlayersForLogic
            .filter(p => p.id !== socket.id)
            .map(p => `
                <div class="opponent-card">
                    <div>${p.name}</div>
                    <div style="font-size:1.2rem">🃏 ${p.hand.length}</div>
                    ${p.unoSaid ? '<span style="color:orange; font-weight:bold">UNO!</span>' : ''}
                </div>
            `).join('');

        // 5. Моя рука
        const handContainer = document.getElementById('my-hand');
        handContainer.innerHTML = me.hand.map((card, idx) => `
            <div class="card ${card.color}" onclick="onCardClick(${idx}, '${card.color}')">
                <span>${card.value}</span>
            </div>
        `).join('');

        // 6. Кнопка UNO
        const unoArea = document.getElementById('uno-actions');
        if (me.hand.length === 2 && isMyTurn) { // Показываем кнопку если осталось 2 карты и мой ход (станет 1 после хода)
             unoArea.classList.remove('hidden');
        } else {
             unoArea.classList.add('hidden');
        }
    }

    // Хелпер для отрисовки карты
    function renderCardHTML(card) {
        const colorClass = card.color === 'wild' ? 'wild' : card.color;
        return `<div class="card ${colorClass}"><span>${card.value}</span></div>`;
    }

    // 6. УПРАВЛЕНИЕ ИГРОЙ
    window.onCardClick = (idx, color) => {
        if (color === 'wild') {
            pendingCardIndex = idx;
            document.getElementById('modal-color').classList.remove('hidden');
        } else {
            socket.emit('playCard', { roomId: currentRoomId, cardIndex: idx });
        }
    };

    window.pickColor = (color) => {
        socket.emit('playCard', { roomId: currentRoomId, cardIndex: pendingCardIndex, chosenColor: color });
        document.getElementById('modal-color').classList.add('hidden');
    };

    document.getElementById('draw-card-btn').onclick = () => socket.emit('drawCard', currentRoomId);
    document.getElementById('draw-pile').onclick = () => socket.emit('drawCard', currentRoomId);
    
    document.getElementById('shout-uno').onclick = () => {
        socket.emit('sayUno', currentRoomId);
        document.getElementById('uno-actions').classList.add('hidden');
    };

    document.getElementById('add-bot-btn').onclick = () => socket.emit('addBot', currentRoomId);
    
    document.getElementById('exit-game-btn').onclick = () => location.reload();

    // 7. СОБЫТИЯ ИГРЫ
    socket.on('gameOver', async ({ winner, id }) => {
        const isWin = id === socket.id;
        alert(isWin ? "ПОБЕДА! 🎉 +50 XP" : `Победил ${winner}. Вы получили +10 XP`);
        
        // Обновляем XP в базе
        if(currentUser) {
            let { data: p } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
            const newXp = p.xp + (isWin ? 50 : 10);
            const newLvl = Math.floor(newXp / 100) + 1;
            const newWins = isWin ? p.wins + 1 : p.wins;
            
            await supabase.from('profiles').update({ xp: newXp, level: newLvl, wins: newWins }).eq('id', currentUser.id);
        }
        location.reload();
    });

    socket.on('unoEffect', (name) => {
        // Визуальное уведомление
        const div = document.createElement('div');
        div.innerText = `${name} КРИЧИТ UNO!`;
        div.style.cssText = "position:fixed; top:20%; left:50%; transform:translateX(-50%); background:orange; padding:20px; font-size:2rem; z-index:1000; border-radius:10px; box-shadow:0 0 20px orange;";
        document.body.appendChild(div);
        setTimeout(() => div.remove(), 2000);
    });
});