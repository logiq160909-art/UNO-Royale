const socket = io();
const supabaseUrl = 'https://wfjpudyikqphplxhovfm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmanB1ZHlpa3FwaHBseGhvdmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc2NzEsImV4cCI6MjA4MTQ4MzY3MX0.AKgEfuvOYDQPlTf0NoOt5NDeldkSTH_XyFSH9EOIHmk';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

let user = null;
let profile = null;
let currentRoomId = null;
let currentChatPartner = null;

// --- УТИЛИТЫ ---
window.closeModals = () => document.querySelectorAll('.overlay').forEach(e => e.classList.add('hidden'));
function showToast(title, msg, actionBtn = null) {
    const box = document.createElement('div');
    box.className = 'toast';
    box.innerHTML = `<strong>${title}</strong><p>${msg}</p>`;
    if(actionBtn) box.appendChild(actionBtn);
    document.getElementById('toast-container').appendChild(box);
    setTimeout(() => box.remove(), 5000);
}

// --- АВТОРИЗАЦИЯ ---
window.addEventListener('load', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if(session) initLobby(session.user);

    document.getElementById('auth-btn').onclick = async () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        let { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if(error) {
            let { data: up, error: upErr } = await supabase.auth.signUp({ email, password });
            if(upErr) return alert(upErr.message);
            initLobby(up.user);
        } else initLobby(data.user);
    };
});

async function initLobby(u) {
    user = u;
    socket.emit('registerUser', user.id); // Регистрируемся в сокете для уведомлений

    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');

    // Профиль
    let { data: p } = await supabase.from('profiles').select('*').eq('id', u.id).single();
    if(!p) {
        const shortId = u.id.substr(0, 6);
        p = { id: u.id, username: u.email.split('@')[0], short_id: shortId, wins: 0, avatar: 'default' };
        await supabase.from('profiles').insert([p]);
    }
    profile = p;
    document.getElementById('u-name').innerText = p.username;
    document.getElementById('u-id').innerText = `ID: ${p.short_id}`;
    document.getElementById('stat-wins').innerText = p.wins;
    
    // Загрузка данных
    loadFriends();
    loadRequests();
}

// --- ВКЛАДКИ ---
window.switchTab = (tab, btn) => {
    document.querySelectorAll('.tab-content').forEach(e => e.classList.add('hidden'));
    document.getElementById(`tab-${tab}`).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(e => e.classList.remove('active'));
    if(btn) btn.classList.add('active');
};

// --- ДРУЗЬЯ И ЗАЯВКИ ---
window.sendFriendRequest = async () => {
    const shortId = document.getElementById('add-friend-input').value;
    if(shortId === profile.short_id) return alert("Это вы");
    
    const { data: target } = await supabase.from('profiles').select('id').eq('short_id', shortId).single();
    if(!target) return alert("Игрок не найден");

    const { error } = await supabase.from('friend_requests').insert({ sender_id: user.id, receiver_id: target.id });
    if(error) alert("Ошибка или уже отправлено");
    else {
        alert("Заявка отправлена!");
        socket.emit('sendFriendRequest', { toUserId: target.id, fromName: profile.username });
    }
};

async function loadRequests() {
    const { data: reqs } = await supabase.from('friend_requests').select('*, profiles:sender_id(username)').eq('receiver_id', user.id).eq('status', 'pending');
    const container = document.getElementById('requests-list');
    const badge = document.getElementById('req-badge');
    
    if(reqs && reqs.length > 0) {
        document.getElementById('requests-section').classList.remove('hidden');
        badge.innerText = `(${reqs.length})`;
        container.innerHTML = reqs.map(r => `
            <div class="req-item">
                <span>${r.profiles.username}</span>
                <div class="actions-row">
                    <button class="ios-btn small green" onclick="acceptReq('${r.id}', '${r.sender_id}')">✓</button>
                    <button class="ios-btn small red" onclick="rejectReq('${r.id}')">✗</button>
                </div>
            </div>
        `).join('');
    } else {
        document.getElementById('requests-section').classList.add('hidden');
        badge.innerText = "";
    }
}

