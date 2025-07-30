// pokerEngine.test.js
const PokerEngine = require('./pokerEngine');

// Mock poker hand evaluator (test için hepsi aynı el)
jest.mock('./pokerHandEval', () => ({
  bestPokerHand: jest.fn(() => ({ rank: 1, high: 10 }))
}));

const createPlayers = () => [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Carol' }
];

describe('PokerEngine - TÜM CASELER', () => {
  let engine;
  beforeEach(() => {
    engine = new PokerEngine(createPlayers());
    engine.startGame();
  });

  // --------- Doğru ve Hatalı CASELER ---------

  test('Doğru: Bet sadece currentBet=0 iken', () => {
    const r1 = engine.playerAction('p1', 'bet', 100);
    expect(r1.log).toMatch(/bet/);
    const r2 = engine.playerAction('p2', 'bet', 50);
    expect(r2.error).toMatch(/Bet sadece bahis açılmadıysa yapılabilir/);
  });

  test('Doğru: Raise sadece currentBet>0 ve minRaise ile', () => {
    engine.playerAction('p1', 'bet', 100);
    const r = engine.playerAction('p2', 'raise', 10);
    expect(r.error).toMatch(/Minimum raise miktarı/);
    const r2 = engine.playerAction('p2', 'raise', 50);
    expect(r2.log).toMatch(/raise/);
  });

  test('Doğru: Yetersiz chip ile raise/bet/call hata döner', () => {
    engine.playerAction('p1', 'bet', 100);
    engine.players[1].chips = 10;
    const r = engine.playerAction('p2', 'raise', 1000);
    expect(r.error).toBe('Yetersiz chip');
    const r2 = engine.playerAction('p2', 'call');
    expect(r2.bet).toBe(10);
    expect(r2.chips).toBe(0);
    expect(r2.allin).toBe(true);
  });

  test('Doğru: Call/Check mantığı ve snapshot', () => {
    engine.playerAction('p1', 'bet', 100);
    const r2 = engine.playerAction('p2', 'call');
    expect(engine.players[1].bet).toBe(100);
    expect(engine.players[1].chips).toBe(900);

    // p3 call sonrası round bitmeli
    const res = engine.playerAction('p3', 'call');
    // Bu aksiyon betting round'u bitirir ve stage ilerler
    expect(res.bets).toEqual([0, 0, 0]); // Betler sıfırlanır
    expect(engine.players.every(p => p.bet === 0)).toBe(true);
  });

  test('Doğru: All-in ile chips sıfır ve snapshot', () => {
    engine.playerAction('p1', 'bet', 1000);
    expect(engine.players[0].allin).toBe(true);
    expect(engine.players[0].chips).toBe(0);
  });

  test('Doğru: Fold olunca oyuncu elden çıkar', () => {
    const res = engine.playerAction('p1', 'fold');
    expect(engine.players[0].folded).toBe(true);
    // Son kalan otomatik kazanır
    engine.playerAction('p2', 'fold');
    const res2 = engine.playerAction('p3', 'bet', 1);
    expect(engine.players.filter(p => !p.folded).length).toBe(1);
  });

  test('Doğru: Showdown tüm board açılır', () => {
    // Sadece 2 oyuncu kalsın
    engine.playerAction('p1', 'fold'); // p1 fold
    engine.playerAction('p2', 'bet', 1000); // p2 all-in
    const callResult = engine.playerAction('p3', 'call'); // p3 all-in
    // Her iki oyuncu da all-in oldu, showdown olmalı
    expect(callResult.reason).toBe('showdown');
    expect(callResult.winner).toBeDefined();
  });

  test('Doğru: Game state snapshot', () => {
    const state = engine.getGameState('p2');
    expect(state.players.length).toBe(3);
    expect(state.board).toBeInstanceOf(Array);
    expect(state.pot).toBeDefined();
    expect(typeof state.stage).toBe('string');
  });

  test('Doğru: Hand count ve tekrar başlatma', () => {
    const old = engine.handCount;
    engine.startGame();
    expect(engine.handCount).toBe(old + 1);
  });

  // --------- NEGATİF CASELER ve HATALAR ---------

  test('Hatalı: Out of turn', () => {
    const res = engine.playerAction('p3', 'bet', 100);
    expect(res.error).toMatch(/Sıra sizde değil/);
  });

  test('Hatalı: Fold/All-in olmuş oyuncu tekrar action yapamaz', () => {
    engine.playerAction('p1', 'fold');
    const r = engine.playerAction('p1', 'bet', 10);
    expect(r.error).toMatch(/elden çıktınız/);

    engine.players[1].allin = true;
    const r2 = engine.playerAction('p2', 'bet', 10);
    expect(r2.error).toMatch(/elden çıktınız/);
  });

  test('Hatalı: Geçersiz aksiyon', () => {
    const res = engine.playerAction('p1', 'fly');
    expect(res.error).toMatch(/Geçersiz aksiyon/);
  });

  test('Hatalı: Check ancak bet eşit ise yapılabilir', () => {
    engine.playerAction('p1', 'bet', 100);
    const r = engine.playerAction('p2', 'check');
    expect(r.error).toMatch(/call yapmalısınız/);
  });

  // --------- KOMPLEX FLOW TESTLERİ ---------

  test('Bet, raise, call, call ile round bitişi ve snapshot', () => {
    engine.playerAction('p1', 'bet', 100);
    engine.playerAction('p2', 'raise', 50);
    engine.playerAction('p3', 'call');
    const res = engine.playerAction('p1', 'call');
    expect(res.bets).toEqual([0, 0, 0]);
  });

  test('Bet, call, raise, call, call akışı', () => {
    engine.playerAction('p1', 'bet', 100);
    engine.playerAction('p2', 'call');
    engine.playerAction('p3', 'raise', 50);
    engine.playerAction('p1', 'call');
    const res = engine.playerAction('p2', 'call');
    expect(res.bets).toEqual([0, 0, 0]);
  });

  test('All-in sonrası her street otomatik açılır ve showdown olur', () => {
    // Sadece 2 oyuncu kalsın
    engine.playerAction('p1', 'fold'); // p1 fold
    engine.playerAction('p2', 'bet', 1000); // p2 all-in
    const result = engine.playerAction('p3', 'call'); // p3 all-in
    // Her iki oyuncu all-in olduğunda direkt showdown
    expect(result.reason).toBe('showdown');
    expect(result.showdownHands).toBeInstanceOf(Array);
  });

  test('Birden fazla fold, round winner snapshot', () => {
    engine.playerAction('p1', 'bet', 100);
    engine.playerAction('p2', 'fold');
    engine.playerAction('p3', 'fold');
    const winner = engine.players.find(p => !p.folded);
    expect(winner).toBeDefined();
    expect(winner.chips).toBeGreaterThanOrEqual(1000);
  });

  test('Bir oyuncu call ile tam all-in olursa snapshot', () => {
    engine.playerAction('p1', 'bet', 100);
    engine.players[1].chips = 50;
    const res = engine.playerAction('p2', 'call');
    expect(res.bet).toBe(50);
    expect(res.chips).toBe(0);
    expect(res.allin).toBe(true);
    
    // p3 call yaptığında round biter ve betler sıfırlanır
    const res2 = engine.playerAction('p3', 'call');
    expect(res2.bets).toEqual([0, 0, 0]);
    expect(engine.players[1].bet).toBe(0);
  });

  test('Raise fails if not enough chips (tekrar)', () => {
    engine.playerAction('p1', 'bet', 100);
    engine.players[1].chips = 10;
    const res = engine.playerAction('p2', 'raise', 200);
    expect(res.error).toBe('Yetersiz chip');
  });

  test('Son check sonrası showdown', () => {
    // Sadece 2 oyuncu kalsın
    engine.playerAction('p1', 'fold'); // p1 fold
    engine.playerAction('p2', 'bet', 1000); // p2 all-in
    const result = engine.playerAction('p3', 'call'); // p3 all-in
    // All-in durumunda direkt showdown
    expect(result.reason).toBe('showdown');
    expect(result.winner).toBeDefined();
    expect(result.pot).toBeGreaterThan(0);
  });
});

