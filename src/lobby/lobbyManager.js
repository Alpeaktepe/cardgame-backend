// File: lobbyManager.js
const { v4: uuidv4 } = require('uuid');

class Lobby {
  constructor(players) {
    this.lobbyId = uuidv4();
    this.players = players; // [{ playerId, socketId, name }]
  }
  isFull() { return this.players.length >= 2; }
  isEmpty() { return this.players.length === 0; }
  addPlayer(player) { this.players.push(player); }
  removePlayerBySocket(socketId) {
    this.players = this.players.filter(p => p.socketId !== socketId);
  }
  getPlayerList() { return this.players.map(p => ({ id: p.playerId, name: p.name })); }
}

class LobbyManager {
  constructor() {
    this.queue = [];
    this.lobbies = new Map();
  }

  enqueue(playerId, socketId, name) {
    this.queue.push({ playerId, socketId, name });
    if (this.queue.length >= 2) {
      const pair = this.queue.splice(0, 2);
      const lobby = new Lobby(pair);
      this.lobbies.set(lobby.lobbyId, lobby);
      return lobby;
    }
    return null;
  }

  createLobby(playerId, socketId, name) {
    const lobby = new Lobby([{ playerId, socketId, name }]);
    this.lobbies.set(lobby.lobbyId, lobby);
    return lobby;
  }

  joinLobby(lobbyId, playerId, socketId, name) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) throw new Error('Lobby bulunamadı');
    if (lobby.isFull()) throw new Error('Lobi dolu');
    lobby.addPlayer({ playerId, socketId, name });
    return lobby;
  }

  findLobbyBySocket(socketId) {
    for (let lobby of this.lobbies.values()) {
      if (lobby.players.some(p => p.socketId === socketId)) return lobby;
    }
    return null;
  }

  removeLobby(lobbyId) {
    this.lobbies.delete(lobbyId);
  }
}

module.exports = new LobbyManager();
