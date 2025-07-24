// server.js
const WebSocket     = require('ws');
const { v4: uuidv4 } = require('uuid');
const path          = require('path');
const LobbyManager  = require('./src/lobby/lobbyManager');
const PokerEngine   = require('./src/core/pokerEngine');

const wss              = new WebSocket.Server({ port: 3000 });
const clients          = new Map(); // socket -> { playerId, socketId }
const games            = new Map(); // lobbyId -> PokerEngine
const lobbyChecks      = new Map(); // lobbyId -> Set<playerId>
const matchmakingQueue = [];        // [{ playerId, socket, playerName }]

// Helpers
function sendError(socket, msg) {
  socket.send(JSON.stringify({ type: 'error', data: msg }));
}

function broadcastGameState(engine, lobbyId) {
  const state  = engine.getGameState();
  const checks = lobbyChecks.get(lobbyId) || new Set();
  const lobby  = LobbyManager.lobbies.get(lobbyId);
  if (!lobby) return;

  for (const [sock, { playerId }] of clients.entries()) {
    if (!lobby.players.some(p => p.playerId === playerId)) continue;

    const playersView = state.players.map(p => ({
      id:      p.id,
      chips:   p.chips,
      bet:     p.bet,
      folded:  p.folded,
      checked: checks.has(p.id) && !p.folded,
      hand:    p.id === playerId ? p.hand : []
    }));

    sock.send(JSON.stringify({
      type: 'gameState',
      data: {
        lobbyId,
        board: state.board,
        players: playersView,
        pot: state.pot,
        currentPlayer: state.currentPlayer,
        stage: state.stage
      }
    }));
  }
}

function broadcastGameResult(engine, lobbyId, result) {
  const lobby = LobbyManager.lobbies.get(lobbyId);
  if (!lobby) return;

  for (const [sock, { playerId }] of clients.entries()) {
    if (!lobby.players.some(p => p.playerId === playerId)) continue;

    const playersView = engine.players.map(p => ({
      id:       p.id,
      hand:     p.id === playerId ? p.hand : [],
      handType: p.handType
    }));

    sock.send(JSON.stringify({
      type: 'gameResult',
      data: {
        lobbyId,
        winner:   result.winner,
        handType: result.handType,
        board:    engine.board,
        players:  playersView
      }
    }));
  }
}

function startGameForLobby(lobbyId) {
  const lobby = LobbyManager.lobbies.get(lobbyId);
  if (!lobby) return;

  const engine = new PokerEngine(lobby.players);
  engine.startGame();

  games.set(lobbyId, engine);
  lobbyChecks.set(lobbyId, new Set());
  broadcastGameState(engine, lobbyId);
}

