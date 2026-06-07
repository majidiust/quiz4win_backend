/**
 * Redis key-schema builders for Quiz4Win Real-Time Quiz.
 *
 * Follows §6 of the architecture document.
 * All keys are prefixed with "q4w:" to avoid collisions in shared Redis.
 *
 * §6.1 Game-level  → q4w:game:{gameId}:state             (Hash)
 * §6.2 Question    → q4w:game:{gameId}:q:{idx}:state      (Hash)
 * §6.3 User        → q4w:game:{gameId}:u:{userId}:state   (Hash)
 *
 * Auxiliary sets:
 *   participants   → q4w:game:{gameId}:participants        (Set of userId)
 *   spectators     → q4w:game:{gameId}:spectators          (Set of userId)
 *   userAnswers    → q4w:game:{gameId}:u:{userId}:answers  (Set of questionId)
 *   questionAnswered → q4w:game:{gameId}:q:{idx}:answered  (Set of userId)
 *   userAttempt    → q4w:game:{gameId}:u:{userId}:attempt:{attemptId} (String, 5 min TTL)
 */

const NS = "q4w";

export const redisKeys = {
  // §6.1 — Game-level state hash
  gameState: (gameId: string) => `${NS}:game:${gameId}:state`,

  // §6.2 — Question-level state hash (keyed by sequential index)
  questionState: (gameId: string, qIdx: number) =>
    `${NS}:game:${gameId}:q:${qIdx}:state`,

  // §6.3 — User-level state hash
  userState: (gameId: string, userId: string) =>
    `${NS}:game:${gameId}:u:${userId}:state`,

  // Set: all participant userIds in this game
  participants: (gameId: string) => `${NS}:game:${gameId}:participants`,

  // Set: all spectator userIds in this game
  spectators: (gameId: string) => `${NS}:game:${gameId}:spectators`,

  // Set: questionIds already answered by this user (duplicate protection)
  userAnswers: (gameId: string, userId: string) =>
    `${NS}:game:${gameId}:u:${userId}:answers`,

  // Set: userIds who answered question at index qIdx (for no-answer detection)
  questionAnswered: (gameId: string, qIdx: number) =>
    `${NS}:game:${gameId}:q:${qIdx}:answered`,

  // Hash: per-option answer tally for question at index qIdx (field=optionId,
  // value=count). Drives the option-distribution stats revealed on QUESTION_CLOSED.
  questionOptionCounts: (gameId: string, qIdx: number) =>
    `${NS}:game:${gameId}:q:${qIdx}:optionCounts`,

  // String: cached idempotency result for a specific attemptId (TTL 300 s)
  userAttempt: (gameId: string, userId: string, attemptId: string) =>
    `${NS}:game:${gameId}:u:${userId}:attempt:${attemptId}`,
};

/**
 * Build the complete set of keys for a game that an atomic Lua script needs.
 * Returns keys in the exact order the scripts expect them.
 *
 * `qIdx` is the live `currentQuestionIndex` (0 when no question is active). It
 * is only used to build the `questionAnswered` key (KEYS[6]) so the late-join
 * path can mark a surviving late joiner as having "answered" the in-progress
 * question — which is already charged as a missed answer — so the no-answer
 * sweep skips them and SUBMIT rejects a re-attempt as a duplicate.
 */
export function joinGameKeys(gameId: string, userId: string, qIdx = 0) {
  return [
    redisKeys.gameState(gameId),              // KEYS[1]
    redisKeys.userState(gameId, userId),      // KEYS[2]
    redisKeys.participants(gameId),           // KEYS[3]
    redisKeys.spectators(gameId),             // KEYS[4]
    redisKeys.userAnswers(gameId, userId),    // KEYS[5]
    redisKeys.questionAnswered(gameId, qIdx), // KEYS[6]
  ];
}

export function submitAnswerKeys(
  gameId: string,
  userId: string,
  qIdx: number,
  attemptId: string,
) {
  return [
    redisKeys.gameState(gameId),                          // KEYS[1]
    redisKeys.userState(gameId, userId),                  // KEYS[2]
    redisKeys.userAnswers(gameId, userId),                // KEYS[3]
    redisKeys.userAttempt(gameId, userId, attemptId),     // KEYS[4]
    redisKeys.questionAnswered(gameId, qIdx),             // KEYS[5]
    redisKeys.questionOptionCounts(gameId, qIdx),         // KEYS[6]
  ];
}

export function closeQuestionKeys(gameId: string, qIdx: number) {
  return [
    redisKeys.gameState(gameId),             // KEYS[1]
    redisKeys.questionState(gameId, qIdx),   // KEYS[2]
    redisKeys.participants(gameId),          // KEYS[3]
    redisKeys.questionAnswered(gameId, qIdx), // KEYS[4]
  ];
}
