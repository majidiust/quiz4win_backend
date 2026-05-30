# Game Template System - Implementation Specification

## Overview

A template-based system for automated game generation. Templates define reusable game configurations with cron schedules. A background job runs every minute, checks active templates, and automatically creates games when the cron expression matches the current time.

---

## Core Concepts

### Template
A template stores all game configuration fields plus scheduling metadata. When active, the system automatically creates games based on the cron schedule.

### Relationships
- **Template → Games**: One-to-many. A template generates multiple games over time.
- **Game → Template**: Each generated game stores a `templateId` reference to its source template.
- **Template tracks**: `currentGameId` (active game), `lastCompletedGameId`, `lastGeneratedAt`, `totalGamesGenerated`

### Overlap Prevention
The system prevents creating a new game if the template's current game is still active (not finished). This ensures no overlapping games from the same template.

---

## Database Schema

### Template Table
Create a new table that mirrors all fields from your game table, plus these additional fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | INT (PK) | Auto-increment primary key |
| `cronExpression` | VARCHAR(50) | Cron schedule (e.g., "0/15 * * * *") |
| `cronDescription` | VARCHAR(100) | Human-readable description (e.g., "Every 15 minutes") |
| `isActive` | BOOLEAN | Whether template is active for auto-generation |
| `currentGameId` | INT (nullable) | FK to currently active game |
| `lastCompletedGameId` | INT (nullable) | FK to last finished game |
| `lastGeneratedAt` | DATETIME (nullable) | Timestamp of last game creation |
| `totalGamesGenerated` | INT (default 0) | Counter of games created |
| `createdAt` | DATETIME | Creation timestamp |
| `updatedAt` | DATETIME | Last update timestamp |
| `createdBy` | INT (nullable) | User who created the template |

**Plus all fields from your game table** (name, description, prize, duration, assets, settings, etc.)

### Game Table Modification
Add to your existing game table:

| Field | Type | Description |
|-------|------|-------------|
| `templateId` | INT (nullable) | FK to source template (null if manually created) |

---

## API Endpoints

### CRUD Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/templates` | List templates with pagination. Query params: `page`, `perPage`, `isActive` |
| GET | `/templates/{id}` | Get single template |
| POST | `/templates` | Create template |
| PUT | `/templates/{id}` | Update template |
| DELETE | `/templates/{id}` | Delete/deactivate template |

### Activation

| Method | Endpoint | Description |
|--------|----------|-------------|
| PATCH | `/templates/{id}/activate` | Start auto-generation |
| PATCH | `/templates/{id}/deactivate` | Stop auto-generation |

### Game Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/templates/{id}/generate-now` | Manually trigger game creation (bypasses cron, respects overlap prevention) |
| GET | `/templates/{id}/current-game` | Get active game for template |
| GET | `/templates/{id}/last-game` | Get last completed game |
| GET | `/templates/{id}/history` | Get games generated from template. Query param: `limit` |

---

## Cron Job Implementation

### Schedule
Run every minute: `* * * * *`

### Logic Flow

```
1. Fetch all templates where isActive = true
2. For each template:
   a. Check if cronExpression matches current time
   b. Check if lastGeneratedAt was within last 2 minutes (prevent duplicates)
   c. Check if currentGameId has an active/unfinished game (prevent overlap)
   d. If all checks pass:
      - Create new game with all template fields
      - Set game.templateId = template.id
      - Calculate startTime and finishTime based on durationMinutes
      - Update template.currentGameId = newGame.id
      - Update template.lastGeneratedAt = now
      - Increment template.totalGamesGenerated
3. Log results
```

### Cron Expression Parser
Support standard 5-field cron syntax:

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, Sunday=0)
* * * * *
```

**Supported patterns:**
- `*` - Any value
- `5` - Specific value
- `1-5` - Range
- `0/15` or `*/15` - Step (every N starting from 0)
- `1,15,30` - List of values

### Shell Script for Cron (if using system cron)

```bash
#!/bin/bash
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
cd "$(dirname "$0")/.."

if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Run the template generator script
/path/to/your/runtime /path/to/template_generator_script