window.acceptReq = async (reqId, friendId) => {
    await supabase.from('friend_requests').update({ status: 'accepted' }).eq('id', reqId);
    // Добавляем в friends (предполагаем наличие таблицы friends или используем логику запросов)
    // Упрощенно: считаем друзьями тех, у кого есть accepted request.
    // Но для списка друзей лучше добавить в таблицу `friends`
    await supabase.from('friends').insert([{ user_id: user.id, friend_id: friendId }, { user_id: friendId, friend_id: user.id }]);
    loadRequests();
    loadFriends();
};

window.rejectReq = async (reqId) => {
    await supabase.from('friend_requests').delete().eq('id', reqId);
    loadRequests();
};

async function loadFriends() {
    // Получаем список друзей из таблицы friends
    const { data: rels } = await supabase.from('friends').select('friend_id').eq('user_id', user.id);
    if(!rels) return;
    const friendIds = rels.map(r => r.friend_id);
    
    const { data: friends } = await supabase.from('profiles').select('*').in('id', friendIds);
    
    const render = (containerId, isInviteMode = false) => {
        const container = document.getElementById(containerId);
        if(!friends.length) return container.innerHTML = '<p style="opacity:0.5">Нет друзей</p>';
        
        container.innerHTML = friends.map(f => `
            <div class="friend-item">
                <div class="friend-info">
                    <div class="status-dot online"></div> <span>${f.username}</span>
                </div>
                ${isInviteMode 
                    ? `<button class="ios-btn small secondary" onclick="sendInvite('${f.id}')">Пригласить</button>`
                    : `<button class="ios-btn small secondary" onclick="openChat('${f.id}', '${f.username}')">Чат</button>`
                }
            </div>
        `).join('');
    };

    render('friends-list');
    render('chat-friends-list');
    render('invite-friends-list', true); // Для модалки инвайтов
}

