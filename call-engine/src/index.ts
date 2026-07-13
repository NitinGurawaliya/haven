import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import fs from "fs";
import path from "path";
import { createDeepgramStream } from "./stt";
import { getAgentResponse } from "./llm";
import { textToSpeech } from "./tts";

const PORT = 8000;

const httpServer = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(fs.readFileSync(path.join(__dirname, "../public/index.html")));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server: httpServer });

function sendJson(socket: WebSocket, payload: Record<string, unknown>) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

wss.on("connection", async (socket: WebSocket) => {
  const history: { role: "user" | "assistant"; content: string }[] = [];
  let processing = false;

  let deepgram: { socket: WebSocket; disconnect: () => void };
  try {
    deepgram = await createDeepgramStream(async (transcript) => {
      if (processing) return;
      processing = true;

      console.log("User said:", transcript);
      sendJson(socket, { type: "transcript", text: transcript });

      try {
        const agentText = await getAgentResponse(transcript, history);
        sendJson(socket, { type: "agent", text: agentText });

        const audioBuffer = await textToSpeech(agentText);
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(audioBuffer);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Pipeline failed";
        console.error("Pipeline error:", message);
        sendJson(socket, { type: "error", message });
      } finally {
        processing = false;
      }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "STT connection failed";
    console.error("Deepgram setup error:", message);
    sendJson(socket, { type: "error", message });
    socket.close();
    return;
  }

  socket.on("message", (data: Buffer, isBinary: boolean) => {
    if (!isBinary) return;
    if (deepgram.socket.readyState === WebSocket.OPEN) {
      deepgram.socket.send(data);
    }
  });

  socket.on("close", () => {
    deepgram.disconnect();
  });
});

httpServer.listen(PORT, () => {
  console.log(`Pipeline running at http://localhost:${PORT}`);
  console.log("Open browser — http://localhost:8000");
});
