const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

let rooms = {};
let userSockets = {};

// Экономика
const REWARDS = {
    WIN_XP: 100,
    WIN_COINS: 50,
    LOSE_XP: 25,
    LOSE_COINS: 10
};

function createDeck() {
    const colors = ['red', 'blue', 'green', 'yellow'];
    const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'SKIP', 'REVERSE', '+2'];
    let deck = [];
    colors.forEach(c => values.forEach(v => {
        deck.push({ color: c, value: v, uid: Math.random().toString(36) });
        if (v !== '0') deck.push({ color: c, value: v, uid: Math.random().toString(36) });
    }));
    for (let i = 0; i < 4; i++) {
        deck.push({ color: 'wild', value: 'WILD', uid: Math.random() });
        deck.push({ color: 'wild', value: '+4', uid: Math.random() });
    }
    return deck.sort(() => Math.random() - 0.5);
}

function destroyRoom(roomId) {
    if (rooms[roomId]) {
        delete rooms[roomId];
        io.emit('roomsList', getRoomsPublicInfo());
    }
}

function getRoomsPublicInfo() {
    return Object.values(rooms).map(r => ({
        id: r.id, name: r.name, players: r.players.length, isPrivate: !!r.password
    }));
}

function getNextPlayerIndex(room, step = 1) {
    return (room.turnIndex + (room.direction * step) % room.players.length + room.players.length) % room.players.length;
}

function nextTurn(room) {
    room.turnIndex = getNextPlayerIndex(room, 1);
    // Сбрасываем флаг "взял карту" для следующего игрока
    if (room.players[room.turnIndex]) {
        room.players[room.turnIndex].hasDrawn = false;
    }
}

async function broadcastGameState(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    const sockets = await io.in(roomId).fetchSockets();

    const publicPlayers = room.players.map(p => ({
        id: p.id, name: p.name, handSize: p.hand.length, isBot: p.isBot, quattroSaid: p.quattroSaid,
        avatar: p.avatar, banner: p.banner
    }));

    const baseState = {
        id: room.id, topCard: room.topCard, currentColor: room.currentColor,
        turnIndex: room.turnIndex, direction: room.direction, players: publicPlayers,
        gameStarted: room.gameStarted
    };

    for (const socket of sockets) {
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            // Передаем также флаг hasDrawn, чтобы клиент знал, менять ли кнопку на "Пропустить"
            socket.emit('updateState', { 
                ...baseState, 
                me: { hand: player.hand, hasDrawn: player.hasDrawn } 
            });
        }
    }
}

