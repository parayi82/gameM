// Crea una Stripe Checkout Session para desbloquear UN capítulo individual.
// Modelo de precio elegido para el MVP: compra por capítulo (no suscripción) —
// encaja mejor con el "desbloqueo" capítulo a capítulo descrito en el spec y es
// más simple de retener sin lock-in; una suscripción puede añadirse después
// como segundo price en Stripe sin tocar este flujo.
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const manifest = require("../../chapters/manifest.json");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { chapterId, userId } = JSON.parse(event.body || "{}");
    if (!chapterId || !userId) {
      return { statusCode: 400, body: JSON.stringify({ error: "chapterId y userId son requeridos" }) };
    }

    const chapter = manifest.chapters.find((c) => c.id === chapterId);
    if (!chapter || chapter.free) {
      return { statusCode: 400, body: JSON.stringify({ error: "Capítulo inválido o gratuito" }) };
    }

    const siteUrl = process.env.SITE_URL || "http://localhost:8080";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `La Cabaña — ${chapter.title}` },
            unit_amount: Math.round(chapter.priceUSD * 100),
          },
          quantity: 1,
        },
      ],
      metadata: { chapterId: String(chapter.id), userId },
      success_url: `${siteUrl}/?chapter=${chapter.id}&purchase=success`,
      cancel_url: `${siteUrl}/?chapter=${chapter.id}&purchase=cancelled`,
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: "Error creando la sesión de pago" }) };
  }
};
