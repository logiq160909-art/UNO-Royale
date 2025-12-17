const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

let rooms = {};

// ГЕНЕРАЦИЯ КОЛОДЫ
function createDeck() {
    const colors = ['red', 'blue', 'green', 'yellow'];
    const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'SKIP', 'REVERSE', '+2'];
    let deck = [];
    colors.forEach(c => values.forEach(v => {
        deck.push({ color: c, value: v });
        if (v !== '0') deck.push({ color: c, value: v });
    }));
    for (let i = 0; i < 4; i++) {
        deck.push({ color: 'wild', value: 'WILD' });
        deck.push({ color: 'wild', value: '+4' });
    }
    return deck.sort(() => Math.random() - 0.5);
}

// УДАЛЕНИЕ КОМНАТЫ
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

io.on('connection', (socket) => {
    socket.emit('roomsList', getRoomsPublicInfo());

    // СОЗДАНИЕ
    socket.on('createRoom', ({ name, password }) => {
        const roomId = Math.random().toString(36).substr(2, 6);
        rooms[roomId] = {
            id: roomId,
            name: name || `Стол #${roomId}`,
            password: password || null,
            players: [],
            deck: createDeck(),
            topCard: null,
            turnIndex: 0,
            currentColor: '',
            gameStarted: false,
            timer: setTimeout(() => destroyRoom(roomId), 900000) // 15 мин
        };
        socket.emit('roomCreated', roomId);
        io.emit('roomsList', getRoomsPublicInfo());
    });

    // ВХОД (ИСПРАВЛЕНО ДУБЛИРОВАНИЕ)
    socket.on('joinRoom', ({ roomId, password, username }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'Комната не найдена');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'Неверный пароль');
        
        // ЗАЩИТА ОТ ДУБЛЕЙ
        const isAlreadyInRoom = room.players.some(p => p.id === socket.id);
        if (isAlreadyInRoom) {
            // Если игрок уже там, просто возвращаем ему состояние игры, но не добавляем снова
            socket.emit('joinSuccess', roomId); 
            return io.to(roomId).emit('updateState', sanitizeState(room));
        }

        if (room.players.length >= 4) return socket.emit('errorMsg', 'Комната переполнена');

        clearTimeout(room.timer);
        room.timer = setTimeout(() => destroyRoom(roomId), 600000);

        socket.join(roomId);
        room.players.push({ id: socket.id, name: username, hand: [], isBot: false, unoSaid: false });

        socket.emit('joinSuccess', roomId); // Сигнал клиенту переключить экран

        if (room.players.length >= 2 && !room.gameStarted) {
            startGame(room);
        } else {
            io.to(roomId).emit('updateState', sanitizeState(room));
        }
        
        io.emit('roomsList', getRoomsPublicInfo());
    });

    // ВЫХОД
    socket.on('disconnect', () => {
        for (let roomId in rooms) {
            let room = rooms[roomId];
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.length === 0) {
                destroyRoom(roomId);
            } else {
                io.to(roomId).emit('updateState', sanitizeState(room));
                io.emit('roomsList', getRoomsPublicInfo());
            }
        }
    });

    socket.on('addBot', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players.length < 4) {
            const botId = "bot_" + Math.random().toString(36).substr(2, 5);
            room.players.push({ id: botId, name: "Бот Олег", hand: [], isBot: true });
            if (room.players.length >= 2 && !room.gameStarted) startGame(room);
            io.to(roomId).emit('updateState', sanitizeState(room));
        }
    });

    function startGame(room) {
        room.gameStarted = true;
        room.deck = createDeck();
        room.players.forEach(p => p.hand = room.deck.splice(0, 7));
        do { room.topCard = room.deck.pop(); } while (room.topCard.color === 'wild');
        room.currentColor = room.topCard.color;
        io.to(room.id).emit('initGame', sanitizeState(room));
    }

    socket.on('playCard', ({ roomId, cardIndex, chosenColor }) => {
        const room = rooms[roomId];
        if (!room) return;
        
        clearTimeout(room.timer);
        room.timer = setTimeout(() => destroyRoom(roomId), 600000);

        const player = room.players[room.turnIndex];
        if (player.id !== socket.id) return;

        const card = player.hand[cardIndex];
        const isWild = card.color === 'wild';
        const isMatch = (card.color === room.currentColor) || (card.value === room.topCard.value) || isWild;

        if (isMatch) {
            player.hand.splice(cardIndex, 1);
            room.topCard = card;
            room.currentColor = isWild ? chosenColor : card.color;

            if (card.value === '+2') {
                const nextP = room.players[(room.turnIndex + 1) % room.players.length];
                nextP.hand.push(...room.deck.splice(0, 2));
            }
            if (card.value === '+4') {
                const nextP = room.players[(room.turnIndex + 1) % room.players.length];
                nextP.hand.push(...room.deck.splice(0, 4));
            }
            if (card.value === 'SKIP' || card.value === 'REVERSE') {
                room.turnIndex = (room.turnIndex + 1) % room.players.length; 
            }

            if (player.hand.length === 0) {
                io.to(roomId).emit('gameOver', { winner: player.name, id: player.id });
                room.gameStarted = false;
                room.players = []; // Очистка после игры
                return;
            }

            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            io.to(roomId).emit('updateState', sanitizeState(room));
            checkBotTurn(room);
        }
    });

    socket.on('drawCard', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.turnIndex];
        if (player.id !== socket.id) return;

        player.hand.push(room.deck.pop());
        player.unoSaid = false;
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        
        io.to(roomId).emit('updateState', sanitizeState(room));
        checkBotTurn(room);
    });

    socket.on('sayUno', (roomId) => {
        const room = rooms[roomId];
        if(!room) return;
        const p = room.players.find(pl => pl.id === socket.id);
        if(p && p.hand.length <= 2) {
            p.unoSaid = true;
            io.to(roomId).emit('unoEffect', p.name);
        }
    });

    function checkBotTurn(room) {
        const player = room.players[room.turnIndex];
        if (player && player.isBot) {
            setTimeout(() => {
                const matchIndex = player.hand.findIndex(c => c.color === 'wild' || c.color === room.currentColor || c.value === room.topCard.value);
                
                if (matchIndex !== -1) {
                    const card = player.hand[matchIndex];
                    player.hand.splice(matchIndex, 1);
                    room.topCard = card;
                    room.currentColor = card.color === 'wild' ? 'red' : card.color; // Бот всегда выбирает красный
                    
                    if(card.value === '+2') room.players[(room.turnIndex + 1) % room.players.length].hand.push(...room.deck.splice(0, 2));
                    if(card.value === '+4') room.players[(room.turnIndex + 1) % room.players.length].hand.push(...room.deck.splice(0, 4));
                    if(card.value === 'SKIP') room.turnIndex = (room.turnIndex + 1) % room.players.length;

                    if (player.hand.length === 0) {
                         io.to(room.id).emit('gameOver', { winner: player.name, id: player.id });
                         room.gameStarted = false;
                         return;
                    }
                } else {
                    player.hand.push(room.deck.pop());
                }
                room.turnIndex = (room.turnIndex + 1) % room.players.length;
                io.to(room.id).emit('updateState', sanitizeState(room));
                checkBotTurn(room);
            }, 1500);
        }
    }

    function sanitizeState(room) {
        return {
            id: room.id,
            players: room.players.map(p => ({ id: p.id, name: p.name, handSize: p.hand.length, isBot: p.isBot, unoSaid: p.unoSaid })),
            topCard: room.topCard,
            currentColor: room.currentColor,
            turnIndex: room.turnIndex,
            fullPlayersForLogic: room.players 
        };
    }
});

server.listen(process.env.PORT || 3000, () => console.log('Server OK'));