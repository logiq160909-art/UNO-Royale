const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let rooms = {};

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

function deleteRoom(roomId) {
    if (rooms[roomId]) {
        console.log(`Удаление комнаты ${roomId} по таймеру`);
        delete rooms[roomId];
        io.emit('roomsList', getRoomsList());
    }
}

function getRoomsList() {
    return Object.values(rooms).map(r => ({
        id: r.id, name: r.name, players: r.players.length, isPrivate: !!r.password
    }));
}

io.on('connection', (socket) => {
    socket.emit('roomsList', getRoomsList());

    socket.on('createRoom', ({ name, password }) => {
        const roomId = "room_" + Math.random().toString(36).substr(2, 4);
        rooms[roomId] = {
            id: roomId, name: name || "Стол " + roomId, password: password || null,
            players: [], deck: createDeck(), topCard: null, turnIndex: 0,
            currentColor: '', gameStarted: false, 
            lastActivity: Date.now(),
            timer: setTimeout(() => deleteRoom(roomId), 15 * 60 * 1000) // 15 мин на ожидание
        };
        socket.emit('roomCreated', roomId);
    });

    socket.on('joinRoom', ({ roomId, password, username }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'Комната не найдена');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'Пароль!');
        
        clearTimeout(room.timer); // Сброс таймера при входе
        room.timer = setTimeout(() => deleteRoom(roomId), 10 * 60 * 1000); // 10 мин бездействия

        socket.join(roomId);
        room.players.push({ id: socket.id, name: username, hand: [], unoSaid: false });
        if (room.players.length >= 2 && !room.gameStarted) startGame(roomId);
        io.to(roomId).emit('updateState', room);
        io.emit('roomsList', getRoomsList());
    });

    function startGame(roomId) {
        const room = rooms[roomId];
        room.gameStarted = true;
        room.players.forEach(p => p.hand = room.deck.splice(0, 7));
        room.topCard = room.deck.pop();
        while(room.topCard.color === 'wild') room.topCard = room.deck.pop();
        room.currentColor = room.topCard.color;
        io.to(roomId).emit('initGame', room);
    }

    socket.on('playCard', ({ roomId, cardIndex, chosenColor }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.turnIndex];
        if (player.id !== socket.id) return;

        const card = player.hand[cardIndex];
        const isWild = card.color === 'wild';
        const isMatch = card.color === room.currentColor || card.value === room.topCard.value || isWild;

        if (isMatch) {
            room.topCard = player.hand.splice(cardIndex, 1)[0];
            room.currentColor = isWild ? chosenColor : room.topCard.color;
            
            // Логика спец. карт
            if (card.value === 'SKIP') room.turnIndex = (room.turnIndex + 1) % room.players.length;
            if (card.value === '+2') {
                const nextP = room.players[(room.turnIndex + 1) % room.players.length];
                nextP.hand.push(...room.deck.splice(0, 2));
            }

            if (player.hand.length === 0) {
                if (!player.unoSaid) { // Штраф если не нажал UNO
                    player.hand.push(...room.deck.splice(0, 2));
                } else {
                    io.to(roomId).emit('gameOver', { winner: player.name, id: player.id });
                    delete rooms[roomId];
                    return;
                }
            }

            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            io.to(roomId).emit('updateState', room);
        }
    });

    socket.on('sayUno', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (player && player.hand.length <= 2) {
            player.unoSaid = true;
            io.to(roomId).emit('unoEffect', player.name);
        }
    });

    socket.on('drawCard', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            const player = room.players[room.turnIndex];
            if (player.id === socket.id) {
                player.hand.push(room.deck.pop());
                player.unoSaid = false;
                room.turnIndex = (room.turnIndex + 1) % room.players.length;
                io.to(roomId).emit('updateState', room);
            }
        }
    });
});

server.listen(process.env.PORT || 3000);