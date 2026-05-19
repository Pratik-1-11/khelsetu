# KhelSetu Backend

Production-grade realtime multi-tenant sports tournament management platform for Nepal.

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: MySQL 8.0
- **Real-time**: Socket.IO
- **Auth**: JWT with refresh tokens
- **API Docs**: Swagger/OpenAPI

## Quick Start

### Prerequisites
- Node.js 18+
- MySQL 8.0

### Installation

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your MySQL credentials
```

### Database Setup

```bash
# Run migrations
npm run migrate

# Seed base data (sports, permissions, roles)
npm run seed
```

### Development

```bash
# Start server
npm start
# Server: http://localhost:3000
# Swagger: http://localhost:3000/api-docs
# Socket.IO: ws://localhost:3001
```

### Docker

```bash
# Start with MySQL
docker-compose up --build
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
| Scoring | events, undo, history, snapshots |
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

MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=password
MYSQL_DATABASE=khelsetu

JWT_SECRET=your-secret
JWT_REFRESH_SECRET=your-refresh-secret
```

## Deployment

### Vercel
```bash
vercel deploy
```

### Docker
```bash
docker build -t khelsetu-backend .
docker run -p 3000:3000 khelsetu-backend
```

## Socket.IO Events

- `subscribe:match` - Join match room
- `match:score_update` - Live score change
- `match:status_change` - Match started/ended
- `scoring:event_added` - New scoring event
- `notification:new` - Real-time notification

## License

MIT