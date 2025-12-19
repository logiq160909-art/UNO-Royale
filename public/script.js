// --- ГЛОБАЛЬНЫЕ ФУНКЦИИ ---
window.openModal = (modalId) => {
    document.querySelectorAll('.overlay').forEach(e => e.classList.add('hidden'));
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('hidden');
}

window.closeModals = () => {
    document.querySelectorAll('.overlay').forEach(e => e.classList.add('hidden'));
};

// --- СИСТЕМА УРОВНЕЙ ---
function getLevelInfo(totalXp) {
    const level = Math.floor(Math.sqrt(totalXp / 100)) + 1;
    const startXp = Math.pow(level - 1, 2) * 100;
    const nextLevelAt = Math.pow(level, 2) * 100;
    return {
        level: level,
        progress: totalXp - startXp,
        needed: nextLevelAt - startXp,
        percent: ((totalXp - startXp) / (nextLevelAt - startXp)) * 100
    };
}

// --- ЛОГИКА ЕЖЕДНЕВНЫХ КВЕСТОВ ---
function getCurrentDailyQuest() {
    const dayIndex = new Date().getDate() % DAILY_QUESTS.length;
    return DAILY_QUESTS[dayIndex];
}

function updateQuestProgress(type, amount) {
    const today = new Date().toDateString();
    const savedDate = localStorage.getItem('quest_date');
    let progress = parseInt(localStorage.getItem('quest_progress') || '0');

    if (savedDate !== today) {
        progress = 0;
        localStorage.setItem('quest_date', today);
    }

    const currentQuest = getCurrentDailyQuest();
    
    if (currentQuest.type === type) {
        progress += amount;
        if(progress > currentQuest.target) progress = currentQuest.target;
        localStorage.setItem('quest_progress', progress);
    }
}

