const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const lobbyManager = require('./src/lobby/lobbyManager');
const PokerEngine  = require('./src/core/pokerEngine');

const app    = express();
app.use(express.static('public'));
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

const engines = new Map();

// --- Autofold için: düzenli intervalde check
setInterval(() => {
  for (const [lobbyId, engine] of engines.entries()) {
    const result = engine.checkAutoFold();
    if (result && result.autoFold) {
      io.to(lobbyId).emit('log', { type: 'lobby', msg: `Oyuncu ${result.autoFold} hamle süresini aştı ve otomatik fold oldu.` });
      const early = engine.playerAction(result.autoFold, 'fold');
      if (early?.winner) {
        io.to(lobbyId).emit('handResult', early);
        continueOrEnd(lobbyId);
        return;
      }
      const adv = engine.advanceStage();
      if (adv?.winner) {
        io.to(lobbyId).emit('handResult', adv);
        continueOrEnd(lobbyId);
      } else {
        sendGameState(lobbyId);
      }
    }
  }
}, 2000); // 2 saniyede bir kontrol

io.on('connection', socket => {
  socket.on('enqueue', ({ playerId, name }) => {
    const lobby = lobbyManager.enqueue(playerId, socket.id, name);
    if (lobby) {
      lobby.players.forEach(p => socket.join(lobby.lobbyId));
      lobby.players.forEach(p => {
        io.to(p.socketId).emit('lobbyReady', { lobbyId: lobby.lobbyId});
      });
      const engine = new PokerEngine(lobby.getPlayerList());
      engines.set(lobby.lobbyId, engine);
      engine.startGame();
      sendGameStarted(lobby.lobbyId);
    } else {
      socket.emit('waiting', 'Rakip aranıyor...');
    }
  });

  socket.on('createLobby', ({ playerId, name }) => {
    const lobby = lobbyManager.createLobby(playerId, socket.id, name);
    socket.join(lobby.lobbyId);
    socket.emit('lobbyCreated', lobby.lobbyId);
  });

  socket.on('joinLobby', ({ lobbyId, playerId, name }) => {
    const lobby = lobbyManager.joinLobby(lobbyId, playerId, socket.id, name);
    socket.join(lobbyId);
    io.to(lobbyId).emit('lobbyUpdate', lobby.getPlayerList());
    if (lobby.isFull()) {
      const engine = new PokerEngine(lobby.getPlayerList());
      engines.set(lobbyId, engine);
      engine.startGame();
      sendGameStarted(lobbyId);
    }
  });

  socket.on('playerAction', ({ lobbyId, playerId, action, amount }) => {
    const engine = engines.get(lobbyId);
    if (!engine) return;
    const early = engine.playerAction(playerId, action, amount);
    if (early?.error) {
      io.to(socket.id).emit('log', { type: 'player', msg: early.error });
      return;
    }
    if (early?.winner) {
      io.to(lobbyId).emit('handResult', early);
      continueOrEnd(lobbyId);
      return;
    }
    const adv = engine.advanceStage();
    if (adv?.winner) {
      io.to(lobbyId).emit('handResult', adv);
      continueOrEnd(lobbyId);
      return;
    }
    if (adv?.stageAdvanced) {
      io.to(lobbyId).emit('log', { type: 'lobby', msg: `Tüm oyuncular check yaptı, sonraki stage başladı.` });
    }
    if (adv?.resetChecked) {
      io.to(lobbyId).emit('log', { type: 'lobby', msg: `Bir oyuncu check yapmadı, bahis turu devam ediyor.` });
    }
    sendGameState(lobbyId);
  });

  socket.on('disconnect', () => {
    const lobby = lobbyManager.findLobbyBySocket(socket.id);
    if (!lobby) return;
    lobby.removePlayerBySocket(socket.id);
    io.to(lobby.lobbyId).emit('lobbyUpdate', lobby.getPlayerList());
    if (lobby.isEmpty()) {
      lobbyManager.removeLobby(lobby.lobbyId);
      engines.delete(lobby.lobbyId);
    }
  });
});

function sendGameStarted(lobbyId) {
  const engine = engines.get(lobbyId);
  const state = engine.getGameState();
  const lobby = lobbyManager.lobbies.get(lobbyId);
  lobby.players.forEach(p => {
    const playerState = { ...state, hand: engine.players.find(pl => pl.id === p.playerId).hand };
    io.to(p.socketId).emit('gameStarted', playerState);
  });
}

function sendGameState(lobbyId) {
  const engine = engines.get(lobbyId);
  const state = engine.getGameState();
  const lobby = lobbyManager.lobbies.get(lobbyId);
  lobby.players.forEach(p => {
    const playerState = { ...state, hand: engine.players.find(pl => pl.id === p.playerId).hand };
    io.to(p.socketId).emit('gameState', playerState);
  });
}

function continueOrEnd(lobbyId) {
  const engine = engines.get(lobbyId);
  const lobby = lobbyManager.lobbies.get(lobbyId);
  const active = engine.players.filter(p => !p.folded && p.chips > 0);
  if (active.length < 2) {
    io.to(lobbyId).emit('gameOver', { winner: active[0]?.id });
    lobbyManager.removeLobby(lobbyId);
    engines.delete(lobbyId);
  } else {
    engine.startGame();
    sendGameState(lobbyId);
  }
}

server.listen(3000, () => console.log('Server listening on port 3000'));
