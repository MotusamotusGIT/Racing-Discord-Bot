# Racing Discord Bot

Discord bot for a Roblox racing game. Roblox sends race results via HTTP POST
(`HttpService`), the bot stores them in SQLite and posts live results +
serves a `!leaderboard` command.

## Setup

```bash
cd racing-discord-bot
npm install
cp .env.example .env
```

Edit `.env`:
- `DISCORD_TOKEN` — from https://discord.com/developers/applications (Bot tab)
- `ANNOUNCE_CHANNEL_ID` — right-click a channel in Discord (enable Developer Mode
  in Settings > Advanced first) > Copy Channel ID
- `API_SECRET` — make up any random string, e.g. `openssl rand -hex 16`
- `PORT` — default 3000 is fine

Make sure your bot is invited to your server with the `bot` scope and
`Send Messages` + `Read Message History` permissions, and that
**Message Content Intent** is enabled for the bot in the Discord Developer
Portal (Bot tab > Privileged Gateway Intents).

Run it:

```bash
node index.js
```

You should see:
```
Discord bot logged in as YourBot#1234
HTTP server listening on port 3000
```

## Exposing it to Roblox with ngrok

Roblox's servers run in the cloud, so they can't reach `localhost` on your
machine directly. ngrok creates a public URL that tunnels to your local port.

```bash
# install ngrok if you haven't: https://ngrok.com/download
ngrok http 3000
```

It'll print something like:
```
Forwarding  https://abcd-1234.ngrok-free.app -> http://localhost:3000
```

That `https://abcd-1234.ngrok-free.app` is what your Roblox game will POST to.
Note: free ngrok URLs change every time you restart ngrok — you'll need to
update the URL in your Roblox script each time, or get a paid static domain.

## Roblox side (Luau)

In Roblox Studio, enable **HttpService** first:
Game Settings > Security > Allow HTTP Requests.

Put this in a Server Script, called whenever a player finishes a race:

```lua
local HttpService = game:GetService("HttpService")

local ENDPOINT = "https://abcd-1234.ngrok-free.app/race-result" -- update this
local API_SECRET = "change_this_to_something_random" -- must match your .env

local function reportRaceResult(playerName, trackName, timeMs)
    local payload = HttpService:JSONEncode({
        player = playerName,
        track = trackName,
        time_ms = timeMs,
    })

    local success, response = pcall(function()
        return HttpService:RequestAsync({
            Url = ENDPOINT,
            Method = "POST",
            Headers = {
                ["Content-Type"] = "application/json",
                ["x-api-secret"] = API_SECRET,
            },
            Body = payload,
        })
    end)

    if not success then
        warn("Failed to report race result:", response)
    elseif not response.Success then
        warn("Race result endpoint returned error:", response.StatusCode, response.Body)
    end
end

-- Example usage when a player crosses the finish line:
-- reportRaceResult(player.Name, "Track1", finishTimeInMilliseconds)
```

## Discord commands

- `!leaderboard` — top 10 best times overall
- `!leaderboard Track1` — top 10 best times for a specific track
- `!tracks` — list all tracks that have recorded times
- `!help` — command list

## Notes

- `races.db` (SQLite file) is created automatically on first run and persists
  all results — back it up if you care about history.
- The `x-api-secret` header is your only protection against strangers posting
  fake results to your endpoint. Keep it secret, don't commit `.env`.
- For a permanent (always-on) setup instead of running this on your own
  machine with ngrok, you'd eventually want a small VPS — happy to help with
  that later.
