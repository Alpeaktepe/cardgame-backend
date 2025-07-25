class PokerEngine {
  constructor(players) {
    this.players = players.map(p => ({ ...p, hand: [], bet: 0, folded: false, chips: 1000 }));
    this.deck = [];
    this.board = [];
    this.pot = 0;
    this.stage = 'preflop';
    this.currentBet = 0;
    this.turnIndex = 0;
  }

  startGame() {
    this._initDeck();
    this._dealHands();
    this.board = [];
    this.stage = 'preflop';
    this.currentBet = 0;
    this.turnIndex = 0;
  }

  _initDeck() {
    const suits = ['C','D','H','S'];
    const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    this.deck = [];
    suits.forEach(s => ranks.forEach(r => this.deck.push(r + s)));
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  _dealHands() {
    this.players.forEach(p => {
      p.hand = [this.deck.pop(), this.deck.pop()];
      p.bet = 0;
      p.folded = false;
    });
  }

  playerAction(playerId, action, amount = 0) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || player.folded) return;
    if (action === 'fold') {
      player.folded = true;
      return { winner: this.players.find(p => !p.folded).id };
    }
    if (action === 'check') {
      if (player.bet !== this.currentBet) throw new Error('Check için bahis eşit olmalı');
    } else if (action === 'call') {
      const diff = this.currentBet - player.bet;
      player.chips -= diff;
      player.bet += diff;
      this.pot += diff;
    } else if (action === 'bet' || action === 'raise') {
      if (amount <= this.currentBet) throw new Error('Bahis mevcut bahisten yüksek olmalı');
      player.chips -= amount;
      player.bet += amount;
      this.pot += amount;
      this.currentBet = player.bet;
    }
    // Sıradaki oyuncuya geç
    this.turnIndex = (this.turnIndex + 1) % this.players.length;
    return null;
  }

  advanceStage() {
    // Aktif oyuncular bahsi eşitlemiş veya fold olmuş olmalı
    if (this.players.filter(p => !p.folded).some(p => p.bet !== this.currentBet)) return null;
    // Bahisleri sıfırla
    this.currentBet = 0;
    this.players.forEach(p => p.bet = 0);

    if (this.stage === 'preflop') {
      this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
      this.stage = 'flop';
    } else if (this.stage === 'flop') {
      this.board.push(this.deck.pop());
      this.stage = 'turn';
    } else if (this.stage === 'turn') {
      this.board.push(this.deck.pop());
      this.stage = 'river';
    } else if (this.stage === 'river') {
      // Showdown
      const winner = this._determineWinner();
      return { winner, pot: this.pot, board: this.board };
    }
    return null;
  }

  _determineWinner() {
    const active = this.players.filter(p => !p.folded);
    // Basit: en yüksek id değerine göre kazanan
    return active.reduce((best, p) => p.id > best.id ? p : best).id;
  }

  getGameState() {
    return {
      players: this.players.map(p => ({ id: p.id, chips: p.chips, bet: p.bet, folded: p.folded })),
      board: this.board,
      pot: this.pot,
      stage: this.stage,
      currentPlayer: this.players[this.turnIndex].id
    };
  }
}

module.exports = PokerEngine;
