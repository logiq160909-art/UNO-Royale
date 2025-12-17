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
    // Отправка списка комнат при подключении
    socket.emit('roomsList', Object.values(rooms).map(r => ({
        id: r.id, name: r.name, players: r.players.length, isPrivate: !!r.password
    })));

    socket.on('createRoom', ({ name, password }) => {
        const roomId = Math.random().toString(36).substr(2, 6);
        rooms[roomId] = {
            id: roomId,
            name: name,
            password: password || null,
            players: [],
            deck: createDeck(),
            topCard: null,
            turnIndex: 0,
            currentColor: '',
            gameStarted: false
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
        if (room.players.length >= 4) return socket.emit('errorMsg', 'Комната полна');

        socket.join(roomId);
        room.players.push({ id: socket.id, name: username, hand: [] });

        if (room.players.length >= 2 && !room.gameStarted) {
            room.gameStarted = true;
            room.players.forEach(p => p.hand = room.deck.splice(0, 7));
            room.topCard = room.deck.pop();
            room.currentColor = room.topCard.color;
            io.to(roomId).emit('initGame', room);
        }
        io.emit('roomsList', Object.values(rooms).map(r => ({
            id: r.id, name: r.name, players: r.players.length, isPrivate: !!r.password
        })));
    });

    socket.on('drawCard', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            const player = room.players[room.turnIndex];
            if (player.id === socket.id) {
                player.hand.push(room.deck.pop());
                room.turnIndex = (room.turnIndex + 1) % room.players.length;
                io.to(roomId).emit('updateState', room);
            }
        }
    });

    socket.on('disconnect', () => {
        // Логика удаления пустых комнат
        for (let id in rooms) {
            rooms[id].players = rooms[id].players.filter(p => p.id !== socket.id);
            if (rooms[id].players.length === 0) delete rooms[id];
        }
        io.emit('roomsList', Object.values(rooms).map(r => ({
            id: r.id, name: r.name, players: r.players.length, isPrivate: !!r.password
        })));
    });
});

server.listen(process.env.PORT || 3000);