// --- КОНСТАНТЫ И НАСТРОЙКИ ---
const DAILY_QUESTS = [
    { id: 'quest_play', text: "Сыграть 1 игру", type: 'play', target: 1, reward: 100 },
    { id: 'quest_win', text: "Выиграть 1 игру", type: 'win', target: 1, reward: 150 },
    { id: 'quest_xp', text: "Набрать 100 XP", type: 'xp', target: 100, reward: 200 }
];

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
        { id: 'bn_gold', type: 'banner', name: 'Золото', price: 2000, color: 'linear-gradient(45deg, #f09819, #edde5d)' },
        { id: 'skin_neon', type: 'card_skin', name: 'Неон', price: 1500, previewColor: '#00ffcc' },
        { id: 'skin_gold', type: 'card_skin', name: 'Люкс', price: 3000, previewColor: '#ffd700' },
        { id: 'skin_dark', type: 'card_skin', name: 'Стелс', price: 1200, previewColor: '#1a1a1a' }
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
        registerSocket(); 
        socket.on('connect', registerSocket);

        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('lobby-screen').classList.remove('hidden');
        
        let { data: p } = await supabase.from('profiles').select('*').eq('id', u.id).single();
        if(!p) {
              const shortId = u.id.substr(0, 6);
              p = { id: u.id, username: u.email.split('@')[0], level: 1, xp: 0, wins: 0, coins: 0, short_id: shortId, card_skin: 'skin_default' };
              await supabase.from('profiles').insert([p]);
        }
        profile = p;
        if(!profile.card_skin) profile.card_skin = 'skin_default';

        updateProfileUI();
        loadShop();
        loadInventory();
        loadFriends();
        loadFriendRequests();
        renderDailyQuestUI(); 
        startChatListener();
        subscribeToFriendRequests();
    }

    function registerSocket() {
        if(user) socket.emit('registerUser', user.id);
    }

    function updateProfileUI() {
        if(!profile) return;
        
        const lvlInfo = getLevelInfo(profile.xp);
        profile.level = lvlInfo.level;

        document.getElementById('u-name').innerText = profile.username;
        document.getElementById('u-short-id').innerText = `ID: ${profile.short_id}`;
        
        document.getElementById('lvl-txt').innerText = `Lvl ${lvlInfo.level}`;
        document.getElementById('xp-details').innerText = `${Math.floor(lvlInfo.progress)} / ${lvlInfo.needed} XP`;
        document.getElementById('coin-balance').innerText = profile.coins;
        document.getElementById('xp-bar').style.width = lvlInfo.percent + '%';
        
        const avatarSrc = getAvatarSrc(profile.avatar_url);
        document.getElementById('my-avatar-display').innerHTML = `<img src="${avatarSrc}">`;
    }

    function getAvatarSrc(id) {
        if(!id || id === 'default') return 'https://api.dicebear.com/7.x/adventurer/svg?seed=Guest';
        const item = SHOP_ITEMS.find(i => i.id === id);
        return item ? item.src : 'https://api.dicebear.com/7.x/adventurer/svg?seed=Guest';
    }

    // --- ЛОГИКА UI КВЕСТА ---
    function renderDailyQuestUI() {
        const quest = getCurrentDailyQuest();
        const now = new Date();
        
        let lastClaimDateString = '';
        if (profile.last_daily_claim) {
            lastClaimDateString = new Date(profile.last_daily_claim).toDateString();
        }

        const savedDate = localStorage.getItem('quest_date');
        let progress = parseInt(localStorage.getItem('quest_progress') || '0');
        
        if(savedDate !== now.toDateString()) {
            progress = 0; 
        }

        const txt = document.getElementById('dq-text');
        const progBar = document.getElementById('dq-progress-bar');
        const progTxt = document.getElementById('dq-progress-text');
        const statusDiv = document.getElementById('dq-status');
        const btn = document.getElementById('claim-daily');
        const badge = document.getElementById('quest-badge');
        
        txt.innerText = quest.text;

        // Сброс видимости
        btn.classList.add('hidden');
        badge.classList.add('hidden');
        statusDiv.innerHTML = '';
        
        // 1. Уже забрали?
        if(lastClaimDateString === now.toDateString()) {
            progBar.style.width = '100%';
            progBar.style.background = '#34d399';
            progTxt.innerText = `${quest.target}/${quest.target}`;
            statusDiv.innerHTML = `<span style="color:#34d399">✅ ЗАДАНИЕ ВЫПОЛНЕНО</span>`;
            return;
        }

        // Обновляем прогресс
        const percent = Math.min((progress / quest.target) * 100, 100);
        progBar.style.width = percent + '%';
        progTxt.innerText = `${progress}/${quest.target}`;

        // 2. Готово к получению?
        if(progress >= quest.target) {
            badge.classList.remove('hidden'); 
            badge.innerText = "!";
            
            statusDiv.innerHTML = `<span style="color:#f09819">Награда доступна!</span>`;
            btn.classList.remove('hidden');
            btn.disabled = false;
            
            btn.onclick = async () => {
                btn.disabled = true;
                btn.innerText = "Зачисление...";
                
                const { error } = await supabase.from('profiles').update({ 
                    coins: profile.coins + quest.reward,
                    last_daily_claim: new Date().toISOString()
                }).eq('id', user.id);
                
                if(!error) {
                    profile.coins += quest.reward;
                    profile.last_daily_claim = new Date().toISOString();
                    updateProfileUI();
                    renderDailyQuestUI(); 
                    alert(`+${quest.reward} монет!`);
                } else {
                    alert("Ошибка соединения.");
                    btn.disabled = false;
                    btn.innerText = `ЗАБРАТЬ ${quest.reward} 💰`;
                }
            };
        } else {
            statusDiv.innerText = "В процессе...";
        }
    }

    // --- ДРУЗЬЯ ---
    function subscribeToFriendRequests() {
        supabase
        .channel('friend-db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests' }, (payload) => {
            if(payload.new.receiver_id === user.id || payload.new.sender_id === user.id || 
               payload.old.receiver_id === user.id || payload.old.sender_id === user.id) {
                loadFriendRequests();
                loadFriends();
            }
        })
        .subscribe();
    }

    window.sendFriendRequest = async () => {
        const fid = document.getElementById('friend-id-input').value.trim();
        if(fid.length < 6) return alert("Неверный ID");
        
        const { data: targetProfile } = await supabase.from('profiles').select('id').eq('short_id', fid).single();
        if(!targetProfile) return alert("Игрок не найден");
        if(targetProfile.id === user.id) return alert("Нельзя добавить себя");

        const { data: existing } = await supabase.from('friend_requests')
            .select('*')
            .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
            .or(`sender_id.eq.${targetProfile.id},receiver_id.eq.${targetProfile.id}`);

        const relation = existing ? existing.find(r => 
            (r.sender_id === user.id && r.receiver_id === targetProfile.id) || 
            (r.sender_id === targetProfile.id && r.receiver_id === user.id)
        ) : null;

        if(relation) {
            if(relation.status === 'accepted') return alert("Вы уже друзья!");
            return alert("Заявка уже существует");
        }

        const { error } = await supabase.from('friend_requests').insert([{ sender_id: user.id, receiver_id: targetProfile.id, status: 'pending' }]);
        if(error) alert("Ошибка: " + error.message);
        else {
            alert("Заявка отправлена!");
            document.getElementById('friend-id-input').value = '';
        }
    };

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
        const id = String(reqId);
        if (accept) {
            await supabase.from('friend_requests').update({ status: 'accepted' }).eq('id', id);
        } else {
            await supabase.from('friend_requests').delete().eq('id', id);
        }
        loadFriendRequests();
        loadFriends();
    };

    async function loadFriends() {
        const { data: rels } = await supabase.from('friend_requests')
            .select('sender_id, receiver_id')
            .eq('status', 'accepted')
            .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);
        
        const listDiv = document.getElementById('friends-list');
        const chatListDiv = document.getElementById('active-chats-list');

        if(!rels || rels.length === 0) {
            listDiv.innerHTML = '<p style="text-align:center;opacity:0.5">Список пуст</p>';
            chatListDiv.innerHTML = '<p style="text-align:center;opacity:0.5">Добавьте друзей</p>';
            return;
        }

        const friendIds = rels.map(r => r.sender_id === user.id ? r.receiver_id : r.sender_id);
        const { data: profiles } = await supabase.from('profiles').select('*').in('id', friendIds);

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

    // --- ЧАТ ---
    window.openChatWith = async (friendId, friendName) => {
        activeChatFriendId = friendId;
        document.getElementById('chat-friend-name').innerText = friendName;
        
        document.getElementById('chat-list-view').classList.add('hidden');
        document.getElementById('chat-conversation-view').classList.remove('hidden');
        
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
        
        const { data: msgs, error } = await supabase.from('messages')
            .select('*')
            .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
            .order('created_at', { ascending: true })
            .limit(100);

        if(error) {
             console.error("Ошибка чата:", error);
             msgContainer.innerHTML = '<div style="text-align:center;color:red">Ошибка загрузки</div>';
             return;
        }

        const filtered = msgs.filter(m => 
            (m.sender_id === user.id && m.receiver_id === friendId) ||
            (m.sender_id === friendId && m.receiver_id === user.id)
        );

        msgContainer.innerHTML = '';
        if(filtered.length === 0) {
            msgContainer.innerHTML = '<div style="text-align:center;opacity:0.5;margin-top:20px">Нет сообщений</div>';
        } else {
            filtered.forEach(renderMessage);
        }
        scrollToBottom();
    }

    function renderMessage(msg) {
        const container = document.getElementById('chat-messages');
        const isMine = msg.sender_id === user.id;
        
        let content = msg.content;
        if(msg.is_invite) {
            content = `<div class="invite-card">
                <div>Приглашение в игру!</div>
                ${!isMine ? `<button class="ios-btn small primary" onclick="acceptInvite('${msg.room_id}')">Присоединиться</button>` : '<small style="opacity:0.7">Отправлено</small>'}
            </div>`;
        } else {
            content = content.replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

        const { error } = await supabase.from('messages').insert([msgData]);
        if(error) {
            alert("Ошибка отправки: " + error.message);
            return;
        }
        
        socket.emit('privateMessage', { toUserId: activeChatFriendId, content: text, fromUsername: profile.username });
        renderMessage({ ...msgData });
        input.value = '';
    }

    window.sendInvite = async (friendId) => {
        if(!currentRoomId) return alert("Вы не в комнате!");
        
        const msgData = {
            sender_id: user.id,
            receiver_id: friendId,
            content: "Приглашение в игру",
            is_invite: true,
            room_id: currentRoomId
        };
        await supabase.from('messages').insert([msgData]);

        socket.emit('sendInvite', { toUserId: friendId, roomId: currentRoomId, fromUsername: profile.username });
        alert("Приглашение отправлено!");
        window.closeModals();
    };

    function startChatListener() {
        socket.on('receiveMessage', (data) => {
            if(activeChatFriendId === data.fromUserId) {
                renderMessage({ sender_id: data.fromUserId, content: data.content, is_invite: false });
            } else {
                const badge = document.getElementById('chat-badge');
                badge.classList.remove('hidden');
                badge.innerText = "!";
            }
        });

        socket.on('inviteReceived', (data) => {
            const modal = document.getElementById('modal-invite-received');
            document.getElementById('invite-text').innerText = `${data.fromUsername} зовет вас играть!`;
            
            document.getElementById('accept-invite-btn').onclick = () => {
                window.tryJoin(data.roomId, false, document.getElementById('accept-invite-btn'));
                window.closeModals();
            };
            modal.classList.remove('hidden');

            if(activeChatFriendId === data.fromUserId) {
                renderMessage({ sender_id: data.fromUserId, content: "Приглашение в игру", is_invite: true, room_id: data.roomId });
            }
        });

        socket.on('quattroEffect', (name) => {
             const flash = document.getElementById('quattro-flash');
             flash.innerText = `${name} QUATTRO!`;
             flash.classList.remove('hidden');
             setTimeout(() => flash.classList.add('hidden'), 2000);
        });
    }
    
    window.acceptInvite = (roomId) => {
        const dummyBtn = document.createElement('button');
        window.tryJoin(roomId, false, dummyBtn);
    };

    window.openInviteModal = async () => {
        const modal = document.getElementById('modal-invite-ingame');
        const list = document.getElementById('ingame-friend-list');
        list.innerHTML = 'Загрузка...';
        modal.classList.remove('hidden');

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

    // --- GAME ENDED ---
    socket.on('gameEnded', async ({ winnerName, reward }) => {
        currentRoomId = null; 
        const modal = document.getElementById('modal-gameover');
        const title = document.getElementById('go-title');
        
        title.innerText = reward.won ? "ПОБЕДА!" : "ПОРАЖЕНИЕ";
        title.style.background = reward.won ? "linear-gradient(to right, #f09819, #edde5d)" : "gray";
        title.style.webkitBackgroundClip = "text";
        title.style.webkitTextFillColor = "transparent";
        
        document.getElementById('go-xp').innerText = `+${reward.xp} XP`;
        document.getElementById('go-coins').innerText = `+${reward.coins} 💰`;

        modal.classList.remove('hidden');

        // --- ОБНОВЛЕНИЕ КВЕСТА ---
        updateQuestProgress('play', 1); 
        if(reward.won) updateQuestProgress('win', 1);
        updateQuestProgress('xp', reward.xp);

        // Обновляем статистику пользователя
        const newTotalXp = profile.xp + reward.xp;
        const lvlInfo = getLevelInfo(newTotalXp);
        const newLevel = lvlInfo.level;
        
        const newCoins = profile.coins + reward.coins;
        const newWins = reward.won ? profile.wins + 1 : profile.wins;

        const { error } = await supabase.from('profiles').update({
            xp: newTotalXp, level: newLevel, coins: newCoins, wins: newWins
        }).eq('id', user.id);

        if(!error) {
            profile.xp = newTotalXp;
            profile.level = newLevel;
            profile.coins = newCoins;
            profile.wins = newWins;
            updateProfileUI();
        }
    });

    window.backToLobby = () => {
        document.getElementById('modal-gameover').classList.add('hidden');
        document.getElementById('game-screen').classList.add('hidden');
        document.getElementById('lobby-screen').classList.remove('hidden');
        renderDailyQuestUI(); 
    };

    // --- SHOP & INVENTORY ---
    async function loadShop() {
        const grid = document.getElementById('shop-grid');
        grid.innerHTML = SHOP_ITEMS.map(item => {
            let preview = '';
            if(item.type === 'avatar') preview = `<img src="${item.src}">`;
            else if (item.type === 'card_skin') preview = `<div style="width:50px;height:70px;background:${item.previewColor};border-radius:5px;margin:0 auto 10px;border:1px solid rgba(255,255,255,0.2)"></div>`;
            else preview = `<div style="width:50px;height:50px;background:${item.color};border-radius:50%;margin:0 auto 10px"></div>`;

            return `
            <div class="shop-item" onclick="buyItem('${item.id}', ${item.price})">
                ${preview}
                <div>${item.name}</div>
                <div class="shop-price">${item.price} 💰</div>
            </div>`;
        }).join('');
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
        
        const skinsDiv = document.getElementById('inv-skins');
        skinsDiv.innerHTML = `<div class="inv-item ${profile.card_skin==='skin_default'?'selected':''}" onclick="equip('card_skin', 'skin_default')">Glass</div>` +
             myItems.filter(i => i.item_type === 'card_skin').map(i => {
                const meta = SHOP_ITEMS.find(s => s.id === i.item_id);
                return `<div class="inv-item ${profile.card_skin===i.item_id?'selected':''}" onclick="equip('card_skin', '${i.item_id}')" style="background:${meta.previewColor}">
                </div>`;
            }).join('');
    }

    window.equip = async (type, id) => {
        let update = {};
        if(type === 'avatar') { update = { avatar_url: id }; profile.avatar_url = id; }
        else if(type === 'banner') { update = { banner_url: id }; profile.banner_url = id; }
        else if(type === 'card_skin') { update = { card_skin: id }; profile.card_skin = id; }

        await supabase.from('profiles').update(update).eq('id', user.id);
        updateProfileUI();
        loadInventory();
        
        if(currentRoomId) {
             const deck = document.getElementById('deck');
             if(deck) {
                 deck.className = 'card card-back ' + (profile.card_skin || 'skin_default');
             }
        }
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

    window.switchTab = (tabName, btnElement) => {
        document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
        document.getElementById(`tab-${tabName}`).classList.remove('hidden');
        document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
        
        const targetBtn = btnElement || (event ? event.target : null);
        if(targetBtn) targetBtn.classList.add('active');
        
        if(tabName === 'friends') {
             loadFriends();
             loadFriendRequests();
             document.getElementById('req-badge').classList.add('hidden');
        }
        if(tabName === 'chats') {
            loadFriends(); 
            document.getElementById('chat-badge').classList.add('hidden');
        }
        if(tabName === 'quests') {
            document.getElementById('quest-badge').classList.add('hidden');
        }
        if(tabName === 'leaderboard') window.loadLeaderboard('wins');
    };

    const createConfirmButton = document.getElementById('create-confirm');
    if(createConfirmButton) {
        createConfirmButton.onclick = () => {
            const name = document.getElementById('r-name').value;
            const password = document.getElementById('r-pass').value;
            socket.emit('createRoom', { name, password });
            window.closeModals();
        };
    }

    // --- GAME ---
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

    // --- АВТОМАТИЧЕСКИЙ ВХОД ПОСЛЕ СОЗДАНИЯ ---
    socket.on('roomCreated', (roomId) => {
        const password = document.getElementById('r-pass').value;
        socket.emit('joinRoom', { 
            roomId: roomId, 
            password: password, 
            username: profile.username,
            avatar: profile.avatar_url, 
            banner: profile.banner_url 
        });
    });

    socket.on('joinSuccess', (roomId) => {
        currentRoomId = roomId;
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
        document.getElementById('deck').className = 'card card-back ' + (profile.card_skin || 'skin_default');
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

        // --- ЛОГИКА КНОПКИ "ВЗЯТЬ КАРТУ" / "ПРОПУСТИТЬ" ---
        const drawBtn = document.getElementById('draw-btn');
        if (state.me && state.me.hasDrawn) {
            drawBtn.innerText = "Пропустить ход";
            drawBtn.style.background = "rgba(255,255,255,0.2)"; // Визуально меняем стиль
        } else {
            drawBtn.innerText = "Взять карту";
            drawBtn.style.background = ""; // Сброс стиля
        }
        // --------------------------------------------------

        const userSkin = profile.card_skin || 'skin_default';

        if(state.topCard) document.getElementById('pile').innerHTML = renderCard(state.topCard, false, 0, 0, userSkin);

        document.getElementById('opponents').innerHTML = state.players.filter(p => p.id !== socket.id).map(p => `
            <div class="opp-pill ${p.id === currentP.id ? 'opp-active' : ''}">
                <div style="width:30px;height:30px;border-radius:50%;background:#333;margin-bottom:5px;overflow:hidden">
                    <img src="${getAvatarSrc(p.avatar)}" style="width:100%">
                </div>
                <strong>${p.name}</strong>
                <small>🃏 ${p.handSize}</small>
                ${p.quattroSaid ? '<span style="color:gold">QUATTRO!</span>' : ''}
            </div>
        `).join('');

        if(me && me.hand) {
            document.getElementById('hand').innerHTML = me.hand.map((c, i) => renderCard(c, true, i, me.hand.length, userSkin)).join('');
        }
        
        if(isTurn && me.hand.length === 2 && !state.players.find(p=>p.id===socket.id).quattroSaid) {
            document.getElementById('quattro-controls').classList.remove('hidden');
        } else {
            document.getElementById('quattro-controls').classList.add('hidden');
        }
    }

    function renderCard(card, isHand, index, total, skinClass) {
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
        const finalClass = `card ${colorClass} ${skinClass}`;

        return `<div class="${finalClass}" ${click} ${style}><span ${textStyle}>${displayValue}</span></div>`;
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
    document.getElementById('quattro-btn').onclick = () => socket.emit('sayQuattro', currentRoomId);
    document.getElementById('bot-btn').onclick = () => socket.emit('addBot', currentRoomId);
    document.getElementById('logout-btn').onclick = async () => { await supabase.auth.signOut(); location.reload(); };
});