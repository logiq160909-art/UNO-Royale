const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

// Хранение данных
let rooms = {};
// Карта: UserId -> SocketId (чтобы знать, кому слать уведомления)
const onlineUsers = new Map(); 

// --- Геймплейные функции (Колода, Утилиты) ---
function createDeck() {
    const colors = ['red', 'blue', 'green', 'yellow'];
    const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'SKIP', 'REVERSE', '+2'];
    let deck = [];
    colors.forEach(c => values.forEach(v => {
        deck.push({ color: c, value: v, uid: Math.random() });
        if (v !== '0') deck.push({ color: c, value: v, uid: Math.random() });
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

function sendState(room) {
    room.players.forEach(p => {
        if (p.isBot) return;
        io.to(p.id).emit('updateState', {
            topCard: room.topCard,
            currentColor: room.currentColor,
            turnIndex: room.turnIndex,
            direction: room.direction, // Добавлено направление
            gameStarted: room.gameStarted,
            opponents: room.players.map(pl => ({ 
                id: pl.id, name: pl.name, handSize: pl.hand.length, 
                avatar: pl.avatar, unoSaid: pl.unoSaid 
            })),
            myHand: p.hand
        });
    });
}

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    
    // 1. РЕГИСТРАЦИЯ ПОЛЬЗОВАТЕЛЯ В СЕТИ
    socket.on('registerUser', (userId) => {
        onlineUsers.set(userId, socket.id);
        socket.userId = userId; // Привязываем ID к сокету
        io.emit('updateOnlineStatus', { userId, isOnline: true });
    });

    socket.on('disconnect', () => {
        if(socket.userId) {
            onlineUsers.delete(socket.userId);
            io.emit('updateOnlineStatus', { userId: socket.userId, isOnline: false });
        }
        // Удаление из комнат (упрощено)
    });

    // 2. СОЦИАЛЬНЫЕ ФУНКЦИИ (Чат, Инвайты, Заявки)
    
    // Отправка заявки в друзья (Realtime уведомление)
    socket.on('sendFriendRequest', ({ toUserId, fromName }) => {
        const targetSocket = onlineUsers.get(toUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('newFriendRequest', { fromName });
        }
    });

    // Отправка сообщения
    socket.on('directMessage', ({ toUserId, content, fromId, fromName }) => {
        const targetSocket = onlineUsers.get(toUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('receiveMessage', { fromId, content, fromName });
        }
    });

    // Приглашение в игру
    socket.on('inviteToGame', ({ toUserId, roomId, fromName }) => {
        const targetSocket = onlineUsers.get(toUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('gameInvite', { roomId, fromName });
        }
    });

    // 3. ИГРОВАЯ ЛОГИКА (Стандартная)
    socket.emit('roomsList', getRoomsPublicInfo());

    socket.on('createRoom', ({ name, password }) => {
        const roomId = Math.random().toString(36).substr(2, 6);
        rooms[roomId] = {
            id: roomId, name: name, password: password, players: [], deck: [],
            topCard: null, turnIndex: 0, direction: 1, gameStarted: false
        };
        socket.emit('roomCreated', roomId);
        io.emit('roomsList', getRoomsPublicInfo());
    });

    socket.on('joinRoom', ({ roomId, username, avatar }) => {
        const room = rooms[roomId];
        if (!room) return;
        if (!room.players.find(p => p.id === socket.id)) {
            socket.join(roomId);
            room.players.push({ id: socket.id, name: username, avatar: avatar, hand: [], isBot: false });
        }
        socket.emit('joinSuccess', roomId);
        if (room.players.length >= 2 && !room.gameStarted) startGame(room);
        else sendState(room);
        io.emit('roomsList', getRoomsPublicInfo());
    });

    function startGame(room) {
        room.gameStarted = true;
        room.deck = createDeck();
        room.players.forEach(p => p.hand = room.deck.splice(0, 7));
        let safeIdx = room.deck.findIndex(c => !['SKIP', 'REVERSE', '+2', '+4', 'WILD'].includes(c.value) && c.color !== 'wild');
        room.topCard = room.deck.splice(safeIdx || 0, 1)[0];
        room.currentColor = room.topCard.color;
        room.turnIndex = Math.floor(Math.random() * room.players.length);
        room.direction = 1;
        sendState(room);
    }

    socket.on('playCard', ({ roomId, cardIndex, chosenColor }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.turnIndex];
        if (player.id !== socket.id) return;

        const card = player.hand[cardIndex];
        const isWild = card.color === 'wild';
        if (card.color === room.currentColor || card.value === room.topCard.value || isWild) {
            player.hand.splice(cardIndex, 1);
            room.topCard = card;
            room.currentColor = isWild ? chosenColor : card.color;

            if (card.value === 'REVERSE') room.direction *= -1;
            if (card.value === 'SKIP') room.turnIndex = (room.turnIndex + room.direction + room.players.length) % room.players.length;
            if (card.value === '+2') {
                const next = room.players[(room.turnIndex + room.direction + room.players.length) % room.players.length];
                next.hand.push(...room.deck.splice(0, 2));
            }
            if (card.value === '+4') {
                const next = room.players[(room.turnIndex + room.direction + room.players.length) % room.players.length];
                next.hand.push(...room.deck.splice(0, 4));
            }

            if (player.hand.length === 0) {
                io.to(roomId).emit('gameOver', { winner: player.name });
                destroyRoom(roomId);
                return;
            }

            room.turnIndex = (room.turnIndex + room.direction + room.players.length) % room.players.length;
            sendState(room);
            // Bot logic ommitted for brevity but goes here
        }
    });

    socket.on('drawCard', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players[room.turnIndex].id === socket.id) {
            room.players[room.turnIndex].hand.push(room.deck.pop());
            room.turnIndex = (room.turnIndex + room.direction + room.players.length) % room.players.length;
            sendState(room);
        }
    });

    socket.on('addBot', (roomId) => { /* Бот код */ });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running'));