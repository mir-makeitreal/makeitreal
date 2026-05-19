import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, stat, mkdir, writeFile, unlink } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "dist");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

// ── RFC 6455 WebSocket helpers ──

const WS_GUID = "258EAFA5-E914-47DA-95CA-5AB5-441BF4863D64";
function wsAcceptKey(key) {
  return createHash("sha1").update(key + WS_GUID).digest("base64");
}

function encodeWsFrame(data) {
  const payload = Buffer.from(data, "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text opcode
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeWsFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let payloadLen = buffer[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  if (masked) {
    if (buffer.length < offset + 4 + payloadLen) return null;
    const mask = buffer.slice(offset, offset + 4);
    offset += 4;
    const data = Buffer.alloc(payloadLen);
    for (let i = 0; i < payloadLen; i++) {
      data[i] = buffer[offset + i] ^ mask[i % 4];
    }
    return { opcode, data, totalLen: offset + payloadLen };
  }

  if (buffer.length < offset + payloadLen) return null;
  return { opcode, data: buffer.slice(offset, offset + payloadLen), totalLen: offset + payloadLen };
}

// ── Dashboard Server ──

export async function startDashboardServer({
  runDir,
  port = 0,
  host = "127.0.0.1",
  idleTimeoutMs = 30 * 60 * 1000,
  parentPid = process.ppid,
  onReady = null,
  distDir = DIST_DIR,
}) {
  const resolvedRunDir = path.resolve(runDir);
  const previewModelPath = path.join(resolvedRunDir, "preview", "preview-model.json");
  const operatorStatusPath = path.join(resolvedRunDir, "preview", "operator-status.json");
  const portFilePath = path.join(resolvedRunDir, "..", "..", "..", ".makeitreal", "dashboard.port");

  let lastActivity = Date.now();
  const wsClients = new Set();

  function touch() {
    lastActivity = Date.now();
  }

  // ── HTTP request handler ──

  async function handleRequest(req, res) {
    touch();
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // CORS headers for API
    if (pathname.startsWith("/api/")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    // API: GET /api/model
    if (pathname === "/api/model" && req.method === "GET") {
      try {
        const data = await readFile(previewModelPath, "utf8");
        const model = JSON.parse(data);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, model }));
      } catch (err) {
        res.writeHead(err.code === "ENOENT" ? 404 : 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // API: GET /api/status
    if (pathname === "/api/status" && req.method === "GET") {
      try {
        const data = await readFile(operatorStatusPath, "utf8");
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(data);
      } catch {
        // Fall back to reading model and extracting status
        try {
          const data = await readFile(previewModelPath, "utf8");
          const model = JSON.parse(data);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({
            ok: true,
            status: model.status ?? null,
            operatorCockpit: model.operatorCockpit ?? null,
          }));
        } catch (err) {
          res.writeHead(err.code === "ENOENT" ? 404 : 500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      }
      return;
    }

    // API: POST /api/blueprint/review
    if (pathname === "/api/blueprint/review" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body);
          // Lazy import to avoid circular deps
          const { decideBlueprintReview } = await import("../blueprint/review.mjs");
          const result = await decideBlueprintReview({
            runDir: resolvedRunDir,
            status: payload.status,
            reviewedBy: payload.reviewedBy ?? "dashboard-ui",
            decisionNote: payload.decisionNote ?? null,
          });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // API: GET /api/server-info
    if (pathname === "/api/server-info" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        ok: true,
        runDir: resolvedRunDir,
        port: server.address().port,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        clients: wsClients.size,
      }));
      return;
    }

    // ── Static file serving ──
    let filePath;
    if (pathname === "/" || pathname === "/index.html") {
      filePath = path.join(distDir, "index.html");
    } else {
      // Prevent directory traversal
      const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
      filePath = path.join(distDir, safePath);
    }

    // Ensure we don't serve outside distDir
    if (!filePath.startsWith(distDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    try {
      const fileStat = await stat(filePath);
      if (fileStat.isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
      const content = await readFile(filePath);
      res.writeHead(200, { "Content-Type": mimeType(filePath) });
      res.end(content);
    } catch (err) {
      if (err.code === "ENOENT") {
        // SPA fallback: serve index.html for non-asset routes
        if (!pathname.includes(".")) {
          try {
            const indexContent = await readFile(path.join(distDir, "index.html"));
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(indexContent);
            return;
          } catch {
            // fall through
          }
        }
        res.writeHead(404);
        res.end("Not Found");
      } else {
        res.writeHead(500);
        res.end("Internal Server Error");
      }
    }
  }

  // ── WebSocket upgrade ──

  function handleUpgrade(req, socket) {
    touch();
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }

    const acceptKey = wsAcceptKey(key);
    const responseHeaders = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "",
      "",
    ].join("\r\n");

    socket.write(responseHeaders);

    const client = { socket, buffer: Buffer.alloc(0) };
    wsClients.add(client);

    socket.on("data", (chunk) => {
      touch();
      client.buffer = Buffer.concat([client.buffer, chunk]);

      while (true) {
        const frame = decodeWsFrame(client.buffer);
        if (!frame) break;
        client.buffer = client.buffer.slice(frame.totalLen);

        if (frame.opcode === 0x08) {
          // Close frame
          socket.end();
          wsClients.delete(client);
          return;
        }

        if (frame.opcode === 0x09) {
          // Ping → pong
          const pong = Buffer.alloc(2);
          pong[0] = 0x8a; // FIN + pong
          pong[1] = 0;
          socket.write(pong);
          continue;
        }

        if (frame.opcode === 0x01) {
          // Text frame
          try {
            const msg = JSON.parse(frame.data.toString("utf8"));
            handleWsMessage(client, msg);
          } catch {
            // Ignore malformed JSON
          }
        }
      }
    });

    socket.on("close", () => {
      wsClients.delete(client);
    });

    socket.on("error", () => {
      wsClients.delete(client);
    });
  }

  function handleWsMessage(_client, msg) {
    touch();
    // Log interaction events
    if (msg.type === "node-select" || msg.type === "interaction") {
      // Could write to events file in the future
    }
  }

  function broadcast(data) {
    const frame = encodeWsFrame(JSON.stringify(data));
    for (const client of wsClients) {
      try {
        client.socket.write(frame);
      } catch {
        wsClients.delete(client);
      }
    }
  }

  // ── File watcher ──

  let fileWatcher = null;
  let debounceTimer = null;
  const previewDir = path.join(resolvedRunDir, "preview");

  function startWatching() {
    try {
      fileWatcher = watch(previewDir, (eventType, filename) => {
        if (filename === "preview-model.json" || filename === "operator-status.json") {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            broadcast({ type: "model-update", file: filename, timestamp: Date.now() });
          }, 100);
        }
      });
      fileWatcher.on("error", () => {
        // Directory may not exist yet; that's fine
      });
    } catch {
      // preview dir may not exist yet
    }
  }

  // ── Lifecycle ──

  const startTime = Date.now();
  let lifecycleInterval = null;

  function checkLifecycle() {
    // Auto-exit after idle timeout
    if (Date.now() - lastActivity > idleTimeoutMs) {
      shutdown("idle-timeout");
      return;
    }

    // Check parent PID is alive
    if (parentPid) {
      try {
        process.kill(parentPid, 0);
      } catch {
        shutdown("parent-exited");
        return;
      }
    }
  }

  async function shutdown(reason = "manual") {
    if (lifecycleInterval) clearInterval(lifecycleInterval);
    if (fileWatcher) fileWatcher.close();
    if (debounceTimer) clearTimeout(debounceTimer);

    // Close all WS connections
    for (const client of wsClients) {
      try {
        const closeFrame = Buffer.alloc(4);
        closeFrame[0] = 0x88; // FIN + close
        closeFrame[1] = 2;
        closeFrame.writeUInt16BE(1000, 2); // normal closure
        client.socket.write(closeFrame);
        client.socket.end();
      } catch {
        // ignore
      }
    }
    wsClients.clear();

    // Remove port file
    try {
      await unlink(portFilePath);
    } catch {
      // ignore
    }

    server.close();
    return reason;
  }

  // ── Create and start server ──

  const server = createServer(handleRequest);
  server.on("upgrade", handleUpgrade);

  await new Promise((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on("error", reject);
  });

  const actualPort = server.address().port;

  // Write port file
  try {
    await mkdir(path.dirname(portFilePath), { recursive: true });
    await writeFile(portFilePath, String(actualPort), "utf8");
  } catch {
    // Non-fatal
  }

  // Start lifecycle monitoring
  lifecycleInterval = setInterval(checkLifecycle, 60_000);
  if (lifecycleInterval.unref) lifecycleInterval.unref();

  // Start file watching
  startWatching();

  const result = {
    server,
    port: actualPort,
    host,
    url: `http://${host}:${actualPort}`,
    runDir: resolvedRunDir,
    portFilePath,
    broadcast,
    shutdown,
    clientCount: () => wsClients.size,
  };

  if (onReady) onReady(result);

  return result;
}

// ── CLI entry point ──

if (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error("Usage: node server.mjs <runDir>");
    process.exit(1);
  }

  const info = await startDashboardServer({ runDir, port: 0 });
  console.log(JSON.stringify({
    ok: true,
    command: "dashboard serve",
    url: info.url,
    port: info.port,
    runDir: info.runDir,
    portFilePath: info.portFilePath,
  }));
}
