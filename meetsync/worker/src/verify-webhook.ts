// Handle WhatsApp webhook verification (GET request)
// Meta sends this once during webhook setup to confirm ownership

export function handleVerification(url: URL, verifyToken: string): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === verifyToken && challenge) {
    console.log("Webhook verification successful");
    return new Response(challenge, { status: 200 });
  }

  console.warn("Webhook verification failed — token mismatch or missing params");
  return new Response("Forbidden", { status: 403 });
}
