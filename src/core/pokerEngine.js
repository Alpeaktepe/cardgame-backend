class PokerEngine {
  constructor(players) {
    this.players = players.map(p => ({ ...p, hand: [], bet: 0, folded: false, chips: 1000 }));
    this.deck = [];
    this.board = [];
    this.pot = 0;
    this.stage = 'preflop';
    this.currentBet = 0;
    this.turnIndex = 0;
    this.actionsTaken = 0;
  }

  startGame() {
    this._initDeck();
    this._dealHands();
    this.board = [];
    this.stage = 'preflop';
    this.currentBet = 0;
    this.turnIndex = 0;
    this.actionsTaken = 0;
    this.players.forEach(p => { p.bet = 0; p.folded = false; });
  }

  _initDeck() {
    const suits = ['Club','Diamond','Heart','Spade'];
    const ranks = ['Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Jack','Queen','King','Ace'];
    this.deck = [];
    suits.forEach(suit => ranks.forEach(rank => this.deck.push({ suit, rank })));
    
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
    const player = this.players[this.turnIndex];
    if (!player || player.id !== playerId || player.folded) return { error: 'Sıra sizde değil veya fold.' };

    this.actionsTaken++;

    if (action === 'fold') {
      player.folded = true;
      if (this.players.filter(p => !p.folded).length === 1) {
        const winner = this.players.find(p => !p.folded);
        winner.chips += this.pot;
        return { winner: winner.id, pot: this.pot, board: this.board, reason: "everyone_folded" };
      }
    }
    if (action === 'check') {
      if (player.bet !== this.currentBet) return { error: 'Check için bahis eşit olmalı' };
    } else if (action === 'call') {
      const diff = this.currentBet - player.bet;
      if (player.chips < diff) return { error: 'Yetersiz chip' };
      player.chips -= diff;
      player.bet += diff;
      this.pot += diff;
    } else if (action === 'bet' || action === 'raise') {
      if (amount <= this.currentBet) return { error: 'Bet/Raise mevcut bahisten yüksek olmalı' };
      if (player.chips < amount) return { error: 'Yetersiz chip' };
      player.chips -= amount;
      player.bet += amount;
      this.pot += amount;
      this.currentBet = player.bet;
    }

    this.turnIndex = this._nextPlayerIndex();
    return null;
  }

  advanceStage() {
    const activeCount = this.players.filter(p => !p.folded).length;
    if (this.actionsTaken < activeCount) return null;

    this.currentBet = 0;
    this.players.forEach(p => p.bet = 0);
    this.actionsTaken = 0;

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
      const winner = this._determineWinner();
      const pot = this.pot;
      this.players.find(p => p.id === winner).chips += pot;
      return { winner, pot, board: this.board, reason: "showdown" };
    }
    return null;
  }

  _nextPlayerIndex() {
    const len = this.players.length;
    for (let i = 1; i <= len; i++) {
      const idx = (this.turnIndex + i) % len;
      if (!this.players[idx].folded) return idx;
    }
    return this.turnIndex;
  }

  _determineWinner() {
    const active = this.players.filter(p => !p.folded);
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
