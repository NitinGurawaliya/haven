import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_KEY });

const conversationHistory: { role: "user" | "assistant"; content: string }[] = [];

export async function getAgentResponse(userMessage: string,  history: { role: string; content: string }[]
): Promise<string> {
  // Add user message to history
  conversationHistory.push({
    role: "user",
    content: userMessage,
  });

  const stream = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
  role: "system",
  content: `You are Priya, a friendly support agent for Zayka — a restaurant QR menu platform.
  
  Language rules:
  - If customer speaks Hindi or Hinglish → respond in Hindi (mix of Hindi and English naturally)
  - If customer speaks English → respond in Hindi
  - Never refuse to speak in a language the customer uses
  - Always write responses in Devanagari script for Hindi words
  
  Personality:
  - Warm, friendly, helpful
  - Like a real person not a robot
  - Keep responses under 2 sentences
  - Don't say "कृपया" every sentence — sounds robotic`
      },
      ...conversationHistory,
    ],
    stream: true,
    max_tokens: 150,
  });

  let fullResponse = "";

  for await (const chunk of stream) {
    const word = chunk.choices[0]?.delta?.content || "";
    fullResponse += word;
  }

  // Add agent response to history — maintains conversation context
  conversationHistory.push({
    role: "assistant",
    content: fullResponse,
  });

  console.log("Agent:", fullResponse);
  return fullResponse;
}