import Stripe from "stripe";
import { sql } from "../db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Crear cliente en Stripe
 */
export async function createStripeCustomer(empresa) {
  const customer = await stripe.customers.create({
    email: empresa.email || empresa.nombre,
    name: empresa.nombre,
    metadata: { empresa_id: empresa.id },
  });

  await sql`
    UPDATE empresa_180
    SET stripe_customer_id = ${customer.id}
    WHERE id = ${empresa.id}
  `;

  return customer;
}

/**
 * Crear sesión de Stripe Checkout para suscripción
 */
export async function createCheckoutSession(empresaId, planNombre, successUrl, cancelUrl) {
  // Obtener empresa
  const [empresa] = await sql`
    SELECT e.*, e.stripe_customer_id
    FROM empresa_180 e
    WHERE e.id = ${empresaId}
  `;

  if (!empresa) throw new Error("Empresa no encontrada");

  // Si es VIP, no necesita pagar
  if (empresa.es_vip) throw new Error("Empresa VIP no requiere suscripción de pago");

  // Obtener plan
  const [plan] = await sql`
    SELECT * FROM plans_180 WHERE nombre = ${planNombre} AND activo = true
  `;
  if (!plan) throw new Error("Plan no encontrado");
  if (plan.precio_mensual <= 0) throw new Error("El plan gratuito no requiere checkout");

  // Crear customer en Stripe si no existe
  let customerId = empresa.stripe_customer_id;
  if (!customerId) {
    const customer = await createStripeCustomer(empresa);
    customerId = customer.id;
  }

  // Crear sesión de checkout
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: {
            name: `Plan ${plan.nombre.charAt(0).toUpperCase() + plan.nombre.slice(1)}`,
            description: `Suscripción mensual - hasta ${plan.max_usuarios} usuarios`,
          },
          unit_amount: Math.round(plan.precio_mensual * 100), // en céntimos
          recurring: { interval: "month" },
        },
        quantity: 1,
      },
    ],
    success_url: successUrl || `${process.env.FRONTEND_URL || "http://localhost:3000"}/admin/suscripcion?success=true`,
    cancel_url: cancelUrl || `${process.env.FRONTEND_URL || "http://localhost:3000"}/admin/suscripcion?canceled=true`,
    metadata: {
      empresa_id: empresaId,
      plan_id: plan.id,
      plan_nombre: plan.nombre,
    },
  });

  return session;
}

/**
 * Cancelar suscripción
 */
export async function cancelSubscription(empresaId) {
  const [empresa] = await sql`
    SELECT stripe_subscription_id FROM empresa_180 WHERE id = ${empresaId}
  `;

  if (!empresa?.stripe_subscription_id) {
    throw new Error("No hay suscripción activa");
  }

  // Cancelar al final del período
  await stripe.subscriptions.update(empresa.stripe_subscription_id, {
    cancel_at_period_end: true,
  });

  await sql`
    UPDATE empresa_180
    SET plan_status = 'canceling'
    WHERE id = ${empresaId}
  `;

  return { message: "Suscripción se cancelará al final del período" };
}

/**
 * Obtener info de suscripción actual
 */
export async function getSubscriptionInfo(empresaId) {
  const [empresa] = await sql`
    SELECT e.plan_id, e.plan_status, e.es_vip, e.vip_motivo,
           e.stripe_subscription_id, e.trial_ends_at,
           p.nombre as plan_nombre, p.precio_mensual,
           p.max_usuarios, p.max_clientes, p.max_facturas_mes,
           p.max_gastos_mes, p.max_ocr_mes, p.max_ai_mensajes_mes,
           p.modulos_incluidos
    FROM empresa_180 e
    LEFT JOIN plans_180 p ON e.plan_id = p.id
    WHERE e.id = ${empresaId}
  `;

  if (!empresa) throw new Error("Empresa no encontrada");

  let stripeSubscription = null;
  if (empresa.stripe_subscription_id) {
    try {
      stripeSubscription = await stripe.subscriptions.retrieve(empresa.stripe_subscription_id);
    } catch (e) {
      // Suscripción no encontrada en Stripe
    }
  }

  return {
    plan: {
      nombre: empresa.plan_nombre || "gratis",
      precio: empresa.precio_mensual || 0,
      max_usuarios: empresa.max_usuarios,
      max_clientes: empresa.max_clientes,
      max_facturas_mes: empresa.max_facturas_mes,
      max_gastos_mes: empresa.max_gastos_mes,
      max_ocr_mes: empresa.max_ocr_mes,
      max_ai_mensajes_mes: empresa.max_ai_mensajes_mes,
      modulos: empresa.modulos_incluidos,
    },
    status: empresa.plan_status,
    es_vip: empresa.es_vip,
    vip_motivo: empresa.vip_motivo,
    stripe: stripeSubscription
      ? {
          current_period_end: new Date(stripeSubscription.current_period_end * 1000),
          cancel_at_period_end: stripeSubscription.cancel_at_period_end,
          status: stripeSubscription.status,
        }
      : null,
  };
}

/**
 * Manejar eventos de Stripe Webhook
 */
export async function handleStripeWebhook(event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const empresaId = session.metadata?.empresa_id;
      const planId = session.metadata?.plan_id;

      if (empresaId && planId) {
        await sql`
          UPDATE empresa_180
          SET plan_id = ${planId}::uuid,
              stripe_subscription_id = ${session.subscription},
              plan_status = 'active'
          WHERE id = ${empresaId}::uuid
        `;
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      const [empresa] = await sql`
        SELECT id FROM empresa_180 WHERE stripe_customer_id = ${customerId}
      `;

      if (empresa) {
        const status = subscription.cancel_at_period_end ? "canceling" : subscription.status;
        await sql`
          UPDATE empresa_180
          SET plan_status = ${status}
          WHERE id = ${empresa.id}
        `;
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      // Volver a plan gratis
      const [planGratis] = await sql`
        SELECT id FROM plans_180 WHERE nombre = 'gratis' LIMIT 1
      `;

      if (planGratis) {
        await sql`
          UPDATE empresa_180
          SET plan_id = ${planGratis.id},
              plan_status = 'active',
              stripe_subscription_id = NULL
          WHERE stripe_customer_id = ${customerId}
        `;
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const customerId = invoice.customer;

      await sql`
        UPDATE empresa_180
        SET plan_status = 'past_due'
        WHERE stripe_customer_id = ${customerId}
      `;
      break;
    }
  }
}

/**
 * Listar planes disponibles
 */
export async function getAvailablePlans() {
  return await sql`
    SELECT id, nombre, precio_mensual, max_usuarios, max_clientes,
           max_facturas_mes, max_gastos_mes, max_ocr_mes,
           max_ai_mensajes_mes, modulos_incluidos
    FROM plans_180
    WHERE activo = true
    ORDER BY precio_mensual ASC
  `;
}
