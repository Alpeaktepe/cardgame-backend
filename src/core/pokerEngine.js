const path       = require('path');
const { Worker } = require('worker_threads');

const Rank = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const Suit = ['Clubs','Diamonds','Hearts','Spades'];
const HandType = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  ThreeOfAKind: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  FourOfAKind: 7,
  StraightFlush: 8
};

class CardDealer {
  constructor() { this.givenCards = new Set(); }
  _random(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  drawUniqueCard() {
    if (this.givenCards.size >= 52) throw new Error('All cards dealt');
    let card, id;
    do {
      const suit = this._random(Suit);
      const rank = this._random(Rank);
      card = { suit, rank };
      id = `${suit}-${rank}`;
    } while (this.givenCards.has(id));
    this.givenCards.add(id);
    return card;
  }
  drawMultiple(count) {
    const cards = [];
    for (let i = 0; i < count; i++) {
      cards.push(this.drawUniqueCard());
    }
    return cards;
  }
  reset() { this.givenCards.clear(); }
}

const rankPower = {
  '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,
  'J':11,'Q':12,'K':13,'A':14
};

class PokerHandEvaluator {
  evaluate(cards) {
    if (!cards || cards.length < 5) throw new Error('At least 5 cards required');
    const counts = {};
    const suits  = {};
    cards.forEach(c => {
      counts[c.rank] = (counts[c.rank] || 0) + 1;
      suits[c.suit]   = (suits[c.suit] || []).concat(c);
    });

    const isFlush        = Object.values(suits).some(g => g.length >= 5);
    const isStraight     = this._hasStraight(Object.keys(counts));
    const isStraightFlush = Object.values(suits)
      .some(g => g.length >= 5 && this._hasStraight(g.map(c => c.rank)));

    if (isStraightFlush) return HandType.StraightFlush;
    if (this._hasCount(counts, 4)) return HandType.FourOfAKind;
    if (this._hasFullHouse(counts)) return HandType.FullHouse;
    if (isFlush) return HandType.Flush;
    if (isStraight) return HandType.Straight;
    if (this._hasCount(counts, 3)) return HandType.ThreeOfAKind;
    if (this._pairCount(counts) >= 2) return HandType.TwoPair;
    if (this._pairCount(counts) === 1) return HandType.Pair;
    return HandType.HighCard;
  }
  _hasCount(counts, target) {
    return Object.values(counts).some(c => c === target);
  }
  _hasFullHouse(counts) {
    const three = Object.values(counts).some(c => c >= 3);
    const pairs = Object.values(counts).filter(c => c >= 2).length;
    return three && pairs >= 2;
  }
  _pairCount(counts) {
    return Object.values(counts).filter(c => c === 2).length;
  }
  _hasStraight(ranks) {
    const vals = ranks.map(r => rankPower[r]).sort((a, b) => a - b);
    const uniq = [...new Set(vals)];
    if (uniq.includes(14)) uniq.unshift(1);
    let streak = 1;
    for (let i = 1; i < uniq.length; i++) {
      if (uniq[i] === uniq[i - 1] + 1) {
        streak++;
        if (streak >= 5) return true;
      } else {
        streak = 1;
      }
    }
    return false;
  }
}

class PokerEngine {
  constructor(players) {
    this.players       = players.map(p => ({
      id:       p.playerId,
      name:     p.name,
      hand:     [],
      handType: null,
      chips:    1000,
      bet:      0,
      folded:   false
    }));
    this.dealer        = new CardDealer();
    this.evaluator     = new PokerHandEvaluator();
    this.board         = [];
    this.pot           = 0;
    this.currentPlayer = 0;
    this.stage         = 'preflop';
    this.started       = false;

    const workerPath = path.resolve(__dirname, 'turnTimerWorker.js');
    this.turnTimerWorker = new Worker(workerPath);
    this.turnTimerWorker.on('message', msg => {
      if (msg === 'timeout') {
        const p = this.players[this.currentPlayer];
        if (!p.folded) this.playerAction(p.id, 'fold');
      }
    });
  }

  startGame() {
    this.dealer.reset();
    this.board         = [];
    this.pot           = 0;
    this.currentPlayer = 0;
    this.stage         = 'preflop';
    this.started       = true;

    this.players.forEach(p => {
      p.hand     = this.dealer.drawMultiple(2);
      p.bet      = 0;
      p.folded   = false;
      p.handType = null;
    });

    this._startTurnTimer();
  }

  _startTurnTimer() {
    this.turnTimerWorker.postMessage({ action: 'stop' });
    this.turnTimerWorker.postMessage({ action: 'start', timeout: 1500000 });
  }

  advanceStage() {
    let result = null;
    switch (this.stage) {
      case 'preflop':
        this.board.push(...this.dealer.drawMultiple(3));
        this.stage = 'flop';
        break;
      case 'flop':
        this.board.push(...this.dealer.drawMultiple(1));
        this.stage = 'turn';
        break;
      case 'turn':
        this.board.push(...this.dealer.drawMultiple(1));
        this.stage = 'river';
        break;
      case 'river':
        result = this.finishGame();
        break;
    }
    if (this.stage !== 'river') this._startTurnTimer();
    return result;
  }

  getGameState() {
    return {
      board: this.board,
      players: this.players.map(p => ({
        id:     p.id,
        name:   p.name,
        hand:   p.hand,
        chips:  p.chips,
        bet:    p.bet,
        folded: p.folded
      })),
      pot: this.pot,
      currentPlayer: this.players[this.currentPlayer].id,
      stage: this.stage
    };
  }

  playerAction(playerId, action, amount = 0) {
    const p = this.players[this.currentPlayer];
    if (p.id !== playerId || p.folded) return;

    switch (action) {
      case 'call': {
        const maxBet = Math.max(...this.players.map(x => x.bet));
        const diff   = maxBet - p.bet;
        if (diff > p.chips) return;
        p.chips -= diff;
        p.bet   += diff;
        this.pot += diff;
        break;
      }
      case 'raise':
        if (amount > p.chips) return;
        p.chips -= amount;
        p.bet   += amount;
        this.pot += amount;
        break;
      case 'fold':
        p.folded = true;
        break;
      default:
        return;
    }

    // Next active player
    for (let i = 1; i <= this.players.length; i++) {
      const idx = (this.currentPlayer + i) % this.players.length;
      if (!this.players[idx].folded) {
        this.currentPlayer = idx;
        break;
      }
    }

    // Only one left?
    const active = this.players.filter(x => !x.folded);
    if (active.length === 1) {
      return { winner: active[0].id };
    }

    this._startTurnTimer();
    return null;
  }

  finishGame() {
    this.turnTimerWorker.postMessage({ action: 'stop' });

    this.players.forEach(p => {
      if (!p.folded) {
        p.handType = this.evaluator.evaluate([...p.hand, ...this.board]);
      }
    });

    this.players.sort((a, b) => b.handType - a.handType);
    this.players[0].chips += this.pot;

    this.dealer.reset();
    return { winner: this.players[0].id, handType: this.players[0].handType };
  }
}

module.exports = PokerEngine;
