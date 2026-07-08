import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import fs from "fs";
import path from "path";
import { createDeepgramStream } from "./stt";
import { getAgentResponse } from "./llm";
import { textToSpeech } from "./tts";

const httpServer = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(fs.readFileSync(path.join(__dirname, "../public/index.html")));
  }
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", async (socket: WebSocket) => {
  const history: { role: string; content: string }[] = [];

  socket.on("message", async (data: Buffer) => {
    try {
      const { transcript } = JSON.parse(data.toString());
      if (!transcript?.trim()) return;

      console.log("User said:", transcript);
      const agentText = await getAgentResponse(transcript, history);
      const audioBuffer = await textToSpeech(agentText);

      if (socket.readyState === WebSocket.OPEN) {
        socket.send(audioBuffer);
      }
    } catch (err: any) {
      console.error("Pipeline error:", err.message);
    }
  });
});

httpServer.listen(8000, () => {
  console.log("Pipeline running at http://localhost:8000");
  console.log("Open browser — http://localhost:8000");
});