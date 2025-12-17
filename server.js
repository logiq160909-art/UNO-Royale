const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

let rooms = {};

// --- ГЕНЕРАТОР КОЛОДЫ ---
function createDeck() {
    const colors = ['red', 'blue', 'green', 'yellow'];
    const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'SKIP', 'REVERSE', '+2'];
    let deck = [];
    
    colors.forEach(c => {
        values.forEach(v => {
            deck.push({ color: c, value: v, uid: Math.random().toString(36) }); // UID для анимаций React/Vue (на будущее)
            if (v !== '0') deck.push({ color: c, value: v, uid: Math.random().toString(36) });
        });
    });

    for (let i = 0; i < 4; i++) {
        deck.push({ color: 'wild', value: 'WILD', uid: Math.random() });
        deck.push({ color: 'wild', value: '+4', uid: Math.random() });
    }
    
    return deck.sort(() => Math.random() - 0.5);
}

// --- УПРАВЛЕНИЕ КОМНАТАМИ ---
function destroyRoom(roomId) {
    if (rooms[roomId]) {
        delete rooms[roomId];
        io.emit('roomsList', getRoomsPublicInfo());
    }
}

function getRoomsPublicInfo() {
    return Object.values(rooms).map(r => ({
        id: r.id,
        name: r.name,
        players: r.players.length,
        isPrivate: !!r.password
    }));
}

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ИГРЫ ---
function getNextPlayerIndex(room, step = 1) {
    // Математика для циклического сдвига с учетом направления
    // (index + direction * step + length) % length
    return (room.turnIndex + (room.direction * step) % room.players.length + room.players.length) % room.players.length;
}

function nextTurn(room) {
    room.turnIndex = getNextPlayerIndex(room, 1);
}

// --- ОТПРАВКА СОСТОЯНИЯ (СЕКЬЮРНАЯ) ---
async function broadcastGameState(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    // Получаем список сокетов в комнате
    const sockets = await io.in(roomId).fetchSockets();

    // Формируем публичную часть состояния (без карт в руках)
    const publicPlayers = room.players.map(p => ({
        id: p.id,
        name: p.name,
        handSize: p.hand.length,
        isBot: p.isBot,
        unoSaid: p.unoSaid
    }));

    const baseState = {
        id: room.id,
        topCard: room.topCard,
        currentColor: room.currentColor,
        turnIndex: room.turnIndex,
        direction: room.direction, // 1 или -1
        players: publicPlayers,
        gameStarted: room.gameStarted
    };

    // Отправляем каждому игроку персональный пакет
    for (const socket of sockets) {
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            socket.emit('updateState', {
                ...baseState,
                me: { hand: player.hand } // Только свои карты!
            });
        }
    }
    
    // Для ботов обновление не нужно, но логика ботов вызывается отдельно
}

