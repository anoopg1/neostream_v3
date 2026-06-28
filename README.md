# NeoStream v3

Professional Twitch stream automation and analytics platform for **neogrit**.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Twitch Developer Application ([dev.twitch.tv](https://dev.twitch.tv))
- Anthropic API key ([console.anthropic.com](https://console.anthropic.com))

## Setup

### 1. Clone and install

```bash
cd neostream_v3
npm install
cd dashboard && npm install && cd ..
```

### 2. Environment

```bash
cp .env.example .env
# Fill in all values in .env
```

### 3. Database

```bash
npm run setup:db
```

### 4. Authorize Twitch accounts

```bash
npm run token:bot    # Authorizes neogri8_supr8 (bot account)
npm run token:main   # Authorizes neogrit (main account)
```

Open the printed URL in your browser and complete OAuth for each account.

### 5. Run

```bash
npm start            # Starts bot + API + dashboard together
```

Or individually:

```bash
npm run start:bot        # Bot only
npm run start:api        # API server only
npm run start:dashboard  # Dashboard dev server only
```

## Services

| Service   | URL                       | Description                    |
|-----------|---------------------------|--------------------------------|
| Dashboard | http://localhost:5173     | React UI                       |
| API       | http://localhost:3500     | Express REST API               |
| WebSocket | ws://localhost:3501       | Real-time event stream         |

## Key Rules

- **BOT client** (`neogri8_supr8`): reads chat and polls Twitch API only. Never posts.
- **MAIN client** (`neogrit`): posts all public messages. Never makes API calls.
- All cooldowns are DB-backed (survive restarts).
- Poison detection runs before every Claude API call.
- Daily Claude spend alerts when the `CLAUDE_DAILY_SPEND_LIMIT` threshold is crossed.

## Pages

| Page             | Route        |
|------------------|--------------|
| Command Center   | /            |
| Viewer Intel     | /viewers     |
| Rankings         | /rankings    |
| Networking CRM   | /networking  |
| Logs             | /logs        |
| API Monitor      | /monitor     |
| Database Manager | /database    |
