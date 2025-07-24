class PlayerSocketData {
  constructor(playerId, socketId, name = null) {
    this.playerId = playerId;
    this.socketId = socketId;
  }
}

module.exports = PlayerSocketData;
