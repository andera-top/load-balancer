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

## Features

- **Task routing:** Distributes tasks to available Workers based on group, function, contract, and priority.
- **Queue management:** Uses BullMQ for task queuing, prioritization, and retries.
- **Dashboard:** Real-time web dashboard for monitoring Workers, tasks, and logs.
- **WebSocket:** Real-time updates for slot usage and Worker status.
- **Authentication:** Forwards client authentication headers to Workers; validates requests with its own key.
- **Native logging:** Exposes last 1000 logs via `/logs` (authentication required).

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
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

All configuration for the Load Balancer is managed through the `.env` file.

### Environment Variables

Below are the main environment variables used by the Load Balancer. All variables are set in your `.env` file.

| Variable                    | Description                                                                                 | Default                |
|-----------------------------|---------------------------------------------------------------------------------------------|------------------------|
| `PORT`                      | HTTP port for the Load Balancer API.                                                       | `4000`                 |
| `REDIS_HOST`                | Host for the Redis instance used by BullMQ.                                                | `localhost`            |
| `REDIS_PORT`                | Port for the Redis instance used by BullMQ.                                                | `6379`                 |
| `LB_AUTH_KEY`               | Authentication key for the Load Balancer and Worker communication or to use the endpoints. | `default-lb-auth-key`  |
| `WORKER_DISCOVERY_INTERVAL` | Interval (ms) for polling Workers for status.                                              | `3000`                 |
| `WORKER_DISCOVERY_TIMEOUT`  | Timeout (ms) for Worker discovery requests.                                                | `3000`                 |
| `WORKER_DISCOVERY_RETRIES`  | Number of retries for Worker discovery.                                                    | `10`                   |
| `WS_HEARTBEAT_INTERVAL`     | Interval (ms) for WebSocket heartbeat pings.                                               | `3000`                 |
| `WS_HEARTBEAT_TIMEOUT`      | Timeout (ms) for WebSocket heartbeat.                                                      | `3000`                 |
| `DASHBOARD_ENABLED`         | Enable or disable the dashboard interface on `/dashboard`.                                 | `true`                 |
| `BULL_BOARD_ENABLED`        | Enable or disable the BullMQ dashboard interface on `/bull`.                               | `true`                 |
| `LOG_LEVEL`                 | Log verbosity (`info`, `warn`, `error`, etc.).                                             | `info`                 |
| `MAX_LOGS`                  | Number of log lines to keep in memory (for `/logs`).                                       | `1000`                 |
| `TASK_TIMEOUT`              | Timeout (ms) for task execution.                                                           | `300000`               |
| `TASK_ATTEMPTS`             | Number of attempts for a task before failure.                                              | `3`                    |

### Example `.env`

```env
PORT=4000
REDIS_HOST=localhost
REDIS_PORT=6379
LB_AUTH_KEY=default-lb-auth-key
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
```

For advanced configuration, see the [Load Balancer Configuration Guide](https://andera.top/docs/load-balancer/configuration/).

### Worker List

#### General

- The list of available Workers is managed in the file `workers.json` (at the project root).
- Each entry is a URL (e.g., `http://localhost:3000`) pointing to a Worker instance.
- This file is read at startup and can be hot-reloaded for dynamic cluster management.

```json
[
  "http://localhost:3000"
]
```

:::info
It is strictly recommended to use HTTPS for your Workers **if they are exposed on the Internet** (this is not necessary when using the Load Balancer, which can be the only one exposed). When using HTTP, the Worker connects to the Load Balancer via `ws://`. When using HTTPS, it connects via `wss://`.
:::

#### Docker network

When using Docker on your Mac/Windows machine, your Load Balancer and Workers can communicate using the `host.docker.internal` domain. Example of a `workers.json` file when you're working on your machine:

```json
[
  "http://host.docker.internal:3000"
]
```

This works out of the box, as host.docker.internal is resolved by Docker.

That said, it won't work on a Linux-type production machine, which is why the Load Balancer and Andera Workers use an `andera-net` network. In this configuration, this syntax must be used for production:

```json
[
  "http://service-name:3000"
]
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
npm start
```

### Docker setup

You should use Docker Compose to run the Load Balancer together with Redis and enable hot-reload of the `Workers.json` file.

#### Create a Docker network for Andera

```sh
docker network create andera-net
```

#### Build the Docker image

```sh
docker-compose build
```

#### Run the stack (Load Balancer + Redis)

```sh
docker-compose up
```

This will start both Redis and the Load Balancer, and automatically mount your local `Workers.json` file into the container for live updates.

> **Do not use `docker run` directly.** The recommended way is to use `docker-compose up` to ensure all dependencies and configuration are handled correctly.

### Access the Dashboard

Visit [http://localhost:4000/dashboard](http://localhost:4000/dashboard)

---

## Endpoints

- `POST /task` — Receives tasks for routing to Workers
- `GET /health` — Public status info; more details with authentication
- `GET /logs` — Last 1000 log lines (authentication required)
- `GET /dashboard` — Web dashboard (optional, enable in config)
- `GET /bull` — BullMQ dashboard (optional, enable in config)

See [API Reference](https://andera.top/docs/load-balancer/usage/) for details.

---

## Testing your Load Balancer

After installation and configuration, you can test your Load Balancer as follows:

### 1. Health Check

Make sure your Load Balancer is running (default port: 4000):

```bash
npm start
```

Or, if using Docker:
```bash
docker network create andera-net
docker-compose build
docker-compose up
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

Andera is open source and community-driven!
See [CONTRIBUTING.md](CONTRIBUTING.md) for repository guidelines, and [How to Contribute](https://andera.top/docs/contribute) for the project's philosophy and license.

---

## License

For license details, see the [LICENSE](LICENSE) file.