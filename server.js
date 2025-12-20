const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

let rooms = {};
let userSockets = {}; // Map: userId -> socketId

// Экономика
const REWARDS = {
    WIN_XP: 100,
    WIN_COINS: 50,
    LOSE_XP: 25,
    LOSE_COINS: 10,
    AFK_PENALTY_COINS: 200,
    AFK_PENALTY_XP: 50
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
        // Очищаем таймеры
        if(rooms[roomId].turnTimer) clearTimeout(rooms[roomId].turnTimer);
        delete rooms[roomId];
        io.emit('roomsList', getRoomsPublicInfo());
    }
}

function getRoomsPublicInfo() {
    return Object.values(rooms).map(r => ({
        id: r.id, name: r.name, players: r.players.length, isPrivate: !!r.password, gameStarted: r.gameStarted
    }));
}

function getNextPlayerIndex(room, step = 1) {
    return (room.turnIndex + (room.direction * step) % room.players.length + room.players.length) % room.players.length;
}

// Сортировка карт по цветам и значениям
function sortHand(hand) {
    const colorOrder = { 'red': 1, 'blue': 2, 'green': 3, 'yellow': 4, 'wild': 5 };
    const valueOrder = { '0':0, '1':1, '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, '+2':10, 'SKIP':11, 'REVERSE':12, 'WILD':13, '+4':14 };
    
    return hand.sort((a, b) => {
        if (colorOrder[a.color] !== colorOrder[b.color]) {
            return colorOrder[a.color] - colorOrder[b.color];
        }
        return (valueOrder[a.value] || 0) - (valueOrder[b.value] || 0);
    });
}

function nextTurn(room) {
    // Очистка предыдущего таймера
    if (room.turnTimer) clearTimeout(room.turnTimer);

    room.turnIndex = getNextPlayerIndex(room, 1);
    const currentPlayer = room.players[room.turnIndex];

    if (!currentPlayer) return;

    currentPlayer.hasDrawn = false;
    room.turnStartTime = Date.now(); // Для синхронизации таймера на клиенте

    // Запуск таймера хода (30 сек)
    room.turnTimer = setTimeout(() => handleAfkTimeout(room, currentPlayer), 30000);
}

function handleAfkTimeout(room, player) {
    if(!room.gameStarted) return;
    
    player.afkStrikes = (player.afkStrikes || 0) + 1;
    
    // Если 2 раза подряд AFK - кик
    if (player.afkStrikes >= 2) {
        io.to(player.id).emit('kickedAFK', { coins: REWARDS.AFK_PENALTY_COINS, xp: REWARDS.AFK_PENALTY_XP });
        
        // Удаляем игрока
        room.players = room.players.filter(p => p.id !== player.id);
        
        if(room.players.length < 2) {
            // Если остался один, он победил
            if(room.players.length === 1) finishGame(room, room.players[0]);
            else destroyRoom(room.id);
        } else {
             // Переход хода следующему
             // Корректируем индекс, так как массив уменьшился
             if(room.turnIndex >= room.players.length) room.turnIndex = 0;
             broadcastGameState(room.id);
             nextTurn(room);
        }
        return;
    }

    // Если первый раз - просто пропускаем ход (берет карту и скипает)
    addCardsToPlayer(room, player, 1);
    io.to(room.id).emit('serverMessage', `${player.name} долго думал и пропустил ход!`);
    
    nextTurn(room);
    broadcastGameState(room.id);
    checkBotTurn(room);
}

async function broadcastGameState(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    const sockets = await io.in(roomId).fetchSockets();

    const publicPlayers = room.players.map(p => ({
        id: p.id, 
        uid: p.uid, // Supabase ID для идентификации
        name: p.name, 
        handSize: p.hand.length, 
        isBot: p.isBot, 
        quattroSaid: p.quattroSaid,
        avatar: p.avatar, 
        banner: p.banner,
        isReady: p.isReady // Статус готовности
    }));

    const baseState = {
        id: room.id, topCard: room.topCard, currentColor: room.currentColor,
        turnIndex: room.turnIndex, direction: room.direction, players: publicPlayers,
        gameStarted: room.gameStarted,
        turnDeadline: room.turnStartTime ? room.turnStartTime + 30000 : null
    };

    for (const socket of sockets) {
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            socket.emit('updateState', { 
                ...baseState, 
                me: { hand: player.hand, hasDrawn: player.hasDrawn, isReady: player.isReady } 
            });
        }
    }
}