// --- ЧАТ ---
window.openChat = async (friendId, friendName) => {
    currentChatPartner = { id: friendId, name: friendName };
    document.getElementById('chat-select-view').classList.add('hidden');
    document.getElementById('chat-conversation-view').classList.remove('hidden');
    document.getElementById('chat-partner-name').innerText = friendName;
    document.getElementById('tab-chats').classList.remove('hidden');
    switchTab('chats'); // Переключаем визуально

    // Загрузка истории
    const { data: msgs } = await supabase.from('messages')
        .select('*')
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${user.id})`)
        .order('created_at', { ascending: true });
        
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    msgs.forEach(displayMessage);
    container.scrollTop = container.scrollHeight;
};

window.closeChat = () => {
    currentChatPartner = null;
    document.getElementById('chat-conversation-view').classList.add('hidden');
    document.getElementById('chat-select-view').classList.remove('hidden');
};

window.sendMessage = async () => {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if(!text || !currentChatPartner) return;

    // Отправка в БД
    const msgObj = { sender_id: user.id, receiver_id: currentChatPartner.id, content: text };
    await supabase.from('messages').insert([msgObj]);

    // Отправка по сокету
    socket.emit('directMessage', { 
        toUserId: currentChatPartner.id, 
        content: text, 
        fromId: user.id,
        fromName: profile.username 
    });

    displayMessage(msgObj);
    input.value = '';
    const container = document.getElementById('chat-messages');
    container.scrollTop = container.scrollHeight;
};

function displayMessage(msg) {
    const div = document.createElement('div');
    const isMe = msg.sender_id === user.id;
    div.className = `message ${isMe ? 'msg-out' : 'msg-in'}`;
    div.innerText = msg.content;
    document.getElementById('chat-messages').appendChild(div);
}

// --- ИНВАЙТЫ И УВЕДОМЛЕНИЯ ---
window.openInviteModal = () => {
    loadFriends(); // Обновить список
    document.getElementById('modal-invite').classList.remove('hidden');
};

window.sendInvite = (friendId) => {
    if(!currentRoomId) return alert("Сначала войдите в комнату");
    socket.emit('inviteToGame', { toUserId: friendId, roomId: currentRoomId, fromName: profile.username });
    alert("Приглашение отправлено");
    closeModals();
};

// --- СОКЕТ СОБЫТИЯ ---
socket.on('newFriendRequest', ({ fromName }) => {
    showToast('Новая заявка в друзья', `От: ${fromName}`);
    loadRequests();
});

socket.on('receiveMessage', ({ fromId, content, fromName }) => {
    if(currentChatPartner && currentChatPartner.id === fromId) {
        displayMessage({ sender_id: fromId, content });
        const container = document.getElementById('chat-messages');
        container.scrollTop = container.scrollHeight;
    } else {
        showToast('Сообщение', `${fromName}: ${content}`, null);
    }
});

socket.on('gameInvite', ({ roomId, fromName }) => {
    const btn = document.createElement('button');
    btn.className = 'ios-btn small primary';
    btn.innerText = "Присоединиться";
    btn.onclick = () => {
        socket.emit('joinRoom', { roomId, username: profile.username, avatar: profile.avatar_url });
    };
    showToast('Приглашение в игру', `${fromName} зовет играть!`, btn);
});

// --- СТАНДАРТНАЯ ИГРА (Из прошлого кода, сокращенно) ---
socket.on('roomsList', list => {
    document.getElementById('rooms-list').innerHTML = list.map(r => `
        <div class="room-item">
            <span>${r.name} (${r.players}/4)</span>
            <button class="ios-btn small" onclick="joinGame('${r.id}')">Войти</button>
        </div>`).join('');
});
window.createRoom = () => socket.emit('createRoom', { name: "Стол " + profile.username });
window.joinGame = (id) => socket.emit('joinRoom', { roomId: id, username: profile.username });

socket.on('joinSuccess', (id) => {
    currentRoomId = id;
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
});

socket.on('updateState', state => {
    // Рендер игры (карт, стола, противников) - как в прошлом коде
    const me = state.myHand;
    const isTurn = state.opponents[state.turnIndex] ? state.opponents[state.turnIndex].id === socket.id : (state.turnIndex === -1); // Bugfix logic
    // ... (Рендер карт, тот же что и раньше)
    const handDiv = document.getElementById('hand');
    handDiv.innerHTML = me.map((c, i) => `<div class="card ${c.color === 'wild' ? 'wild' : c.color}" onclick="play(${i}, '${c.color}')"><span>${c.value}</span></div>`).join('');
    
    // Обновляем текст хода
    const turnName = state.opponents[state.turnIndex] ? state.opponents[state.turnIndex].name : "Вы";
    document.getElementById('turn-txt').innerText = isTurn ? "ВАШ ХОД" : `Ходит: ${turnName}`;
    document.getElementById('color-dot').style.background = state.currentColor === 'wild' ? '#fff' : ({red:'#ff5e62',blue:'#00c6ff',green:'#56ab2f',yellow:'#f09819'}[state.currentColor]);
    
    if(state.topCard) document.getElementById('pile').innerHTML = `<div class="card ${state.topCard.color === 'wild' ? 'wild' : state.topCard.color}"><span>${state.topCard.value}</span></div>`;

    document.getElementById('opponents').innerHTML = state.opponents.filter(p => p.id !== socket.id).map(p => `
        <div class="opp-pill"><b>${p.name}</b><br>${p.handSize} карт</div>
    `).join('');
});

// Игровые действия
window.drawCard = () => socket.emit('drawCard', currentRoomId);
window.play = (i, c) => {
    if(c === 'wild') {
        window.pendingIdx = i;
        document.getElementById('modal-color').classList.remove('hidden');
    } else socket.emit('playCard', { roomId: currentRoomId, cardIndex: i });
};
window.pick = (c) => {
    socket.emit('playCard', { roomId: currentRoomId, cardIndex: window.pendingIdx, chosenColor: c });
    closeModals();
}