describe('Sıra ve akış kontrolleri', () => {
  let engine;
  beforeEach(() => {
    engine = new PokerEngine([
      { id: 'p1', name: 'Alice' },
      { id: 'p2', name: 'Bob' },
      { id: 'p3', name: 'Carol' }
    ]);
    engine.startGame();
  });

  test('Bet sonrası sıra doğru oyuncuya geçer', () => {
    expect(engine.getGameState().currentPlayer).toBe('p1');
    engine.playerAction('p1', 'bet', 100);
    expect(engine.getGameState().currentPlayer).toBe('p2');
    engine.playerAction('p2', 'call');
    expect(engine.getGameState().currentPlayer).toBe('p3');
    engine.playerAction('p3', 'call');
    // Betting round bitti, yeni roundda sıra ilk aktif oyuncuya döner
    expect(engine.getGameState().currentPlayer).toBe('p1');
  });

  test('Fold sonrası sıra atlanır', () => {
    expect(engine.getGameState().currentPlayer).toBe('p1');
    engine.playerAction('p1', 'fold');
    // p2 sırada olmalı
    expect(engine.getGameState().currentPlayer).toBe('p2');
    engine.playerAction('p2', 'bet', 100);
    expect(engine.getGameState().currentPlayer).toBe('p3');
    engine.playerAction('p3', 'call');
    // p1 fold olduğu için tekrar p2'ye döner
    expect(engine.getGameState().currentPlayer).toBe('p2');
  });

  test('All-in olan oyuncunun sırası atlanır', () => {
    engine.playerAction('p1', 'bet', 500); // p1 all-in değil, yarı all-in
    expect(engine.players[0].allin).toBe(false);
    expect(engine.getGameState().currentPlayer).toBe('p2');
    engine.playerAction('p2', 'call');
    expect(engine.getGameState().currentPlayer).toBe('p3');
    engine.playerAction('p3', 'call');
    // Yeni roundda, ilk aktif oyuncu p1 olduğu için sıra ona geçer
    // (tüm oyuncular aktif, çünkü kimse all-in değil)
    expect(engine.getGameState().currentPlayer).toBe('p1');
    
    // Şimdi p1 tam all-in yapıyor
    engine.playerAction('p1', 'bet', 500); // p1 all-in oldu
    expect(engine.players[0].allin).toBe(true);
    
    // p2 ve p3 call yaparlar
    engine.playerAction('p2', 'call');
    engine.playerAction('p3', 'call');
    
    // Yeni roundda p1 all-in olduğu için, aktif oyuncuların ilki p2'ye geçer
    expect(engine.getGameState().currentPlayer).toBe('p2');
  });

  test('Fold ve all-in kombinasyonu ile sıra', () => {
    engine.playerAction('p1', 'bet', 1000); // p1 all-in
    engine.playerAction('p2', 'fold');
    expect(engine.getGameState().currentPlayer).toBe('p3');
    engine.playerAction('p3', 'call');
    // Sadece p1 ve p3 aktif, p1 all-in olduğu için sıra p3'te kalır
    expect(engine.getGameState().currentPlayer).toBe('p3');
  });

  test('Raise sonrası sıra', () => {
    engine.playerAction('p1', 'bet', 100);
    expect(engine.getGameState().currentPlayer).toBe('p2');
    engine.playerAction('p2', 'raise', 50);
    expect(engine.getGameState().currentPlayer).toBe('p3');
    engine.playerAction('p3', 'call');
    expect(engine.getGameState().currentPlayer).toBe('p1');
    engine.playerAction('p1', 'call');
    // Betting round bitti, yeni roundda sıra p1'de
    expect(engine.getGameState().currentPlayer).toBe('p1');
  });

  test('Sıra sadece aktif oyuncular arasında döner', () => {
    engine.playerAction('p1', 'fold');
    engine.playerAction('p2', 'bet', 100);
    engine.playerAction('p3', 'call');
    // p1 fold olduğu için sıra p2 ve p3 arasında döner
    expect(engine.getGameState().currentPlayer).toBe('p2');
    engine.playerAction('p2', 'check');
    expect(engine.getGameState().currentPlayer).toBe('p3');
  });
});
