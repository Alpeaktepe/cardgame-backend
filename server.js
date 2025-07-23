const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const LobbyManager = require('./src/lobby/lobbyManager');
const PokerEngine = require('./src/core/pokerEngine');

const wss = new WebSocket.Server({ port: 3000 });

console.log('WebSocket server running on ws://localhost:3000');

const clients = new Map(); // socket -> playerId

wss.on('connection', (socket) => {
  const socketId = uuidv4();
  console.log(`Client connected: ${socketId}`);

  socket.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      const { type, data } = parsed;

      if (type === 'join_lobby') {
        const { playerId, name } = data;
        clients.set(socket, playerId);

        // Müsait bir lobi bul veya oluştur
        let lobby = Array.from(LobbyManager.lobbies.values())
          .find((l) => !l.isFull);

        if (!lobby) {
          lobby = LobbyManager.createLobby();
          console.log(`New lobby created: ${lobby.lobbyId}`);
        }

        lobby.addPlayer(playerId, socketId, name);
        console.log(`Player ${playerId} joined lobby ${lobby.lobbyId}`);

        // Lobi bilgisi gönder
        socket.send(JSON.stringify({
          type: 'lobby_joined',
          data: {
            lobbyId: lobby.lobbyId,
            players: lobby.getPlayerList(),
          },
        }));

        // Lobi dolduysa oyunu başlat
        if (lobby.isFull) {
          const game = new PokerEngine();
          const result = game.playMatch(lobby.maxPlayers);

          // Her oyuncuya sonucu gönder
          for (const player of lobby.players) {
            const clientSocket = Array.from(clients.entries())
              .find(([sock, pid]) => pid === player.playerId)?.[0];

            if (clientSocket) {
              clientSocket.send(JSON.stringify({
                type: 'game_result',
                data: {
                  board: result.board,
                  players: result.players.map((p) => ({
                    id: p.id,
                    hand: p.hand,
                    handType: p.handType
                  })),
                  winner: result.winner.id
                }
              }));
            }
          }

          LobbyManager.removeLobby(lobby.lobbyId);
        }
      }

    } catch (err) {
      console.error('[ERROR] Invalid message or processing error:', err.message);
    }
  });

  socket.on('close', () => {
    const playerId = clients.get(socket);
    clients.delete(socket);

    const lobby = LobbyManager.findLobbyByPlayerId(playerId);
    if (lobby) {
      lobby.removePlayer(playerId);
      console.log(`Player ${playerId} disconnected and removed from lobby ${lobby.lobbyId}`);
    }
  });
});
