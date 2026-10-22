module.exports = {
  JWT_SECRET: process.env.JWT_SECRET || 'f1predictor2026secret',
  PORT: process.env.PORT || 5000,
  POINTS: {
    PARTICIPATION: 5,
    CORRECT_WINNER: 25,
    CORRECT_PODIUM: 10,
    CORRECT_TOP10: 3
  },
  F1_POINTS_TABLE: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
  SPRINT_POINTS_TABLE: [8, 7, 6, 5, 4, 3, 2, 1],
  MONTE_CARLO_ITERATIONS: 10000
};