// WebSocket setup
wss.on('connection', socket => {
  // Generate a unique socketId for this connection
  const socketId = uuidv4();
  socket.isAlive = true;
  socket.on('pong', () => socket.isAlive = true);

  socket.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); }
    catch { return sendError(socket, 'Invalid JSON'); }

    const { type, data } = msg;

    // --- CREATE LOBBY ---
    if (type === 'createLobby') {
      const { playerId, playerName, maxPlayers = 2 } = data;
      const lobby = LobbyManager.createLobby(maxPlayers);
      lobby.addPlayer(playerId, socketId, playerName);
      clients.set(socket, { playerId, socketId });

      return socket.send(JSON.stringify({
        type: 'lobbyCreated',
        data: {
          lobbyId: lobby.lobbyId,
          players: lobby.getPlayerList()
        }
      }));
    }

    // --- JOIN LOBBY ---
    if (type === 'joinLobby') {
      const { playerId, playerName, lobbyId } = data;
      const lobby = LobbyManager.lobbies.get(lobbyId);
      if (!lobby) return sendError(socket, 'Lobby not found');

      try {
        lobby.addPlayer(playerId, socketId, playerName);
      } catch (e) {
        return sendError(socket, e.message);
      }
      clients.set(socket, { playerId, socketId });

      // Broadcast updated lobby list
      for (const [s, { playerId: pid }] of clients.entries()) {
        if (lobby.players.some(p => p.playerId === pid)) {
          s.send(JSON.stringify({
            type: 'lobbyJoined',
            data: { lobbyId, players: lobby.getPlayerList() }
          }));
        }
      }

      if (lobby.isFull()) {
        startGameForLobby(lobbyId);
      }
      return;
    }

    // --- MATCHMAKING ---
    if (type === 'matchmaking') {
      const { playerId, playerName } = data;
      clients.set(socket, { playerId, socketId });
      matchmakingQueue.push({ playerId, socket, playerName });

      if (matchmakingQueue.length >= 2) {
        const p1 = matchmakingQueue.shift();
        const p2 = matchmakingQueue.shift();
        const lobby = LobbyManager.createLobby(2);

        lobby.addPlayer(p1.playerId, p1.socketId, p1.playerName);
        lobby.addPlayer(p2.playerId, p2.socketId, p2.playerName);
        clients.set(p1.socket, { playerId: p1.playerId, socketId: p1.socketId });
        clients.set(p2.socket, { playerId: p2.playerId, socketId: p2.socketId });

        for (const p of [p1, p2]) {
          p.socket.send(JSON.stringify({
            type: 'lobbyJoined',
            data: { lobbyId: lobby.lobbyId, players: lobby.getPlayerList() }
          }));
        }
        startGameForLobby(lobby.lobbyId);
      }
      return;
    }

    // --- IN-GAME ACTIONS: call, raise, fold, check ---
    if (['call','raise','fold','check'].includes(type)) {
      const { lobbyId, playerId, amount } = data;

      // Authentication & membership
      const clientInfo = clients.get(socket);
      if (!clientInfo || clientInfo.playerId !== playerId) {
        return sendError(socket, 'Player/socket mismatch');
      }
      const lobby = LobbyManager.lobbies.get(lobbyId);
      if (!lobby || !lobby.players.some(p => p.playerId === playerId)) {
        return sendError(socket, 'Not in this lobby');
      }
      const engine = games.get(lobbyId);
      if (!engine) return sendError(socket, 'Game not found');

      // Validate raise
      if (type === 'raise' && (!Number.isFinite(amount) || amount <= 0)) {
        return sendError(socket, 'Invalid amount for raise');
      }

      let result = null;
      switch (type) {
        case 'call':
          result = engine.playerAction(playerId, 'call');
          break;
        case 'raise':
          result = engine.playerAction(playerId, 'raise', amount);
          break;
        case 'fold':
          result = engine.playerAction(playerId, 'fold');
          break;
        case 'check':
          const checks = lobbyChecks.get(lobbyId) || new Set();
          checks.add(playerId);
          lobbyChecks.set(lobbyId, checks);
          break;
      }

      // If game ended
      if (result && result.winner) {
        broadcastGameResult(engine, lobbyId, result);
        games.delete(lobbyId);
        LobbyManager.removeLobby(lobbyId);
        lobbyChecks.delete(lobbyId);
        return;
      }

      // Otherwise broadcast new state
      broadcastGameState(engine, lobbyId);

      // Auto-advance on full check
      if (type === 'check') {
        const checks = lobbyChecks.get(lobbyId);
        if (checks.size === engine.players.filter(p => !p.folded).length) {
          checks.clear();
          const adv = engine.advanceStage();
          if (adv && adv.winner) {
            broadcastGameResult(engine, lobbyId, adv);
            games.delete(lobbyId);
            LobbyManager.removeLobby(lobbyId);
            lobbyChecks.delete(lobbyId);
          } else {
            broadcastGameState(engine, lobbyId);
          }
        }
      }
      return;
    }
  });

  // --- DISCONNECT HANDLING ---
  socket.on('close', () => {
    const info = clients.get(socket);
    if (info) clients.delete(socket);

    for (const [lobbyId, lobby] of LobbyManager.lobbies.entries()) {
      if (!info || !lobby.players.some(p => p.playerId === info.playerId)) continue;
      lobby.removePlayer(info.playerId);

      // Notify rest
      for (const [s, { playerId: pid }] of clients.entries()) {
        if (lobby.players.some(p => p.playerId === pid)) {
          s.send(JSON.stringify({
            type: 'lobbyUpdate',
            data: { lobbyId, players: lobby.getPlayerList() }
          }));
        }
      }

      // Fold in-game if needed
      const engine = games.get(lobbyId);
      if (engine) {
        engine.playerAction(info.playerId, 'fold');
        broadcastGameState(engine, lobbyId);
        if (engine.players.filter(p => !p.folded).length === 1) {
          const winner = engine.players.find(p => !p.folded).id;
          broadcastGameResult(engine, lobbyId, { winner, handType: null });
          games.delete(lobbyId);
          LobbyManager.removeLobby(lobbyId);
          lobbyChecks.delete(lobbyId);
        }
      }

      if (lobby.players.length === 0) {
        LobbyManager.removeLobby(lobbyId);
        games.delete(lobbyId);
        lobbyChecks.delete(lobbyId);
      }
    }
  });
});

// Ping-pong health check
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
