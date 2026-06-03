

Game Template & Automated Game Lifecycle Logic

Overview

The platform uses a Game Template Engine that automatically creates and manages games based on predefined scheduling and lifecycle rules.

The purpose of this system is to:

* Automatically generate upcoming games
* Allow users to register before the game starts
* Execute games at the exact scheduled time
* Prevent invalid overlapping registration states
* Process winners automatically after the game ends
* Notify users and store all prize records

This document explains the complete business logic and lifecycle behavior of the system.

⸻

1. Core Concept

The system contains two main entities:

A. Game Template

A reusable configuration that defines:

* Game type
* Schedule frequency
* Game duration
* Prize settings
* Registration behavior
* Execution rules
* Winner calculation rules

The Game Template acts like a scheduler and factory for creating future games automatically.

⸻

B. Game Instance

An actual playable game generated from a Game Template.

Each generated game has its own:

* Start time
* End time
* Status
* Registered users
* Winners
* Prize distribution
* Notifications
* Historical records

⸻

2. Game Creation Logic

When a Game Template is enabled:

* The engine must immediately create the next upcoming game.
* The game may be scheduled for:
    * 30 minutes later
    * 1 hour later
    * tomorrow
    * next month
    * or any configured future time

The important point is:

Games are created BEFORE they start so users can already see them and register in advance.

Example:

* Current time: 09:00
* Scheduled game start: 12:30

The engine creates the game immediately at 09:00.

Users can now:

* See the game
* View countdown
* Register/join

The game will officially begin at 12:30.

⸻

3. Registration Logic

There is NO separate registration duration configuration.

Instead:

Registration Window

Registration is automatically open from:

Game Creation Time → Until Start Time

Example:

* Game created at 09:00
* Game starts at 12:30

Users can register anytime between:

09:00 → 12:30

At exactly the Start Time:

* Registration closes automatically
* No more new participants are allowed

Users who missed registration may still watch as spectators/viewers if the product allows viewing mode.

⸻

4. Game Status Lifecycle

Each Game passes through several states.

⸻

A. Upcoming / Registration Open

State meaning:

* Game exists
* Users can register
* Countdown is active
* Game has not started yet

Allowed actions:

* Register
* View game details
* Purchase tickets/lives/etc.
* Join waiting room

Not allowed:

* Gameplay actions

⸻

B. Running / In Progress

At the exact Start Time:

* Registration closes
* Game becomes active
* Gameplay begins

Allowed actions:

* Participate in gameplay
* Answer questions / interact / play

Not allowed:

* New registrations

Important:

Users who were not registered before Start Time cannot join the game anymore.

⸻

C. Processing Winners

After the configured Game Duration ends:

Example:

* Game starts at 12:30
* Duration = 5 minutes

At 12:35:

The game automatically enters winner-processing mode.

The system must:

* Stop gameplay
* Freeze results
* Validate participants
* Calculate winners
* Calculate prize shares
* Generate payout records

⸻

D. Finished / Completed

After winner processing finishes:

The game becomes completed.

At this stage:

* Final winners are stored
* Prize allocations are finalized
* Notifications are sent
* Historical records are available

The game becomes read-only.

⸻

5. Template Scheduling Rules

Important Rule

A single Game Template may have:

* One Running Game
    AND
* One Upcoming/Registerable Game

at the same time.

This is VALID.

Example:

Game	Status
Game A	Running
Game B	Registration Open

Both belong to the same template.

⸻

Invalid Scenario

The following must NOT happen:

Game	Status
Game A	Registration Open
Game B	Registration Open

The same template cannot have multiple upcoming/registerable games simultaneously.

⸻

6. Next Game Creation Rule

The engine should create the next game when:

The current Upcoming Game changes to Running.

Meaning:

When Game A reaches Start Time:

* Registration closes
* Game A becomes Running

At that moment:

The template engine is allowed to generate Game B.

This allows users to always see and register for the next upcoming game while the previous game is currently running.

This creates continuous game availability.

⸻

7. Game Duration Logic

Each template defines a Game Duration.

Example:

* 5 minutes
* 10 minutes
* 30 minutes

Once the game enters Running state:

The timer begins.

When the duration ends:

* Gameplay stops automatically
* Users cannot continue interacting
* Final game state is frozen

⸻

8. Winner Eligibility Logic

Only users who satisfy all conditions are eligible for prizes.

Eligible users are:

* Registered users
* Users not eliminated/disqualified
* Users who completed the game according to rules

Excluded users may include:

* Eliminated players
* Timeout users
* Invalid participants
* Cheaters/disconnected users (depending on product rules)

⸻

9. Prize Distribution Logic

After the game ends:

The system calculates:

* Total eligible winners
* Prize pool
* Share per winner

The engine then:

* Creates Winner Records
* Creates Prize Transactions
* Stores payout information

Each record should include:

* User ID
* Game ID
* Prize amount
* Prize type
* Timestamp
* Status

⸻

10. Notifications

After winner calculation:

The system sends notifications to users.

Examples:

* Push notifications
* In-app notifications
* Emails
* Telegram/SMS (optional)

Example notification:

“You are one of the winners of Game #123.”

⸻

11. User Experience Requirements

Users should always be able to:

Before Start

* See upcoming games
* View countdowns
* Register

⸻

During Running

* Watch game progress
* Participate if already registered
* View live state

⸻

After Completion

* See winners
* View their rewards
* Access game history
* View payout status

⸻

12. System Goals

This architecture is designed to achieve:

* Continuous game availability
* Predictable scheduling
* Real-time registration
* Smooth game transitions
* Automated winner processing
* Automated notifications
* Full historical traceability
* Scalable recurring game management

The result is a fully automated recurring game engine capable of operating continuously without manual intervention.
