/**
 * Redis Lua scripts for Quiz4Win atomic real-time quiz operations.
 *
 * §9.3 requires that validation be atomic:
 *   "duplicate check, wrong count update, and elimination decision [must]
 *    not [be] performed in separate unsafe operations."
 *
 * Each script uses cjson.encode() to return a JSON string so Deno can
 * parse the full result with a single JSON.parse(). All keys that the
 * script touches must appear in KEYS[] (cluster-safe).
 */

// ─── JOIN_GAME (§7 + late-join rule + ghost-sweep pre-charged path) ──────────
// Late-join rule (first_question_only policy): every question already presented
// counts as a missed (wrong) answer. missed = currentQuestionIndex + 1 (the
// in-progress question started before the player arrived, so it counts too).
// Once missed >= maxWrongAnswers the player joins demoted to spectator and may
// never answer. Below the limit they join as a participant with reduced lives
// and are blocked from the already-counted in-progress question.
//   maxWrong=3, join during Q1(idx0)→missed1 / Q2(idx1)→missed2 → participant
//   maxWrong=3, join during Q3(idx2)→missed3 ≥ 3 → spectator (eliminated)
//   maxWrong=1, join during Q2(idx1)→missed2 ≥ 1 → spectator (eliminated)
// The `any_time` policy keeps its no-penalty behavior; `closed` rejects.
//
// Ghost-sweep pre-charged path (ARGV[6] non-empty):
//   When the ghost sweep has already charged this player for all closed questions
//   (players who paid but never called /game-session/join), ARGV[6] carries the
//   pre-charged wrongCount and ARGV[7] the pre-charged livesRemaining so the Lua
//   script only charges the currently-active question (+1) to avoid double-counting.
//
// KEYS[1] = gameState hash
// KEYS[2] = userState hash
// KEYS[3] = participants set
// KEYS[4] = spectators set
// KEYS[5] = userAnswers set       (questionIds this user has answered)
// KEYS[6] = questionAnswered set  (userIds who answered current question, by ARGV[5])
// ARGV[1] = userId
// ARGV[2] = sessionId
// ARGV[3] = deviceId
// ARGV[4] = serverTimeMs (epoch milliseconds as string)
// ARGV[5] = currentQuestionIndex as read by the caller ("" when none) — guards
//           the KEYS[6] block against an index that advanced mid-request.
// ARGV[6] = preChargedWrong ("" | "<number>") — DB wrong_count from ghost sweep
// ARGV[7] = preChargedLives ("" | "<number>") — DB lives_remaining from ghost sweep
export const JOIN_GAME_SCRIPT = `
local gameStatus = redis.call("HGET", KEYS[1], "gameStatus")
if not gameStatus then
  return cjson.encode({status="error", reason="game_not_found"})
end
if gameStatus ~= "running" and gameStatus ~= "open" then
  return cjson.encode({status="error", reason="game_not_joinable"})
end
local joinPolicy = redis.call("HGET", KEYS[1], "joinPolicy") or "first_question_only"
if joinPolicy == "closed" then
  return cjson.encode({status="error", reason="join_closed"})
end
local existingStatus = redis.call("HGET", KEYS[2], "userStatus")
if existingStatus then
  if ARGV[2] ~= "" then redis.call("HSET", KEYS[2], "sessionId", ARGV[2]) end
  if ARGV[3] ~= "" then redis.call("HSET", KEYS[2], "deviceId", ARGV[3]) end
  local wc = tonumber(redis.call("HGET", KEYS[2], "wrongCount") or "0")
  local rl = redis.call("HGET", KEYS[2], "remainingLives")
  local cc = tonumber(redis.call("HGET", KEYS[2], "correctCount") or "0")
  local er = redis.call("HGET", KEYS[2], "eliminationReason")
  return cjson.encode({status="ok", reconnect=true, userStatus=existingStatus,
    wrongCount=wc, remainingLives=rl and tonumber(rl) or cjson.null, correctCount=cc,
    eliminated=(existingStatus ~= "participant"), eliminationReason=er or cjson.null,
    missedQuestions=0})
end
-- ─── Late-join charge calculation ─────────────────────────────────────────────
local qIdxLive = redis.call("HGET", KEYS[1], "currentQuestionIndex")
local qStatus  = redis.call("HGET", KEYS[1], "currentQuestionStatus")
local maxWrong = redis.call("HGET", KEYS[1], "maxWrongAnswers")
local maxW     = maxWrong and tonumber(maxWrong) or nil
local role = "participant"
local eliminated = false
local elimReason = cjson.null
local wrongCount = 0
local remainingLives = maxW      -- nil means no limit
-- missedQuestions returned to caller: counts only NEW charges so the edge
-- function only publishes LATE_JOIN_RECONCILE when there is a fresh event to
-- broadcast (ghost-sweep events for closed questions are already published).
local missedQuestions = 0
-- Whether to block the currently-active question (prevent double-charge and
-- reject re-attempts via SUBMIT for an already-counted question).
local shouldBlock = false

-- ARGV[6] non-empty = ghost-sweep pre-charged path: the orchestrator already
-- charged this player for all closed questions via the DB ghost sweep. Only the
-- currently-active question (if any) is a new charge.
local preChargedWrong = ARGV[6] ~= "" and tonumber(ARGV[6]) or nil
if preChargedWrong ~= nil then
  local preChargedLives = ARGV[7] ~= "" and tonumber(ARGV[7]) or nil
  -- Charge 1 for the in-progress question, 0 if between questions.
  local inCharge = (qIdxLive ~= nil and qStatus == "active") and 1 or 0
  wrongCount = preChargedWrong + inCharge
  if maxW ~= nil then
    local baseLives = preChargedLives ~= nil and preChargedLives or math.max(maxW - preChargedWrong, 0)
    remainingLives = math.max(baseLives - inCharge, 0)
    if remainingLives <= 0 then
      remainingLives = 0; role = "spectator"; eliminated = true; elimReason = "late_join_missed"
    end
  else
    remainingLives = preChargedLives  -- nil = unlimited
  end
  missedQuestions = inCharge   -- only the NEW in-progress charge
  shouldBlock = inCharge == 1
else
  -- Original path: compute missed from currentQuestionIndex.
  local missed = 0
  if joinPolicy ~= "any_time" and qIdxLive then
    missed = tonumber(qIdxLive) + 1
  end
  wrongCount = missed
  if maxW ~= nil then
    remainingLives = maxW - missed
    if remainingLives <= 0 then
      remainingLives = 0; role = "spectator"; eliminated = true; elimReason = "late_join_missed"
    end
  end
  missedQuestions = missed
  shouldBlock = missed > 0
end
-- ─── Write Redis state ─────────────────────────────────────────────────────────
redis.call("HSET", KEYS[2], "userId", ARGV[1], "sessionId", ARGV[2],
  "deviceId", ARGV[3], "userStatus", role, "wrongCount", tostring(wrongCount),
  "correctCount", "0", "joinTime", ARGV[4])
if remainingLives ~= nil then
  redis.call("HSET", KEYS[2], "remainingLives", tostring(remainingLives))
end
if eliminated then
  redis.call("HSET", KEYS[2], "eliminatedAt", ARGV[4], "eliminationReason", elimReason)
end
if role == "participant" then
  redis.call("SADD", KEYS[3], ARGV[1])
  redis.call("HINCRBY", KEYS[1], "participantCount", 1)
  -- Block the already-charged in-progress question: mark it answered so the
  -- no-answer sweep skips this user and SUBMIT rejects a re-attempt.
  if shouldBlock and qStatus == "active" and ARGV[5] ~= "" and qIdxLive == ARGV[5] then
    local curQId = redis.call("HGET", KEYS[1], "currentQuestionId")
    if curQId then redis.call("SADD", KEYS[5], curQId) end
    redis.call("SADD", KEYS[6], ARGV[1])
  end
else
  redis.call("SADD", KEYS[4], ARGV[1])
  redis.call("HINCRBY", KEYS[1], "spectatorCount", 1)
end
return cjson.encode({status="ok", reconnect=false, userStatus=role,
  wrongCount=wrongCount, remainingLives=remainingLives or cjson.null, correctCount=0,
  eliminated=eliminated, eliminationReason=elimReason, missedQuestions=missedQuestions})
`;

