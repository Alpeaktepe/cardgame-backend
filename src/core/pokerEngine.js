const { bestPokerHand } = require('./pokerHandEval');

class PokerEngine {
  constructor(players) {
    if (players.length < 2) throw new Error("En az 2 oyuncu gerekir.");
    this.players = players.map((p, i) => ({
      ...p,
      hand: [],
      bet: 0,
      folded: false,
      chips: 1000,
      seat: i,
      allin: false
    }));

    this.deck = [];
    this.board = [];
    this.pot = 0;
    this.currentBet = 0;
    this.lastRaise = 0;
    this.turnIndex = 0;
    this.stage = 'prebet';
    this.lastAggressorIndex = null;
    this.actionOrder = [];
  }

  startGame() {
    this._initDeck();
    this._resetForNewRound();
    this._dealHands();
  }

  _resetForNewRound() {
    this.board = [];
    this.pot = 0;
    this.currentBet = 0;
    this.lastRaise = 0;
    this.stage = 'prebet';
    this.turnIndex = 0;
    this.lastAggressorIndex = null;
    this.actionOrder = [];

    this.players.forEach(p => {
      p.bet = 0;
      p.folded = false;
      p.hand = [];
      p.allin = false;
    });
  }

  _initDeck() {
    const suits = ['Club', 'Diamond', 'Heart', 'Spade'];
    const ranks = [
      'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
      'Ten', 'Jack', 'Queen', 'King', 'Ace'
    ];

    this.deck = [];
    suits.forEach(suit =>
      ranks.forEach(rank => this.deck.push({ suit, rank }))
    );

    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  _dealHands() {
    this.players.forEach(p => {
      p.hand = [this.deck.pop(), this.deck.pop()];
    });
  }

  _findNextActivePlayerIndex(curr) {
    const len = this.players.length;
    for (let i = 1; i <= len; i++) {
      const idx = (curr + i) % len;
      const player = this.players[idx];

      if (!player.folded && player.chips > 0) {
        return idx;
      }
    }
    return curr;
  }

  _inHand() {
    return this.players.filter(p => !p.folded);
  }

  _isBettingRoundOver() {
    const activePlayers = this.players.filter(p => !p.folded);
    const canActPlayers = this.players.filter(p => !p.folded && p.chips > 0);

    if (activePlayers.length <= 1) return true;

    const allBetsEqual = activePlayers.every(p => p.bet === this.currentBet);
    if (!allBetsEqual) return false;

    if (canActPlayers.length === 0) return true;

    if (canActPlayers.length === 2) {
      if (this.currentBet > 0) return true;

      const acted = new Set(this.actionOrder);
      if (acted.size >= 2) return true;
      return false;
    }

    let lastActionIndex = -1;
    for (let i = this.actionOrder.length - 1; i >= 0; i--) {
      const idx = this.actionOrder[i];
      const act = this.players[idx];
      if (!act.folded && (act.bet === this.currentBet || act.allin)) {
        lastActionIndex = i;
        break;
      }
    }

    if (lastActionIndex >= 0) {
      const actedSince = new Set(this.actionOrder.slice(lastActionIndex + 1));
      if (actedSince.size >= canActPlayers.length - 1) {
        return true;
      }
    }

    return false;
  }

  playerAction(playerId, action = '', amount = 0) {
    const player = this.players[this.turnIndex];

    if (!player || player.id !== playerId || player.folded || player.allin) {
      return { error: 'Sıra sizde değil veya elden çıktınız.' };
    }

    let logMsg = '';
    this.actionOrder.push(this.turnIndex);

    if (action === 'fold') {
      player.folded = true;
      logMsg = `${player.name} fold yaptı`;

      const activePlayers = this._inHand();
      if (activePlayers.length === 1) {
        activePlayers[0].chips += this.pot;
        this.stage = 'ended';
        return {
          winner: activePlayers[0].id,
          pot: this.pot,
          board: this.board,
          reason: "everyone_folded",
          log: logMsg
        };
      }
    }
    else if (action === 'check') {
      if (player.bet !== this.currentBet)
        return { error: 'Check yapamazsınız, call yapmalısınız' };
      logMsg = `${player.name} check yaptı`;
    }
    else if (action === 'call') {
      const callAmount = this.currentBet - player.bet;
      if (callAmount < 0)
        return { error: 'Call yapacak miktar yok' };

      if (callAmount === 0) {
        logMsg = `${player.name} check yaptı`;
      } else {
        const actualCall = Math.min(callAmount, player.chips);
        player.chips -= actualCall;
        player.bet += actualCall;
        this.pot += actualCall;
        if (player.chips === 0) player.allin = true;
        logMsg = `${player.name} ${actualCall} call yaptı${player.allin ? ' (all-in)' : ''}`;
      }
    }
    else if (action === 'bet') {
      if (this.currentBet !== 0)
        return { error: 'Bet sadece bahis açılmadıysa yapılabilir' };
      if (amount < 1)
        return { error: 'Minimum bet 1' };
      if (amount > player.chips)
        return { error: 'Yetersiz chip' };

      player.chips -= amount;
      player.bet = amount;
      this.pot += amount;
      this.currentBet = amount;
      this.lastRaise = amount;
      this.lastAggressorIndex = this.turnIndex;
      if (player.chips === 0) player.allin = true;
      logMsg = `${player.name} ${amount} bet yaptı${player.allin ? ' (all-in)' : ''}`;
    }
    else if (action === 'raise') {
      if (this.currentBet === 0)
        return { error: 'Raise için önce bet olmalı' };
      if (amount < this.lastRaise)
        return { error: `Minimum raise ${this.lastRaise}` };

      const callAmount = this.currentBet - player.bet;
      const raiseAmount = amount;
      const totalCost = callAmount + raiseAmount;
      const newBet = this.currentBet + raiseAmount;

      if (totalCost > player.chips)
        return { error: 'Yetersiz chip' };

      player.chips -= totalCost;
      player.bet = newBet;
      this.pot += totalCost;
      this.lastRaise = raiseAmount;
      this.currentBet = newBet;
      this.lastAggressorIndex = this.turnIndex;
      if (player.chips === 0) player.allin = true;
      logMsg = `${player.name} ${raiseAmount} raise yaptı${player.allin ? ' (all-in)' : ''}`;
    }
    else {
      return { error: 'Geçersiz aksiyon' };
    }

    if (this._isBettingRoundOver()) {
      const advanceResult = this.advanceStage();
      if (advanceResult) {
        advanceResult.log = logMsg;
        return advanceResult;
      }
    }

    // Sıradaki oyuncuya geç
    this.turnIndex = this._findNextActivePlayerIndex(this.turnIndex);
    const result = { log: logMsg };

    
    if (this._allPlayersAllInOrFolded() && this.stage !== 'showdown') {
      while (['flop','turn','river'].includes(this.stage)) {
        const advanceResult = this.advanceStage();
        if (advanceResult && advanceResult.reason === 'showdown') {
          return advanceResult;
        }
      }
    }

    return result;
  }

  _openBoard(n) {
    for (let i = 0; i < n; i++) {
      if (this.deck.length > 0)
        this.board.push(this.deck.pop());
    }
  }

  advanceStage() {
    this.players.forEach(p => { p.bet = 0; });
    this.currentBet = 0;
    this.lastRaise = 0;
    this.lastAggressorIndex = null;

    // Son aksiyonu yapan oyuncunun indexi
    let startIdx = this.turnIndex;
    if (this.actionOrder.length > 0) {
      startIdx = this.actionOrder[this.actionOrder.length - 1];
    }
    this.actionOrder = [];

    if (this.stage === 'prebet') {
      this.stage = 'flop';
      this._openBoard(3);
    } else if (this.stage === 'flop') {
      this.stage = 'turn';
      this._openBoard(1);
    } else if (this.stage === 'turn') {
      this.stage = 'river';
      this._openBoard(1);
    } else if (this.stage === 'river') {
      this.stage = 'showdown';
      const result = this._determineWinner();

      
      const showdownHands = this.players
        .filter(p => !p.folded)
        .map(p => ({ id: p.id, name: p.name, hand: p.hand }));

      if (result.winner) {
        this.players.find(p => p.id === result.winner).chips += this.pot;
      }
      const potWon = this.pot;
      this.pot = 0;
      return {
        winner: result.winner,
        pot: potWon,
        board: this.board,
        reason: "showdown",
        showdownHands
      };
      
    }

    if (this._allPlayersAllInOrFolded() && ['flop','turn','river'].includes(this.stage)) {
  // Kalan tüm board kartlarını aç
  if (this.stage === 'flop') this._openBoard(1); // turn
  if (this.stage === 'turn') this._openBoard(1); // river
  this.stage = 'showdown';
  // Kazananı belirle
  const result = this._determineWinner();
  const showdownHands = this.players
    .filter(p => !p.folded)
    .map(p => ({ id: p.id, name: p.name, hand: p.hand }));
  if (result.winner) {
    this.players.find(p => p.id === result.winner).chips += this.pot;
  }
  const potWon = this.pot;
  this.pot = 0;
  return {
    winner: result.winner,
    pot: potWon,
    board: this.board,
    reason: "showdown",
    showdownHands
  };
}

    this.turnIndex = this._findNextActivePlayerIndex(startIdx);

    return { stageAdvanced: true, board: this.board, stage: this.stage };
  }

  _determineWinner() {
    const active = this._inHand();
    if (active.length === 0) return { winner: null };
    if (active.length === 1) return { winner: active[0].id };

    let bestHand = null;
    let winnerId = null;

    active.forEach(player => {
      const allCards = [...player.hand, ...this.board];
      const handEval = bestPokerHand(allCards);

      if (!bestHand || this._compareHands(handEval, bestHand) > 0) {
        bestHand = handEval;
        winnerId = player.id;
      }
    });

    return { winner: winnerId };
  }

  _compareHands(hand1, hand2) {
    if (hand1.rank !== hand2.rank) return hand1.rank - hand2.rank;
    if (hand1.high !== hand2.high) return hand1.high - hand2.high;
    return 0; // Basitleştirilmiş
  }

  _allPlayersAllInOrFolded() {
  const active = this.players.filter(p => !p.folded);
  // 1 kişi kaldıysa zaten oyun bitmiş olur.
  if (active.length <= 1) return true;
  return active.every(p => p.allin);
}


  getGameState(forId = null) {
    return {
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        hand: (forId && forId === p.id) ? p.hand : [],
        allin: p.allin
      })),
      board: this.board,
      pot: this.pot,
      stage: this.stage,
      currentBet: this.currentBet,
      lastRaise: this.lastRaise,
      currentPlayer: this.players[this.turnIndex]?.id,
    };
  }
}

module.exports = PokerEngine;
