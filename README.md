<p align="center">
  <img src="https://andera.top/img/github.png" alt="Andera" style="max-width: 100%; height: auto;"/>
</p>

# Andera Load Balancer

**Andera** is a high-performance, open-source Task Orchestration Platform (TOP) designed for simplicity, flexibility, and scalability.

---

## What is Andera?

Andera is composed of three main components:
- **Load Balancer:** Routes and prioritizes tasks, manages Worker clusters, and provides a dashboard for monitoring.
- **Base Worker:** Template for building your own custom Workers.
- **Worker Core:** The core engine for all Workers.

Learn more: [Andera Documentation](https://andera.top/docs/)

---

## About Load Balancer

The Load Balancer is the entrypoint and orchestrator for the Andera platform. It routes tasks to available Workers, manages clusters, handles priorities and contracts, and provides a real-time dashboard for monitoring.

---

## Task timeouts

The LB does not automatically retry Worker HTTP 504 responses, upstream request timeouts, or jobs whose caller deadline has expired; these return HTTP 500. Worker rejections (HTTP 4xx except 408 and 429) and webhook delivery failures (`code: "WEBHOOK_FAILED"`, the function already ran) are not retried either: the caller receives the Worker's status and error message. Other failures still follow `TASK_ATTEMPTS`. Worker credentials and webhook headers stay in LB memory and never enter Redis or Bull Board; task inputs do.

In webhook mode the LB answers immediately and the Worker posts the result to the webhook. If the task fails instead, the LB posts `{ "success": false, "error": "...", "code": "..." }` to the same URL with the caller's webhook headers and an `X-Andera-Status: failed` header, so receivers can tell it apart from a result. The code is `WORKER_REJECTED` (the Worker refused the task, e.g. invalid input), `WEBHOOK_FAILED` (the function ran but the Worker could not deliver its result), `TASK_TIMEOUT` or `TASK_FAILED`. The notice does not carry the Worker's `WEBHOOK_HEADERS`. A Worker that finishes after `TASK_TIMEOUT` may still deliver its result after the timeout notice, and tasks lost in an LB restart are not reported.

Worker Core's function deadline triggers cooperative cancellation through `context.signal`. The Worker retains its slot until the handler actually settles; inspect authenticated **Worker** `/health` at `executions.timedOutRunning` for lingering calls. An LB/client timeout or disconnection does not propagate a cancellation request to the Worker. Configure the LB deadline to allow for queueing and the Worker's execution deadline. Completed external side effects are not undone.

## Features

- **MCP (optional):** Exposes selected functions from your Workers to AI agents.
- **Task routing:** Distributes tasks to available Workers based on group, function, contract, and priority.
- **Queue management:** Uses BullMQ for task queuing, prioritization, and retries.
- **Dashboard:** Real-time web dashboard for monitoring Workers, tasks, and logs.
- **WebSocket:** Real-time updates for slot usage and Worker status.
- **Authentication:** Forwards client authentication headers to Workers; validates requests with its own key.
- **Native logging:** Exposes recent logs, bounded by `MAX_LOGS`, via `/logs` (authentication required).

> **Queue process boundary:** Run one active Load Balancer process per Redis queue. BullMQ stores jobs in Redis, while the waiting HTTP response and Worker credential remain in that LB process. Requests cannot resume on another LB replica or after a restart; orphaned jobs fail visibly instead of being reported as successful.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (Node 24 LTS recommended; supported: 22.23.4+, 24.22.1+ or 26.12.1+, which include the October 2026 security fixes; Docker uses Node 24.22.1)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
- [Docker](https://www.docker.com/) (optional)

### Installation

```sh
git clone <your-fork-or-repo-url>
cd load-balancer
cp .env.example .env
npm install
```

Then set `LB_AUTH_KEY` in `.env` (for example `openssl rand -hex 32`). Every Worker behind this LB must use the same `LB_AUTH_KEY`; the LB fails to start without it.

---

## Configuration

Runtime settings and secrets come from the environment, loaded from `.env` at startup. Worker URLs live in `workers.json`; MCP targets and function allowlists live in `mcp.json`. Both JSON configurations support live reload.

### Environment Variables

Below are the main environment variables used by the Load Balancer. All variables are set in your `.env` file.

| Variable                    | Description                                                                                | Default  |
| --------------------------- | ------------------------------------------------------------------------------------------ | -------- |
| `PORT`                      | HTTP port for the Load Balancer API.                                                       | `4000`   |
| `REDIS_HOST`                | Host for the Redis instance used by BullMQ.                                                | `localhost` |
| `REDIS_PORT`                | Port for the Redis instance used by BullMQ.                                                | `6379`   |
| `LB_AUTH_KEY`               | Key for LB endpoints and LB-to-Worker calls; must equal `LB_AUTH_KEY` on every Worker. Use hex: it is also sent as a WebSocket subprotocol. | Required |
| `WORKER_DISCOVERY_INTERVAL` | Interval (ms) for polling Workers for status. | `1000` |
| `WORKER_DISCOVERY_TIMEOUT`  | Timeout (ms) for Worker discovery requests.                                                | `3000`   |
| `WORKER_DISCOVERY_RETRIES`  | Number of retries for Worker discovery.                                                    | `10`     |
| `WS_HEARTBEAT_INTERVAL`     | Interval (ms) for WebSocket heartbeat pings.                                               | `3000`   |
| `WS_HEARTBEAT_TIMEOUT`      | Timeout (ms) for WebSocket heartbeat.                                                      | `3000`   |
| `DASHBOARD_ENABLED`         | Enable or disable the dashboard interface on `/dashboard`.                                 | `false`  |
| `BULL_BOARD_ENABLED`        | Enable or disable the BullMQ dashboard interface on `/bull`.                               | `false`  |
| `LOG_LEVEL`                 | Log verbosity: `debug`, `info`, `warn` or `error`.                                         | `info`   |
| `MAX_LOGS`                  | Number of log lines to keep in memory (for `/logs`).                                       | `1000`   |
| `TASK_TIMEOUT`              | Timeout (ms) for task execution.                                                           | `300000` |
| `TASK_ATTEMPTS`             | Number of attempts for a task before failure.                                              | `3`      |
| `REQUEST_BODY_LIMIT`        | Maximum size of request body (supports kb, mb, gb units).                                  | `10mb`   |
| `MCP_AUTH_KEY` | Dedicated agent token distinct from internal and target keys. | Empty: disabled |
| `MCP_CONFIG_PATH` | MCP configuration path relative to the application root, or absolute. | `mcp.json` |
| `MCP_ALLOWED_ORIGINS` | Comma-separated exact browser origins; native clients need none. | Empty |
| `WORKERS_CONFIG_PATH` | Override for the Worker URL-list file, relative to the working directory or absolute. | Application-root `workers.json` |

The table lists runtime defaults. The sample `.env` uses Docker's `redis` hostname, a 3000ms discovery interval, and enables the optional dashboards. For local Redis outside Docker, set `REDIS_HOST=localhost`.

### Example `.env`

```env
PORT=4000
REDIS_HOST=redis
REDIS_PORT=6379
LB_AUTH_KEY=<random-key>
WORKER_DISCOVERY_INTERVAL=3000
WORKER_DISCOVERY_TIMEOUT=3000
WORKER_DISCOVERY_RETRIES=10
WS_HEARTBEAT_INTERVAL=3000
WS_HEARTBEAT_TIMEOUT=3000
DASHBOARD_ENABLED=true
BULL_BOARD_ENABLED=true
LOG_LEVEL=info
MAX_LOGS=1000
TASK_TIMEOUT=300000
TASK_ATTEMPTS=3
REQUEST_BODY_LIMIT=10mb
```

For advanced configuration, see the [Load Balancer Configuration Guide](https://andera.top/docs/load-balancer/configuration/).

### Worker List

#### General

- The list of available Workers is managed in the file `workers.json` (at the project root).
- Each entry is a URL (e.g., `http://localhost:3000`) pointing to a Worker instance.
- This file is read at startup and can be hot-reloaded for dynamic cluster management. An invalid or deleted file keeps the last valid list; write `[]` to remove all Workers.
- When the LB runs in Docker, `localhost` is the LB container itself: use the Docker network names below.

```json
["http://localhost:3000"]
```

> **Note:** It is strictly recommended to use HTTPS for your Workers **if they are exposed on the Internet** (this is not necessary when using the Load Balancer, which can be the only one exposed). The LB connects to the Worker WebSocket port using `ws://` for HTTP Worker URLs and `wss://` for HTTPS URLs. HTTPS deployments must also terminate TLS on the advertised WebSocket port.

#### Docker network

When using Docker on your Mac/Windows machine, your Load Balancer and Workers can communicate using the `host.docker.internal` domain. Example of a `workers.json` file when you're working on your machine:

```json
["http://host.docker.internal:3000"]
```

This works out of the box, as host.docker.internal is resolved by Docker.

That said, it won't work on a Linux-type production machine, which is why the Load Balancer and Andera Workers use an `andera-net` network. In this configuration, this syntax must be used for production:

```json
["http://service-name:3000"]
```

Where `service-name` is the Docker Compose service name.

---

## Usage

### Manual setup

#### Run the application

```sh
npm run dev
```

#### Build & Run in Production

```sh
npm run build
node dist/app.js
```

### Docker setup

You should use Docker Compose to run the Load Balancer together with Redis and enable hot-reload of the `workers.json` file.

#### Create a Docker network for Andera

```sh
docker network create andera-net
```

#### Build the Docker image

```sh
docker compose build
```

#### Run the stack (Load Balancer + Redis)

```sh
docker compose up
```

This will start both Redis and the Load Balancer, and mount your local `workers.json` file read-only into the container for live updates. The mount targets a single file: editors that save by replacing the file (atomic save) leave the container on the old version, so edit it in place or restart the LB.

> **Do not use `docker run` directly.** The recommended way is to use `docker compose up` to ensure all dependencies and configuration are handled correctly.

### Access the Dashboard

Visit [http://localhost:4000/dashboard](http://localhost:4000/dashboard) when enabled. Dashboard (`/dashboard` and its `/dashboard/api/*` routes, which include Worker URLs and logs) and Bull (`/bull`, job data and actions) have no built-in login: protect them at the reverse proxy, or keep them disabled. The MCP panel does not request a token and displays only its operational summary.

---

## Endpoints

- `POST /mcp` — Optional MCP discovery and tool calls with `MCP_AUTH_KEY`
- `POST /task` — Receives tasks for routing to Workers
- `GET /health` — Public status info; more details with authentication
- `GET /logs` — Recent log lines, bounded by `MAX_LOGS` (authentication required)
- `GET /dashboard` — Web dashboard (optional, enable in config)
- `GET /bull` — BullMQ dashboard (optional, enable in config)

See [API Reference](https://andera.top/docs/load-balancer/usage/) for details.

---

## Testing your Load Balancer

Run `npm test` for the automated protocol, security and LB/Redis integration tests; the integration test is skipped when `redis-server` is not installed locally.

After installation and configuration, you can test your Load Balancer as follows:

### 1. Health Check

Make sure your Load Balancer is running (default port: 4000):

```bash
npm run build
node dist/app.js
```

Or, if using Docker:

```bash
docker network create andera-net
docker compose build
docker compose up
```

Test the health endpoint:

```bash
curl http://localhost:4000/health
```

Expected response:

```json
{
  "status": "ready"
}
```

### 2. Submit a Task

Call the `/task` endpoint to route a task to a connected Worker. You must specify the `group`, `contract`, and `function` fields, and provide two headers:

- `Authorization: <LB_AUTH_KEY>` (your Load Balancer's LB_AUTH_KEY)
- `x-wr-auth: <AUTH_KEY>` (the target Worker's AUTH_KEY)

```bash
curl -X POST http://localhost:4000/task \
  -H "Content-Type: application/json" \
  -H "Authorization: <LB_AUTH_KEY>" \
  -H "x-wr-auth: <AUTH_KEY>" \
  -d '{
    "function": "hello",
    "input": { "name": "Andera" },
    "contract": 1,
    "group": "default"
  }'
```

Expected response:

```json
{
  "success": true,
  "result": {
    "message": "Hello Andera!"
  }
}
```

For more details, see the [Testing Guide](https://andera.top/docs/load-balancer/test/).

---

## Deployment

- [Deployment Guide](https://andera.top/docs/load-balancer/deployment/)
- Supports local, Docker, and cloud deployment.

---

## MCP (optional)

The [Model Context Protocol](https://modelcontextprotocol.io) (MCP) is the standard way for AI agents such as Claude, Cursor or VS Code to discover and call tools. The Load Balancer can expose functions from all your Workers as MCP tools at a single `/mcp` endpoint. Agents configure one URL and one bearer token; their calls go through the usual queue and reach Workers over REST, so Workers do not need MCP enabled.

To enable it:

1. Set `MCP_AUTH_KEY` to a dedicated random token, different from `LB_AUTH_KEY`.
2. Copy `mcp.example.json` to `mcp.json`. Each target names a group and contract, the functions to expose (omit `functions` for all of them), and in `workerAuthKeyEnv` the environment variable that holds those Workers' `AUTH_KEY`. Replicas of a group/contract must share that key.
3. Set those variables and restart the Load Balancer.

`mcp.json` reloads without a restart: invalid edits keep the last valid configuration, and removing the file disables MCP. With Docker, `docker-compose.mcp.yml` mounts `.mcp/mcp.json` through a directory so atomic saves from editors are picked up.

Good to know:

- Calls are synchronous, wait up to `TASK_TIMEOUT` (default 300s) and are not retried. Many MCP clients give up after 60s; the Worker then finishes the call but the result is discarded.
- The endpoint uses stateless Streamable HTTP with bearer authentication. OAuth is not implemented, so clients that require it, such as ChatGPT on the web, are not supported.
- Authenticated `/health` shows the full MCP status, tool names, input schemas and configuration errors. The dashboard shows only a summary and no credentials.

Setup and client configuration: [Load Balancer MCP documentation](https://andera.top/docs/load-balancer/mcp).

---

## Useful Links

- [Andera Documentation](https://andera.top/docs/)
- [Load Balancer Reference](https://andera.top/docs/load-balancer/)

---

## Contributing

Andera makes its source available and welcomes community contributions.
See [CONTRIBUTING.md](CONTRIBUTING.md) for repository guidelines, and [How to Contribute](https://andera.top/docs/contribute) for the project's philosophy and license.

---

## License

For license details, see the [LICENCE](LICENCE) file.
