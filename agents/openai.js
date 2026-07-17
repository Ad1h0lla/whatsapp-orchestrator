export async function askChatGPT({ message, history = [], system }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push(...history, { role: "user", content: message });

  const response = await fetch(
    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: "glm-4-flash",  // free tier model
        messages,
      }),
    }
  );

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}
