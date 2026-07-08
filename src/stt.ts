// import { DeepgramClient } from "@deepgram/sdk";

// const client = new DeepgramClient({ apiKey: "ca1ac67b7753998a4461db4d222b992c5bac4d80" });

// // export async function createDeepgramStream(onTranscript: (text: string) => void) {
// //   console.log("1. Creating connection...");

// //   const connection = await client.listen.v1.connect({
// //     model: "nova-2",
// //     language: "hi",

// //     endpointing: 500,
// //   });

// //   console.log("2. Connection object created");

// //   // Return a promise that resolves when connection actually opens
// //   return new Promise((resolve, reject) => {
// //     connection.on("open", () => {
// //       console.log("3. Deepgram actually open now");
// //       resolve(connection);
// //     });

// //     connection.on("error", (err: any) => {
// //       console.error("Deepgram error:", err);
// //       reject(err);
// //     });

// //     // Timeout — if not open in 5 seconds, something is wrong
// //     setTimeout(() => {
// //       reject(new Error("Deepgram connection timed out after 5 seconds"));
// //     }, 5000);

// //     connection.on("message", (data: any) => {
// //       const transcript = data.channel?.alternatives?.[0]?.transcript;
// //       if (transcript && data.is_final) {
// //         console.log("Transcript:", transcript);
// //         onTranscript(transcript);
// //       }
// //     });

// //     connection.on("close", () => {
// //       console.log("Deepgram disconnected");
// //     });
// //   });
// // }

// export async function createDeepgramStream(onTranscript: (text: string) => void) {
//   console.log("Mock STT running — firing transcript every 5 seconds");

//   setInterval(() => {
//     onTranscript("bhai mera order kahan hai");
//   }, 5000);

//   return {
//     socket: { send: (_: any) => {} },
//     disconnect: () => {}
//   };
// }

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
    );

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