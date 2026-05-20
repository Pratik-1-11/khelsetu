import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import env from '../core/env.js';
import logger from '../core/logger/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openApiDoc = {
  openapi: '3.0.3',
  info: {
    title: env.swagger.title,
    version: env.swagger.version,
    description: `# KhelSetu API Documentation

## Platform Overview

KhelSetu is a multi-tenant sports tournament management platform with **two distinct portals**:

### 🌐 Public Portal (No Login Required)
The public portal is for **viewers and fans** who want to watch live matches, browse tournaments, and view standings. These endpoints are **completely open** — no authentication needed.

- **Live match scores** — Real-time scores for any match
- **Tournament browsing** — View all public tournaments
- **Standings & fixtures** — League tables and match schedules
- **Team & player profiles** — Roster and player information
- **Global search** — Search across tournaments, teams, and players

### 🔒 SaaS Dashboard (Login Required)
The dashboard is for **organization members** (admins, scorers, coaches) who manage tournaments, teams, players, and live scoring. **All dashboard endpoints require JWT authentication** and **organization membership**.

- **Organization management** — Create/manage organizations, invite members
- **Tournament management** — Create tournaments, generate fixtures
- **Team & player management** — Roster management, player profiles
- **Live scoring** — Real-time event-driven scoring (Football, Cricket, Basketball)
- **Standings** — Auto-calculated league tables
- **RBAC** — Role-based access control (owner, admin, scorer, coach, viewer)
- **Billing** — Subscription and payment management
- **Analytics & Audit** — Usage analytics and audit logs

### 🔑 Authentication Flow

1. **Register** → \`POST /api/auth/register\` (dashboard user) or \`POST /api/public/users/register\` (public user)
2. **Login** → \`POST /api/auth/login\` → Returns JWT access token (15min) + refresh token (7d)
3. **Use Token** → Pass as \`Authorization: Bearer <token>\` header for all dashboard endpoints
4. **Refresh** → \`POST /api/auth/refresh\` → Get new access token when expired

### 🏢 Multi-Tenant Architecture

Every organization (tenant) is **isolated**. A user must be a **member of an organization** to access its resources.

- **Tenant Resolution**: Pass \`x-organization-id\` header, or include \`organization_id\` in request body/query
- **Access Control**: If you're not a member of the organization → \`403 Forbidden\`
- **Staff Roles**: Tenant admin assigns roles (admin, tournament_admin, scorer, coach, viewer) with specific permissions

### 🆓 Free Tier Limits

| Resource | Free | Starter | Professional | Enterprise |
|----------|------|---------|--------------|------------|
| Tournaments per org | 5 | 20 | 100 | Unlimited |
| Teams per org | 10 | 50 | 200 | Unlimited |
| Players per org | 50 | 200 | 1000 | Unlimited |
| Matches per org | 100 | 500 | 2000 | Unlimited |

**Public users** get **5 free matches** lifetime. On first match, a personal organization is auto-created.

---

## API Sections

| Section | Auth Required | Description |
|---------|--------------|-------------|
| **Public Portal** | No | Live scores, tournament browsing, standings, search |
| **Authentication** | No | Register, login, refresh tokens |
| **Dashboard: Organizations** | Yes | Org CRUD, members, invitations |
| **Dashboard: Tournaments** | Yes | Tournament CRUD, fixtures, progression |
| **Dashboard: Teams & Players** | Yes | Team/player management |
| **Dashboard: Matches** | Yes | Match lifecycle, officials |
| **Dashboard: Scoring** | Yes | Live scoring (Football, Cricket, Basketball) |
| **Dashboard: Standings** | Yes | League tables, snapshots |
| **Dashboard: RBAC** | Yes | Roles, permissions, staff management |
| **Dashboard: Billing** | Yes | Plans, subscriptions, invoices |
| **Dashboard: Analytics & Audit** | Yes | Usage analytics, audit logs |
| **Dashboard: Overlays & Visualization** | Yes | Broadcast overlays, tactical boards |
| **Dashboard: Sync** | Yes | Offline sync queue |
`,
    contact: {
      name: 'KhelSetu Support',
      email: 'support@khelsetu.com'
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT'
    }
  },
  paths: {},
  servers: [
    {
      url: `http://localhost:${env.port}`,
      description: 'Local development server'
    },
    {
      url: env.client.apiUrl,
      description: 'Production server'
    }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT access token. Get it from POST /api/auth/login. Pass as: Authorization: Bearer <token>'
      }
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string', example: 'Validation failed' }
            }
          }
        }
      },
      SuccessResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'object' }
        }
      },
      PaginationParams: {
        type: 'object',
        properties: {
          page: { type: 'integer', example: 1, description: 'Page number' },
          limit: { type: 'integer', example: 20, description: 'Items per page' },
          sort: { type: 'string', example: 'created_at', description: 'Sort field' },
          order: { type: 'string', example: 'DESC', enum: ['ASC', 'DESC'] }
        }
      },
      PaginatedResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'array', items: { type: 'object' } },
          pagination: {
            type: 'object',
            properties: {
              page: { type: 'integer' },
              limit: { type: 'integer' },
              total: { type: 'integer' },
              totalPages: { type: 'integer' }
            }
          }
        }
      },
      BasketballGameState: {
        type: 'object',
        properties: {
          match: { type: 'object' },
          possession: {
            type: 'object',
            properties: {
              current_possession_team_id: { type: 'string' },
              possession_arrow_team_id: { type: 'string' }
            }
          },
          fouls: { type: 'array' },
          stats: { type: 'object' },
          periods: { type: 'array' },
          shotClock: { type: 'integer' },
          gameClock: { type: 'integer' },
          quarter: { type: 'integer' },
          overtimeCount: { type: 'integer' }
        }
      },
      BasketballScore: {
        type: 'object',
        properties: {
          home: { type: 'integer', example: 98 },
          away: { type: 'integer', example: 95 }
        }
      },
      BasketballStats: {
        type: 'object',
        properties: {
          playerStats: { type: 'array' },
          teamStats: { type: 'array' }
        }
      },
      PossessionState: {
        type: 'object',
        properties: {
          current_possession_team_id: { type: 'string' },
          possession_arrow_team_id: { type: 'string' },
          last_possession_event_id: { type: 'string' }
        }
      },
      TeamFoulStatus: {
        type: 'object',
        properties: {
          byQuarter: { type: 'object' },
          total: { type: 'integer' },
          bonus_status: { type: 'string', enum: ['none', 'bonus', 'double_bonus'] }
        }
      }
    },
    responses: {
      BadRequest: {
        description: 'Bad Request',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' }
          }
        }
      },
      Unauthorized: {
        description: 'Unauthorized — Invalid or missing JWT token',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' }
          }
        }
      },
      Forbidden: {
        description: 'Forbidden — You are not a member of this organization or lack required permission',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' }
          }
        }
      },
      NotFound: {
        description: 'Not Found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' }
          }
        }
      },
      InternalError: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' }
          }
        }
      }
    }
  },
  security: [{ bearerAuth: [] }],
  tags: [
    {
      name: '🌐 Public Portal',
      description: '🔓 **No login required.** Live scores, tournament browsing, standings, team/player profiles, and search. For viewers and fans.'
    },
    {
      name: '🔑 Authentication',
      description: '🔓 **No login required.** Register, login, refresh tokens. Used by both public and dashboard users.'
    },
    {
      name: '🏢 Organizations',
      description: '🔒 **Login + org membership required.** Create/manage organizations, invite members, manage roles. Only for org owners and admins.'
    },
    {
      name: '🏆 Tournaments',
      description: '🔒 **Login + org membership required.** Create tournaments, generate fixtures (league/knockout), manage progression.'
    },
    {
      name: '👥 Teams',
      description: '🔒 **Login + org membership required.** Create/manage teams, team registrations for tournaments.'
    },
    {
      name: '🏃 Players',
      description: '🔒 **Login + org membership required.** Create/manage players, assign to teams.'
    },
    {
      name: '⚽ Matches',
      description: '🔒 **Login + org membership required.** Match lifecycle (scheduled → live → completed), officials, lineups.'
    },
    {
      name: '📊 Scoring',
      description: '🔒 **Login + match:score permission required.** Event-driven live scoring. Supports Football, Cricket, Basketball. Undo/reverse events, deterministic replay.'
    },
    {
      name: '🏅 Standings',
      description: '🔒 **Login + org membership required.** Auto-calculated league tables, head-to-head, snapshots.'
    },
    {
      name: '🛡️ RBAC',
      description: '🔒 **Login + rbac:manage permission required.** Roles, permissions, staff assignment. Tenant admin creates staff with specific roles and permissions.'
    },
    {
      name: '💳 Billing',
      description: '🔒 **Login + org admin required.** Plans, subscriptions, invoices, payment methods. Free tier: 5 tournaments per org.'
    },
    {
      name: '📈 Analytics',
      description: '🔒 **Login + analytics:view permission required.** Usage analytics, event tracking.'
    },
    {
      name: '📋 Audit',
      description: '🔒 **Login + audit:view permission required.** Audit logs for all actions.'
    },
    {
      name: '📺 Overlays',
      description: '🔒 **Login + org membership required.** Broadcast overlay templates, live overlays for OBS/web.'
    },
    {
      name: '📐 Visualization',
      description: '🔒 **Login + org membership required.** Tactical formations, annotations.'
    },
    {
      name: '🔄 Sync',
      description: '🔒 **Login + org membership required.** Offline sync queue, device tracking, conflict resolution.'
    },
    {
      name: '🏏 Cricket Scoring',
      description: '🔒 **Login + match:score permission required.** Ball-by-ball scoring, innings, DRS, DLS, super overs, powerplays.'
    },
    {
      name: '🏀 Basketball Scoring',
      description: '🔒 **Login + match:score permission required.** Possession tracking, shot clock, fouls, free throws, timeouts, jump balls.'
    }
  ]
};

