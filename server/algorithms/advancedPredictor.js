/**
 * Advanced machine learning-inspired prediction algorithm
 * Uses multiple factors for more accurate race outcome predictions:
 * - Historical performance
 * - Form trend (recent results)
 * - Circuit suitability
 * - Weather conditions
 * - Qualifying position
 */

const { getPointsForPosition } = require('./f1Points');

/**
 * Predict race finish position based on multiple factors
 * Combines driver form, historical performance, and circuit data
 */
function predictRaceOutcome(drivers, raceResults, currentRace, weatherFactor = 1.0) {
  const predictions = drivers.map((driver) => {
    let score = 50; // Base score

    // 1. Historical performance (30% weight)
    const historicalScore = calculateHistoricalPerformance(driver, raceResults);
    score += historicalScore * 0.3;

    // 2. Form trend (25% weight) - last 3 races
    const formScore = calculateFormTrend(driver, raceResults);
    score += formScore * 0.25;

    // 3. Circuit suitability (20% weight)
    if (currentRace.circuitHistory) {
      const circuitScore = calculateCircuitSuitability(driver, currentRace.circuitHistory);
      score += circuitScore * 0.2;
    }

    // 4. Weather impact (15% weight)
    if (currentRace.weather) {
      const weatherScore = calculateWeatherImpact(driver, currentRace.weather, weatherFactor);
      score += weatherScore * 0.15;
    }

    // 5. Qualifying position boost (10% weight)
    if (currentRace.qualifyingOrder) {
      const qualifyingScore = calculateQualifyingImpact(driver, currentRace.qualifyingOrder);
      score += qualifyingScore * 0.1;
    }

    // Add variance for realism (small random factor)
    const variance = (Math.random() - 0.5) * 5;
    score += variance;

    return {
      driverId: driver.id,
      name: driver.name,
      team: driver.team,
      predictedScore: Math.max(0, Math.min(100, score)), // Clamp 0-100
      factors: {
        historical: historicalScore,
        form: formScore,
        circuit: currentRace.circuitHistory ? calculateCircuitSuitability(driver, currentRace.circuitHistory) : 50,
        weather: currentRace.weather ? calculateWeatherImpact(driver, currentRace.weather, weatherFactor) : 50
      }
    };
  });

  // Sort by predicted score and convert to probabilities
  return convertScoresToProbabilities(predictions);
}

/**
 * Calculate driver's historical average performance
 */
function calculateHistoricalPerformance(driver, raceResults) {
  if (!raceResults || raceResults.length === 0) return 50;

  let totalScore = 0;
  let raceCount = 0;

  raceResults.forEach((result) => {
    const position = result.finishingOrder.indexOf(driver.id);
    if (position !== -1) {
      // Convert position to score (1st = 100, 20th = 0)
      const score = Math.max(0, 100 - (position * 5));
      totalScore += score;
      raceCount++;
    }
  });

  return raceCount > 0 ? totalScore / raceCount : 50;
}

/**
 * Calculate driver's current form based on recent races
 * Gives more weight to recent results
 */
function calculateFormTrend(driver, raceResults, recentRaceCount = 3) {
  if (!raceResults || raceResults.length === 0) return 50;

  const recentRaces = raceResults.slice(-recentRaceCount);
  let weightedScore = 0;
  let totalWeight = 0;

  recentRaces.forEach((result, index) => {
    const position = result.finishingOrder.indexOf(driver.id);
    if (position !== -1) {
      const score = Math.max(0, 100 - (position * 5));
      const weight = (index + 1) / recentRaceCount; // More recent = higher weight
      weightedScore += score * weight;
      totalWeight += weight;
    }
  });

  return totalWeight > 0 ? weightedScore / totalWeight : 50;
}

/**
 * Calculate driver's suitability to current circuit
 * Based on historical performance at this circuit
 */
