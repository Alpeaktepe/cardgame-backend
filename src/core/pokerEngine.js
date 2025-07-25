class PokerEngine {
  constructor(players) {
    this.players = players.map(p => ({
      ...p,
      hand: [],
      bet: 0,
      folded: false,
      checked: false, // yeni: her oyuncu check yaptı mı
      chips: 1000
    }));
    this.deck = [];
    this.board = [];
    this.pot = 0;
    this.stage = 'preflop';
    this.currentBet = 0;
    this.turnIndex = 0;
    this.actionsTaken = 0;
    this.lastActionTime = Date.now();
  }

  startGame() {
    this._initDeck();
    this._dealHands();
    this.board = [];
    this.stage = 'preflop';
    this.currentBet = 0;
    this.turnIndex = 0;
    this.actionsTaken = 0;
    this.players.forEach(p => { 
      p.bet = 0; 
      p.folded = false;
      p.checked = false;
    });
    this.lastActionTime = Date.now();
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
      p.checked = false;
    });
  }

  playerAction(playerId, action, amount = 0) {
    const player = this.players[this.turnIndex];
    if (!player || player.id !== playerId || player.folded) return { error: 'Sıra sizde değil veya fold.' };
    this.actionsTaken++;
    this.lastActionTime = Date.now();

    // Tüm oyuncular check yaptıysa stage advance
    if (action === 'fold') {
      player.folded = true;
      player.checked = false;
      if (this.players.filter(p => !p.folded).length === 1) {
        const winner = this.players.find(p => !p.folded);
        winner.chips += this.pot;
        return { winner: winner.id, pot: this.pot, board: this.board, reason: "everyone_folded" };
      }
    }
    if (action === 'check') {
      if (player.bet !== this.currentBet) return { error: 'Check için bahis eşit olmalı' };
      player.checked = true;
    } else if (action === 'call') {
      const diff = this.currentBet - player.bet;
      if (player.chips < diff) return { error: 'Yetersiz chip' };
      player.chips -= diff;
      player.bet += diff;
      this.pot += diff;
      player.checked = false;
      this._resetChecked();
    } else if (action === 'bet' || action === 'raise') {
      if (amount <= this.currentBet) return { error: 'Bet/Raise mevcut bahisten yüksek olmalı' };
      if (player.chips < amount) return { error: 'Yetersiz chip' };
      player.chips -= amount;
      player.bet += amount;
      this.pot += amount;
      this.currentBet = player.bet;
      player.checked = false;
      this._resetChecked();
    }

    // Sıradaki oyuncuya geç
    this.turnIndex = this._nextPlayerIndex();
    return null;
  }

  // Tüm checked flag'lerini sıfırlar (yeni bet/raise/call gelirse)
  _resetChecked() {
    this.players.forEach(p => {
      if (!p.folded) p.checked = false;
    });
  }

  // Her round sonunda çağırılır
  advanceStage() {
    const activePlayers = this.players.filter(p => !p.folded);

    // 1- Eğer tüm aktif oyuncular checked ise stage advance
    if (activePlayers.length > 0 && activePlayers.every(p => p.checked)) {
      this.currentBet = 0;
      this.players.forEach(p => { p.bet = 0; p.checked = false; });
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
        // Tie/draw logic -- basic, eğer birden fazla aktif varsa!
        const remaining = activePlayers.map(p => p.id);
        let winner = null;
        if (remaining.length === 1) {
          winner = remaining[0];
        } else {
          winner = this._determineWinner(); // Buraya gerçek el gücü logic'i eklersin
        }
        if (winner) {
          this.players.find(p => p.id === winner).chips += this.pot;
        }
        else {
          // Tie/Draw: Pot eşit bölüştürülür
          const share = Math.floor(this.pot / remaining.length);
          activePlayers.forEach(p => { p.chips += share; });
        }
        return { winner, pot: this.pot, board: this.board, reason: "showdown" };
      }
      return { stageAdvanced: true };
    }

    // 2- Sadece bir oyuncu checked değilse, tüm checked flag'leri resetlenir, stage devam eder
    if (activePlayers.filter(p => !p.checked).length === 1) {
      this._resetChecked();
      return { resetChecked: true };
    }
    return null;
  }

  // Sıradaki oyuncuyu bulur (sadece folded olmayanlar arasında)
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
    // Gerçek el gücü burada hesaplanmalı!
    return active.reduce((best, p) => p.id > best.id ? p : best).id;
  }

  // AUTO FOLD (timeout kontrolü, 30 sn örnek)
  checkAutoFold(timeoutMs = 30000) {
    if (Date.now() - this.lastActionTime > timeoutMs) {
      // Sıradaki oyuncu auto-fold olur
      const player = this.players[this.turnIndex];
      player.folded = true;
      player.checked = false;
      this.lastActionTime = Date.now();
      return { autoFold: player.id };
    }
    return null;
  }

  getGameState() {
    return {
      players: this.players.map(p => ({ 
        id: p.id, 
        chips: p.chips, 
        bet: p.bet, 
        folded: p.folded,
        checked: p.checked 
      })),
      board: this.board,
      pot: this.pot,
      stage: this.stage,
      currentPlayer: this.players[this.turnIndex].id
    };
  }
}
module.exports = PokerEngine;