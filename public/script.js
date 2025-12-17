const supabaseUrl = 'https://wfjpudyikqphplxhovfm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmanB1ZHlpa3FwaHBseGhvdmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc2NzEsImV4cCI6MjA4MTQ4MzY3MX0.AKgEfuvOYDQPlTf0NoOt5NDeldkSTH_XyFSH9EOIHmk';
const supabase = supabasejs.createClient(supabaseUrl, supabaseKey);
const socket = io();

// Авторизация
document.getElementById('login-btn').onclick = async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    let { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) return alert(signUpError.message);
        alert("Подтвердите почту!");
    } else {
        document.getElementById('auth-overlay').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
        socket.emit('joinRoyale', { username: email.split('@')[0] });
    }
};

// Игра
socket.on('initGame', (state) => updateUI(state));
socket.on('updateState', (state) => updateUI(state));

function updateUI(state) {
    const me = state.players.find(p => p.id === socket.id);
    if (!me) return;

    // Индикаторы
    const turnIndicator = document.getElementById('turn-indicator');
    const isMyTurn = state.players[state.turnIndex].id === socket.id;
    turnIndicator.innerText = isMyTurn ? "ВАШ ХОД!" : `ХОДИТ: ${state.players[state.turnIndex].name}`;
    document.getElementById('color-dot').style.backgroundColor = `var(--${state.currentColor})`;

    // Сброс
    const discard = document.getElementById('discard-pile');
    discard.innerHTML = '';
    const topCard = document.createElement('div');
    topCard.className = `card ${state.topCard.color === 'wild' ? state.currentColor : state.topCard.color}`;
    topCard.innerHTML = `<span>${state.topCard.value}</span>`;
    discard.appendChild(topCard);

    // Рука
    const hand = document.getElementById('player-hand');
    hand.innerHTML = '';
    me.hand.forEach((card, i) => {
        const el = document.createElement('div');
        el.className = `card ${card.color}`;
        el.innerHTML = `<span>${card.value}</span>`;
        if (isMyTurn) {
            el.classList.add('playable');
            el.onclick = () => socket.emit('playCard', i);
        }
        hand.appendChild(el);
    });

    // Оппоненты
    document.getElementById('opponents').innerHTML = state.players
        .filter(p => p.id !== socket.id)
        .map(p => `<div class="glass-card" style="padding:10px; margin:5px; display:inline-block">
            ${p.name} (🂠 ${p.hand.length})
        </div>`).join('');
}

document.getElementById('draw-btn').onclick = () => socket.emit('drawCard');
document.getElementById('draw-pile').onclick = () => socket.emit('drawCard');