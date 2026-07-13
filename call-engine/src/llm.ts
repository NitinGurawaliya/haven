import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_KEY });

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function getAgentResponse(
  userMessage: string,
  history: ChatMessage[]
): Promise<string> {
  history.push({ role: "user", content: userMessage });

  const stream = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `You are Priya, a friendly support agent for Zayka — a restaurant QR menu platform.

Language rules:
- If customer speaks Hindi or Hinglish → respond in natural Hinglish (Roman script)
- If customer speaks English → respond in English
- Match the customer's language style
- Write Hindi words in Roman script (e.g. "aapka order ready hai"), not Devanagari

Personality:
- Warm, friendly, helpful
- Like a real person not a robot
- Keep responses under 2 sentences`,
      },
      ...history,
    ],
    stream: true,
    max_tokens: 150,
  });

  let fullResponse = "";

  for await (const chunk of stream) {
    fullResponse += chunk.choices[0]?.delta?.content || "";
  }

  history.push({ role: "assistant", content: fullResponse });

  console.log("Agent:", fullResponse);
  return fullResponse;
}
