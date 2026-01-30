import { google } from 'googleapis';
import { sql } from '../db.js';
import { 
  getEmailConfig, 
  saveOAuth2Config, 
  disconnectOAuth2,
  sendEmail 
} from '../services/emailService.js';

/**
 * GET /admin/email-config
 * Get current email configuration (without sensitive data)
 */
export async function getConfig(req, res) {
  try {
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const config = await getEmailConfig(empresa[0].id);

    if (!config) {
      return res.json({
        modo: 'disabled',
        configured: false
      });
    }

    // Return config without sensitive data
    res.json({
      modo: config.modo,
      configured: true,
      oauth2_provider: config.oauth2_provider,
      oauth2_email: config.oauth2_email,
      oauth2_connected_at: config.oauth2_connected_at,
      from_name: config.from_name,
      from_email: config.from_email,
      smtp_host: config.smtp_host,
      smtp_port: config.smtp_port,
      smtp_user: config.smtp_user
    });
  } catch (err) {
    console.error("❌ Error getting email config:", err);
    res.status(500).json({ error: "Error al obtener configuración" });
  }
}

/**
 * POST /admin/email-config/oauth2/start
 * Start OAuth2 flow - returns authorization URL
 */
export async function startOAuth2(req, res) {
  try {
    const { provider = 'gmail' } = req.body;

    if (provider !== 'gmail') {
      return res.status(400).json({ error: "Solo Gmail está soportado actualmente" });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const scopes = [
      'https://www.googleapis.com/auth/gmail.send'
    ];

    // Store user ID in state to retrieve after callback
    const state = Buffer.from(JSON.stringify({ userId: req.user.id })).toString('base64');

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: state,
      prompt: 'consent' // Force to get refresh_token
    });

    res.json({ authUrl });
  } catch (err) {
    console.error("❌ Error starting OAuth2:", err);
    res.status(500).json({ error: "Error al iniciar autenticación" });
  }
}

/**
 * GET /auth/google/callback
 * OAuth2 callback from Google
 */
export async function handleGoogleCallback(req, res) {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`/admin/perfil?oauth_error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      return res.status(400).send('Missing code or state');
    }

    // Decode state to get user ID
    const { userId } = JSON.parse(Buffer.from(state, 'base64').toString());

    // Get empresa ID from user ID
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${userId}
    `;

    if (empresa.length === 0) {
      return res.status(403).send('Unauthorized');
    }

    const empresaId = empresa[0].id;

    // Exchange code for tokens
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);
    
    if (!tokens.refresh_token) {
      return res.redirect('/admin/perfil?oauth_error=no_refresh_token');
    }

    // Get user email from Google
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress;

    // Save configuration
    await saveOAuth2Config(empresaId, {
      provider: 'gmail',
      email: email,
      refreshToken: tokens.refresh_token
    });

    // Redirect to success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Autenticación exitosa</title>
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            display: flex;
            align-items: center;
            justify-center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 2rem;
            border-radius: 1rem;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 400px;
          }
          .success-icon {
            font-size: 4rem;
            margin-bottom: 1rem;
          }
          h1 {
            color: #10b981;
            margin: 0 0 0.5rem 0;
          }
          p {
            color: #6b7280;
            margin: 0 0 1.5rem 0;
          }
          button {
            background: #3b82f6;
            color: white;
            border: none;
            padding: 0.75rem 2rem;
            border-radius: 0.5rem;
            font-size: 1rem;
            cursor: pointer;
            font-weight: 600;
          }
          button:hover {
            background: #2563eb;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">✅</div>
          <h1>¡Gmail conectado!</h1>
          <p>Tu cuenta de Gmail ha sido conectada correctamente. Ya puedes enviar emails desde la aplicación.</p>
          <button onclick="window.close()">Cerrar</button>
        </div>
        <script>
          // Send message to opener window
          if (window.opener) {
            window.opener.postMessage({ type: 'oauth-success' }, '*');
          }
          // Auto-close after 3 seconds
          setTimeout(() => window.close(), 3000);
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("❌ Error in Google callback:", err);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error</title>
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            display: flex;
            align-items: center;
            justify-center;
            min-height: 100vh;
            margin: 0;
            background: #fee;
          }
          .container {
            background: white;
            padding: 2rem;
            border-radius: 1rem;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 400px;
          }
          h1 { color: #dc2626; }
          p { color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Error</h1>
          <p>Hubo un error al conectar con Gmail. Por favor, inténtalo de nuevo.</p>
          <button onclick="window.close()">Cerrar</button>
        </div>
      </body>
      </html>
    `);
  }
}

/**
 * POST /admin/email-config/oauth2/disconnect
 * Disconnect OAuth2
 */
export async function disconnectOAuth2Handler(req, res) {
  try {
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    await disconnectOAuth2(empresa[0].id);

    res.json({ success: true, message: "Gmail desconectado correctamente" });
  } catch (err) {
    console.error("❌ Error disconnecting OAuth2:", err);
    res.status(500).json({ error: "Error al desconectar Gmail" });
  }
}

/**
 * POST /admin/email-config/test
 * Send test email
 */
export async function sendTestEmail(req, res) {
  try {
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const user = await sql`
      SELECT email FROM users_180 WHERE id = ${req.user.id}
    `;

    const userEmail = user[0].email;

    await sendEmail({
      to: userEmail,
      subject: 'Email de prueba - CONTENDO GESTIONES',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #3b82f6;">✅ ¡Configuración exitosa!</h2>
          <p>Este es un email de prueba para confirmar que tu configuración de email funciona correctamente.</p>
          <p>Ya puedes enviar invitaciones y notificaciones desde CONTENDO GESTIONES.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="color: #6b7280; font-size: 14px;">
            Si no solicitaste este email, puedes ignorarlo.
          </p>
        </div>
      `
    }, empresa[0].id);

    res.json({ 
      success: true, 
      message: `Email de prueba enviado a ${userEmail}` 
    });
  } catch (err) {
    console.error("❌ Error sending test email:", err);
    res.status(500).json({ 
      error: err.message || "Error al enviar email de prueba" 
    });
  }
}
