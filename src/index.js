const http = require('http');
const cors = require('cors');
const express = require('express');
const socketIO = require('socket.io');

const bot = require('./bot');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIO(server);

let currentGameState;
io.on('connection', (socket) => {
  console.log('connected!');
  if (currentGameState) {
    socket.emit('game-event', currentGameState);
  }
});

bot((gameEvent) => {
  if (gameEvent.type === 'gameFull') {
    currentGameState = gameEvent;
  } else if (currentGameState && gameEvent.type === 'gameState') {
    currentGameState.state = gameEvent;
  }
  if (gameEvent.type === 'votes') {
    io.emit('game-event', gameEvent);
  } else {
    io.emit('game-event', currentGameState);
  }
});

app.get('/', (req, res) => {
  res.json({
    message: 'Hello World!',
  });
});

const port = process.env.PORT || 4782;
server.listen(port, () => {
  console.log(`Listening at http://localhost:${port}`);
});