// ─── SUBMIT_ANSWER (§9.3) ────────────────────────────────────────────────────
// KEYS[1] = gameState hash
// KEYS[2] = userState hash
// KEYS[3] = userAnswers set  (set of questionIds this user has answered)
// KEYS[4] = userAttempt key  (idempotency cache string, TTL 300s)
// KEYS[5] = questionAnswered set (userIds who answered current question)
// ARGV[1] = questionId
// ARGV[2] = selectedOptionId
// ARGV[3] = attemptId
// ARGV[4] = serverTimeMs
// ARGV[5] = responseTimeMs
export const SUBMIT_ANSWER_SCRIPT = `
local cached = redis.call("GET", KEYS[4])
if cached then return cached end
local userStatus = redis.call("HGET", KEYS[2], "userStatus")
if not userStatus then
  return cjson.encode({status="rejected", reason="not_joined"})
end
if userStatus ~= "participant" then
  return cjson.encode({status="rejected", reason=userStatus.."_cannot_answer"})
end
local gameStatus = redis.call("HGET", KEYS[1], "gameStatus")
if gameStatus ~= "running" then
  return cjson.encode({status="rejected", reason="game_not_running"})
end
local curQId = redis.call("HGET", KEYS[1], "currentQuestionId")
if not curQId or curQId ~= ARGV[1] then
  return cjson.encode({status="rejected", reason="question_not_active"})
end
local qStatus = redis.call("HGET", KEYS[1], "currentQuestionStatus")
if qStatus ~= "active" then
  return cjson.encode({status="rejected", reason="question_closed"})
end
local endsAt = tonumber(redis.call("HGET", KEYS[1], "currentQuestionEndsAt"))
local grace = tonumber(redis.call("HGET", KEYS[1], "gracePeriodMs") or "400")
local now = tonumber(ARGV[4])
if not endsAt or now > (endsAt + grace) then
  return cjson.encode({status="rejected", reason="late"})
end
local dup = redis.call("SISMEMBER", KEYS[3], ARGV[1])
if dup == 1 then
  return cjson.encode({status="rejected", reason="duplicate"})
end
local correctOpt = redis.call("HGET", KEYS[1], "currentQuestionCorrectOptionId")
if not correctOpt then
  return cjson.encode({status="rejected", reason="no_correct_option"})
end
local isCorrect = (ARGV[2] == correctOpt)
local wrongCount = tonumber(redis.call("HGET", KEYS[2], "wrongCount") or "0")
local rlRaw = redis.call("HGET", KEYS[2], "remainingLives")
local maxWrongRaw = redis.call("HGET", KEYS[1], "maxWrongAnswers")
local correctCount = tonumber(redis.call("HGET", KEYS[2], "correctCount") or "0")
local newWrong = wrongCount
local newRl = rlRaw and tonumber(rlRaw) or nil
local eliminate = false
local elimReason = cjson.null
local points = 0
if isCorrect then
  correctCount = correctCount + 1
  local rt = tonumber(ARGV[5]) or 0
  points = math.max(10, 100 - math.floor(rt / 100))
else
  newWrong = wrongCount + 1
  if newRl ~= nil then
    newRl = math.max(newRl - 1, 0)
    if newRl == 0 then eliminate = true; elimReason = "wrong_answer_lives_zero" end
  end
  if maxWrongRaw and not eliminate then
    if newWrong > tonumber(maxWrongRaw) then eliminate=true; elimReason="max_wrong_exceeded" end
  end
end
local roleAfter = eliminate and "eliminated" or "participant"
local qIdx = redis.call("HGET", KEYS[1], "currentQuestionIndex")
redis.call("HSET", KEYS[2], "wrongCount", tostring(newWrong),
  "correctCount", tostring(correctCount), "userStatus", roleAfter,
  "lastAnsweredQuestionId", ARGV[1])
if newRl ~= nil then redis.call("HSET", KEYS[2], "remainingLives", tostring(newRl)) end
if eliminate then
  local ts = ARGV[4]
  redis.call("HSET", KEYS[2], "eliminatedAt", ts, "eliminationReason", elimReason)
  redis.call("HINCRBY", KEYS[1], "eliminatedUserCount", 1)
end
redis.call("SADD", KEYS[3], ARGV[1])
redis.call("SADD", KEYS[5], redis.call("HGET", KEYS[2], "userId") or "unknown")
local startsAt = redis.call("HGET", KEYS[1], "currentQuestionStartsAt")
local result = cjson.encode({
  status="accepted", isCorrect=isCorrect,
  correctOptionId=correctOpt, pointsEarned=points,
  wrongCount=newWrong, remainingLives=newRl or cjson.null,
  participantRole=roleAfter, eliminated=eliminate, eliminationReason=elimReason,
  questionId=ARGV[1], questionIndex=tonumber(qIdx) or 0,
  startsAt=startsAt and tonumber(startsAt) or 0, endsAt=endsAt, serverTime=now
})
redis.call("SET", KEYS[4], result, "EX", 300)
return result
`;

