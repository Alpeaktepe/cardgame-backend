const { v4: uuidv4 } = require('uuid');
const Player = require('../models/player.js');

class Lobby {
  constructor(maxPlayers = 2) {
    this.lobbyId = uuidv4();
    this.players = [];
    this.maxPlayers = maxPlayers;
  }

  addPlayer(playerId, socketId, name = null) {
    if (this.players.length >= this.maxPlayers) {
      throw new Error('Lobby is full');
    }
    // Aynı player iki kez eklenmesin
    if (this.players.some(p => p.playerId === playerId)) {
      throw new Error('Player already in lobby');
    }
    const player = new Player(playerId, socketId, name);
    this.players.push(player);
    return player;
  }

  removePlayer(playerId) {
    this.players = this.players.filter(p => p.playerId !== playerId);
  }

  isFull() {
    return this.players.length >= this.maxPlayers;
  }

  getPlayerList() {
    return this.players.map(p => ({
      playerId: p.playerId,
      socketId: p.socketId,
      name: p.name,
    }));
  }
}

class LobbyManager {
  constructor() {
    this.lobbies = new Map();
  }

  joinOrCreateLobby(playerId, socketId, name = null, maxPlayers = 2) {
    // Player zaten bir lobby'de ise tekrar eklenmesin
    const existingLobby = this.findLobbyByPlayerId(playerId);
    if (existingLobby) {
      return existingLobby;
    }
    for (const lobby of this.lobbies.values()) {
      if (!lobby.isFull() && lobby.maxPlayers === maxPlayers) {
        try {
          lobby.addPlayer(playerId, socketId, name);
          return lobby;
        } catch (err) {
          // Lobby dolu veya oyuncu zaten var, devam et
          continue;
        }
      }
    }
    const lobby = this.createLobby(maxPlayers);
    lobby.addPlayer(playerId, socketId, name);
    return lobby;
  }

  createLobby(maxPlayers = 2) {
    const lobby = new Lobby(maxPlayers);
    this.lobbies.set(lobby.lobbyId, lobby);
    return lobby;
  }

  findLobbyByPlayerId(playerId) {
    for (const lobby of this.lobbies.values()) {
      if (lobby.players.some(p => p.playerId === playerId)) {
        return lobby;
      }
    }
    return null;
  }

  removeLobby(lobbyId) {
    this.lobbies.delete(lobbyId);
  }

  // Ekstra: Boş lobby'leri temizle
  cleanupEmptyLobbies() {
    for (const [lobbyId, lobby] of this.lobbies.entries()) {
      if (lobby.players.length === 0) {
        this.lobbies.delete(lobbyId);
      }
    }
  }
}

module.exports = new LobbyManager();
