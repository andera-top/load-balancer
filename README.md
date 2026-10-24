<p align="center">
  <img src="https://andera.top/img/github.png" alt="Andera" style="max-width: 100%; height: auto;"/>
</p>

# Andera Load Balancer

**Andera** is a source-available platform for exposing business functions as REST APIs and MCP tools for AI agents. Run a Worker directly or use the Load Balancer to route tasks across Workers; agents connect through one `/mcp` endpoint and one dedicated token.

---

## Native MCP

Expose selected functions to agents at `/mcp` without another service. Set a distinct `MCP_AUTH_KEY`, copy `mcp.example.json` to `mcp.json`, and set the environment variables referenced by each target's `workerAuthKeyEnv`. Agents configure only the endpoint URL and the MCP bearer token.

The configuration reloads live. Omit `functions` for all functions within a target; use an explicit list to restrict access. Missing configuration or token disables MCP. Invalid edits keep the last valid configuration; removing the file disables new access.

The LB uses existing Worker REST endpoints and internal credentials. Workers do not need MCP enabled. Replicas of a group/contract must share the configured key. The optional `docker-compose.mcp.yml` mounts `.mcp/mcp.json` through a directory for atomic-save support.

Authenticated `/health` shows the full MCP status, target selection, exact tool names, input schemas and sanitized reload errors. The dashboard asks for no token and shows only the endpoint, enabled state, tool titles and availability.

V1 supports stateless Streamable HTTP and synchronous calls. It does not implement OAuth; ChatGPT web compatibility is therefore not promised. See [MCP documentation](https://andera.top/docs/mcp).

Run `npm test` for protocol/security tests and the LB/Redis integration test (requires local `redis-server`).

---

## What is Andera?

Andera is composed of three main components:

- **Load Balancer:** Routes tasks, monitors Workers, and exposes functions across groups/contracts through one MCP endpoint.
- **Base Worker:** Template for building your own custom Workers.
- **Worker Core:** The core engine for all Workers.

Learn more: [Andera Documentation](https://andera.top/docs/)

---

## About Load Balancer

The Load Balancer is the entrypoint and orchestrator for the Andera platform. It routes tasks to available Workers, manages clusters, handles priorities and contracts, and provides a real-time dashboard for monitoring.

---

## Task timeouts

The LB does not automatically retry Worker HTTP 504 responses, upstream request timeouts, or jobs whose caller deadline has expired. Other failures still follow `TASK_ATTEMPTS`. The LB response remains its sanitized task error; no upstream request credentials enter Redis errors.

Worker Core's function deadline triggers cooperative cancellation through `context.signal`. The Worker retains its slot until the handler actually settles; inspect authenticated **Worker** `/health` at `executions.timedOutRunning` for lingering calls. An LB/client timeout or disconnection does not propagate a cancellation request to the Worker. Configure the LB deadline to allow for queueing and the Worker's execution deadline. Completed external side effects are not undone.

## Features

- **MCP tools:** One endpoint and agent token for selected functions across Worker groups/contracts.
- **Task routing:** Distributes tasks to available Workers based on group, function, contract, and priority.
- **Queue management:** Uses BullMQ for task queuing, prioritization, and retries.
- **Dashboard:** Real-time web dashboard for monitoring Workers, tasks, and logs.
- **WebSocket:** Real-time updates for slot usage and Worker status.
- **Authentication:** Forwards client authentication headers to Workers; validates requests with its own key.
- **Native logging:** Exposes last 1000 logs via `/logs` (authentication required).

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
| `LB_AUTH_KEY`               | Authentication key for the Load Balancer and Worker communication or to use the endpoints. | Required |
| `WORKER_DISCOVERY_INTERVAL` | Interval (ms) for polling Workers for status. | `1000` |
| `WORKER_DISCOVERY_TIMEOUT`  | Timeout (ms) for Worker discovery requests.                                                | `3000`   |
| `WORKER_DISCOVERY_RETRIES`  | Number of retries for Worker discovery.                                                    | `10`     |
| `WS_HEARTBEAT_INTERVAL`     | Interval (ms) for WebSocket heartbeat pings.                                               | `3000`   |
| `WS_HEARTBEAT_TIMEOUT`      | Timeout (ms) for WebSocket heartbeat.                                                      | `3000`   |
| `DASHBOARD_ENABLED`         | Enable or disable the dashboard interface on `/dashboard`.                                 | `false`  |
| `BULL_BOARD_ENABLED`        | Enable or disable the BullMQ dashboard interface on `/bull`.                               | `false`  |
| `LOG_LEVEL`                 | Log verbosity (`info`, `warn`, `error`, etc.).                                             | `info`   |
| `MAX_LOGS`                  | Number of log lines to keep in memory (for `/logs`).                                       | `1000`   |
| `TASK_TIMEOUT`              | Timeout (ms) for task execution.                                                           | `300000` |
| `TASK_ATTEMPTS`             | Number of attempts for a task before failure.                                              | `3`      |
| `REQUEST_BODY_LIMIT`        | Maximum size of request body (supports kb, mb, gb units).                                  | `10mb`   |
| `MCP_AUTH_KEY` | Dedicated agent token distinct from internal and target keys. | Empty: disabled |
| `MCP_CONFIG_PATH` | MCP configuration path relative to the application root, or absolute. | `mcp.json` |
| `MCP_ALLOWED_ORIGINS` | Comma-separated exact browser origins; native clients need none. | Empty |
| `WORKERS_CONFIG_PATH` | Override for the Worker URL-list file. | Application-root `workers.json` |

The table lists runtime defaults. The sample `.env` uses Docker's `redis` hostname, a 3000 ms discovery interval, and enables the optional dashboards. For local Redis outside Docker, set `REDIS_HOST=localhost`.

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
- This file is read at startup and can be hot-reloaded for dynamic cluster management.

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

This will start both Redis and the Load Balancer, and automatically mount your local `workers.json` file into the container for live updates.

> **Do not use `docker run` directly.** The recommended way is to use `docker compose up` to ensure all dependencies and configuration are handled correctly.

### Access the Dashboard

Visit [http://localhost:4000/dashboard](http://localhost:4000/dashboard) when enabled. Dashboard and Bull routes have no built-in login: protect them at the reverse proxy. The MCP panel does not request a token and displays only its operational summary.

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