io.on('connection', (socket) => {
    socket.emit('roomsList', getRoomsPublicInfo());

    socket.on('registerUser', (userId) => {
        userSockets[userId] = socket.id;
        socket.userId = userId; 
    });

    socket.on('disconnect', () => {
        if(socket.userId) delete userSockets[socket.userId];
    });

    socket.on('privateMessage', ({ toUserId, content, fromUsername }) => {
        const targetSocketId = userSockets[toUserId];
        if (targetSocketId) {
            io.to(targetSocketId).emit('receiveMessage', { 
                fromUserId: socket.userId, 
                content: content,
                fromUsername: fromUsername
            });
        }
    });

    socket.on('sendInvite', ({ toUserId, roomId, fromUsername }) => {
        const targetSocketId = userSockets[toUserId];
        if (targetSocketId) {
            io.to(targetSocketId).emit('inviteReceived', { 
                fromUserId: socket.userId,
                fromUsername: fromUsername,
                roomId: roomId
            });
        }
    });

    socket.on('createRoom', ({ name, password }) => {
        const roomId = Math.random().toString(36).substr(2, 6);
        rooms[roomId] = {
            id: roomId, name: name || `Room #${roomId}`, password: password || null,
            players: [], deck: createDeck(), topCard: null, turnIndex: 0, direction: 1,
            currentColor: '', gameStarted: false,
            timer: setTimeout(() => destroyRoom(roomId), 900000)
        };
        socket.emit('roomCreated', roomId);
        io.emit('roomsList', getRoomsPublicInfo());
    });

    socket.on('joinRoom', ({ roomId, password, username, avatar, banner }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'Комната не найдена');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'Неверный пароль');
        
        if (room.players.some(p => p.id === socket.id)) {
            socket.join(roomId);
            socket.emit('joinSuccess', roomId);
            broadcastGameState(roomId);
            return;
        }

        if (room.players.length >= 4) return socket.emit('errorMsg', 'Мест нет');
        if (room.gameStarted) return socket.emit('errorMsg', 'Игра идет');

        socket.join(roomId);
        room.players.push({ 
            id: socket.id, name: username, hand: [], isBot: false, 
            quattroSaid: false, avatar: avatar || 'default', banner: banner || 'default',
            hasDrawn: false // Инициализация флага
        });

        socket.emit('joinSuccess', roomId);
        if (room.players.length >= 2 && !room.gameStarted) startGame(room);
        else broadcastGameState(roomId);
        io.emit('roomsList', getRoomsPublicInfo());
    });

    socket.on('addBot', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players.length < 4 && !room.gameStarted) {
            room.players.push({ 
                id: "bot_" + Math.random().toString(36).substr(2, 5), 
                name: "Bot Alex", hand: [], isBot: true, quattroSaid: false,
                avatar: 'bot', banner: 'default',
                hasDrawn: false
            });
            if (room.players.length >= 2) startGame(room);
            else broadcastGameState(roomId);
        }
    });

    function startGame(room) {
        room.gameStarted = true;
        room.deck = createDeck();
        room.direction = 1;
        room.players.forEach(p => {
            p.hand = room.deck.splice(0, 7);
            p.hasDrawn = false;
        });
        
        do { room.topCard = room.deck.pop(); } while (room.topCard.color === 'wild');
        room.currentColor = room.topCard.color;
        room.turnIndex = Math.floor(Math.random() * room.players.length);
        
        if (room.topCard.value === 'REVERSE') {
            room.direction = -1;
            room.turnIndex = getNextPlayerIndex(room, 0);
            if(room.players.length === 2) nextTurn(room);
        } else if (room.topCard.value === 'SKIP') nextTurn(room);

        broadcastGameState(room.id);
        checkBotTurn(room);
    }

    socket.on('playCard', ({ roomId, cardIndex, chosenColor }) => {
        const room = rooms[roomId];
        if (!room) return;
        
        clearTimeout(room.timer);
        room.timer = setTimeout(() => destroyRoom(roomId), 600000);

        const player = room.players[room.turnIndex];
        if (player.id !== socket.id) return; 

        const card = player.hand[cardIndex];
        const isMatch = (card.color === room.currentColor) || (card.value === room.topCard.value) || (card.color === 'wild');

        if (isMatch) {
            player.hand.splice(cardIndex, 1);
            room.topCard = card;
            room.currentColor = (card.color === 'wild') ? chosenColor : card.color;

            if (card.value === 'REVERSE') {
                room.direction *= -1;
                if (room.players.length === 2) nextTurn(room);
            } else if (card.value === 'SKIP') nextTurn(room);
            else if (card.value === '+2') {
                addCardsToPlayer(room, room.players[getNextPlayerIndex(room, 1)], 2);
                nextTurn(room);
            } else if (card.value === '+4') {
                addCardsToPlayer(room, room.players[getNextPlayerIndex(room, 1)], 4);
                nextTurn(room);
            }

            if (player.hand.length === 0) {
                finishGame(room, player);
                return;
            }

            nextTurn(room);
            broadcastGameState(roomId);
            checkBotTurn(room);
        }
    });

    // --- НОВАЯ ЛОГИКА ВЗЯТИЯ КАРТЫ ---
    socket.on('drawCard', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.turnIndex];
        if (player.id !== socket.id) return;

        // Если игрок уже взял карту в этот ход, значит он нажал кнопку второй раз -> это ПРОПУСК ХОДА
        if (player.hasDrawn) {
            nextTurn(room);
            broadcastGameState(roomId);
            checkBotTurn(room);
            return;
        }

        // Если ещё не брал, даем карту
        if (room.deck.length === 0) room.deck = createDeck();
        const card = room.deck.pop();
        player.hand.push(card);
        player.hasDrawn = true; // Запоминаем, что взял
        player.quattroSaid = false; 

        // Проверяем, подходит ли карта
        const isPlayable = (card.color === room.currentColor) || 
                           (card.value === room.topCard.value) || 
                           (card.color === 'wild');

        if (isPlayable) {
            // Если подходит, НЕ передаем ход. Игрок увидит карту и сможет её сыграть.
            // Или нажать кнопку еще раз, чтобы пропустить.
            broadcastGameState(roomId);
        } else {
            // Если карта не подходит, сразу передаем ход (как раньше)
            nextTurn(room);
            broadcastGameState(roomId);
            checkBotTurn(room);
        }
    });

    socket.on('sayQuattro', (roomId) => {
        const room = rooms[roomId];
        if(!room) return;
        const p = room.players.find(pl => pl.id === socket.id);
        if(p && p.hand.length <= 2 && !p.quattroSaid) {
            p.quattroSaid = true;
            io.to(roomId).emit('quattroEffect', p.name);
            broadcastGameState(roomId);
        }
    });

    function finishGame(room, winner) {
        room.gameStarted = false;
        
        room.players.forEach(p => {
            const isWinner = p.id === winner.id;
            const reward = isWinner 
                ? { xp: REWARDS.WIN_XP, coins: REWARDS.WIN_COINS, won: true } 
                : { xp: REWARDS.LOSE_XP, coins: REWARDS.LOSE_COINS, won: false };
            
            if (!p.isBot) {
                io.to(p.id).emit('gameEnded', { 
                    winnerName: winner.name,
                    reward: reward
                });
            }
        });

        destroyRoom(room.id);
    }

    function checkBotTurn(room) {
        if (!room.gameStarted) return;
        const player = room.players[room.turnIndex];
        
        if (player && player.isBot) {
            setTimeout(() => {
                if (!rooms[room.id] || !room.gameStarted) return;

                const matchIndex = player.hand.findIndex(c => 
                    c.color === 'wild' || c.color === room.currentColor || c.value === room.topCard.value
                );
                
                if (matchIndex !== -1) {
                    const card = player.hand[matchIndex];
                    player.hand.splice(matchIndex, 1);
                    room.topCard = card;
                    
                    if (card.color === 'wild') {
                        const counts = { red:0, blue:0, green:0, yellow:0 };
                        player.hand.forEach(c => { if(c.color !== 'wild') counts[c.color]++; });
                        room.currentColor = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
                    } else room.currentColor = card.color;

                    if (player.hand.length === 1) {
                        player.quattroSaid = true;
                        io.to(room.id).emit('quattroEffect', player.name);
                    }

                    if (card.value === 'REVERSE') {
                        room.direction *= -1;
                        if (room.players.length === 2) nextTurn(room);
                    } else if (card.value === 'SKIP') nextTurn(room);
                    else if (card.value === '+2') {
                        addCardsToPlayer(room, room.players[getNextPlayerIndex(room, 1)], 2);
                        nextTurn(room);
                    } else if (card.value === '+4') {
                        addCardsToPlayer(room, room.players[getNextPlayerIndex(room, 1)], 4);
                        nextTurn(room);
                    }

                    if (player.hand.length === 0) {
                        finishGame(room, player);
                        return;
                    }
                } else {
                    addCardsToPlayer(room, player, 1);
                    player.quattroSaid = false;
                }
                nextTurn(room);
                broadcastGameState(room.id);
                checkBotTurn(room); 
            }, 1500);
        }
    }

    function addCardsToPlayer(room, player, count) {
        if (room.deck.length < count) room.deck = createDeck(); 
        player.hand.push(...room.deck.splice(0, count));
    }
});

server.listen(process.env.PORT || 3000, () => console.log('Server running on port 3000'));