// ─── PREPARE_QUESTION (§8.1) ─────────────────────────────────────────────────
// KEYS[1] = gameState hash
// KEYS[2] = questionState hash  (q4w:game:{id}:q:{idx}:state)
// ARGV[1] = questionId
// ARGV[2] = questionIndex (string)
// ARGV[3] = correctOptionId
// ARGV[4] = startsAt (epoch ms string)
// ARGV[5] = endsAt   (epoch ms string)
// ARGV[6] = gracePeriodMs
// ARGV[7] = localizedJson (full payload, stored as string)
// Rule §8.2: Redis must be ready BEFORE the question is broadcast.
export const PREPARE_QUESTION_SCRIPT = `
redis.call("HSET", KEYS[2],
  "questionId", ARGV[1], "questionIndex", ARGV[2],
  "status", "active", "correctOptionId", ARGV[3],
  "startsAt", ARGV[4], "endsAt", ARGV[5],
  "gracePeriodMs", ARGV[6], "localizedPayload", ARGV[7])
redis.call("EXPIRE", KEYS[2], 86400)
redis.call("HSET", KEYS[1],
  "currentQuestionId", ARGV[1],
  "currentQuestionIndex", ARGV[2],
  "currentQuestionStatus", "active",
  "currentQuestionStartsAt", ARGV[4],
  "currentQuestionEndsAt", ARGV[5],
  "currentQuestionCorrectOptionId", ARGV[3])
return cjson.encode({status="ok", questionId=ARGV[1], questionIndex=tonumber(ARGV[2]),
  startsAt=tonumber(ARGV[4]), endsAt=tonumber(ARGV[5])})
`;

// ─── CLOSE_QUESTION (§18.5) ──────────────────────────────────────────────────
// KEYS[1] = gameState hash
// KEYS[2] = questionState hash
// KEYS[3] = participants set
// KEYS[4] = questionAnswered set
// ARGV[1] = serverTimeMs
// Returns list of userIds who didn't answer (for no-answer processing).
export const CLOSE_QUESTION_SCRIPT = `
local curStatus = redis.call("HGET", KEYS[1], "currentQuestionStatus")
if curStatus ~= "active" then
  return cjson.encode({status="error", reason="question_not_active"})
end
redis.call("HSET", KEYS[1], "currentQuestionStatus", "closed")
redis.call("HSET", KEYS[2], "status", "closed", "closedAt", ARGV[1])
local notAnswered = redis.call("SDIFF", KEYS[3], KEYS[4])
local qId = redis.call("HGET", KEYS[1], "currentQuestionId")
local qIdx = redis.call("HGET", KEYS[1], "currentQuestionIndex")
return cjson.encode({status="ok", questionId=qId, questionIndex=tonumber(qIdx) or 0,
  notAnswered=notAnswered, closedAt=tonumber(ARGV[1])})
`;
