// Webhook de Stripe: en checkout.session.completed, registra la compra en Supabase
// usando la service role key (nunca expuesta al cliente). Idempotente vía
// UNIQUE(stripe_payment_id) — reintentos de Stripe no duplican la fila.
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  const signature = event.headers["stripe-signature"];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Firma de webhook inválida:", err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const { chapterId, userId } = session.metadata || {};

    if (chapterId && userId) {
      const { error } = await supabase.from("purchases").upsert(
        {
          user_id: userId,
          chapter_id: parseInt(chapterId, 10),
          stripe_payment_id: session.payment_intent || session.id,
          unlocked_at: new Date().toISOString(),
        },
        { onConflict: "stripe_payment_id" }
      );
      if (error) console.error("Error registrando compra:", error);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
