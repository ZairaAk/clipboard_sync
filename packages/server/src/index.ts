import { startServer } from "./server";
import { DEFAULT_HOST, DEFAULT_PORT } from "./config";

// Boot the server using the configured port.
const port = Number(process.env.PORT) || DEFAULT_PORT;
const host = process.env.HOST || DEFAULT_HOST;

startServer(port, host)
  .then(({ port: boundPort }) => {
    console.log(`[server] WebSocket server listening on ${host}:${boundPort}`);
  })
  .catch((error) => {
    console.error("[server] failed to start", error);
    process.exit(1);
  });
