import WebSocket from "ws";

const DEEPGRAM_KEY = process.env.STT_KEY;

export function createDeepgramStream(onTranscript: (text: string) => void) {
  return new Promise<{ socket: WebSocket; disconnect: () => void }>((resolve, reject) => {
    if (!DEEPGRAM_KEY) {
      reject(new Error("STT_KEY is not set in .env"));
      return;
    }

    console.log("Connecting to Deepgram...");

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Deepgram connection timed out"));
      }
    }, 10000);

    const dgSocket = new WebSocket(
      "wss://api.deepgram.com/v1/listen?model=nova-2&language=hi&punctuate=true&interim_results=false&endpointing=500&encoding=linear16&sample_rate=16000&channels=1",
      {
        headers: {
          Authorization: `Token ${DEEPGRAM_KEY}`,
        },
      }
    );

    dgSocket.on("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      console.log("Deepgram connected");
      resolve({
        socket: dgSocket,
        disconnect: () => dgSocket.close(),
      });
    });

    dgSocket.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        const transcript = parsed.channel?.alternatives?.[0]?.transcript;
        if (transcript?.trim() && parsed.is_final) {
          console.log("Transcript:", transcript);
          onTranscript(transcript);
        }
      } catch {
        // ignore non-JSON frames
      }
    });

    dgSocket.on("error", (err) => {
      console.error("Deepgram error:", err.message);
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    dgSocket.on("close", (code, reason) => {
      const detail = reason.toString() || "no reason";
      console.log(`Deepgram disconnected (code=${code}, reason=${detail})`);
    });
  });
}
