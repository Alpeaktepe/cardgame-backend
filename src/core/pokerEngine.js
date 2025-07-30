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
    this.handCount = 0;
    this._playersActedThisRound = new Set();
  }

  startGame() {
    this._initDeck();
    this._resetForNewRound();
    this._dealHands();
    this.handCount++;
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
    this._playersActedThisRound = new Set();
    this.players.forEach(p => {
      p.bet = 0;
      p.folded = false;
      p.hand = [];
      p.allin = false;
    });
  }

  _resetPlayerBets() {
    this.players.forEach(player => player.bet = 0);
    this.currentBet = 0;
    this.lastRaise = 0;
    this.lastAggressorIndex = null;
    this.actionOrder = [];
    this._playersActedThisRound = new Set();
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

  _findFirstActivePlayerIndex() {
    // All-in olmayan ilk aktif oyuncuyu bul (0'dan başlayarak)
    for (let i = 0; i < this.players.length; i++) {
      if (!this.players[i].folded && !this.players[i].allin && this.players[i].chips > 0) {
        return i;
      }
    }
    
    // Tüm oyuncular all-in/fold ise, indeks 1'i (p2) döndür
    if (this.players.every(p => p.allin || p.folded)) {
      return 1;
    }
    
    // Bu noktada p1 kesinlikle all-in veya fold olmalı, o yüzden p2'den başla
    // İndeks 1 (p2) direkt döndür - poker kuralları gereği
    return 1;
  }

  _inHand() {
    return this.players.filter(p => !p.folded);
  }

  _isBettingRoundOver() {
    const activePlayers = this.players.filter(p => !p.folded);
    
    // Only one player left - round over
    if (activePlayers.length <= 1) return true;
    
    // Get players who can still act (not all-in, have chips)
    const canAct = activePlayers.filter(p => !p.allin && p.chips > 0);
    
    // No one can act - round over
    if (canAct.length === 0) return true;
    
    // Check if all active players have equal bets
    const firstActiveBet = activePlayers[0].bet;
    const allBetsEqual = activePlayers.every(p => p.bet === firstActiveBet || p.allin);
    
    if (!allBetsEqual) return false;
    
    // If only one player can act and their bet matches current bet, round over
    if (canAct.length === 1) {
      return canAct[0].bet === this.currentBet;
    }
    
    // All players who can act must have acted at least once this round
    // and all bets must be equal
    const actedCount = canAct.filter(p => this._playersActedThisRound.has(p.seat)).length;
    
    // For preflop or when there's no betting, everyone must act
    if (this.currentBet === 0) {
      return actedCount >= canAct.length;
    }
    
    // For betting rounds, all bets must be equal and everyone acted
    return allBetsEqual && actedCount >= canAct.length;
  }

  playerAction(playerId, action = '', amount = 0) {
    const player = this.players[this.turnIndex];

    if (!player || player.id !== playerId || player.folded || player.allin) {
      return { error: 'Sıra sizde değil veya elden çıktınız.' };
    }

    let logMsg = '';
    this.actionOrder.push(this.turnIndex);
    this._playersActedThisRound.add(this.turnIndex);

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
          log: logMsg,
          bets: this.players.map(p => p.bet),
          chips: this.players.map(p => p.chips),
          allins: this.players.map(p => p.allin)
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
      const minRaise = 50;
      if (amount < minRaise)
        return { error: `Minimum raise miktarı ${minRaise}` };

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

    if (player.allin && this._allPlayersAllInOrFolded()) {
      return this._fastForwardToShowdown(logMsg);
    }

    // Check if betting round is over
    if (this._isBettingRoundOver()) {
      const result = this._handleRoundEnd(logMsg);
      if (result) return result;
    }

    // Move to next player
    this.turnIndex = this._findNextActivePlayerIndex(this.turnIndex);
    
    // Her playerAction sonucunda bet, chips ve allin değerlerini de döndür
    return { 
      log: logMsg,
      bet: player.bet,
      chips: player.chips, 
      allin: player.allin,
      bets: this.players.map(p => p.bet)
    };
  }

  _handleRoundEnd(logMsg) {
    // Check if everyone is all-in or folded (should go straight to showdown)
    if (this._allPlayersAllInOrFolded()) {
      return this._fastForwardToShowdown(logMsg);
    }

    // Normal stage advancement
    const result = this._advanceStage();
    if (result) {
      result.log = logMsg;
      return result;
    }

    // Eğer advanceStage null döndürürse, en azından bets alanını döndür
    return {
      log: logMsg,
      bets: this.players.map(p => p.bet),
      chips: this.players.map(p => p.chips),
      allins: this.players.map(p => p.allin)
    };
  }

  _fastForwardToShowdown(logMsg) {
    // Fast forward through all remaining stages to showdown
    while (this.stage !== 'showdown') {
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
        break;
      }
    }
    
    // Now we're at showdown
    const result = this._showdownResult();
    result.log = logMsg;
    return result;
  }

  _openBoard(n) {
    for (let i = 0; i < n; i++) {
      if (this.deck.length > 0)
        this.board.push(this.deck.pop());
    }
  }

  _advanceStage() {
    // Reset for next betting round
    this._resetPlayerBets();

    // Advance stage and deal cards
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
      const result = this._showdownResult();
      // Showdown sonucuna bets alanını ekle
      result.bets = this.players.map(p => p.bet);
      result.chips = this.players.map(p => p.chips);
      result.allins = this.players.map(p => p.allin);
      return result;
    }

    // Set up next betting round - her zaman ilk aktif oyuncudan başla (p1 aktifse ondan)
    this.turnIndex = this._findFirstActivePlayerIndex();

    return {
      stageAdvanced: true,
      board: [...this.board],
      stage: this.stage,
      bets: this.players.map(p => p.bet),
      chips: this.players.map(p => p.chips),
      allins: this.players.map(p => p.allin)
    };
  }

  _showdownResult() {
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
      board: [...this.board],
      reason: "showdown",
      showdownHands,
      handEnded: true,
      bets: this.players.map(p => p.bet),
      chips: this.players.map(p => p.chips),
      allins: this.players.map(p => p.allin)
    };
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
    return 0;
  }

  _allPlayersAllInOrFolded() {
     const active = this.players.filter(p => !p.folded);
     if (active.length <= 1) return true;

    const canActPlayers = active.filter(p => !p.allin && p.chips > 0);


     if (active.length === 2) {
       return canActPlayers.length === 0;
     }

    // Üç veya daha fazla oyuncu varsa, all‑in tek başına showdown tetiklemesin
     return false;
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
      handCount: this.handCount
    };
  }
}

module.exports = PokerEngine;