io.on('connection', (socket) => {
    socket.emit('roomsList', getRoomsPublicInfo());

    socket.on('registerUser', (userId) => {
        userSockets[userId] = socket.id;
        socket.userId = userId; 

        // Проверка реконнекта (есть ли этот юзер уже в какой-то комнате?)
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const existingPlayer = room.players.find(p => p.uid === userId);
            
            if (existingPlayer) {
                // Обновляем socket.id игрока
                existingPlayer.id = socket.id;
                socket.join(roomId);
                
                socket.emit('joinSuccess', roomId);
                // Отправляем текущее состояние игры
                setTimeout(() => broadcastGameState(roomId), 500);
                return;
            }
        }
    });

    socket.on('disconnect', () => {
        if(socket.userId) delete userSockets[socket.userId];
        // Мы НЕ удаляем игрока из комнаты сразу при дисконнекте, 
        // чтобы дать возможность перезайти (Reconnection)
    });

    socket.on('leaveRoom', (roomId) => {
        const room = rooms[roomId];
        if(room) {
            room.players = room.players.filter(p => p.id !== socket.id);
            socket.leave(roomId);
            if(room.players.length === 0) destroyRoom(roomId);
            else broadcastGameState(roomId);
            io.emit('roomsList', getRoomsPublicInfo());
        }
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
            turnStartTime: null, turnTimer: null
        };
        socket.emit('roomCreated', roomId);
        io.emit('roomsList', getRoomsPublicInfo());
    });

    socket.on('joinRoom', ({ roomId, password, username, avatar, banner }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'Комната не найдена');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'Неверный пароль');
        
        // Reconnection logic handled mostly in registerUser, but safe check here:
        const existing = room.players.find(p => p.uid === socket.userId);
        if (existing) {
            existing.id = socket.id; // update socket
            socket.join(roomId);
            socket.emit('joinSuccess', roomId);
            broadcastGameState(roomId);
            return;
        }

        if (room.players.length >= 4) return socket.emit('errorMsg', 'Мест нет');
        if (room.gameStarted) return socket.emit('errorMsg', 'Игра уже идет');

        socket.join(roomId);
        room.players.push({ 
            id: socket.id, 
            uid: socket.userId, // Важно для реконнекта
            name: username, hand: [], isBot: false, 
            quattroSaid: false, avatar: avatar || 'default', banner: banner || 'default',
            hasDrawn: false,
            isReady: false, // Флаг готовности
            afkStrikes: 0
        });

        socket.emit('joinSuccess', roomId);
        broadcastGameState(roomId);
        io.emit('roomsList', getRoomsPublicInfo());
    });

    socket.on('toggleReady', (roomId) => {
        const room = rooms[roomId];
        if(!room || room.gameStarted) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if(player) {
            player.isReady = !player.isReady;
            
            // Проверка, все ли готовы
            const allReady = room.players.every(p => p.isReady || p.isBot);
            if(room.players.length >= 2 && allReady) {
                startGame(room);
            } else {
                broadcastGameState(roomId);
            }
        }
    });

    socket.on('addBot', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players.length < 4 && !room.gameStarted) {
            room.players.push({ 
                id: "bot_" + Math.random().toString(36).substr(2, 5), 
                uid: "bot_" + Math.random(),
                name: "Bot Alex", hand: [], isBot: true, quattroSaid: false,
                avatar: 'av_robot', banner: 'default',
                hasDrawn: false, isReady: true // Боты всегда готовы
            });
            broadcastGameState(roomId);
            
            // Если все люди готовы, старт
            const humans = room.players.filter(p => !p.isBot);
            if(humans.length > 0 && humans.every(p => p.isReady) && room.players.length >= 2) {
                startGame(room);
            }
        }
    });

    function startGame(room) {
        room.gameStarted = true;
        room.deck = createDeck();
        room.direction = 1;
        room.players.forEach(p => {
            p.hand = room.deck.splice(0, 7);
            sortHand(p.hand); // Сортировка при раздаче
            p.hasDrawn = false;
            p.afkStrikes = 0;
        });
        
        do { room.topCard = room.deck.pop(); } while (room.topCard.color === 'wild');
        room.currentColor = room.topCard.color;
        room.turnIndex = Math.floor(Math.random() * room.players.length);
        
        if (room.topCard.value === 'REVERSE') {
            room.direction = -1;
            room.turnIndex = getNextPlayerIndex(room, 0);
            if(room.players.length === 2) nextTurn(room); // Специальный случай для 2 игроков
        } else if (room.topCard.value === 'SKIP') {
            nextTurn(room); // Сразу переключаем если первый скип
        }

        // Засекаем время первого хода
        room.turnStartTime = Date.now();
        room.turnTimer = setTimeout(() => handleAfkTimeout(room, room.players[room.turnIndex]), 30000);

        broadcastGameState(room.id);
        checkBotTurn(room);
        io.emit('roomsList', getRoomsPublicInfo());
    }

    socket.on('playCard', ({ roomId, cardIndex, chosenColor }) => {
        const room = rooms[roomId];
        if (!room) return;
        
        const player = room.players[room.turnIndex];
        if (player.id !== socket.id) return; 

        const card = player.hand[cardIndex];
        const isMatch = (card.color === room.currentColor) || (card.value === room.topCard.value) || (card.color === 'wild');

        if (isMatch) {
            player.afkStrikes = 0; // Сброс AFK страйка
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

    socket.on('drawCard', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.turnIndex];
        if (player.id !== socket.id) return;

        player.afkStrikes = 0; // Активность сбрасывает AFK

        if (player.hasDrawn) {
            nextTurn(room);
            broadcastGameState(roomId);
            checkBotTurn(room);
            return;
        }

        addCardsToPlayer(room, player, 1);
        player.hasDrawn = true;
        player.quattroSaid = false;
        
        const drawnCard = player.hand[player.hand.length - 1];
        const isPlayable = (drawnCard.color === room.currentColor) || 
                           (drawnCard.value === room.topCard.value) || 
                           (drawnCard.color === 'wild');

        if (isPlayable) {
            broadcastGameState(roomId);
        } else {
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
        if(room.turnTimer) clearTimeout(room.turnTimer);

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
            // Сброс состояния для следующей игры
            p.hand = [];
            p.isReady = false;
        });

        // Не удаляем комнату сразу, даем игрокам вернуться в лобби
        // но таймер уничтожения запустим
        // destroyRoom(room.id); 
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
        sortHand(player.hand); // Сортируем руку после взятия карты
    }
});

server.listen(process.env.PORT || 3000, () => console.log('Server running on port 3000'));