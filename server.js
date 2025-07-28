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

io.on('connection', socket => {
  socket.on('enqueue', ({ playerId, name }) => {
    const lobby = lobbyManager.enqueue(playerId, socket.id, name);
    if (lobby) {
      // Her iki oyuncunun socket'ini lobiye ekle
      lobby.players.forEach(p => io.sockets.sockets.get(p.socketId)?.join(lobby.lobbyId));
      lobby.players.forEach(p => io.to(p.socketId).emit('lobbyReady', { lobbyId: lobby.lobbyId }));
      const engine = new PokerEngine(lobby.getPlayerList());
      engines.set(lobby.lobbyId, engine);
      engine.startGame();
      sendGameStarted(lobby.lobbyId);
      io.to(lobby.lobbyId).emit('log', { type: 'lobby', msg: 'Matchmaking tamamlandı, oyun başlıyor!' });
    } else {
      io.to(socket.id).emit('waiting', 'Rakip aranıyor...');
    }
  });

  socket.on('createLobby', ({ playerId, name }) => {
    const lobby = lobbyManager.createLobby(playerId, socket.id, name);
    socket.join(lobby.lobbyId);
    socket.emit('lobbyCreated', lobby.lobbyId);
  });

  socket.on('joinLobby', ({ lobbyId, playerId, name }) => {
    const lobby = lobbyManager.joinLobby(lobbyId, playerId, socket.id, name);
    // Tüm oyuncuları lobiye ekle
    lobby.players.forEach(p => io.sockets.sockets.get(p.socketId)?.join(lobbyId));
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
    const player = engine.players.find(p => p.id === playerId);

    // Herkese hareketi logla
    io.to(lobbyId).emit('log', {
      type: 'player',
      msg: `${player?.name || playerId}: ${action}${amount ? ' ' + amount : ''}`
    });

    const result = engine.playerAction(playerId, action, amount);
    if (result?.error) {
      io.to(socket.id).emit('log', { type: 'player', msg: result.error });
      return;
    }
    if (result?.winner) {
      io.to(lobbyId).emit('handResult', result);
      io.to(lobbyId).emit('log', { type: 'player', msg: `El bitti! Kazanan: ${engine.players.find(p=>p.id===result.winner)?.name || result.winner}` });
      continueOrEnd(lobbyId);
      return;
    }
    if (result?.stageAdvanced) {
      io.to(lobbyId).emit('log', { type: 'lobby', msg: `Stage: ${engine.stage} - Yeni kart açıldı!` });
    }
    if (result?.log) {
      io.to(lobbyId).emit('log', { type: 'player', msg: result.log });
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
  const lobby = lobbyManager.lobbies.get(lobbyId);
  lobby.players.forEach(p => {
    const playerState = engine.getGameState(p.playerId || p.id);
    io.to(p.socketId).emit('gameStarted', playerState);
  });
}

function sendGameState(lobbyId) {
  const engine = engines.get(lobbyId);
  const lobby = lobbyManager.lobbies.get(lobbyId);
  lobby.players.forEach(p => {
    const playerState = engine.getGameState(p.playerId || p.id);
    io.to(p.socketId).emit('gameState', playerState);
  });
}

function continueOrEnd(lobbyId) {
  const engine = engines.get(lobbyId);
  const lobby = lobbyManager.lobbies.get(lobbyId);
  const finished = engine.players.filter(p => p.chips > 0);
  if (finished.length < 2) {
    io.to(lobbyId).emit('gameOver', { winner: finished[0]?.id });
    io.to(lobbyId).emit('log', { type: 'lobby', msg: `Oyun Bitti! Kazanan: ${finished[0]?.name || finished[0]?.id}` });
    lobbyManager.removeLobby(lobbyId);
    engines.delete(lobbyId);
  } else {
    // Sıfırlanmamış iki kişi varsa yeni el başlat!
    engine.startGame();
    io.to(lobbyId).emit('log', { type: 'lobby', msg: `Yeni el başlıyor...` });
    sendGameState(lobbyId);
  }
}

server.listen(3000, () => console.log('Server listening on port 3000'));
