const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

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

function sendState(room) {
    room.players.forEach(p => {
        if (p.isBot) return;
        io.to(p.id).emit('updateState', {
            topCard: room.topCard,
            currentColor: room.currentColor,
            turnIndex: room.turnIndex,
            gameStarted: room.gameStarted,
            opponents: room.players.map(pl => ({ 
                id: pl.id, 
                name: pl.name, 
                handSize: pl.hand.length 
            })),
            myHand: p.hand
        });
    });
}

function startGame(room) {
    room.gameStarted = true;
    room.deck = createDeck();
    room.players.forEach(p => p.hand = room.deck.splice(0, 7));
    
    // Поиск первой карты (не спец-карта)
    let safeIdx = room.deck.findIndex(c => 
        !['SKIP', 'REVERSE', '+2', '+4', 'WILD'].includes(c.value) && c.color !== 'wild'
    );
    room.topCard = room.deck.splice(safeIdx >= 0 ? safeIdx : 0, 1)[0];
    room.currentColor = room.topCard.color;
    
    // Рандомный старт
    room.turnIndex = Math.floor(Math.random() * room.players.length);
    sendState(room);
}

io.on('connection', (socket) => {
    socket.on('createRoom', ({ name }) => {
        const roomId = Math.random().toString(36).substr(2, 6);
        rooms[roomId] = {
            id: roomId, name: name || "Стол UNO", players: [],
            deck: [], topCard: null, turnIndex: 0, gameStarted: false
        };
        socket.emit('roomCreated', roomId);
    });

    socket.on('joinRoom', ({ roomId, username }) => {
        const room = rooms[roomId];
        if (!room) return;
        socket.join(roomId);
        room.players.push({ id: socket.id, name: username || 'Игрок', hand: [], isBot: false });
        if (room.players.length >= 2 && !room.gameStarted) startGame(room);
        else sendState(room);
    });

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

            if (player.hand.length === 0) {
                io.to(roomId).emit('gameOver', { winner: player.name });
                delete rooms[roomId];
                return;
            }
            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            sendState(room);
            if (room.players[room.turnIndex].isBot) runBot(room);
        }
    });

    socket.on('drawCard', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players[room.turnIndex].id === socket.id) {
            room.players[room.turnIndex].hand.push(room.deck.pop());
            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            sendState(room);
            if (room.players[room.turnIndex].isBot) runBot(room);
        }
    });

    socket.on('addBot', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players.length < 4) {
            room.players.push({ id: 'bot_'+Math.random(), name: 'Бот Аркадий', hand: [], isBot: true });
            if (room.players.length >= 2 && !room.gameStarted) startGame(room);
            else sendState(room);
        }
    });
});

function runBot(room) {
    setTimeout(() => {
        const bot = room.players[room.turnIndex];
        if (!bot || !bot.isBot) return;
        const idx = bot.hand.findIndex(c => c.color === room.currentColor || c.value === room.topCard.value || c.color === 'wild');
        if (idx !== -1) {
            const card = bot.hand[idx];
            bot.hand.splice(idx, 1);
            room.topCard = card;
            room.currentColor = card.color === 'wild' ? 'red' : card.color;
            if (bot.hand.length === 0) return io.to(room.id).emit('gameOver', { winner: bot.name });
        } else {
            bot.hand.push(room.deck.pop());
        }
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        sendState(room);
        if (room.players[room.turnIndex].isBot) runBot(room);
    }, 1500);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on port ${PORT}`));