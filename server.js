const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let gameState = {
    players: [],
    deck: [],
    topCard: null,
    turnIndex: 0,
    currentColor: '',
    gameStarted: false
};

function createDeck() {
    const colors = ['red', 'blue', 'green', 'yellow'];
    const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'SKIP', 'REVERSE', '+2'];
    let deck = [];
    colors.forEach(c => values.forEach(v => deck.push({color: c, value: v})));
    // Добавим черные карты
    for(let i=0; i<4; i++) {
        deck.push({color: 'wild', value: 'WILD'});
        deck.push({color: 'wild', value: '+4'});
    }
    return deck.sort(() => Math.random() - 0.5);
}

io.on('connection', (socket) => {
    socket.on('joinRoyale', (data) => {
        if (gameState.players.length < 4 && !gameState.gameStarted) {
            gameState.players.push({ id: socket.id, name: data.username, hand: [] });
            io.emit('playerListUpdate', gameState.players.map(p => p.name));
            
            if (gameState.players.length >= 2) {
                startGame();
            }
        }
    });

    function startGame() {
        gameState.gameStarted = true;
        gameState.deck = createDeck();
        gameState.players.forEach(p => p.hand = gameState.deck.splice(0, 7));
        gameState.topCard = gameState.deck.pop();
        gameState.currentColor = gameState.topCard.color;
        io.emit('initGame', gameState);
    }

    socket.on('playCard', (cardIndex) => {
        const player = gameState.players[gameState.turnIndex];
        if (player.id !== socket.id) return;

        const card = player.hand[cardIndex];
        // Проверка правил
        if (card.color === 'wild' || card.color === gameState.currentColor || card.value === gameState.topCard.value) {
            gameState.topCard = player.hand.splice(cardIndex, 1)[0];
            gameState.currentColor = gameState.topCard.color;
            
            // Логика перехода хода
            gameState.turnIndex = (gameState.turnIndex + 1) % gameState.players.length;
            io.emit('updateState', gameState);
        }
    });

    socket.on('drawCard', () => {
        const player = gameState.players[gameState.turnIndex];
        if (player.id !== socket.id) return;
        
        if (gameState.deck.length === 0) gameState.deck = createDeck();
        player.hand.push(gameState.deck.pop());
        gameState.turnIndex = (gameState.turnIndex + 1) % gameState.players.length;
        io.emit('updateState', gameState);
    });

    socket.on('disconnect', () => {
        gameState.players = gameState.players.filter(p => p.id !== socket.id);
        if (gameState.players.length < 2) gameState.gameStarted = false;
    });
});

server.listen(process.env.PORT || 3000, () => console.log('Server running!'));