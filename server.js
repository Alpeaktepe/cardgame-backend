// server.js
const WebSocket     = require('ws');
const { v4: uuidv4 } = require('uuid');
const path          = require('path');
const LobbyManager  = require('./src/lobby/lobbyManager');
const PokerEngine   = require('./src/core/pokerEngine');

const wss            = new WebSocket.Server({ port: 3000 });
const clients        = new Map(); // socket -> playerId
const games          = new Map(); // lobbyId -> PokerEngine
const lobbyChecks    = new Map(); // lobbyId -> Set<playerId>
const matchmakingQueue = [];      // [{ playerId, socket, playerName }]

// --- HELPERS ---
function sendError(socket, msg) {
  socket.send(JSON.stringify({ type: 'error', data: msg }));
}

function broadcastGameState(engine, lobbyId) {
  const state  = engine.getGameState();
  const checks = lobbyChecks.get(lobbyId) || new Set();
  const lobby  = LobbyManager.lobbies.get(lobbyId);
  if (!lobby) return;

  for (const [sock, pid] of clients.entries()) {
    if (!lobby.players.some(p => p.playerId === pid)) continue;
    const playersView = state.players.map(p => ({
      id:     p.id,
      chips:  p.chips,
      bet:    p.bet,
      folded: p.folded,
      checked: checks.has(p.id) && !p.folded,
      hand:   p.id === pid ? p.hand : []
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

  for (const [sock, pid] of clients.entries()) {
    if (!lobby.players.some(p => p.playerId === pid)) continue;
    const playersView = engine.players.map(p => ({
      id:       p.id,
      hand:     p.id === pid ? p.hand : [],
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

// --- WebSocket HANDLERS ---
wss.on('connection', socket => {
  // Yeni bağlantı → benzersiz ID oluştur
  socket.id      = uuidv4();
  socket.isAlive = true;
  socket.on('pong', () => socket.isAlive = true);

  socket.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); }
    catch { return sendError(socket, 'Invalid JSON'); }

    const { type, data } = msg;

    // 1) CREATE LOBBY
    if (type === 'createLobby') {
      const { playerId, playerName, maxPlayers = 2 } = data;
      const lobby = LobbyManager.createLobby(maxPlayers);
      try {
        lobby.addPlayer(String(playerId), socket.id, playerName);
      } catch (err) {
        return sendError(socket, err.message);
      }
      clients.set(socket, String(playerId));
      return socket.send(JSON.stringify({
        type: 'lobbyCreated',
        data: {
          lobbyId: lobby.lobbyId,
          players: lobby.getPlayerList()
        }
      }));
    }

    // 2) JOIN LOBBY
    if (type === 'joinLobby') {
      const { playerId, playerName, lobbyId } = data;
      const lobby = LobbyManager.lobbies.get(lobbyId);
      if (!lobby) return sendError(socket, 'Lobby not found');
      try {
        lobby.addPlayer(String(playerId), socket.id, playerName);
      } catch (err) {
        return sendError(socket, err.message);
      }
      clients.set(socket, String(playerId));
      // Her üye client’a güncel lobi bilgisi gönder
      for (const [s, pid] of clients.entries()) {
        if (lobby.players.some(p => p.playerId === pid)) {
          s.send(JSON.stringify({
            type: 'lobbyJoined',
            data: {
              lobbyId,
              players: lobby.getPlayerList()
            }
          }));
        }
      }
      if (lobby.isFull()) startGameForLobby(lobbyId);
      return;
    }

    // 3) MATCHMAKING
    if (type === 'matchmaking') {
      const { playerId, playerName } = data;
      clients.set(socket, String(playerId));
      matchmakingQueue.push({ playerId: String(playerId), socket, playerName });
      if (matchmakingQueue.length >= 2) {
        const p1 = matchmakingQueue.shift();
        const p2 = matchmakingQueue.shift();
        const lobby = LobbyManager.createLobby(2);
        lobby.addPlayer(p1.playerId, p1.socket.id, p1.playerName);
        lobby.addPlayer(p2.playerId, p2.socket.id, p2.playerName);
        clients.set(p1.socket, p1.playerId);
        clients.set(p2.socket, p2.playerId);
        [p1, p2].forEach(p => {
          p.socket.send(JSON.stringify({
            type: 'lobbyJoined',
            data: {
              lobbyId: lobby.lobbyId,
              players: lobby.getPlayerList()
            }
          }));
        });
        startGameForLobby(lobby.lobbyId);
      }
      return;
    }

    // 4) IN-GAME ACTIONS: call, raise, fold, check
    if (['call','raise','fold','check'].includes(type)) {
      const { lobbyId, playerId, amount } = data;
      // Kimlik doğrulama
      const pid = clients.get(socket);
      if (pid !== String(playerId)) {
        return sendError(socket, 'Player/socket mismatch');
      }
      // Lobi kontrolü
      const lobby = LobbyManager.lobbies.get(lobbyId);
      if (!lobby) {
        return sendError(socket, 'Lobby not found');
      }
      const memberIds = lobby.players.map(p => p.playerId);
      if (!memberIds.includes(String(playerId))) {
        return sendError(socket, 'Not in this lobby');
      }
      // Motor kontrolü
      const engine = games.get(lobbyId);
      if (!engine) {
        return sendError(socket, 'Game not found');
      }
      // Raise miktar validasyonu
      if (type === 'raise' && (!Number.isFinite(amount) || amount <= 0)) {
        return sendError(socket, 'Invalid amount for raise');
      }

      // Aksiyonları uygula
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

      // Oyun bitti mi?
      if (result && result.winner) {
        broadcastGameResult(engine, lobbyId, result);
        games.delete(lobbyId);
        LobbyManager.removeLobby(lobbyId);
        lobbyChecks.delete(lobbyId);
        return;
      }

      // Güncel durumu yayınla
      broadcastGameState(engine, lobbyId);

      // Eğer check aksiyonuysa ve tüm aktif oyuncular checklediyse
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

    // Diğer tipler...
  });

  // Disconnect handling
  socket.on('close', () => {
    const pid = clients.get(socket);
    clients.delete(socket);
    // lobi ve oyun temizliği...
  });
});

// Ping-pong health check every 30s
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
