## Racing Discord Bot
This application connects a Roblox racing game directly to a Discord server to automate leaderboard tracking, record preservation, and live race status announcements.
------------------------------
## Core Features

* Automated Data Processing: Captures finish-line statistics from Roblox game servers without any manual log entry.
* Persistent Leaderboards: Saves historic personal bests and track rankings permanently.
* Instant Feed Updates: Fires formatted embed alerts directly into a specific Discord server text channel the moment a race finishes.
* Interactive Discovery: Allows players to query overall or map-specific top times using native application slash commands.

------------------------------
## Architecture & Data Flow

┌───────────────────────┐
│  Roblox Game Servers  │
└───────────┬───────────┘
            │
            ▼ (HTTP POST JSON Payload)
┌───────────────────────┐
│     ngrok Proxy       │ (Bridges public cloud requests to local network)
└───────────┬───────────┘
            │
            ▼ (Target Port: 3050)
┌───────────────────────┐
│ Node.js Backend App   ├───────────► [ SQLite Database (races.db) ]
└───────────┬───────────┘             (Stores historic records locally)
            │
            ▼ (Discord.js API Interface)
┌───────────────────────┐
│   Discord Channels    │ (Outputs Real-time Channel Embeds & Slash Queries)
└───────────────────────┘


   1. Ingestion Layer: When a player crosses a tracking checkpoint in Roblox, the game engine packages the variables and drops an asynchronous network request.
   2. Proxy Route: Because Roblox servers run in the cloud, they target an active ngrok tunnel address that securely proxies the payload straight into your local Node.js process environment.
   3. Database Ledger: The Node.js application interceptor verifies the payload signatures and writes the data points down inside a local SQLite storage table.
   4. Discord Event Engine: The application formats an alert card and submits it straight across the Discord gateway into your server channel while updating the internal slash command memory.

------------------------------
## Webhook Ingestion Specs
The application initializes an internal HTTP web server that opens routing paths explicitly designed to parse external automation calls.

* Target Inbound Route: /race-result
* Network Method Type: POST
* Required Authentication Header: x-api-secret (Validates requests to prevent malicious users from spoofing fake scores)

## JSON Payload Schema
The payload sent by Roblox must follow this structural interface layout exactly:

{
  "player": "String (The racer's Roblox Username)",
  "track": "String (The explicit Name of the track map)",
  "time_ms": "Integer (The total completion time measured in Milliseconds)"
}


