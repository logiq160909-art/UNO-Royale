// Обертка для безопасности
window.addEventListener('load', () => {
    const supabaseUrl = 'https://wfjpudyikqphplxhovfm.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmanB1ZHlpa3FwaHBseGhvdmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc2NzEsImV4cCI6MjA4MTQ4MzY3MX0.AKgEfuvOYDQPlTf0NoOt5NDeldkSTH_XyFSH9EOIHmk';

    // Умный поиск библиотеки Supabase
    const lib = window.supabase || window.supabasejs;

    if (!lib) {
        alert("Ошибка: Библиотека Supabase не загрузилась. Проверьте интернет!");
        return;
    }

    const supabase = lib.createClient(supabaseUrl, supabaseKey);
    const socket = io();

    const loginBtn = document.getElementById('login-btn');
    const statusMsg = document.getElementById('status-msg');

    // Авторизация
    loginBtn.onclick = async () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        if (!email || !password) return alert("Введите данные!");

        statusMsg.innerText = "Вход...";
        let { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            // Если входа нет, пробуем регистрацию
            let { error: sError } = await supabase.auth.signUp({ email, password });
            if (sError) statusMsg.innerText = "Ошибка: " + sError.message;
            else statusMsg.innerText = "Проверьте почту!";
        } else {
            document.getElementById('auth-overlay').classList.add('hidden');
            document.getElementById('game-screen').classList.remove('hidden');
            socket.emit('joinRoyale', { username: email.split('@')[0] });
        }
    };

    // Сетевая логика
    socket.on('initGame', (state) => updateUI(state));
    socket.on('updateState', (state) => updateUI(state));

    function updateUI(state) {
        const me = state.players.find(p => p.id === socket.id);
        if (!me) return;

        const isMyTurn = state.players[state.turnIndex].id === socket.id;
        document.getElementById('turn-indicator').innerText = isMyTurn ? "ВАШ ХОД!" : `ХОДИТ: ${state.players[state.turnIndex].name}`;
        document.getElementById('color-dot').style.backgroundColor = `var(--${state.currentColor})`;

        const discard = document.getElementById('discard-pile');
        discard.innerHTML = '';
        if (state.topCard) {
            const topEl = document.createElement('div');
            const color = state.topCard.color === 'wild' ? state.currentColor : state.topCard.color;
            topEl.className = `card ${color}`;
            topEl.innerHTML = `<span>${state.topCard.value}</span>`;
            discard.appendChild(topEl);
        }

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

        document.getElementById('opponents').innerHTML = state.players
            .filter(p => p.id !== socket.id)
            .map(p => `<div class="glass-card" style="padding:10px; margin:5px; width:auto; display:inline-block; font-size:12px">
                ${p.name}<br>🂠 ${p.hand.length}
            </div>`).join('');
    }

    document.getElementById('draw-btn').onclick = () => socket.emit('drawCard');
    document.getElementById('draw-pile').onclick = () => socket.emit('drawCard');
});