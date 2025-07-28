const rankOrder = {
  'Two': 2, 'Three': 3, 'Four': 4, 'Five': 5, 'Six': 6, 'Seven': 7, 'Eight': 8, 'Nine': 9,
  'Ten': 10, 'Jack': 11, 'Queen': 12, 'King': 13, 'Ace': 14
};

function getCombinations(arr, k) {
  // arr içinden k elemanlı tüm kombinasyonları döndürür
  let ret = [];
  (function combine(start, combo) {
    if (combo.length === k) { ret.push(combo); return; }
    for (let i = start; i < arr.length; i++) combine(i + 1, combo.concat([arr[i]]));
  })(0, []);
  return ret;
}

function evaluateHand(cards) {
  // Kartları sıralı rakama göre diz
  const sorted = [...cards].sort((a, b) => rankOrder[b.rank] - rankOrder[a.rank]);

  const counts = {};
  const suits = {};

  sorted.forEach(card => {
    counts[card.rank] = (counts[card.rank] || 0) + 1;
    suits[card.suit] = (suits[card.suit] || []);
    suits[card.suit].push(rankOrder[card.rank]);
  });

  const values = sorted.map(card => rankOrder[card.rank]);
  const uniqueValues = [...new Set(values)];

  const flushSuit = Object.keys(suits).find(suit => suits[suit].length >= 5);
  let isFlush = !!flushSuit;
  let flushValues = isFlush ? suits[flushSuit].sort((a, b) => b - a) : [];

  // Straight
  function getStraight(vals) {
    let v = [...new Set(vals)].sort((a, b) => b - a);
    for (let i = 0; i <= v.length - 5; i++) {
      if (v[i] - v[i + 4] === 4) return v[i];
    }
    // Wheel (A-2-3-4-5)
    if (v.includes(14) && v.includes(5) && v.includes(4) && v.includes(3) && v.includes(2)) {
      return 5;
    }
    return null;
  }

  let straightHigh = getStraight(values);
  let flushStraightHigh = isFlush ? getStraight(flushValues) : null;

  // Royal Flush
  if (isFlush && flushStraightHigh === 14)
    return { rank: 10, high: 14, name: 'Royal Flush' };

  // Straight Flush
  if (isFlush && flushStraightHigh)
    return { rank: 9, high: flushStraightHigh, name: 'Straight Flush' };

  // Four of a Kind
  if (Object.values(counts).includes(4)) {
    const fourRank = Object.keys(counts).find(r => counts[r] === 4);
    const kicker = Math.max(...values.filter(v => v !== rankOrder[fourRank]));
    return { rank: 8, high: rankOrder[fourRank], kicker, name: 'Four of a Kind' };
  }

  // Full House
  if (Object.values(counts).includes(3) && Object.values(counts).includes(2)) {
    const threeRank = Math.max(...Object.keys(counts).filter(r => counts[r] === 3).map(r => rankOrder[r]));
    const twoRank = Math.max(...Object.keys(counts).filter(r => counts[r] === 2).map(r => rankOrder[r]));
    return { rank: 7, high: threeRank, kicker: twoRank, name: 'Full House' };
  }

  // Flush
  if (isFlush)
    return { rank: 6, high: flushValues[0], kicker: flushValues[1], name: 'Flush' };

  // Straight
  if (straightHigh)
    return { rank: 5, high: straightHigh, name: 'Straight' };

  // Three of a Kind
  if (Object.values(counts).includes(3)) {
    const threeRank = Math.max(...Object.keys(counts).filter(r => counts[r] === 3).map(r => rankOrder[r]));
    const kickers = values.filter(v => v !== threeRank).slice(0, 2);
    return { rank: 4, high: threeRank, kicker: kickers, name: 'Three of a Kind' };
  }

  // Two Pair
  if (Object.values(counts).filter(c => c === 2).length >= 2) {
    const pairs = Object.keys(counts).filter(r => counts[r] === 2).map(r => rankOrder[r]).sort((a, b) => b - a);
    const kicker = values.filter(v => v !== pairs[0] && v !== pairs[1])[0];
    return { rank: 3, high: pairs[0], kicker: pairs[1], third: kicker, name: 'Two Pair' };
  }

  // One Pair
  if (Object.values(counts).includes(2)) {
    const pairRank = Math.max(...Object.keys(counts).filter(r => counts[r] === 2).map(r => rankOrder[r]));
    const kickers = values.filter(v => v !== pairRank).slice(0, 3);
    return { rank: 2, high: pairRank, kicker: kickers, name: 'Pair' };
  }

  // High Card
  return { rank: 1, high: values[0], kicker: values.slice(1, 5), name: 'High Card' };
}

function bestPokerHand(cards) {
  // 7 kart içinden en iyi 5 kartı bul
  const combs = getCombinations(cards, 5);
  let best = null;

  for (let comb of combs) {
    const hand = evaluateHand(comb);
    if (
      !best ||
      hand.rank > best.rank ||
      (hand.rank === best.rank && hand.high > best.high) ||
      (hand.rank === best.rank && hand.high === best.high && JSON.stringify(hand.kicker) > JSON.stringify(best.kicker))
    ) {
      best = hand;
    }
  }

  return best;
}

module.exports = { bestPokerHand };
