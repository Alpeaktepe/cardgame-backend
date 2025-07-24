class Player {
  constructor(playerId, socketId, name = null) {
    this.playerId = playerId;
    this.socketId = socketId;
    this.name     = name;
    this.hand     = [];
    this.handType = null;
  }

  setHand(cards) {
    this.hand = cards;
  }

  setHandType(type) {
    this.handType = type;
  }
}

module.exports = Player;