export const addRoute = (path, method, operation) => {
  let pathKey = path.startsWith('/') ? path : `/${path}`;
  if (!pathKey.startsWith('/api')) {
    pathKey = `/api${pathKey}`;
  }
  if (!openApiDoc.paths[pathKey]) {
    openApiDoc.paths[pathKey] = {};
  }
  openApiDoc.paths[pathKey][method.toLowerCase()] = operation;
};

export const addSchema = (name, schema) => {
  openApiDoc.components.schemas[name] = schema;
};

const swaggerSetup = (app) => {
  const yamlContent = YAML.stringify(openApiDoc);

  try {
    const docsPath = path.join(__dirname, '../docs/openapi.yaml');
    fs.writeFileSync(docsPath, yamlContent);
    logger.info('OpenAPI documentation generated');
  } catch (err) {
    logger.warn('Could not write OpenAPI file (read-only filesystem)', { error: err.message });
  }

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDoc, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: env.swagger.title,
    customfavIcon: '/favicon.ico',
    customCssUrl: '',
  }));

  app.get('/api-docs.json', (req, res) => {
    res.json(openApiDoc);
  });

  app.get('/api-docs.yaml', (req, res) => {
    res.set('Content-Type', 'text/yaml');
    res.send(yamlContent);
  });
};

export default swaggerSetup;
export { openApiDoc };
