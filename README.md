# KhelSetu Backend

Production-grade realtime multi-tenant sports tournament management platform for Nepal.

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **Database**: PostgreSQL (hosted on Railway)
- **Real-time**: Socket.IO
- **Auth**: JWT with refresh tokens
- **API Docs**: Swagger/OpenAPI

## Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL (or use Railway PostgreSQL)

### Installation

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your PostgreSQL credentials
```

### Database Setup

```bash
# Run PostgreSQL migrations
npm run migrate

# Seed base data (sports, permissions, roles)
npm run seed
```

### Development

```bash
# Start server
npm run dev
# Server: http://localhost:3000
# Swagger: http://localhost:3000/api-docs
# Socket.IO: ws://localhost:3001
```

## API Endpoints

| Domain | Endpoints |
|--------|-----------|
| Auth | register, login, refresh, logout, profile |
| Organizations | CRUD, members, invitations |
| Sports | CRUD, scoring engines |
| Tournaments | CRUD, fixtures, teams |
| Teams | CRUD, players |
| Players | CRUD, team membership |
| Matches | CRUD, start/end, officials |
| Scoring | events, undo, history, snapshots (Football, Cricket, Basketball) |
| Sync | queue, offline support |
| Standings | calculation, snapshots |
| Notifications | real-time via Socket.IO |
| Overlays | templates, live overlays |
| Visualization | formations, annotations |
| Public | tournaments, matches, scores |

## Architecture

- **Pattern**: Modular Monolith
- **Multi-tenancy**: Single DB with organization_id
- **RBAC**: Dynamic AWS IAM-like system
- **Scoring**: Event-driven with undo/replay
- **Offline**: Idempotency + sync queue

## Environment Variables

```
NODE_ENV=development
PORT=3000
SOCKET_PORT=3001

DATABASE_URL=postgresql://user:password@host:5432/db

JWT_SECRET=your-secret
JWT_REFRESH_SECRET=your-refresh-secret
CLIENT_URL=http://localhost:5173
```

## Deployment (Railway)

This project is designed for Railway.app deployment:

```bash
# Push to GitHub, then connect repo in Railway dashboard
# Railway auto-detects Node.js and runs npm start
# Set environment variables in Railway dashboard
```

The database and app can both run on Railway for minimal latency.

## Socket.IO Events

- `subscribe:match` - Join match room
- `match:score_update` - Live score change
- `match:status_change` - Match started/ended
- `scoring:event_added` - New scoring event
- `notification:new` - Real-time notification

## License

MIT