function calculateCircuitSuitability(driver, circuitHistory) {
  if (!circuitHistory || !circuitHistory[driver.id]) {
    return 50; // Neutral score if no history
  }

  const history = circuitHistory[driver.id];
  let score = 0;

  // Average podium rate
  if (history.races && history.races > 0) {
    const podiumRate = (history.podiums || 0) / history.races;
    score += podiumRate * 100 * 0.6; // 60% weight to podium rate
  }

  // Average points per race
  if (history.races && history.races > 0) {
    const avgPoints = (history.totalPoints || 0) / history.races;
    score += (avgPoints / 25) * 100 * 0.4; // 40% weight to average points
  }

  return score || 50;
}

/**
 * Calculate weather impact on driver performance
 * Different drivers handle different weather conditions differently
 */
function calculateWeatherImpact(driver, weather, weatherFactor = 1.0) {
  let score = 50;

  // Wet weather specialists typically score higher in rain
  const wetSpecialists = ['VER', 'HAM', 'ALO']; // Example codes
  const drySpecialists = ['LEC', 'SAI', 'NOR'];

  if (weather.type === 'rain' && weatherFactor > 1.0) {
    score = wetSpecialists.includes(driver.code) ? 65 : 45;
  } else if (weather.type === 'clear' && weatherFactor < 1.0) {
    score = drySpecialists.includes(driver.code) ? 65 : 45;
  }

  // Temperature impact
  if (weather.temperature) {
    if (weather.temperature > 30 && drySpecialists.includes(driver.code)) {
      score += 5;
    } else if (weather.temperature < 10 && wetSpecialists.includes(driver.code)) {
      score += 5;
    }
  }

  return score;
}

/**
 * Calculate qualifying position impact
 * Pole position significantly improves win probability
 */
function calculateQualifyingImpact(driver, qualifyingOrder) {
  const position = qualifyingOrder.indexOf(driver.id);
  if (position === -1) return 50;

  // Exponential decay: P1 = +25, P2 = +15, P3 = +10, P4 = +5, P5+ = +2
  if (position === 0) return 75;
  if (position === 1) return 65;
  if (position === 2) return 60;
  if (position === 3) return 55;
  if (position === 4) return 52;
  return 50;
}

/**
 * Convert prediction scores to win/podium probabilities
 */
function convertScoresToProbabilities(predictions) {
  const totalScore = predictions.reduce((sum, p) => sum + p.predictedScore, 0);

  return predictions.map((prediction) => {
    const winProbability = (prediction.predictedScore / totalScore) * 100;
    // Three drivers share a podium, so podium chances add up to 300% across the field
    const podiumProbability = Math.min(100, (prediction.predictedScore / totalScore) * 300);

    return {
      ...prediction,
      winProbability: Math.round(winProbability * 100) / 100,
      podiumProbability: Math.round(podiumProbability * 100) / 100,
    };
  })
    .sort((a, b) => b.winProbability - a.winProbability)
    .map((prediction, index) => ({ ...prediction, predictedPosition: index + 1 }));
}

/**
 * Calculate confidence score for predictions
 * Based on data availability and recent form consistency
 */
function calculatePredictionConfidence(driver, raceResults) {
  let confidence = 0.5; // Base 50%

  if (!raceResults || raceResults.length === 0) {
    return 0.2; // Low confidence with no data
  }

  // More races = higher confidence
  const raceCount = raceResults.filter(
    (r) => r.finishingOrder.includes(driver.id)
  ).length;
  confidence += (Math.min(raceCount, 10) / 10) * 0.3;

  // Consistent performance = higher confidence
  const formScore = calculateFormTrend(driver, raceResults);
  const historicalScore = calculateHistoricalPerformance(driver, raceResults);
  const consistency = 1 - Math.abs(formScore - historicalScore) / 100;
  confidence += consistency * 0.2;

  return Math.min(confidence, 0.99);
}

module.exports = {
  predictRaceOutcome,
  calculateHistoricalPerformance,
  calculateFormTrend,
  calculateCircuitSuitability,
  calculateWeatherImpact,
  calculateQualifyingImpact,
  convertScoresToProbabilities,
  calculatePredictionConfidence
};
