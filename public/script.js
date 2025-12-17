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
        socket.emit('identify', user.id);
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

    // --- СИСТЕМА ДРУЗЕЙ И ЧАТА ---
    window.addFriend = async () => {
        const fid = document.getElementById('friend-id-input').value;
        if(fid.length < 6) return alert("Неверный ID");
        const { data: target } = await supabase.from('profiles').select('id').eq('short_id', fid).single();
        if(!target) return alert("Игрок не найден");
        await supabase.from('friends').insert([{ user_id: user.id, friend_id: target.id, sender_id: user.id }]);
        alert("Запрос отправлен!");
        loadFriends();
    };

    async function loadFriends() {
        const { data: rels } = await supabase.from('friends').select('*').or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);
        if(!rels) return;
        const friendIds = rels.map(r => r.user_id === user.id ? r.friend_id : r.user_id);
        const { data: profiles } = await supabase.from('profiles').select('*').in('id', friendIds);

        const accepted = rels.filter(r => r.status === 'accepted');
        
        // Вкладка Друзья
        document.getElementById('friends-list').innerHTML = profiles.filter(p => accepted.some(r => r.user_id === p.id || r.friend_id === p.id)).map(p => `
            <div class="room-item">
                <strong>${p.username}</strong>
                <div style="display:flex; gap:5px">
                    <button class="ios-btn small" onclick="openChat('${p.id}', '${p.username}')">💬</button>
                    ${currentRoomId ? `<button class="ios-btn small" style="background:#34d399" onclick="invite('${p.id}')">➕</button>` : ''}
                </div>
            </div>
        `).join('') || '<p style="text-align:center; opacity:0.5">Список пуст</p>';

        // Вкладка Чаты (Запросы + Диалоги)
        const pending = rels.filter(r => r.status === 'pending' && r.friend_id === user.id);
        document.getElementById('chats-list').innerHTML = pending.map(r => {
            const p = profiles.find(pr => pr.id === r.user_id);
            return `<div class="room-item"><span>Запрос от <b>${p.username}</b></span><button onclick="respondFriend('${r.user_id}', true)" class="ios-btn primary small">✅</button></div>`;
        }).join('') + profiles.filter(p => accepted.some(r => r.user_id === p.id || r.friend_id === p.id)).map(p => `
            <div class="room-item" onclick="openChat('${p.id}', '${p.username}')">
                <span>Чат с <b>${p.username}</b></span>
                <small>Нажмите, чтобы открыть</small>
            </div>
        `).join('');
    }

    window.respondFriend = async (oid, acc) => {
        if(acc) await supabase.from('friends').update({ status: 'accepted' }).match({ user_id: oid, friend_id: user.id });
        else await supabase.from('friends').delete().match({ user_id: oid, friend_id: user.id });
        loadFriends();
    };

    window.openChat = (id, name) => {
        activeChatFriendId = id;
        document.getElementById('chat-with-name').innerText = name;
        openModal('modal-chat');
        loadMessages();
    };

    async function loadMessages() {
        if(!activeChatFriendId) return;
        const { data } = await supabase.from('messages').select('*')
            .or(`and(sender_id.eq.${user.id},receiver_id.eq.${activeChatFriendId}),and(sender_id.eq.${activeChatFriendId},receiver_id.eq.${user.id})`)
            .order('created_at', { ascending: true });
        
        const cont = document.getElementById('chat-messages');
        cont.innerHTML = (data || []).map(m => `
            <div class="msg" style="display:flex; justify-content:${m.sender_id === user.id ? 'flex-end' : 'flex-start'}">
                <div class="bubble" style="background:${m.sender_id === user.id ? 'var(--primary)' : 'rgba(255,255,255,0.1)'}; padding:8px 12px; border-radius:12px; max-width:80%; margin:4px 0;">
                    ${m.text}
                </div>
            </div>
        `).join('');
        cont.scrollTop = cont.scrollHeight;
    }

    window.sendMessage = async () => {
        const input = document.getElementById('chat-input');
        if(!input.value.trim()) return;
        await supabase.from('messages').insert([{ sender_id: user.id, receiver_id: activeChatFriendId, text: input.value }]);
        input.value = '';
        loadMessages();
    };

    window.invite = (fid) => {
        socket.emit('sendInvite', { to: fid, fromName: profile.username, roomId: currentRoomId });
        alert("Приглашение отправлено!");
    };

    socket.on('receiveInvite', (d) => {
        if(confirm(`${d.fromName} приглашает вас за стол! Принять?`)) {
            socket.emit('joinRoom', { 
                roomId: d.roomId, username: profile.username,
                avatar: profile.avatar_url, banner: profile.banner_url 
            });
        }
    });

    // --- ОСТАЛЬНАЯ ЛОГИКА ---
    socket.on('gameEnded', async ({ winnerName, reward }) => {
        const modal = document.getElementById('modal-gameover');
        document.getElementById('go-title').innerText = reward.won ? "ПОБЕДА!" : "ПОРАЖЕНИЕ";
        document.getElementById('go-xp').innerText = `+${reward.xp} XP`;
        document.getElementById('go-coins').innerText = `+${reward.coins} 💰`;
        modal.classList.remove('hidden');

        localStorage.setItem('last_played_date', new Date().toDateString());
        const newXp = profile.xp + reward.xp;
        const { error } = await supabase.from('profiles').update({
            xp: newXp, level: Math.floor(newXp / 100) + 1, coins: profile.coins + reward.coins, wins: reward.won ? profile.wins + 1 : profile.wins
        }).eq('id', user.id);
        if(!error) location.reload();
    });

    window.switchTab = (tabName, btnElement) => {
        document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
        document.getElementById(`tab-${tabName}`).classList.remove('hidden');
        document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
        if(btnElement) btnElement.classList.add('active');
        if(tabName === 'friends' || tabName === 'chats') loadFriends();
        if(tabName === 'leaderboard') window.loadLeaderboard('wins');
    };

    async function loadShop() {
        document.getElementById('shop-grid').innerHTML = SHOP_ITEMS.map(item => `
            <div class="shop-item" onclick="buyItem('${item.id}', ${item.price})">
                ${item.type === 'avatar' ? `<img src="${item.src}">` : `<div style="width:50px;height:50px;background:${item.color};border-radius:50%;margin:0 auto 10px"></div>`}
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
        location.reload();
    };

    async function loadInventory() {
        const { data: items } = await supabase.from('user_items').select('*').eq('user_id', user.id);
        document.getElementById('inv-avatars').innerHTML = `<div class="inv-item" onclick="equip('avatar', 'default')">Default</div>` +
            (items || []).filter(i => i.item_type === 'avatar').map(i => {
                const meta = SHOP_ITEMS.find(s => s.id === i.item_id);
                return `<div class="inv-item" onclick="equip('avatar', '${i.item_id}')"><img src="${meta.src}" style="width:100%"></div>`;
            }).join('');
    }

    window.equip = async (type, id) => {
        const update = type === 'avatar' ? { avatar_url: id } : { banner_url: id };
        await supabase.from('profiles').update(update).eq('id', user.id);
        location.reload();
    };

    function checkDailyQuest() {
        const now = new Date();
        const playedDateStr = localStorage.getItem('last_played_date');
        const btn = document.getElementById('claim-daily');
        if(playedDateStr === now.toDateString() && profile.last_daily_claim !== now.toDateString()) {
            btn.classList.remove('hidden');
            btn.onclick = async () => {
                await supabase.from('profiles').update({ coins: profile.coins + 100, last_daily_claim: now.toDateString() }).eq('id', user.id);
                location.reload();
            };
        }
    }

    // --- GAME ENGINE ---
    document.getElementById('create-confirm').onclick = () => {
        socket.emit('createRoom', { name: document.getElementById('r-name').value });
        window.closeModals();
    };

    socket.on('roomsList', list => {
        document.getElementById('rooms-list').innerHTML = list.map(r => `
            <div class="room-item">
                <div><strong>${r.name}</strong><br><small>${r.players}/4</small></div>
                <button class="ios-btn small" onclick="socket.emit('joinRoom', {roomId:'${r.id}', username:profile.username, avatar:profile.avatar_url})">Войти</button>
            </div>`).join('');
    });

    socket.on('joinSuccess', (id) => { currentRoomId = id; document.getElementById('lobby-screen').classList.add('hidden'); document.getElementById('game-screen').classList.remove('hidden'); });

    socket.on('updateState', renderGame);

    function renderGame(state) {
        const me = state.me;
        const currentP = state.players[state.turnIndex];
        const isTurn = currentP.id === socket.id;

        document.getElementById('turn-txt').innerText = isTurn ? "ТВОЙ ХОД" : `Ходит: ${currentP.name}`;
        document.getElementById('color-dot').style.background = getColorHex(state.currentColor);
        document.getElementById('direction-arrow').innerText = state.direction === 1 ? '↻' : '↺';

        if(state.topCard) document.getElementById('pile').innerHTML = renderCard(state.topCard, false);
        document.getElementById('opponents').innerHTML = state.players.filter(p => p.id !== socket.id).map(p => `
            <div class="opp-pill ${p.id === currentP.id ? 'opp-active' : ''}">
                <div style="width:30px;height:30px;border-radius:50%;overflow:hidden"><img src="${getAvatarSrc(p.avatar)}" style="width:100%"></div>
                <strong>${p.name}</strong>
                <small>🃏 ${p.handSize}</small>
            </div>
        `).join('');

        document.getElementById('hand').innerHTML = me.hand.map((c, i) => renderCard(c, true, i)).join('');
    }

    function renderCard(card, isHand, index) {
        const colorClass = card.color === 'wild' ? 'wild' : card.color;
        const click = isHand ? `onclick="clickCard(${index}, '${card.color}')"` : '';
        let val = card.value;
        if(val === 'SKIP') val = '⊘'; else if(val === 'REVERSE') val = '⇄'; else if(val === 'WILD') val = '★';
        return `<div class="card ${colorClass}" ${click}><span>${val}</span></div>`;
    }

    function getColorHex(c) { return {red:'#ff5e62',blue:'#00c6ff',green:'#56ab2f',yellow:'#f09819',wild:'#fff'}[c] || '#fff'; }

    window.clickCard = (i, c) => {
        if(c === 'wild') { pendingIndex = i; openModal('modal-color'); }
        else socket.emit('playCard', { roomId: currentRoomId, cardIndex: i });
    };

    let pendingIndex = -1;
    window.pickColor = (c) => { socket.emit('playCard', { roomId: currentRoomId, cardIndex: pendingIndex, chosenColor: c }); window.closeModals(); };
    
    document.getElementById('draw-btn').onclick = () => socket.emit('drawCard', currentRoomId);
    document.getElementById('bot-btn').onclick = () => socket.emit('addBot', currentRoomId);
    document.getElementById('logout-btn').onclick = () => { supabase.auth.signOut(); location.reload(); };
});