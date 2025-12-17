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
        socket.emit('identify', u.id); // Сообщаем серверу ID пользователя для личных уведомлений
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
        checkDailyQuest();
        loadFriends();
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
        if(id === 'bot') return 'https://api.dicebear.com/7.x/bottts/svg?seed=Bot';
        const item = SHOP_ITEMS.find(i => i.id === id);
        return item ? item.src : 'https://api.dicebear.com/7.x/adventurer/svg?seed=Guest';
    }

    // --- ДРУЗЬЯ И ЧАТ ---
    window.addFriend = async () => {
        const fid = document.getElementById('friend-id-input').value;
        if(fid.length < 6) return alert("Неверный ID");
        const { data: target } = await supabase.from('profiles').select('id').eq('short_id', fid).single();
        if(!target) return alert("Игрок не найден");
        if(target.id === user.id) return alert("Нельзя добавить самого себя");

        const { error } = await supabase.from('friends').insert([
            { user_id: user.id, friend_id: target.id, status: 'pending', sender_id: user.id }
        ]);
        if(error) return alert("Запрос уже отправлен или ошибка");
        alert("Запрос отправлен!");
        loadFriends();
    };

    async function loadFriends() {
        // Получаем все связи, где участвует текущий юзер
        const { data: rels } = await supabase.from('friends')
            .select('*')
            .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);

        const friendsList = document.getElementById('friends-list');
        const inviteList = document.getElementById('invite-friends-list'); // Список в лобби игры
        const chatsList = document.getElementById('chats-list');
        
        if(!rels || rels.length === 0) {
            friendsList.innerHTML = '<p class="empty-msg">У вас нет друзей</p>';
            return;
        }

        const friendIds = rels.map(r => r.user_id === user.id ? r.friend_id : r.user_id);
        const { data: profiles } = await supabase.from('profiles').select('*').in('id', friendIds);

        // Рендер подтвержденных друзей
        const activeFriends = rels.filter(r => r.status === 'accepted');
        friendsList.innerHTML = profiles.filter(p => activeFriends.some(r => r.user_id === p.id || r.friend_id === p.id)).map(p => `
            <div class="room-item">
                <div class="profile-header">
                    <div class="avatar-container small"><img src="${getAvatarSrc(p.avatar_url)}"></div>
                    <div><strong>${p.username}</strong><br><small>Wins: ${p.wins}</small></div>
                </div>
                <div style="display:flex; gap:5px">
                    <button class="ios-btn primary small" onclick="openChat('${p.id}', '${p.username}')">💬</button>
                    ${currentRoomId ? `<button class="ios-btn small" style="background:var(--accent-green)" onclick="inviteFriend('${p.id}')">➕</button>` : ''}
                </div>
            </div>
        `).join('');

        // Рендер запросов (вкладка Чаты/Уведомления)
        const pendingIn = rels.filter(r => r.status === 'pending' && r.friend_id === user.id);
        chatsList.innerHTML = (pendingIn.length > 0 ? '<h4>Запросы в друзья</h4>' : '') + pendingIn.map(r => {
            const p = profiles.find(prof => prof.id === r.user_id);
            return `
            <div class="room-item request-item">
                <span><strong>${p.username}</strong> хочет дружить</span>
                <div>
                    <button class="ios-btn primary small" onclick="respondFriend('${r.user_id}', true)">✅</button>
                    <button class="ios-btn secondary small" onclick="respondFriend('${r.user_id}', false)">❌</button>
                </div>
            </div>`;
        }).join('') + (activeFriends.length > 0 ? '<h4>Диалоги</h4>' : '') + profiles.filter(p => activeFriends.some(r => r.user_id === p.id || r.friend_id === p.id)).map(p => `
            <div class="room-item" onclick="openChat('${p.id}', '${p.username}')">
                <strong>${p.username}</strong>
                <small>Нажмите, чтобы открыть чат</small>
            </div>
        `).join('');
    }

    window.respondFriend = async (otherId, accept) => {
        if(accept) {
            await supabase.from('friends').update({ status: 'accepted' }).match({ user_id: otherId, friend_id: user.id });
        } else {
            await supabase.from('friends').delete().match({ user_id: otherId, friend_id: user.id });
        }
        loadFriends();
    };

    window.openChat = async (friendId, name) => {
        activeChatFriendId = friendId;
        document.getElementById('chat-with-name').innerText = name;
        openModal('modal-chat');
        loadMessages();
    };

    async function loadMessages() {
        if(!activeChatFriendId) return;
        const { data } = await supabase.from('messages')
            .select('*')
            .or(`and(sender_id.eq.${user.id},receiver_id.eq.${activeChatFriendId}),and(sender_id.eq.${activeChatFriendId},receiver_id.eq.${user.id})`)
            .order('created_at', { ascending: true });
        
        const container = document.getElementById('chat-messages');
        container.innerHTML = data.map(m => `
            <div class="msg ${m.sender_id === user.id ? 'sent' : 'received'}">
                <div class="msg-bubble">${m.text}</div>
            </div>
        `).join('');
        container.scrollTop = container.scrollHeight;
    }

    window.sendMessage = async () => {
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if(!text || !activeChatFriendId) return;
        
        await supabase.from('messages').insert([{ sender_id: user.id, receiver_id: activeChatFriendId, text }]);
        input.value = '';
        loadMessages();
    };

    window.inviteFriend = (friendId) => {
        if(!currentRoomId) return alert("Сначала создайте или войдите в комнату");
        socket.emit('sendInvite', { to: friendId, fromName: profile.username, roomId: currentRoomId });
        alert("Приглашение отправлено!");
    };

    socket.on('receiveInvite', ({ fromName, roomId }) => {
        if(confirm(`${fromName} приглашает вас в игру! Принять?`)) {
            socket.emit('joinRoom', { 
                roomId, username: profile.username,
                avatar: profile.avatar_url, banner: profile.banner_url 
            });
        }
    });

    // --- ОБРАБОТКА КОНЦА ИГРЫ ---
    socket.on('gameEnded', async ({ winnerName, reward }) => {
        const modal = document.getElementById('modal-gameover');
        const title = document.getElementById('go-title');
        title.innerText = reward.won ? "ПОБЕДА!" : "ПОРАЖЕНИЕ";
        title.style.background = reward.won ? "linear-gradient(to right, #f09819, #edde5d)" : "gray";
        title.style.webkitBackgroundClip = "text";
        document.getElementById('go-xp').innerText = `+${reward.xp} XP`;
        document.getElementById('go-coins').innerText = `+${reward.coins} 💰`;
        modal.classList.remove('hidden');

        const todayStr = new Date().toDateString();
        localStorage.setItem('last_played_date', todayStr);

        const newXp = profile.xp + reward.xp;
        const newLevel = Math.floor(newXp / 100) + 1;
        const newCoins = profile.coins + reward.coins;
        const newWins = reward.won ? profile.wins + 1 : profile.wins;

        await supabase.from('profiles').update({ xp: newXp, level: newLevel, coins: newCoins, wins: newWins }).eq('id', user.id);
        profile.xp = newXp; profile.level = newLevel; profile.coins = newCoins; profile.wins = newWins;
        updateProfileUI();
    });

    window.backToLobby = () => location.reload();

    // --- МАГАЗИН И ИНВЕНТАРЬ ---
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

        await supabase.from('profiles').update({ coins: profile.coins - price }).eq('id', user.id);
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

    window.switchTab = (tabName, btnElement) => {
        document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
        document.getElementById(`tab-${tabName}`).classList.remove('hidden');
        document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
        const targetBtn = btnElement || (event ? event.target : null);
        if(targetBtn) targetBtn.classList.add('active');
        if(tabName === 'leaderboard') window.loadLeaderboard('wins');
        if(tabName === 'friends' || tabName === 'chats') loadFriends();
    };

    window.loadLeaderboard = async (sortBy) => {
        const { data } = await supabase.from('profiles').select('username, wins, xp, level').order(sortBy, { ascending: false }).limit(10);
        const list = document.getElementById('lb-list');
        list.innerHTML = data.map((p, i) => `<div class="lb-row"><span>${i+1}</span><span>${p.username}</span><span>${p[sortBy].toFixed(0)}</span></div>`).join('');
    };

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
            btn.onclick = async () => {
                await supabase.from('profiles').update({ coins: profile.coins + 100, last_daily_claim: now.toISOString() }).eq('id', user.id);
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

    // --- GAME ROOMS ---
    const createConfirmButton = document.getElementById('create-confirm');
    if(createConfirmButton) {
        createConfirmButton.onclick = () => {
            const name = document.getElementById('r-name').value;
            const password = document.getElementById('r-pass').value;
            socket.emit('createRoom', { name, password });
            window.closeModals();
        };
    }

    window.tryJoin = (id, isPriv, btn) => {
        let pass = isPriv ? prompt('Пароль') : null;
        socket.emit('joinRoom', { roomId: id, password: pass, username: profile.username, avatar: profile.avatar_url });
    };

    socket.on('roomsList', list => {
        const container = document.getElementById('rooms-list');
        container.innerHTML = list.map(r => `
            <div class="room-item">
                <div><strong>${r.name}</strong><br><small>${r.players}/4</small></div>
                <button class="ios-btn small" onclick="tryJoin('${r.id}', ${r.isPrivate}, this)">Войти</button>
            </div>`).join('');
    });

    socket.on('joinSuccess', (roomId) => {
        currentRoomId = roomId;
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
        loadFriends(); // Чтобы обновить кнопки приглашения
    });

    socket.on('updateState', renderGame);

    function renderGame(state) {
        const me = state.me;
        const currentP = state.players[state.turnIndex];
        const isTurn = currentP.id === socket.id;

        document.getElementById('turn-txt').innerText = isTurn ? "ТВОЙ ХОД" : `Ходит: ${currentP.name}`;
        document.getElementById('color-dot').style.background = getColorHex(state.currentColor);
        if(state.topCard) document.getElementById('pile').innerHTML = renderCard(state.topCard, false);

        document.getElementById('opponents').innerHTML = state.players.filter(p => p.id !== socket.id).map(p => `
            <div class="opp-pill ${p.id === currentP.id ? 'opp-active' : ''}">
                <div class="avatar-container small"><img src="${getAvatarSrc(p.avatar)}"></div>
                <strong>${p.name}</strong>
                <small>🃏 ${p.handSize}</small>
            </div>
        `).join('');

        if(me && me.hand) document.getElementById('hand').innerHTML = me.hand.map((c, i) => renderCard(c, true, i, me.hand.length)).join('');
    }

    function renderCard(card, isHand, index, total) {
        const colorClass = card.color === 'wild' ? 'wild' : card.color;
        const style = isHand ? `style="transform: rotate(${(index - (total-1)/2)*5}deg);"` : '';
        const click = isHand ? `onclick="clickCard(${index}, '${card.color}')"` : '';
        let val = card.value;
        if(val === 'SKIP') val = '⊘'; else if(val === 'REVERSE') val = '⇄'; else if(val === 'WILD') val = '★';
        return `<div class="card ${colorClass}" ${click} ${style}><span>${val}</span></div>`;
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
    document.getElementById('uno-btn').onclick = () => socket.emit('sayUno', currentRoomId);
    document.getElementById('bot-btn').onclick = () => socket.emit('addBot', currentRoomId);
    document.getElementById('logout-btn').onclick = async () => { await supabase.auth.signOut(); location.reload(); };
});