// --- ГЛОБАЛЬНЫЕ ФУНКЦИИ ---

window.openModal = (modalId) => {
    document.querySelectorAll('.overlay').forEach(e => e.classList.add('hidden'));
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('hidden');
}

window.closeModals = () => {
    document.querySelectorAll('.overlay').forEach(e => e.classList.add('hidden'));
};

window.addEventListener('load', async () => {
    const supabaseUrl = 'https://wfjpudyikqphplxhovfm.supabase.co';
    // Внимание: Этот ключ должен быть защищен в продакшене, но оставляем для примера как было
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmanB1ZHlpa3FwaHBseGhvdmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc2NzEsImV4cCI6MjA4MTQ4MzY3MX0.AKgEfuvOYDQPlTf0NoOt5NDeldkSTH_XyFSH9EOIHmk';
    
    const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
    const socket = io();

    let user = null;
    let profile = null;
    let currentRoomId = null;
    let activeChatFriendId = null;
    
    const SHOP_ITEMS = [
        { id: 'av_fox', type: 'avatar', name: 'Лис', price: 500, src: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix' },
        { id: 'av_robot', type: 'avatar', name: 'Робот', price: 1000, src: 'https://api.dicebear.com/7.x/bottts/svg?seed=Zork' },
        { id: 'bn_space', type: 'banner', name: 'Космос', price: 800, color: 'linear-gradient(45deg, #0b0c2a, #2a0b25)' },
        { id: 'bn_gold', type: 'banner', name: 'Золото', price: 2000, color: 'linear-gradient(45deg, #f09819, #edde5d)' }
    ];

    // --- АВТОРИЗАЦИЯ ---
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
        // Регистрируем сокет с UserID для личных уведомлений
        socket.emit('registerUser', user.id);

        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('lobby-screen').classList.remove('hidden');
        
        let { data: p } = await supabase.from('profiles').select('*').eq('id', u.id).single();
        if(!p) {
              const shortId = u.id.substr(0, 6);
              p = { id: u.id, username: u.email.split('@')[0], level: 1, xp: 0, wins: 0, coins: 0, short_id: shortId };
              await supabase.from('profiles').insert([p]);
        }
        profile = p;
        updateProfileUI();
        loadShop();
        loadInventory();
        loadFriends();
        loadFriendRequests();
        checkDailyQuest();
        startChatListener();
    }

    function updateProfileUI() {
        if(!profile) return;
        document.getElementById('u-name').innerText = profile.username;
        document.getElementById('u-short-id').innerText = `ID: ${profile.short_id}`;
        document.getElementById('lvl-txt').innerText = `Lvl ${profile.level}`;
        document.getElementById('xp-details').innerText = `${Math.floor(profile.xp)} XP`;
        document.getElementById('coin-balance').innerText = profile.coins;
        document.getElementById('xp-bar').style.width = ((profile.xp % 100)) + '%';
        
        const avatarSrc = getAvatarSrc(profile.avatar_url);
        document.getElementById('my-avatar-display').innerHTML = `<img src="${avatarSrc}">`;
    }

    function getAvatarSrc(id) {
        if(!id || id === 'default') return 'https://api.dicebear.com/7.x/adventurer/svg?seed=Guest';
        const item = SHOP_ITEMS.find(i => i.id === id);
        return item ? item.src : 'https://api.dicebear.com/7.x/adventurer/svg?seed=Guest';
    }

    // --- ЛОГИКА ДРУЗЕЙ И ЗАЯВОК ---
    
    // 1. Отправка заявки
    window.sendFriendRequest = async () => {
        const fid = document.getElementById('friend-id-input').value;
        if(fid.length < 6) return alert("Неверный ID");
        
        const { data: targetProfile } = await supabase.from('profiles').select('id').eq('short_id', fid).single();
        if(!targetProfile) return alert("Игрок не найден");
        if(targetProfile.id === user.id) return alert("Нельзя добавить себя");

        // Проверяем, есть ли уже заявка или дружба
        const { data: existing } = await supabase.from('friend_requests')
            .select('*')
            .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
            .or(`sender_id.eq.${targetProfile.id},receiver_id.eq.${targetProfile.id}`);
        
        // Фильтруем точное совпадение пары
        const relation = existing ? existing.find(r => 
            (r.sender_id === user.id && r.receiver_id === targetProfile.id) || 
            (r.sender_id === targetProfile.id && r.receiver_id === user.id)
        ) : null;

        if(relation) {
            if(relation.status === 'accepted') return alert("Вы уже друзья!");
            return alert("Заявка уже существует");
        }

        await supabase.from('friend_requests').insert([{ sender_id: user.id, receiver_id: targetProfile.id, status: 'pending' }]);
        alert("Заявка отправлена!");
        document.getElementById('friend-id-input').value = '';
    };

    // 2. Загрузка входящих заявок
    async function loadFriendRequests() {
        const { data: reqs } = await supabase.from('friend_requests')
            .select('id, sender_id, status')
            .eq('receiver_id', user.id)
            .eq('status', 'pending');
        
        const container = document.getElementById('requests-list');
        const section = document.getElementById('friend-requests-section');
        const badge = document.getElementById('req-badge');

        if(!reqs || reqs.length === 0) {
            section.classList.add('hidden');
            badge.classList.add('hidden');
            return;
        }

        section.classList.remove('hidden');
        badge.classList.remove('hidden');
        badge.innerText = reqs.length;

        // Получаем имена отправителей
        const senderIds = reqs.map(r => r.sender_id);
        const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', senderIds);

        container.innerHTML = reqs.map(r => {
            const sender = profiles.find(p => p.id === r.sender_id);
            return `
            <div class="request-item">
                <span>${sender ? sender.username : 'Unknown'}</span>
                <div style="display:flex; gap:5px">
                    <button class="ios-btn small primary" onclick="respondRequest('${r.id}', true)">✔</button>
                    <button class="ios-btn small secondary" onclick="respondRequest('${r.id}', false)">✖</button>
                </div>
            </div>`;
        }).join('');
    }

    window.respondRequest = async (reqId, accept) => {
        if(accept) {
            await supabase.from('friend_requests').update({ status: 'accepted' }).eq('id', reqId);
            loadFriends(); // Обновляем список друзей
        } else {
            await supabase.from('friend_requests').delete().eq('id', reqId);
        }
        loadFriendRequests(); // Обновляем список заявок
    };

    // 3. Загрузка списка друзей (для вкладок Друзья и Чаты)
    async function loadFriends() {
        // Ищем записи где статус accepted и пользователь участвует
        const { data: rels } = await supabase.from('friend_requests')
            .select('sender_id, receiver_id')
            .eq('status', 'accepted')
            .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);
        
        const listDiv = document.getElementById('friends-list');
        const chatListDiv = document.getElementById('active-chats-list');

        if(!rels || rels.length === 0) {
            listDiv.innerHTML = '<p style="text-align:center;opacity:0.5">Список пуст</p>';
            chatListDiv.innerHTML = '<p style="text-align:center;opacity:0.5">Добавьте друзей для чата</p>';
            return;
        }

        const friendIds = rels.map(r => r.sender_id === user.id ? r.receiver_id : r.sender_id);
        const { data: profiles } = await supabase.from('profiles').select('*').in('id', friendIds);

        // Рендер во вкладку Друзья
        listDiv.innerHTML = profiles.map(p => `
            <div class="room-item">
                <div style="display:flex; align-items:center; gap:10px">
                    <div style="width:30px;height:30px;border-radius:50%;background:#333;overflow:hidden">
                        <img src="${getAvatarSrc(p.avatar_url)}" style="width:100%">
                    </div>
                    <div>
                        <strong>${p.username}</strong>
                        <div style="font-size:0.75rem; opacity:0.7">${p.wins} wins</div>
                    </div>
                </div>
                <button class="ios-btn small secondary" onclick="openChatWith('${p.id}', '${p.username}')">💬</button>
            </div>
        `).join('');

        // Рендер во вкладку Чаты
        chatListDiv.innerHTML = profiles.map(p => `
            <div class="room-item" onclick="openChatWith('${p.id}', '${p.username}')" style="cursor:pointer">
                <div style="display:flex; align-items:center; gap:10px">
                     <div style="width:40px;height:40px;border-radius:50%;background:#333;overflow:hidden">
                        <img src="${getAvatarSrc(p.avatar_url)}" style="width:100%">
                    </div>
                    <div>
                        <strong>${p.username}</strong>
                        <small style="display:block; opacity:0.6">Нажмите чтобы написать</small>
                    </div>
                </div>
            </div>
        `).join('');
    }

    // --- ЧАТ И ПРИГЛАШЕНИЯ ---

    window.openChatWith = async (friendId, friendName) => {
        activeChatFriendId = friendId;
        document.getElementById('chat-friend-name').innerText = friendName;
        
        // UI переключение
        document.getElementById('chat-list-view').classList.add('hidden');
        document.getElementById('chat-conversation-view').classList.remove('hidden');
        
        // Если мы не на вкладке чатов, переключаем
        const chatTabBtn = document.querySelector('button[onclick="switchTab(\'chats\', this)"]');
        window.switchTab('chats', chatTabBtn);

        loadMessages(friendId);
    };

    window.closeChat = () => {
        activeChatFriendId = null;
        document.getElementById('chat-conversation-view').classList.add('hidden');
        document.getElementById('chat-list-view').classList.remove('hidden');
    };

    async function loadMessages(friendId) {
        const msgContainer = document.getElementById('chat-messages');
        msgContainer.innerHTML = '<div style="text-align:center;padding:10px">Загрузка...</div>';
        
        const { data: msgs } = await supabase.from('messages')
            .select('*')
            .or(`and(sender_id.eq.${user.id},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${user.id})`)
            .order('created_at', { ascending: true })
            .limit(50);

        msgContainer.innerHTML = '';
        if(msgs) msgs.forEach(renderMessage);
        scrollToBottom();
    }

    function renderMessage(msg) {
        const container = document.getElementById('chat-messages');
        const isMine = msg.sender_id === user.id;
        
        let content = msg.content;
        if(msg.is_invite) {
            content = `<div class="invite-card">
                <div>Приглашение в игру!</div>
                ${!isMine ? `<button class="ios-btn small primary" onclick="acceptInvite('${msg.room_id}')">Присоединиться</button>` : '<small>Отправлено</small>'}
            </div>`;
        }

        const div = document.createElement('div');
        div.className = `chat-bubble ${isMine ? 'mine' : 'theirs'}`;
        div.innerHTML = content;
        container.appendChild(div);
        scrollToBottom();
    }

    function scrollToBottom() {
        const c = document.getElementById('chat-messages');
        c.scrollTop = c.scrollHeight;
    }

    // Отправка сообщений
    document.getElementById('send-msg-btn').onclick = sendMessage;
    document.getElementById('chat-input').addEventListener('keypress', (e) => { if(e.key === 'Enter') sendMessage() });

    async function sendMessage() {
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if(!text || !activeChatFriendId) return;

        const msgData = { 
            sender_id: user.id, 
            receiver_id: activeChatFriendId, 
            content: text, 
            is_invite: false 
        };

        // Сохраняем в БД
        await supabase.from('messages').insert([msgData]);
        
        // Отправляем через сокет для реалтайма
        socket.emit('privateMessage', { toUserId: activeChatFriendId, content: text, fromUsername: profile.username });
        
        renderMessage({ ...msgData }); // Рендерим себе сразу
        input.value = '';
    }

    // Отправка ПРИГЛАШЕНИЯ
    window.sendInvite = async (friendId) => {
        if(!currentRoomId) return alert("Вы не в комнате!");
        
        // Создаем запись сообщения-приглашения
        const msgData = {
            sender_id: user.id,
            receiver_id: friendId,
            content: "Приглашение в игру",
            is_invite: true,
            room_id: currentRoomId
        };
        await supabase.from('messages').insert([msgData]);

        // Отправляем сокет-сигнал
        socket.emit('sendInvite', { toUserId: friendId, roomId: currentRoomId, fromUsername: profile.username });
        alert("Приглашение отправлено!");
        window.closeModals();
    };

    // Слушатель событий чата и приглашений
    function startChatListener() {
        socket.on('receiveMessage', (data) => {
            // data: { fromUserId, content, fromUsername }
            if(activeChatFriendId === data.fromUserId) {
                renderMessage({ sender_id: data.fromUserId, content: data.content, is_invite: false });
            } else {
                // Показать бейдж уведомления
                const badge = document.getElementById('chat-badge');
                badge.classList.remove('hidden');
                badge.innerText = "!";
            }
        });

        socket.on('inviteReceived', (data) => {
            // data: { fromUsername, roomId, fromUserId }
            // Показываем модалку
            const modal = document.getElementById('modal-invite-received');
            document.getElementById('invite-text').innerText = `${data.fromUsername} зовет вас играть!`;
            
            // Настраиваем кнопку принятия
            document.getElementById('accept-invite-btn').onclick = () => {
                window.tryJoin(data.roomId, false, document.getElementById('accept-invite-btn'));
                window.closeModals();
            };
            
            modal.classList.remove('hidden');

            // Также добавляем в чат, если он открыт
            if(activeChatFriendId === data.fromUserId) {
                renderMessage({ sender_id: data.fromUserId, content: "Приглашение в игру", is_invite: true, room_id: data.roomId });
            }
        });
    }
    
    window.acceptInvite = (roomId) => {
        // Пробуем войти через существующую функцию
        // Создаем фиктивную кнопку для передачи в tryJoin чтобы не ломался UI
        const dummyBtn = document.createElement('button');
        window.tryJoin(roomId, false, dummyBtn);
    };

    // Окно приглашения внутри игры
    window.openInviteModal = async () => {
        const modal = document.getElementById('modal-invite-ingame');
        const list = document.getElementById('ingame-friend-list');
        list.innerHTML = 'Загрузка...';
        modal.classList.remove('hidden');

        // Грузим друзей
        const { data: rels } = await supabase.from('friend_requests')
            .select('sender_id, receiver_id')
            .eq('status', 'accepted')
            .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);

        if(!rels || rels.length === 0) {
            list.innerHTML = "Нет друзей для приглашения";
            return;
        }

        const friendIds = rels.map(r => r.sender_id === user.id ? r.receiver_id : r.sender_id);
        const { data: profiles } = await supabase.from('profiles').select('*').in('id', friendIds);

        list.innerHTML = profiles.map(p => `
             <div class="room-item">
                <span>${p.username}</span>
                <button class="ios-btn small primary" onclick="sendInvite('${p.id}')">Позвать</button>
            </div>
        `).join('');
    };

    // --- ОБРАБОТКА КОНЦА ИГРЫ (Оставляем как было) ---
    socket.on('gameEnded', async ({ winnerName, reward }) => {
        currentRoomId = null; // Сброс ID комнаты
        const modal = document.getElementById('modal-gameover');
        const title = document.getElementById('go-title');
        
        title.innerText = reward.won ? "ПОБЕДА!" : "ПОРАЖЕНИЕ";
        title.style.background = reward.won ? "linear-gradient(to right, #f09819, #edde5d)" : "gray";
        title.style.webkitBackgroundClip = "text";
        
        document.getElementById('go-xp').innerText = `+${reward.xp} XP`;
        document.getElementById('go-coins').innerText = `+${reward.coins} 💰`;

        modal.classList.remove('hidden');

        // ЗАПИСЫВАЕМ ПРОГРЕСС КВЕСТА
        const todayStr = new Date().toDateString();
        localStorage.setItem('last_played_date', todayStr);

        const newXp = profile.xp + reward.xp;
        const newLevel = Math.floor(newXp / 100) + 1;
        const newCoins = profile.coins + reward.coins;
        const newWins = reward.won ? profile.wins + 1 : profile.wins;

        const { error } = await supabase.from('profiles').update({
            xp: newXp, level: newLevel, coins: newCoins, wins: newWins
        }).eq('id', user.id);

        if(!error) {
            profile.xp = newXp;
            profile.level = newLevel;
            profile.coins = newCoins;
            profile.wins = newWins;
        }
    });

    window.backToLobby = () => location.reload();

    // --- МАГАЗИН (Оставляем) ---
    async function loadShop() {
        const grid = document.getElementById('shop-grid');
        grid.innerHTML = SHOP_ITEMS.map(item => `
            <div class="shop-item" onclick="buyItem('${item.id}', ${item.price})">
                ${item.type === 'avatar' 
                    ? `<img src="${item.src}">` 
                    : `<div style="width:50px;height:50px;background:${item.color};border-radius:50%;margin:0 auto 10px"></div>`
                }
                <div>${item.name}</div>
                <div class="shop-price">${item.price} 💰</div>
            </div>
        `).join('');
    }

    window.buyItem = async (itemId, price) => {
        if(profile.coins < price) return alert("Недостаточно монет!");
        const { data: has } = await supabase.from('user_items').select('*').eq('user_id', user.id).eq('item_id', itemId);
        if(has && has.length > 0) return alert("Уже куплено!");

        const { error } = await supabase.from('profiles').update({ coins: profile.coins - price }).eq('id', user.id);
        if(error) return alert("Ошибка транзакции");

        await supabase.from('user_items').insert([{ user_id: user.id, item_id: itemId, item_type: SHOP_ITEMS.find(i=>i.id===itemId).type }]);
        profile.coins -= price;
        updateProfileUI();
        loadInventory();
        alert("Куплено!");
    };

    async function loadInventory() {
        const { data: items } = await supabase.from('user_items').select('*').eq('user_id', user.id);
        const myItems = items || [];
        const avatarsDiv = document.getElementById('inv-avatars');
        avatarsDiv.innerHTML = `<div class="inv-item ${profile.avatar_url==='default'?'selected':''}" onclick="equip('avatar', 'default')">Default</div>` +
            myItems.filter(i => i.item_type === 'avatar').map(i => {
                const meta = SHOP_ITEMS.find(s => s.id === i.item_id);
                return `<div class="inv-item ${profile.avatar_url===i.item_id?'selected':''}" onclick="equip('avatar', '${i.item_id}')">
                    <img src="${meta.src}" style="width:100%">
                </div>`;
            }).join('');
    }

    window.equip = async (type, id) => {
        const update = type === 'avatar' ? { avatar_url: id } : { banner_url: id };
        await supabase.from('profiles').update(update).eq('id', user.id);
        profile[type === 'avatar' ? 'avatar_url' : 'banner_url'] = id;
        updateProfileUI();
        loadInventory();
    };

    window.loadLeaderboard = async (sortBy) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        if(event && event.target) event.target.classList.add('active');
        const { data } = await supabase.from('profiles').select('username, wins, xp, level').order(sortBy, { ascending: false }).limit(10);
        const list = document.getElementById('lb-list');
        list.innerHTML = data.map((p, i) => `
            <div class="lb-row"><span>${i+1}</span><span>${p.username}</span><span>${p[sortBy].toFixed(0)}</span></div>
        `).join('');
    };

    // --- ЕЖЕДНЕВНЫЕ ЗАДАНИЯ ---
    function checkDailyQuest() {
        const now = new Date();
        const lastClaim = profile.last_daily_claim ? new Date(profile.last_daily_claim) : new Date(0);
        const playedDateStr = localStorage.getItem('last_played_date');
        
        const btn = document.getElementById('claim-daily');
        const statusText = document.getElementById('daily-status-text');

        if(now.toDateString() === lastClaim.toDateString()) {
            btn.classList.add('hidden');
            if(statusText) statusText.innerText = "Выполнено ✅";
            return;
        }

        if(playedDateStr === now.toDateString()) {
            btn.classList.remove('hidden'); 
            btn.innerText = "Забрать 100💰";
            if(statusText) statusText.innerText = "Награда доступна!";
            
            btn.onclick = async () => {
                await supabase.from('profiles').update({ 
                    coins: profile.coins + 100,
                    last_daily_claim: now.toISOString()
                }).eq('id', user.id);
                profile.coins += 100;
                updateProfileUI();
                btn.classList.add('hidden');
                if(statusText) statusText.innerText = "Выполнено ✅";
            };
        } else {
            btn.classList.add('hidden');
            if(statusText) statusText.innerText = "Сыграйте 1 игру ⏳";
        }
    }

    window.switchTab = (tabName, btnElement) => {
        document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
        document.getElementById(`tab-${tabName}`).classList.remove('hidden');
        document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
        
        const targetBtn = btnElement || (event ? event.target : null);
        if(targetBtn) targetBtn.classList.add('active');
        
        // Скрываем бейджи при открытии
        if(tabName === 'friends') {
             loadFriends();
             loadFriendRequests();
             document.getElementById('req-badge').classList.add('hidden');
        }
        if(tabName === 'chats') {
            loadFriends(); // Загружаем список для чата
            document.getElementById('chat-badge').classList.add('hidden');
        }
        if(tabName === 'leaderboard') window.loadLeaderboard('wins');
    };

    // Создание комнаты
    const createConfirmButton = document.getElementById('create-confirm');
    if(createConfirmButton) {
        createConfirmButton.onclick = () => {
            const name = document.getElementById('r-name').value;
            const password = document.getElementById('r-pass').value;
            socket.emit('createRoom', { name, password });
            window.closeModals();
        };
    }

    // --- ИГРОВАЯ ЛОГИКА ---
    window.tryJoin = (id, isPriv, btn) => {
        if(btn) {
            btn.disabled = true;
            btn.innerText = "...";
        }
        let pass = isPriv ? prompt('Пароль') : null;
        socket.emit('joinRoom', { 
            roomId: id, password: pass, username: profile.username,
            avatar: profile.avatar_url, banner: profile.banner_url 
        });
        setTimeout(() => { if(btn) { btn.disabled = false; btn.innerText = "Войти"; }}, 2000);
    };
    
    socket.on('roomsList', list => {
        const container = document.getElementById('rooms-list');
        if(list.length === 0) container.innerHTML = '<div style="text-align:center; opacity:0.5; padding:20px">Нет столов</div>';
        else container.innerHTML = list.map(r => `
            <div class="room-item">
                <div><strong>${r.name}</strong><br><small>${r.players}/4</small></div>
                <button class="ios-btn small" onclick="tryJoin('${r.id}', ${r.isPrivate}, this)">Войти</button>
            </div>`).join('');
    });

    socket.on('joinSuccess', (roomId) => {
        currentRoomId = roomId;
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
    });

    socket.on('updateState', renderGame);

    function renderGame(state) {
        const me = state.me;
        const currentP = state.players[state.turnIndex];
        const isTurn = currentP.id === socket.id;

        document.getElementById('turn-txt').innerText = isTurn ? "ТВОЙ ХОД" : `Ходит: ${currentP.name}`;
        document.getElementById('turn-txt').style.color = isTurn ? '#34d399' : '#fff';
        document.getElementById('direction-arrow').innerText = state.direction === 1 ? '↻' : '↺'; 
        document.getElementById('color-dot').style.background = getColorHex(state.currentColor);

        if(state.topCard) document.getElementById('pile').innerHTML = renderCard(state.topCard, false);

        document.getElementById('opponents').innerHTML = state.players.filter(p => p.id !== socket.id).map(p => `
            <div class="opp-pill ${p.id === currentP.id ? 'opp-active' : ''}">
                <div style="width:30px;height:30px;border-radius:50%;background:#333;margin-bottom:5px;overflow:hidden">
                    <img src="${getAvatarSrc(p.avatar)}" style="width:100%">
                </div>
                <strong>${p.name}</strong>
                <small>🃏 ${p.handSize}</small>
                ${p.unoSaid ? '<span style="color:gold">UNO!</span>' : ''}
            </div>
        `).join('');

        if(me && me.hand) {
            document.getElementById('hand').innerHTML = me.hand.map((c, i) => renderCard(c, true, i, me.hand.length)).join('');
        }
        
        if(isTurn && me.hand.length === 2 && !state.players.find(p=>p.id===socket.id).unoSaid) {
            document.getElementById('uno-controls').classList.remove('hidden');
        } else {
            document.getElementById('uno-controls').classList.add('hidden');
        }
    }

    // --- ФУНКЦИЯ ОТРИСОВКИ КАРТ ---
    function renderCard(card, isHand, index, total) {
        const colorClass = card.color === 'wild' ? 'wild' : card.color;
        const style = isHand ? `style="transform: rotate(${(index - (total-1)/2)*5}deg); margin-bottom:${Math.abs((index-(total-1)/2)*5)}px"` : '';
        const click = isHand ? `onclick="clickCard(${index}, '${card.color}')"` : '';
        
        let displayValue = card.value;
        if(card.value === 'SKIP') displayValue = '⊘'; 
        else if(card.value === 'REVERSE') displayValue = '⇄'; 
        else if(card.value === 'WILD') displayValue = '★'; 
        else if(card.value === '+4') displayValue = '+4'; 
        else if(card.value === '+2') displayValue = '+2'; 

        const textStyle = card.color === 'wild' ? 'style="color: white; text-shadow: 0 0 5px black;"' : '';

        return `<div class="card ${colorClass}" ${click} ${style}><span ${textStyle}>${displayValue}</span></div>`;
    }

    function getColorHex(c) { return {red:'#ff5e62',blue:'#00c6ff',green:'#56ab2f',yellow:'#f09819',wild:'#fff'}[c] || '#fff'; }

    window.clickCard = (i, c) => {
        if(c === 'wild') { pendingIndex = i; document.getElementById('modal-color').classList.remove('hidden'); }
        else socket.emit('playCard', { roomId: currentRoomId, cardIndex: i });
    };
    let pendingIndex = -1;
    window.pickColor = (c) => {
        socket.emit('playCard', { roomId: currentRoomId, cardIndex: pendingIndex, chosenColor: c });
        window.closeModals();
    };
    
    document.getElementById('draw-btn').onclick = () => socket.emit('drawCard', currentRoomId);
    document.getElementById('deck').onclick = () => socket.emit('drawCard', currentRoomId);
    document.getElementById('uno-btn').onclick = () => socket.emit('sayUno', currentRoomId);
    document.getElementById('bot-btn').onclick = () => socket.emit('addBot', currentRoomId);
    document.getElementById('logout-btn').onclick = async () => { await supabase.auth.signOut(); location.reload(); };
});