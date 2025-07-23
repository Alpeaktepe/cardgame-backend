class Player {
  constructor(playerId, socketId, name = null) {
    this.playerId = playerId;   // Persistent user ID
    this.socketId = socketId;   // Current connection ID
    this.name = name;

    this.hand = [];
    this.handType = null;
  }

  setHand(cards) {
    this.hand = cards;
  }

  setHandType(type) {
    this.handType = type;
  }

  updateSocketId(newSocketId) {
    this.socketId = newSocketId;
  }

  resetForNewRound() {
    this.hand = [];
    this.handType = null;
  }
}

module.exports = Player;
