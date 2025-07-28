const rankOrder = {
  'Two': 2, 'Three': 3, 'Four': 4, 'Five': 5, 'Six': 6, 'Seven': 7, 'Eight': 8, 
  'Nine': 9, 'Ten': 10, 'Jack': 11, 'Queen': 12, 'King': 13, 'Ace': 14
};

class FactionSkills {
  static applyPassives(player, boardCards, isWinner = false) {
    const allCards = [...player.hand, ...boardCards];

    switch (player.faction) {
      case 'factionDiamonds':
        // Pasif 1
        const kingCount = allCards.filter(c => c.rank === 'King').length;
        player.armor += 50 * kingCount;
        // Pasif 2
        const diamondCount = boardCards.filter(c => c.suit === 'Diamond').length;
        player.armor += diamondCount;
        // Pasif 3
        const aceCount = allCards.filter(c => c.rank === 'Ace').length;
        player.damageReduction += aceCount * 0.05;
        break;

      case 'factionHearts':
        // Pasif 1 (true damage)
        player.extraTrueDamage = boardCards
          .filter(c => c.suit === 'Heart')
          .reduce((sum, c) => sum + (rankOrder[c.rank] * 10), 0);

        // Pasif 2
        if (isWinner) {
          player.extraTrueDamage += player.hand
            .filter(c => c.suit === 'Heart')
            .reduce((sum, c) => sum + (rankOrder[c.rank] * 10), 0);
        }

        // Pasif 3
        const queenCount = allCards.filter(c => c.rank === 'Queen').length;
        player.extraTrueDamage += queenCount * 50;
        break;

      case 'factionSpades':
        // Pasif 1
        const spadesCount = boardCards.filter(c => c.suit === 'Spade').length;
        player.hp += spadesCount; // Her kart 1 HP yeniler
        // Pasif 2
        if (isWinner) {
          const aceSpadeCount = player.hand.filter(c => c.rank === 'Ace').length;
          player.extraDamage = aceSpadeCount * 50;
        }
        break;

      case 'factionClubs':
        // Pasif 1
        if (isWinner) {
          const jackCount = player.hand.filter(c => c.rank === 'Jack').length;
          player.damageMultiplier = 1 + (jackCount * 0.1);
        } else {
          player.damageMultiplier = 1;
        }
        // Pasif 2
        const clubsCount = boardCards.filter(c => c.suit === 'Club').length;
        player.dodgeChance += Math.min(0.1 * clubsCount, 0.5);
        break;
    }
  }
}

module.exports = FactionSkills;
