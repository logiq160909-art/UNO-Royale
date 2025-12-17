window.addEventListener('load', () => {
    const supabaseUrl = 'https://wfjpudyikqphplxhovfm.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmanB1ZHlpa3FwaHBseGhvdmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc2NzEsImV4cCI6MjA4MTQ4MzY3MX0.AKgEfuvOYDQPlTf0NoOt5NDeldkSTH_XyFSH9EOIHmk';
    const lib = window.supabase || window.supabasejs;
    const supabase = lib.createClient(supabaseUrl, supabaseKey);
    const socket = io();
    let currentRoom = null;

    document.getElementById('login-btn').onclick = async () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        currentRoom = document.getElementById('room-id').value;
        if(!email || !password || !currentRoom) return alert("Заполни всё!");

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            await supabase.auth.signUp({ email, password });
            alert("Аккаунт создан! Нажми ИГРАТЬ еще раз.");
        } else {
            document.getElementById('auth-overlay').classList.add('hidden');
            document.getElementById('game-screen').classList.remove('hidden');
            socket.emit('joinRoom', { roomId: currentRoom, username: email.split('@')[0] });
        }
    };

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
        if(state.topCard) {
            const cardDiv = document.createElement('div');
            cardDiv.className = `card ${state.topCard.color}`;
            cardDiv.innerHTML = `<span>${state.topCard.value}</span>`;
            discard.appendChild(cardDiv);
        }

        const hand = document.getElementById('player-hand');
        hand.innerHTML = '';
        me.hand.forEach((card, i) => {
            const el = document.createElement('div');
            el.className = `card ${card.color}`;
            el.innerHTML = `<span>${card.value}</span>`;
            if (isMyTurn) {
                el.onclick = () => socket.emit('playCard', { roomId: currentRoom, cardIndex: i });
            }
            hand.appendChild(el);
        });
    }

    document.getElementById('draw-btn').onclick = () => socket.emit('drawCard', currentRoom);
});