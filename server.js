const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { Worker } = require('worker_threads');
const LobbyManager = require('./src/lobby/lobbyManager');
const PokerEngine = require('./src/core/pokerEngine');

const wss = new WebSocket.Server({ port: 3000 });
const clients = new Map();     // WebSocket -> playerId
const games = new Map();       // lobbyId -> PokerEngine instance
const matchmakingQueue = [];

// Ping-pong kontrolü için worker thread
const pingWorker = new Worker(`
  const { parentPort } = require('worker_threads');
  setInterval(() => parentPort.postMessage('pingTick'), 30000);
`, { eval: true });
pingWorker.on('message', msg => {
  if (msg === 'pingTick') {
    for (const [socket] of clients.entries()) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }
});

wss.on('connection', socket => {
  socket.isAlive = true;
  clients.set(socket, null);
  socket.on('pong', () => socket.isAlive = true);

  socket.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); }
    catch { return socket.send(JSON.stringify({ type: 'error', data: 'Invalid JSON' })); }

    // 1) createLobby
    if (msg.type === 'createLobby') {
      const { playerId, name, maxPlayers = 2 } = msg.data;
      const lobby = LobbyManager.createLobby(maxPlayers);
      lobby.addPlayer(playerId, socket._socketId || (socket._socketId = uuidv4()), name);
      clients.set(socket, playerId);
      return socket.send(JSON.stringify({ type: 'lobbyCreated', data: { lobbyId: lobby.lobbyId, players: lobby.getPlayerList() } }));
    }

    // 2) joinLobby
    if (msg.type === 'joinLobby') {
      const { playerId, name, lobbyId } = msg.data;
      const lobby = LobbyManager.lobbies.get(lobbyId);
      if (!lobby) return socket.send(JSON.stringify({ type: 'error', data: 'Lobby not found' }));
      if (lobby.isFull()) return socket.send(JSON.stringify({ type: 'error', data: 'Lobby is full' }));
      lobby.addPlayer(playerId, socket._socketId || (socket._socketId = uuidv4()), name);
      clients.set(socket, playerId);
      // Bilgilendir
      for (const [sock, pid] of clients.entries()) {
        if (lobby.players.some(p => p.playerId === pid)) {
          sock.send(JSON.stringify({ type: 'lobbyJoined', data: { lobbyId, players: lobby.getPlayerList() } }));
        }
      }
      // Lobby artık dolduysa oyunu başlat
      if (lobby.isFull()) {
        const engine = new PokerEngine(lobby.players);
        engine.startGame();
        games.set(lobbyId, engine);
        // Oyuna katılan herkese gameStart
        for (const [sock, pid] of clients.entries()) {
          if (lobby.players.some(p => p.playerId === pid)) {
            const state = engine.getGameState();
            const ownHand = engine.players.find(pl => pl.id === pid).hand;
            sock.send(JSON.stringify({ type: 'gameStart', data: { lobbyId, playerId: pid, board: state.board, hand: ownHand, players: state.players.map(p => ({ id: p.id, name: p.name, chips: p.chips, folded: p.folded })), pot: state.pot, currentPlayer: state.currentPlayer, stage: state.stage } }));
          }
        }
      }
      return;
    }

    // 3) matchmaking
    if (msg.type === 'matchmaking') {
      const { playerId, name } = msg.data;
      clients.set(socket, playerId);
      matchmakingQueue.push({ playerId, socket, name });
      if (matchmakingQueue.length >= 2) {
        const [p1, p2] = matchmakingQueue.splice(0, 2);
        const lobby = LobbyManager.createLobby(2);
        lobby.addPlayer(p1.playerId, uuidv4(), p1.name);
        lobby.addPlayer(p2.playerId, uuidv4(), p2.name);
        [p1, p2].forEach(p => p.socket.send(JSON.stringify({ type: 'lobbyJoined', data: { lobbyId: lobby.lobbyId, players: lobby.getPlayerList() } })));        
        const engine = new PokerEngine(lobby.players);
        engine.startGame();
        games.set(lobby.lobbyId, engine);
        for (const [sock, pid] of clients.entries()) {
          if (lobby.players.some(p => p.playerId === pid)) {
            const state = engine.getGameState();
            const ownHand = engine.players.find(pl => pl.id === pid).hand;
            sock.send(JSON.stringify({ type: 'gameStart', data: { lobbyId: lobby.lobbyId, playerId: pid, board: state.board, hand: ownHand, players: state.players.map(p => ({ id: p.id, name: p.name, chips: p.chips, folded: p.folded })), pot: state.pot, currentPlayer: state.currentPlayer, stage: state.stage } }));
          }
        }
      }
      return;
    }

    // Helper: broadcast gameState per client
    const broadcastGameState = (engine, lobbyId) => {
      const state = engine.getGameState();
      for (const [sock, pid] of clients.entries()) {
        if (!pid) continue;
        const playersView = state.players.map(p => ({ id: p.id, chips: p.chips, bet: p.bet, folded: p.folded, hand: pid === p.id ? p.hand : [] }));
        sock.send(JSON.stringify({ type: 'gameState', data: { lobbyId, board: state.board, players: playersView, pot: state.pot, currentPlayer: state.currentPlayer, stage: state.stage } }));
      }
    };

    // Helper: broadcast gameResult per client
    const broadcastGameResult = (engine, lobbyId, result) => {
      const state = engine.getGameState();
      for (const [sock, pid] of clients.entries()) {
        if (!pid) continue;
        const playersView = state.players.map(p => ({ id: p.id, hand: pid === p.id ? p.hand : [], handType: p.handType }));
        sock.send(JSON.stringify({ type: 'gameResult', data: { lobbyId, winner: result.winner, handType: result.handType, board: state.board, players: playersView } }));
      }
    };

    // 4) nextStage
    if (msg.type === 'nextStage') {
      const { lobbyId } = msg.data;
      const engine = games.get(lobbyId);
      if (!engine) return socket.send(JSON.stringify({ type: 'error', data: 'Game not found' }));
      const result = engine.advanceStage();
      if (result && result.winner) {
        broadcastGameResult(engine, lobbyId, result);
        games.delete(lobbyId);
        LobbyManager.removeLobby(lobbyId);
      } else {
        broadcastGameState(engine, lobbyId);
      }
      return;
    }

    // 5) showdown (finishGame)
    if (msg.type === 'showdown') {
      const { lobbyId } = msg.data;
      const engine = games.get(lobbyId);
      if (!engine) return socket.send(JSON.stringify({ type: 'error', data: 'Game not found' }));
      const result = engine.finishGame();
      broadcastGameResult(engine, lobbyId, result);
      games.delete(lobbyId);
      LobbyManager.removeLobby(lobbyId);
      return;
    }

    // 6) bet
    if (msg.type === 'bet') {
      const { lobbyId, playerId, amount } = msg.data;
      const engine = games.get(lobbyId);
      if (!engine) return socket.send(JSON.stringify({ type: 'error', data: 'Game not found' }));
      if (typeof amount !== 'number') return socket.send(JSON.stringify({ type: 'error', data: 'Amount required for bet' }));
      const result = engine.playerAction(playerId, 'bet', amount);
      if (result && result.winner) {
        broadcastGameResult(engine, lobbyId, result);
        games.delete(lobbyId);
        LobbyManager.removeLobby(lobbyId);
      } else {
        broadcastGameState(engine, lobbyId);
      }
      return;
    }

    // 7) call
    if (msg.type === 'call') {
      const { lobbyId, playerId } = msg.data;
      const engine = games.get(lobbyId);
      if (!engine) return socket.send(JSON.stringify({ type: 'error', data: 'Game not found' }));
      const result = engine.playerAction(playerId, 'call', null);
      if (result && result.winner) {
        broadcastGameResult(engine, lobbyId, result);
        games.delete(lobbyId);
        LobbyManager.removeLobby(lobbyId);
      } else {
        broadcastGameState(engine, lobbyId);
      }
      return;
    }

    // 8) raise
    if (msg.type === 'raise') {
      const { lobbyId, playerId, amount } = msg.data;
      const engine = games.get(lobbyId);
      if (!engine) return socket.send(JSON.stringify({ type: 'error', data: 'Game not found' }));
      if (typeof amount !== 'number') return socket.send(JSON.stringify({ type: 'error', data: 'Amount required for raise' }));
      const result = engine.playerAction(playerId, 'raise', amount);
      if (result && result.winner) {
        broadcastGameResult(engine, lobbyId, result);
        games.delete(lobbyId);
        LobbyManager.removeLobby(lobbyId);
      } else {
        broadcastGameState(engine, lobbyId);
      }
      return;
    }

    // 9) fold
    if (msg.type === 'fold') {
      const { lobbyId, playerId } = msg.data;
      const engine = games.get(lobbyId);
      if (!engine) return socket.send(JSON.stringify({ type: 'error', data: 'Game not found' }));
      const result = engine.playerAction(playerId, 'fold', null);
      if (result && result.winner) {
        broadcastGameResult(engine, lobbyId, result);
        games.delete(lobbyId);
        LobbyManager.removeLobby(lobbyId);
      } else {
        broadcastGameState(engine, lobbyId);
      }
      return;
    }

  });

  socket.on('close', () => {
    const pid = clients.get(socket);
    clients.delete(socket);
    const lobby = LobbyManager.findLobbyByPlayerId(pid);
    if (!lobby) return;
    const engine = games.get(lobby.lobbyId);
    lobby.removePlayer(pid);
    if (engine) {
      const result = engine.playerAction(pid, 'fold', null);
      if (result && result.winner) {
        broadcastGameResult(engine, lobby.lobbyId, result);
        games.delete(lobby.lobbyId);
        LobbyManager.removeLobby(lobby.lobbyId);
        return;
      }
      broadcastGameState(engine, lobby.lobbyId);
    }
  });
});

module.exports = {};