io.on('connection', (socket) => {
    socket.emit('roomsList', getRoomsPublicInfo());

    // СОЗДАНИЕ
    socket.on('createRoom', ({ name, password }) => {
        const roomId = Math.random().toString(36).substr(2, 6);
        rooms[roomId] = {
            id: roomId,
            name: name || `Room #${roomId}`,
            password: password || null,
            players: [],
            deck: createDeck(),
            topCard: null,
            turnIndex: 0,
            direction: 1, // 1: по часовой, -1: против
            currentColor: '',
            gameStarted: false,
            timer: setTimeout(() => destroyRoom(roomId), 900000) // 15 мин бездействия
        };
        socket.emit('roomCreated', roomId);
        io.emit('roomsList', getRoomsPublicInfo());
    });

    // ВХОД
    socket.on('joinRoom', ({ roomId, password, username }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'Комната не найдена');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'Неверный пароль');
        
        // Реконнект
        const existingPlayer = room.players.find(p => p.id === socket.id);
        if (existingPlayer) {
            socket.join(roomId);
            socket.emit('joinSuccess', roomId);
            broadcastGameState(roomId);
            return;
        }

        if (room.players.length >= 4) return socket.emit('errorMsg', 'Мест нет');
        if (room.gameStarted) return socket.emit('errorMsg', 'Игра уже идет');

        clearTimeout(room.timer);
        room.timer = setTimeout(() => destroyRoom(roomId), 600000); // 10 мин

        socket.join(roomId);
        room.players.push({ id: socket.id, name: username || 'Player', hand: [], isBot: false, unoSaid: false });

        socket.emit('joinSuccess', roomId);

        if (room.players.length >= 2 && !room.gameStarted) {
             // Автостарт (можно убрать, если нужна кнопка "Старт")
             startGame(room);
        } else {
             broadcastGameState(roomId);
        }
        
        io.emit('roomsList', getRoomsPublicInfo());
    });

    // ДОБАВИТЬ БОТА
    socket.on('addBot', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players.length < 4 && !room.gameStarted) {
            const botId = "bot_" + Math.random().toString(36).substr(2, 5);
            room.players.push({ id: botId, name: "Bot Alex", hand: [], isBot: true, unoSaid: false });
            if (room.players.length >= 2) startGame(room);
            else broadcastGameState(roomId);
        }
    });

    function startGame(room) {
        room.gameStarted = true;
        room.deck = createDeck();
        room.direction = 1;
        room.players.forEach(p => p.hand = room.deck.splice(0, 7));
        
        do { room.topCard = room.deck.pop(); } while (room.topCard.color === 'wild');
        
        room.currentColor = room.topCard.color;
        room.turnIndex = Math.floor(Math.random() * room.players.length);

        // Обработка первой карты, если она особенная
        if (room.topCard.value === 'REVERSE') {
            room.direction = -1;
            room.turnIndex = getNextPlayerIndex(room, 0); // Разворот на месте
            if(room.players.length === 2) nextTurn(room); // Для 2 игроков Reverse = Skip
        } else if (room.topCard.value === 'SKIP') {
            nextTurn(room);
        }

        broadcastGameState(room.id);
        checkBotTurn(room);
    }

    // ХОД ИГРОКА
    socket.on('playCard', ({ roomId, cardIndex, chosenColor }) => {
        const room = rooms[roomId];
        if (!room) return;
        
        clearTimeout(room.timer);
        room.timer = setTimeout(() => destroyRoom(roomId), 600000);

        const player = room.players[room.turnIndex];
        if (player.id !== socket.id) return; // Не твой ход

        const card = player.hand[cardIndex];
        const isWild = card.color === 'wild';
        
        // Проверка валидности хода
        const isMatch = (card.color === room.currentColor) || 
                        (card.value === room.topCard.value) || 
                        isWild;

        if (isMatch) {
            // Удаляем карту
            player.hand.splice(cardIndex, 1);
            room.topCard = card;
            room.currentColor = isWild ? chosenColor : card.color;

            // Логика спецкарт
            if (card.value === 'REVERSE') {
                room.direction *= -1;
                if (room.players.length === 2) nextTurn(room); // Reverse работает как Skip для 2 игроков
            }
            else if (card.value === 'SKIP') {
                nextTurn(room);
            }
            else if (card.value === '+2') {
                const victimIndex = getNextPlayerIndex(room, 1);
                const victim = room.players[victimIndex];
                addCardsToPlayer(room, victim, 2);
                nextTurn(room); // Жертва пропускает ход
            }
            else if (card.value === '+4') {
                const victimIndex = getNextPlayerIndex(room, 1);
                const victim = room.players[victimIndex];
                addCardsToPlayer(room, victim, 4);
                nextTurn(room); // Жертва пропускает ход
            }

            // Проверка победы
            if (player.hand.length === 0) {
                io.to(roomId).emit('gameOver', { winner: player.name, id: player.id });
                resetGame(room);
                return;
            }

            // Переход хода
            nextTurn(room);
            broadcastGameState(roomId);
            checkBotTurn(room);
        }
    });

    socket.on('drawCard', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.turnIndex];
        if (player.id !== socket.id) return;

        addCardsToPlayer(room, player, 1);
        player.unoSaid = false; // Сброс UNO флага при взятии
        
        nextTurn(room);
        broadcastGameState(roomId);
        checkBotTurn(room);
    });

    socket.on('sayUno', (roomId) => {
        const room = rooms[roomId];
        if(!room) return;
        const p = room.players.find(pl => pl.id === socket.id);
        if(p && p.hand.length <= 2 && !p.unoSaid) {
            p.unoSaid = true;
            io.to(roomId).emit('unoEffect', p.name);
            broadcastGameState(roomId);
        }
    });

    // --- ЛОГИКА БОТА ---
    function checkBotTurn(room) {
        if (!room.gameStarted) return;
        const player = room.players[room.turnIndex];
        
        if (player && player.isBot) {
            setTimeout(() => {
                // Проверяем, не закончилась ли игра пока ждали таймер
                if (!rooms[room.id] || !room.gameStarted) return;

                // Бот ищет карту
                const matchIndex = player.hand.findIndex(c => 
                    c.color === 'wild' || 
                    c.color === room.currentColor || 
                    c.value === room.topCard.value
                );
                
                if (matchIndex !== -1) {
                    // Бот ходит
                    const card = player.hand[matchIndex];
                    player.hand.splice(matchIndex, 1);
                    room.topCard = card;
                    
                    // Бот выбирает цвет (просто тот, которого больше в руке, или рандом)
                    if (card.color === 'wild') {
                        const counts = { red:0, blue:0, green:0, yellow:0 };
                        player.hand.forEach(c => { if(c.color !== 'wild') counts[c.color]++; });
                        room.currentColor = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
                    } else {
                        room.currentColor = card.color;
                    }

                    // Сказать UNO если надо
                    if (player.hand.length === 1) {
                        player.unoSaid = true;
                        io.to(room.id).emit('unoEffect', player.name);
                    }

                    // Эффекты карт
                    if (card.value === 'REVERSE') {
                        room.direction *= -1;
                        if (room.players.length === 2) nextTurn(room);
                    }
                    else if (card.value === 'SKIP') {
                        nextTurn(room);
                    }
                    else if (card.value === '+2') {
                        const victim = room.players[getNextPlayerIndex(room, 1)];
                        addCardsToPlayer(room, victim, 2);
                        nextTurn(room);
                    }
                    else if (card.value === '+4') {
                        const victim = room.players[getNextPlayerIndex(room, 1)];
                        addCardsToPlayer(room, victim, 4);
                        nextTurn(room);
                    }

                    if (player.hand.length === 0) {
                        io.to(room.id).emit('gameOver', { winner: player.name, id: player.id });
                        resetGame(room);
                        return;
                    }
                } else {
                    // Бот берет карту
                    addCardsToPlayer(room, player, 1);
                    player.unoSaid = false;
                }

                nextTurn(room);
                broadcastGameState(room.id);
                checkBotTurn(room); // Рекурсия, если следующий тоже бот
            }, 1500);
        }
    }

    function addCardsToPlayer(room, player, count) {
        if (room.deck.length < count) {
            // Если колода пуста, восстанавливаем из сброса (упрощенно: просто создаем новую)
            room.deck = createDeck(); 
        }
        player.hand.push(...room.deck.splice(0, count));
    }

    function resetGame(room) {
        room.gameStarted = false;
        room.players = []; // Кикаем всех (или можно оставить)
        room.deck = createDeck();
        broadcastGameState(room.id);
        io.emit('roomsList', getRoomsPublicInfo());
    }
});

server.listen(process.env.PORT || 3000, () => console.log('Server running on port 3000'));