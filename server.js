const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

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
    socket.on('joinRoom', ({ roomId, username }) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: [],
                deck: createDeck(),
                topCard: null,
                turnIndex: 0,
                currentColor: '',
                gameStarted: false
            };
        }

        const room = rooms[roomId];
        if (room.players.length < 4) {
            room.players.push({ id: socket.id, name: username, hand: [] });
        }

        if (room.players.length >= 2 && !room.gameStarted) {
            room.gameStarted = true;
            room.players.forEach(p => p.hand = room.deck.splice(0, 7));
            room.topCard = room.deck.pop();
            room.currentColor = room.topCard.color;
            io.to(roomId).emit('initGame', room);
        } else if (room.gameStarted) {
            socket.emit('initGame', room);
        }
    });

    socket.on('playCard', ({ roomId, cardIndex }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[room.turnIndex];
        if (player.id !== socket.id) return;

        const card = player.hand[cardIndex];
        if (card.color === room.currentColor || card.value === room.topCard.value) {
            room.topCard = player.hand.splice(cardIndex, 1)[0];
            room.currentColor = room.topCard.color;
            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            io.to(roomId).emit('updateState', room);
        }
    });

    socket.on('drawCard', (roomId) => {
        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;
        const player = room.players[room.turnIndex];
        if (player.id !== socket.id) return;

        player.hand.push(room.deck.pop());
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        io.to(roomId).emit('updateState', room);
    });
});

server.listen(process.env.PORT || 3000);