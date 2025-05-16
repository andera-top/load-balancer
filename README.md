<p align="center">
  <img src="https://andera.top/img/github.png" alt="Andera" style="max-width: 100%; height: auto;"/>
</p>

# Andera Load Balancer

**Andera** is a high-performance, open-source Task Orchestration Platform (TOP) designed for simplicity, flexibility, and scalability.

---

## What is Andera?

Andera is composed of three main components:
- **Load Balancer:** Routes and prioritizes tasks, manages worker clusters, and provides a dashboard for monitoring.
- **Base Worker:** Template for building your own custom workers.
- **Worker Core:** The core engine for all workers.

Learn more: [Andera Documentation](https://andera.top/docs/)

---

## About Load Balancer

The Load Balancer is the entrypoint and orchestrator for the Andera platform. It routes tasks to available workers, manages clusters, handles priorities and contracts, and provides a real-time dashboard for monitoring.

---

## Features

- **Task routing:** Distributes tasks to available workers based on group, function, contract, and priority.
- **Queue management:** Uses BullMQ for task queuing, prioritization, and retries.
- **Dashboard:** Real-time web dashboard for monitoring workers, tasks, and logs.
- **WebSocket:** Real-time updates for slot usage and worker status.
- **Authentication:** Forwards client authentication headers to workers; validates requests with its own key.
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

- All environment variables are documented in `.env.example`.
- For advanced configuration, see the [Load Balancer Configuration Guide](https://andera.top/docs/load-balancer/configuration/).

---

## Usage

### Run in Development

```sh
npm run dev
```

### Build & Run in Production

```sh
npm run build
npm start
```

### Run with Docker

You should use Docker Compose to run the Load Balancer together with Redis and enable hot-reload of the `workers.json` file.

### Build the Docker image

```sh
docker-compose build
```

### Run the stack (Load Balancer + Redis)

```sh
docker-compose up
```

This will start both Redis and the Load Balancer, and automatically mount your local `workers.json` file into the container for live updates.

> **Do not use `docker run` directly.** The recommended way is to use `docker-compose up` to ensure all dependencies and configuration are handled correctly.

### Access the Dashboard

Visit [http://localhost:4000/dashboard](http://localhost:4000/dashboard)

---

## Endpoints

- `POST /task` — Receives tasks for routing to workers
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
docker run --env-file .env -p 4000:4000 andera-load-balancer
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