// Geliştirilmiş PokerEngine.js - Worker Threads ile Turn Timer
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
  _generateRandomCard() { return { suit: this._random(Suit), rank: this._random(Rank) }; }
  drawUniqueCard() {
    if (this.givenCards.size >= 52) throw new Error('Tüm kartlar dağıtıldı!');
    let card, cardId;
    do { card = this._generateRandomCard(); cardId = `${card.suit}-${card.rank}`; } 
    while (this.givenCards.has(cardId));
    this.givenCards.add(cardId);
    return card;
  }
  drawMultiple(count) { const cards = []; while (cards.length < count) cards.push(this.drawUniqueCard()); return cards; }
  reset() { this.givenCards.clear(); }
}

const rankPower = {
  '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,
  'J':11,'Q':12,'K':13,'A':14
};

class PokerHandEvaluator {
  evaluate(cards) {
    if (!cards || cards.length < 5) throw new Error('At least 5 cards required');
    const counts = {}, suits = {};
    cards.forEach(c => { counts[c.rank] = (counts[c.rank]||0)+1; suits[c.suit] = (suits[c.suit]||[]).concat(c); });
    const isFlush = Object.values(suits).some(g=>g.length>=5);
    const isStraight = this._hasStraight(Object.keys(counts));
    const isSF = Object.values(suits).some(g=>g.length>=5 && this._hasStraight(g.map(x=>x.rank)));
    if (isSF) return HandType.StraightFlush;
    if (this._hasCount(counts,4)) return HandType.FourOfAKind;
    if (this._hasFullHouse(counts)) return HandType.FullHouse;
    if (isFlush) return HandType.Flush;
    if (isStraight) return HandType.Straight;
    if (this._hasCount(counts,3)) return HandType.ThreeOfAKind;
    if (this._pairCount(counts)>=2) return HandType.TwoPair;
    if (this._pairCount(counts)===1) return HandType.Pair;
    return HandType.HighCard;
  }
  _hasCount(c,t){return Object.values(c).includes(t);}  
  _hasFullHouse(c){return Object.values(c).some(x=>x>=3)&& Object.values(c).filter(x=>x>=2).length>=2;}  
  _pairCount(c){return Object.values(c).filter(x=>x===2).length;}  
  _hasStraight(r){const p=r.map(x=>rankPower[x]).sort((a,b)=>a-b);const u=[...new Set(p)]; if(u.includes(14))u.unshift(1);let curr=1;for(let i=1;i<u.length;i++){if(u[i]===u[i-1]+1){curr++;if(curr>=5)return true;}else curr=1;}return false;}
}

class PokerEngine {
  constructor(players) {
    this.players = players.map(p=>({id:p.playerId,name:p.name,hand:[],handType:null,chips:1000,bet:0,folded:false}));
    this.dealer = new CardDealer();
    this.evaluator = new PokerHandEvaluator();
    this.board = [];
    this.pot = 0;
    this.currentPlayer = 0;
    this.started = false;
    this.stage = 'preflop';
    this.turnTimerWorker = new Worker(`
      const { parentPort } = require('worker_threads');
      let timer;
      parentPort.on('message', ({action, timeout}) => {
        if(action==='start'){ clearTimeout(timer); timer = setTimeout(() => parentPort.postMessage('timeout'), timeout); } 
        else if(action==='stop'){ clearTimeout(timer); }
      });
    `, { eval: true });
    this.turnTimerWorker.on('message', msg => {
      if (msg==='timeout') {
        const p = this.players[this.currentPlayer];
        if (!p.folded) this.playerAction(p.id, 'fold');
      }
    });
  }

  startGame() {
    this.board = [];
    this.players.forEach(p => p.hand = this.dealer.drawMultiple(2));
    this.started = true;
    this.stage = 'preflop';
    this._startTurnTimer();
  }

  _startTurnTimer() {
    this.turnTimerWorker.postMessage({action:'stop'});
    this.turnTimerWorker.postMessage({action:'start', timeout:15000});
  }

  advanceStage() {
    switch(this.stage) {
      case 'preflop': this.revealFlop(); this.stage='flop'; break;
      case 'flop': this.revealTurn(); this.stage='turn'; break;
      case 'turn': this.revealRiver(); this.stage='river'; break;
      case 'river': return this.finishGame();
    }
    return null;
  }

  revealFlop() { this.board.push(...this.dealer.drawMultiple(3)); }
  revealTurn() { this.board.push(...this.dealer.drawMultiple(1)); }
  revealRiver() { this.board.push(...this.dealer.drawMultiple(1)); }

  getGameState() {
    return {
      board: this.board,
      players: this.players.map(p=>({id:p.id,name:p.name,hand:p.hand,chips:p.chips,bet:p.bet,folded:p.folded})),
      pot: this.pot,
      currentPlayer: this.players[this.currentPlayer].id,
      started: this.started,
      stage: this.stage
    };
  }

  playerAction(playerId, action, amount=0) {
    const player = this.players[this.currentPlayer];
    if (player.id !== playerId || player.folded) return;

    switch(action) {
      case 'bet':
        if (amount > player.chips) return;
        player.chips -= amount; player.bet += amount; this.pot += amount;
        break;
      case 'call': {
        const maxBet = Math.max(...this.players.map(p=>p.bet));
        const callAmt = maxBet - player.bet;
        if (callAmt > player.chips) return;
        player.chips -= callAmt; player.bet += callAmt; this.pot += callAmt;
        break;
      }
      case 'raise':
        if (amount > player.chips) return;
        player.chips -= amount; player.bet += amount; this.pot += amount;
        break;
      case 'fold': player.folded = true; break;
      case 'check': break;
      default: return;
    }

    // Sıradaki oyuncu
    for (let i=1; i<=this.players.length; i++) {
      const idx = (this.currentPlayer + i) % this.players.length;
      if (!this.players[idx].folded) { this.currentPlayer = idx; break; }
    }

    const active = this.players.filter(p=>!p.folded);
    if (active.length === 1) return { winner: active[0].id };

    this._startTurnTimer();
    return null;
  }

  finishGame() {
    this.turnTimerWorker.postMessage({action:'stop'});
    this.players.forEach(p => {
      if (!p.folded) p.handType = this.evaluator.evaluate([...p.hand, ...this.board]);
    });
    this.players.sort((a,b) => b.handType - a.handType);
    this.players[0].chips += this.pot;
    this.dealer.reset();
    return { winner: this.players[0].id, handType: this.players[0].handType };
  }
}

module.exports = PokerEngine;
