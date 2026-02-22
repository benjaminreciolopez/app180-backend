import {
  createCheckoutSession,
  cancelSubscription,
  getSubscriptionInfo,
  getAvailablePlans,
  handleStripeWebhook,
  getStripe,
} from "../services/stripeService.js";

/**
 * GET /api/admin/subscription — Info del plan actual
 */
export async function getSubscription(req, res) {
  try {
    const info = await getSubscriptionInfo(req.user.empresa_id);
    res.json(info);
  } catch (err) {
    console.error("Error getSubscription:", err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/admin/subscription/plans — Planes disponibles
 */
export async function getPlans(req, res) {
  try {
    const plans = await getAvailablePlans();
    res.json(plans);
  } catch (err) {
    console.error("Error getPlans:", err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/admin/subscription/checkout — Crear sesión de Stripe Checkout
 */
export async function checkout(req, res) {
  try {
    const { plan } = req.body;
    if (!plan) return res.status(400).json({ error: "Plan requerido" });

    const session = await createCheckoutSession(
      req.user.empresa_id,
      plan,
      req.body.success_url,
      req.body.cancel_url
    );

    res.json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error("Error checkout:", err.message);
    res.status(400).json({ error: err.message });
  }
}

/**
 * POST /api/admin/subscription/cancel — Cancelar suscripción
 */
export async function cancel(req, res) {
  try {
    const result = await cancelSubscription(req.user.empresa_id);
    res.json(result);
  } catch (err) {
    console.error("Error cancel:", err.message);
    res.status(400).json({ error: err.message });
  }
}

/**
 * POST /api/webhook/stripe — Webhook de Stripe (público, sin JWT)
 */
export async function stripeWebhook(req, res) {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET no configurado");
    return res.status(500).json({ error: "Webhook no configurado" });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({ error: "Firma inválida" });
  }

  try {
    await handleStripeWebhook(event);
    res.json({ received: true });
  } catch (err) {
    console.error("Error procesando webhook:", err.message);
    res.status(500).json({ error: "Error procesando evento" });
  }
}
