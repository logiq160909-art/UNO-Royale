const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let rooms = {};
let userSockets = {};

io.on('connection', (socket) => {
    socket.on('identify', (userId) => {
        userSockets[userId] = socket.id;
        socket.userId = userId;
    });

    socket.on('sendInvite', (d) => {
        const targetSid = userSockets[d.to];
        if (targetSid) io.to(targetSid).emit('receiveInvite', d);
    });

    socket.on('createRoom', (d) => {
        const id = Math.random().toString(36).substr(2, 6);
        rooms[id] = { id, name: d.name || "UNO Table", players: [], gameStarted: false, turnIndex: 0, direction: 1, currentColor: '', deck: [] };
        io.emit('roomsList', Object.values(rooms).map(r => ({id: r.id, name: r.name, players: r.players.length})));
    });

    socket.on('joinRoom', (d) => {
        const r = rooms[d.roomId];
        if(!r || r.players.length >= 4) return;
        socket.join(d.roomId);
        r.players.push({ id: socket.id, name: d.username, hand: [], avatar: d.avatar });
        socket.emit('joinSuccess', d.roomId);
        if(r.players.length >= 2) startGame(r);
    });

    function startGame(r) {
        r.gameStarted = true;
        // Тут твоя сложная логика UNO колоды из исходника...
        io.to(r.id).emit('updateState', { players: r.players, turnIndex: 0 });
    }

    socket.on('disconnect', () => {
        if (socket.userId) delete userSockets[socket.userId];
    });
});

server.listen(process.env.PORT || 3000);