import WebSocket from "ws";

const DEEPGRAM_KEY = process.env.STT_KEY;

export function createDeepgramStream(onTranscript: (text: string) => void) {
  return new Promise<{ socket: WebSocket; disconnect: () => void }>((resolve, reject) => {
    console.log("1. Connecting to Deepgram via raw WebSocket...");

    const dgSocket = new WebSocket(
      "wss://api.deepgram.com/v1/listen?model=nova-2&language=hi&punctuate=true&interim_results=false&endpointing=500",
      {
        headers: {
          Authorization: `Token ${DEEPGRAM_KEY}`,
        },
      }
    )

    dgSocket.on("open", () => {
      console.log("2. Deepgram connected!");
      resolve({
        socket: dgSocket,
        disconnect: () => dgSocket.close(),
      });
    });

    dgSocket.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        const transcript = parsed.channel?.alternatives?.[0]?.transcript;
        if (transcript && parsed.is_final) {
          console.log("Transcript:", transcript);
          onTranscript(transcript);
        }
      } catch (err) {
        // ignore parse errors
      }
    });

    dgSocket.on("error", (err) => {
      console.error("Deepgram error:", err.message);
      reject(err);
    });

    dgSocket.on("close", () => {
      console.log("Deepgram disconnected");
    });

    setTimeout(() => {
      reject(new Error("Deepgram timed out"));
    }, 5000);
  });
}
