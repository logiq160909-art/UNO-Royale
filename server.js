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
    const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'SKIP', '+2'];
    let deck = [];
    colors.forEach(c => values.forEach(v => {
        deck.push({ color: c, value: v });
        if (v !== '0') deck.push({ color: c, value: v });
    }));
    return deck.sort(() => Math.random() - 0.5);
}

io.on('connection', (socket) => {
    socket.emit('roomsList', Object.values(rooms).map(r => ({
        id: r.id, name: r.name, players: r.players.length, isPrivate: !!r.password
    })));

    socket.on('createRoom', ({ name, password }) => {
        const roomId = "room_" + Math.random().toString(36).substr(2, 4);
        rooms[roomId] = {
            id: roomId, name: name || "Стол " + roomId, password: password || null,
            players: [], deck: createDeck(), topCard: null, turnIndex: 0,
            currentColor: '', gameStarted: false
        };
        socket.emit('roomCreated', roomId);
        io.emit('roomsList', Object.values(rooms).map(r => ({
            id: r.id, name: r.name, players: r.players.length, isPrivate: !!r.password
        })));
    });

    socket.on('joinRoom', ({ roomId, password, username }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'Комната не найдена');
        if (room.password && room.password !== password) return socket.emit('errorMsg', 'Неверный пароль');
        
        socket.join(roomId);
        room.players.push({ id: socket.id, name: username, hand: [], isBot: false });
        if (room.players.length >= 2) startGame(roomId);
        io.to(roomId).emit('updateState', room);
    });

    socket.on('addBot', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players.length < 4) {
            room.players.push({ id: "bot_" + Math.random(), name: "Бот Олег", hand: [], isBot: true });
            if (room.players.length >= 2 && !room.gameStarted) startGame(roomId);
            io.to(roomId).emit('updateState', room);
        }
    });

    function startGame(roomId) {
        const room = rooms[roomId];
        if (room.gameStarted) return;
        room.gameStarted = true;
        room.players.forEach(p => p.hand = room.deck.splice(0, 7));
        room.topCard = room.deck.pop();
        room.currentColor = room.topCard.color;
        io.to(roomId).emit('initGame', room);
    }

    socket.on('playCard', ({ roomId, cardIndex }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.turnIndex];
        if (player.id !== socket.id) return;

        const card = player.hand[cardIndex];
        if (card.color === room.currentColor || card.value === room.topCard.value) {
            room.topCard = player.hand.splice(cardIndex, 1)[0];
            room.currentColor = room.topCard.color;

            if (player.hand.length === 0) {
                io.to(roomId).emit('gameOver', { winner: player.name, id: player.id });
                delete rooms[roomId];
                return;
            }

            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            io.to(roomId).emit('updateState', room);
            if (room.players[room.turnIndex].isBot) botTurn(roomId);
        }
    });

    function botTurn(roomId) {
        const room = rooms[roomId];
        if (!room) return;
        const bot = room.players[room.turnIndex];
        if (!bot || !bot.isBot) return;

        setTimeout(() => {
            const index = bot.hand.findIndex(c => c.color === room.currentColor || c.value === room.topCard.value);
            if (index !== -1) {
                room.topCard = bot.hand.splice(index, 1)[0];
                room.currentColor = room.topCard.color;
            } else {
                bot.hand.push(room.deck.pop());
            }
            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            io.to(roomId).emit('updateState', room);
            if (room.players[room.turnIndex]?.isBot) botTurn(roomId);
        }, 1500);
    }

    socket.on('drawCard', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.turnIndex];
        if (player.id !== socket.id) return;
        player.hand.push(room.deck.pop());
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        io.to(roomId).emit('updateState', room);
        if (room.players[room.turnIndex]?.isBot) botTurn(roomId);
    });
});

server.listen(process.env.PORT || 3000);