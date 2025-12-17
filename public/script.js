// Переменные объявляем глобально
let socket;
let supabase;
let user = null, profile = null, currentRoomId = null, currentChatPartner = null, pendingIndex = null;

const SHOP_ITEMS = [
    { id: 'av_fox', type: 'avatar', name: 'Fox', price: 500, src: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix' },
    { id: 'av_robot', type: 'avatar', name: 'Bot', price: 1000, src: 'https://api.dicebear.com/7.x/bottts/svg?seed=Zork' }
];

window.closeModals = () => document.querySelectorAll('.overlay').forEach(e => e.classList.add('hidden'));
function showToast(title, msg, actionBtn = null) {
    const box = document.createElement('div');
    box.className = 'toast';
    box.innerHTML = `<strong>${title}</strong><p>${msg}</p>`;
    if(actionBtn) box.appendChild(actionBtn);
    document.getElementById('toast-container').appendChild(box);
    setTimeout(() => box.remove(), 5000);
}

// ГЛАВНЫЙ ЗАПУСК
window.addEventListener('load', async () => {
    // 1. Инициализация библиотек с защитой от сбоев
    const sbLib = window.supabase || window.supabasejs;
    if (!sbLib) return alert("Ошибка загрузки библиотек. Обновите страницу.");
    
    const supabaseUrl = 'https://wfjpudyikqphplxhovfm.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmanB1ZHlpa3FwaHBseGhvdmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc2NzEsImV4cCI6MjA4MTQ4MzY3MX0.AKgEfuvOYDQPlTf0NoOt5NDeldkSTH_XyFSH9EOIHmk';
    
    supabase = sbLib.createClient(supabaseUrl, supabaseKey);
    socket = io();

    // 2. Проверка сессии
    const { data: { session } } = await supabase.auth.getSession();
    if(session) initLobby(session.user);

    // 3. Обработчик входа
    document.getElementById('auth-btn').onclick = async () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        if(!email || !password) return alert("Введите данные");
        
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
    socket.emit('registerUser', user.id);
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');

    let { data: p } = await supabase.from('profiles').select('*').eq('id', u.id).single();
    if(!p) {
        p = { id: u.id, username: u.email.split('@')[0], short_id: u.id.substr(0, 6), wins: 0, coins: 0, level: 1, xp: 0, avatar_url: 'default' };
        await supabase.from('profiles').insert([p]);
    }
    profile = p;
    updateProfileUI();
    loadFriends(); loadRequests(); loadShop(); loadInventory(); checkDailyQuest();
}

function updateProfileUI() {
    document.getElementById('u-name').innerText = profile.username;
    document.getElementById('u-id').innerText = `ID: ${profile.short_id}`;
    document.getElementById('lvl-txt').innerText = `Lvl ${profile.level}`;
    document.getElementById('xp-details').innerText = `${Math.floor(profile.xp)} XP`;
    document.getElementById('coin-balance').innerText = profile.coins;
    document.getElementById('xp-bar').style.width = (profile.xp % 100) + '%';
    document.getElementById('my-avatar-display').innerHTML = `<img src="${getAvatarSrc(profile.avatar_url)}" style="width:100%">`;
}

function getAvatarSrc(id) {
    const item = SHOP_ITEMS.find(i => i.id === id);
    return item ? item.src : 'https://api.dicebear.com/7.x/adventurer/svg?seed=Guest';
}

// --- SOCIAL ---
window.sendFriendRequest = async () => {
    const shortId = document.getElementById('add-friend-input').value;
    if(shortId === profile.short_id) return alert("Это вы");
    const { data: target } = await supabase.from('profiles').select('id').eq('short_id', shortId).single();
    if(!target) return alert("Игрок не найден");
    const { error } = await supabase.from('friend_requests').insert({ sender_id: user.id, receiver_id: target.id });
    if(error) alert("Ошибка");
    else {
        alert("Заявка отправлена");
        socket.emit('sendFriendRequest', { toUserId: target.id, fromName: profile.username });
    }
};

async function loadRequests() {
    const { data: reqs } = await supabase.from('friend_requests').select('*, profiles:sender_id(username)').eq('receiver_id', user.id).eq('status', 'pending');
    const container = document.getElementById('requests-list');
    const badge = document.getElementById('req-badge');
    
    if(reqs && reqs.length) {
        document.getElementById('requests-section').classList.remove('hidden');
        badge.innerText = `(${reqs.length})`;
        container.innerHTML = reqs.map(r => `
            <div class="req-item"><span>${r.profiles.username}</span>
            <div class="actions-row"><button class="ios-btn small green" onclick="acceptReq('${r.id}', '${r.sender_id}')">✓</button>
            <button class="ios-btn small red" onclick="rejectReq('${r.id}')">✗</button></div></div>`).join('');
    } else {
        document.getElementById('requests-section').classList.add('hidden');
        badge.innerText = "";
    }
}

window.acceptReq = async (rid, fid) => {
    await supabase.from('friend_requests').update({ status: 'accepted' }).eq('id', rid);
    await supabase.from('friends').insert([{ user_id: user.id, friend_id: fid }, { user_id: fid, friend_id: user.id }]);
    loadRequests(); loadFriends();
};
window.rejectReq = async (rid) => { await supabase.from('friend_requests').delete().eq('id', rid); loadRequests(); };

async function loadFriends() {
    const { data: rels } = await supabase.from('friends').select('friend_id').eq('user_id', user.id);
    if(!rels) return;
    const fids = rels.map(r => r.friend_id);
    const { data: friends } = await supabase.from('profiles').select('*').in('id', fids);
    
    const render = (cid, invite=false) => {
        const c = document.getElementById(cid);
        if(!friends.length) return c.innerHTML = '<p style="opacity:0.5">Пусто</p>';
        c.innerHTML = friends.map(f => `
            <div class="friend-item">
                <div class="friend-info"><div class="status-dot online"></div><span>${f.username}</span></div>
                ${invite ? `<button class="ios-btn small secondary" onclick="sendInvite('${f.id}')">Позвать</button>` : `<button class="ios-btn small secondary" onclick="openChat('${f.id}', '${f.username}')">Чат</button>`}
            </div>`).join('');
    };
    render('friends-list'); render('chat-friends-list'); render('invite-friends-list', true);
}

// --- CHAT ---
window.openChat = async (fid, fname) => {
    currentChatPartner = { id: fid, name: fname };
    document.getElementById('chat-select-view').classList.add('hidden');
    document.getElementById('chat-conversation-view').classList.remove('hidden');
    document.getElementById('chat-partner-name').innerText = fname;
    window.switchTab('chats');
    const { data: msgs } = await supabase.from('messages').select('*').or(`and(sender_id.eq.${user.id},receiver_id.eq.${fid}),and(sender_id.eq.${fid},receiver_id.eq.${user.id})`).order('created_at', { ascending: true });
    const c = document.getElementById('chat-messages');
    c.innerHTML = '';
    msgs.forEach(displayMessage);
    c.scrollTop = c.scrollHeight;
};
window.closeChat = () => { currentChatPartner = null; document.getElementById('chat-conversation-view').classList.add('hidden'); document.getElementById('chat-select-view').classList.remove('hidden'); };
window.sendMessage = async () => {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if(!text || !currentChatPartner) return;
    const msgObj = { sender_id: user.id, receiver_id: currentChatPartner.id, content: text };
    await supabase.from('messages').insert([msgObj]);
    socket.emit('directMessage', { toUserId: currentChatPartner.id, content: text, fromId: user.id, fromName: profile.username });
    displayMessage(msgObj);
    input.value = '';
};
function displayMessage(msg) {
    const div = document.createElement('div');
    div.className = `message ${msg.sender_id === user.id ? 'msg-out' : 'msg-in'}`;
    div.innerText = msg.content;
    const c = document.getElementById('chat-messages');
    c.appendChild(div);
    c.scrollTop = c.scrollHeight;
}

// --- INVITES ---
window.openInviteModal = () => { loadFriends(); document.getElementById('modal-invite').classList.remove('hidden'); };
window.sendInvite = (fid) => {
    if(!currentRoomId) return alert("Войдите в комнату");
    socket.emit('inviteToGame', { toUserId: fid, roomId: currentRoomId, fromName: profile.username });
    alert("Отправлено"); window.closeModals();
};

if (typeof socket !== 'undefined') {
    socket.on('newFriendRequest', ({ fromName }) => showToast('Заявка', `От: ${fromName}`));
    socket.on('receiveMessage', ({ fromId, content, fromName }) => {
        if(currentChatPartner && currentChatPartner.id === fromId) {
            displayMessage({ sender_id: fromId, content });
        } else showToast('Сообщение', `${fromName}: ${content}`);
    });
    socket.on('gameInvite', ({ roomId, fromName }) => {
        const btn = document.createElement('button');
        btn.className = 'ios-btn small primary';
        btn.innerText = "Играть";
        btn.onclick = () => socket.emit('joinRoom', { roomId, username: profile.username, avatar: profile.avatar_url });
        showToast('Приглашение', `${fromName} зовет!`, btn);
    });
    // --- GAME LOGIC ---
    socket.on('roomsList', list => {
        document.getElementById('rooms-list').innerHTML = list.map(r => `
            <div class="room-item"><span>${r.name} (${r.players}/4)</span><button class="ios-btn small" onclick="tryJoin('${r.id}', ${r.isPrivate}, this)">Войти</button></div>`).join('');
    });
    
    socket.on('joinSuccess', (id) => {
        currentRoomId = id;
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
    });

    socket.on('updateState', renderGame);
}

window.createRoom = () => {
    document.getElementById('modal-create').classList.remove('hidden');
    document.getElementById('create-confirm').onclick = () => {
        socket.emit('createRoom', { name: document.getElementById('r-name').value, password: document.getElementById('r-pass').value });
        window.closeModals();
    };
};
window.tryJoin = (id, isPriv, btn) => {
    btn.disabled = true; btn.innerText = "...";
    let pass = isPriv ? prompt('Pass?') : null;
    socket.emit('joinRoom', { roomId: id, password: pass, username: profile.username, avatar: profile.avatar_url });
    setTimeout(() => { btn.disabled = false; btn.innerText = "Войти"; }, 2000);
};

function renderGame(state) {
    const me = state.me;
    const currentP = state.players[state.turnIndex];
    const isTurn = currentP.id === socket.id;
    document.getElementById('turn-txt').innerText = isTurn ? "ТВОЙ ХОД" : `Ходит: ${currentP.name}`;
    document.getElementById('color-dot').style.background = getColorHex(state.currentColor);
    
    if(state.topCard) document.getElementById('pile').innerHTML = renderCard(state.topCard, false);
    
    document.getElementById('opponents').innerHTML = state.players.filter(p => p.id !== socket.id).map(p => `
        <div class="opp-pill ${p.id===currentP.id?'opp-active':''}"><div style="width:30px;height:30px;border-radius:50%;background:#333;overflow:hidden"><img src="${getAvatarSrc(p.avatar)}" style="width:100%"></div><strong>${p.name}</strong><small>🃏 ${p.handSize}</small>${p.unoSaid?'<span style="color:gold">UNO!</span>':''}</div>`).join('');
    
    if(me && me.hand) document.getElementById('hand').innerHTML = me.hand.map((c, i) => renderCard(c, true, i, me.hand.length)).join('');
    if(isTurn && me.hand.length === 2) document.getElementById('uno-controls').classList.remove('hidden');
    else document.getElementById('uno-controls').classList.add('hidden');
}

// --- ВИЗУАЛ КАРТ (СИМВОЛЫ) ---
function renderCard(card, isHand, index, total) {
    const colorClass = card.color === 'wild' ? 'wild' : card.color;
    const style = isHand ? `style="transform: rotate(${(index - (total-1)/2)*5}deg); margin-bottom:${Math.abs((index-(total-1)/2)*5)}px"` : '';
    const click = isHand ? `onclick="clickCard(${index}, '${card.color}')"` : '';
    
    let display = card.value;
    if(card.value === 'SKIP') display = '⊘';
    else if(card.value === 'REVERSE') display = '⇄';
    else if(card.value === 'WILD') display = '★';
    
    const ts = card.color==='wild'?'style="color:white;text-shadow:0 0 5px black"':'';
    return `<div class="card ${colorClass}" ${click} ${style}><span ${ts}>${display}</span></div>`;
}

function getColorHex(c) { return {red:'#ff5e62',blue:'#00c6ff',green:'#56ab2f',yellow:'#f09819',wild:'#fff'}[c] || '#fff'; }

window.clickCard = (i, c) => { if(c === 'wild') { pendingIndex = i; document.getElementById('modal-color').classList.remove('hidden'); } else socket.emit('playCard', { roomId: currentRoomId, cardIndex: i }); };
window.pick = (c) => { socket.emit('playCard', { roomId: currentRoomId, cardIndex: pendingIndex, chosenColor: c }); window.closeModals(); };
document.getElementById('draw-btn').onclick = () => socket.emit('drawCard', currentRoomId);
document.getElementById('deck').onclick = () => socket.emit('drawCard', currentRoomId);
document.getElementById('uno-btn').onclick = () => socket.emit('sayUno', currentRoomId);

// --- END GAME & QUESTS ---
if (typeof socket !== 'undefined') {
    socket.on('gameEnded', async ({ winnerName, reward }) => {
        document.getElementById('modal-gameover').classList.remove('hidden');
        document.getElementById('go-title').innerText = reward.won ? "ПОБЕДА!" : "ПОРАЖЕНИЕ";
        document.getElementById('go-xp').innerText = `+${reward.xp}`;
        document.getElementById('go-coins').innerText = `+${reward.coins}`;
        
        // Сохраняем факт игры СЕГОДНЯ
        localStorage.setItem('last_played_date', new Date().toDateString());

        const { error } = await supabase.from('profiles').update({
            xp: profile.xp + reward.xp, coins: profile.coins + reward.coins, 
            wins: reward.won ? profile.wins + 1 : profile.wins
        }).eq('id', user.id);
        if(!error) { profile.xp += reward.xp; profile.coins += reward.coins; }
    });
}

function checkDailyQuest() {
    const now = new Date().toDateString();
    const last = profile.last_daily_claim ? new Date(profile.last_daily_claim).toDateString() : '';
    const played = localStorage.getItem('last_played_date');
    const btn = document.getElementById('claim-daily');
    const txt = document.getElementById('daily-status-text');

    if(now === last) { btn.classList.add('hidden'); txt.innerText = "Выполнено ✅"; return; }
    if(played === now) {
        btn.classList.remove('hidden'); txt.innerText = "Награда доступна!";
        btn.onclick = async () => {
            await supabase.from('profiles').update({ coins: profile.coins+100, last_daily_claim: new Date().toISOString() }).eq('id', user.id);
            profile.coins += 100; updateProfileUI(); btn.classList.add('hidden'); txt.innerText = "Выполнено ✅";
        };
    } else {
        btn.classList.add('hidden'); txt.innerText = "Сыграйте 1 игру ⏳";
    }
}

window.backToLobby = () => location.reload();
window.switchTab = (tab, btn) => {
    document.querySelectorAll('.tab-content').forEach(e => e.classList.add('hidden'));
    document.getElementById(`tab-${tab}`).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(e => e.classList.remove('active'));
    if(btn) btn.classList.add('active');
};

async function loadShop() { /* Код магазина (для краткости) */ }
window.buyItem = async (id, pr) => { /* Код покупки */ }
async function loadInventory() { /* Код инвентаря */ }