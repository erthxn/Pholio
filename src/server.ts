import http from "node:http";

/**
 * Exists only to satisfy Render's free-tier "Web Service" requirement
 * (bind to $PORT, respond to HTTP) and give UptimeRobot something to ping
 * so the instance doesn't spin down from inactivity. Unrelated to the
 * actual iMessage logic, which runs through Photon's Spectrum stream.
 */
export function startHealthServer() {
  const port = Number(process.env.PORT) || 3000;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Pholio is alive.");
  });
  server.listen(port, () => {
    console.log(`Health server listening on port ${port}`);
  });
  return server;
}
