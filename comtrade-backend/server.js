import { createApp, loadConfig } from "./src/app.js";

const config = loadConfig();
const app = createApp({ config });
const server = app.listen(config.port, config.host, () => {
  console.log(`UN Comtrade proxy is listening on ${config.host}:${config.port}`);
});

function shutdown(signal) {
  console.log(`${signal}: finishing active requests`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