echo "$(date): Template generator executed" >> /var/log/cron.log
```

---

## Service Functions

### Required Functions

1. **createTemplate(data)** - Create new template
2. **updateTemplate(id, data)** - Update template
3. **deleteTemplate(id)** - Soft delete (deactivate)
4. **getTemplate(id)** - Get single template
5. **listTemplates(page, perPage, filters)** - Paginated list
6. **activateTemplate(id)** - Set isActive = true
7. **deactivateTemplate(id)** - Set isActive = false
8. **getActiveTemplates()** - Get all active templates (for cron job)
9. **generateGameFromTemplate(templateId, skipOverlapCheck?)** - Create game from template
10. **getCurrentGame(templateId)** - Get active game
11. **getLastCompletedGame(templateId)** - Get last finished game
12. **getGameHistory(templateId, limit)** - Get games from template

### generateGameFromTemplate Logic

```
1. Fetch template by ID
2. If !skipOverlapCheck and template.currentGameId exists:
   a. Fetch current game
   b. If game is not finished AND finishTime > now:
      - Throw error "Template already has active game"
3. Create new game with:
   - All configuration fields from template
   - templateId = template.id
   - startTime = now + buffer (e.g., 2 minutes)
   - finishTime = startTime + durationMinutes
   - status = "nostarted" or initial status
4. Update template:
   - currentGameId = newGame.id
   - lastGeneratedAt = now
   - totalGamesGenerated += 1
5. Return new game
```

---

## Overlap Prevention Logic

### In Cron Job (hasActiveGame check)

```
function hasActiveGame(template):
  if !template.currentGameId: return false

  game = fetchGame(template.currentGameId)
  if !game: return false

  if game.finished != true AND game.status != "finish":
    if !game.finishTime OR game.finishTime > now:
      return true  // Active game exists

  return false  // No active game
```

### In Service (generateGameFromTemplate)
Same logic as above, throws error instead of returning boolean.

---

## Cron Expression Matching

```
function matchesCronExpression(cronExpr, date):
  parts = cronExpr.split(" ")
  if parts.length != 5: return false

  [minuteExpr, hourExpr, dayExpr, monthExpr, weekdayExpr] = parts

  return (
    matchField(minuteExpr, date.minute, 0, 59) AND
    matchField(hourExpr, date.hour, 0, 23) AND
    matchField(dayExpr, date.day, 1, 31) AND
    matchField(monthExpr, date.month, 1, 12) AND
    matchField(weekdayExpr, date.weekday, 0, 6)
  )

function matchField(expr, value, min, max):
  if expr == "*": return true

  if expr contains "/":
    [base, step] = expr.split("/")
    startValue = (base == "*") ? min : parseInt(base)
    return (value - startValue) >= 0 AND (value - startValue) % step == 0

  if expr contains "-":
    [start, end] = expr.split("-")
    return value >= start AND value <= end

  if expr contains ",":
    values = expr.split(",").map(parseInt)
    return values.includes(value)

  return parseInt(expr) == value
```

---

## Example Cron Expressions

| Expression | Description |
|------------|-------------|
| `0/15 * * * *` | Every 15 minutes (:00, :15, :30, :45) |
| `0 * * * *` | Every hour at :00 |
| `0 0 * * *` | Daily at midnight |
| `0 20 * * *` | Daily at 8:00 PM |
| `0 18 * * 6` | Every Saturday at 6:00 PM |
| `30 9 * * 1-5` | Weekdays at 9:30 AM |
| `0 0 1 * *` | First day of every month |

---

## Error Handling

### Cron Job Errors
- Log errors to database (system_error_logs table)
- Continue processing other templates if one fails
- Don't exit on individual template failures

### API Errors

| Status | Scenario |
|--------|----------|
| 400 | Invalid input, overlap detected |
| 404 | Template not found |
| 500 | Server error |

---

## Game Naming Convention

When generating games from templates, create unique names:

```
{templateName}_{MMDD}_{HHmm}
```

Example: `Quick15Min_0210_1430` (February 10, 2:30 PM)

---

## Summary Checklist

- [ ] Create template database table with all game fields + scheduling fields
- [ ] Add `templateId` column to game table
- [ ] Implement template CRUD API endpoints
- [ ] Implement activate/deactivate endpoints
- [ ] Implement generate-now endpoint with overlap prevention
- [ ] Implement current-game, last-game, history endpoints
- [ ] Create cron job that runs every minute
- [ ] Implement cron expression parser
- [ ] Implement overlap prevention logic
- [ ] Implement duplicate prevention (2-minute threshold)
- [ ] Add logging for cron job execution
- [ ] Add error logging to database
- [ ] Configure cron in deployment (Docker/system cron)
