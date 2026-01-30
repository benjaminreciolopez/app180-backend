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
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email'
    ];

    // Store user ID in state to retrieve after callback
    const state = Buffer.from(JSON.stringify({ userId: req.user.id })).toString('base64');

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: state,
      prompt: 'consent' // Force to get refresh_token
    });

    console.log('🔗 Generated auth URL redirect_uri:', process.env.GOOGLE_REDIRECT_URI);
    console.log('🔗 Full auth URL:', authUrl);

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
  // Log IMMEDIATELY to see if function is even called
  console.log('🔵🔵🔵 CALLBACK FUNCTION CALLED 🔵🔵🔵');
  console.log('📍 Request URL:', req.url);
  console.log('📍 Request method:', req.method);
  console.log('📍 Request headers:', JSON.stringify(req.headers, null, 2));
  
  try {
    console.log('🔵 OAuth callback received');
    const { code, state, error } = req.query;

    console.log('📋 Query params:', { hasCode: !!code, hasState: !!state, error });

    if (error) {
      console.log('❌ OAuth error from Google:', error);
      return res.redirect(`/admin/perfil?oauth_error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      console.log('❌ Missing code or state');
      return res.status(400).send('Missing code or state');
    }

    // Decode state to get user ID
    console.log('🔓 Decoding state...');
    const { userId } = JSON.parse(Buffer.from(state, 'base64').toString());
    console.log('✅ User ID from state:', userId);

    // Get empresa ID from user ID
    console.log('🔍 Looking up empresa for user:', userId);
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${userId}
    `;

    if (empresa.length === 0) {
      console.log('❌ No empresa found for user:', userId);
      return res.status(403).send('Unauthorized');
    }

    const empresaId = empresa[0].id;
    console.log('✅ Empresa ID:', empresaId);

    // Exchange code for tokens
    console.log('🔄 Exchanging code for tokens...');
    console.log('📌 Environment check:', {
      hasClientId: !!process.env.GOOGLE_CLIENT_ID,
      hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
      hasRedirectUri: !!process.env.GOOGLE_REDIRECT_URI,
      redirectUri: process.env.GOOGLE_REDIRECT_URI
    });

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);
    console.log('✅ Tokens received:', { 
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token 
    });
    
    if (!tokens.refresh_token) {
      console.log('❌ No refresh token received');
      return res.redirect('/admin/perfil?oauth_error=no_refresh_token');
    }

    // Get user email from Google
    console.log('📧 Getting user email from OAuth2 API...');
    oauth2Client.setCredentials(tokens);
    
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;
    console.log('✅ Email obtained:', email);

    // Save configuration
    console.log('💾 Saving OAuth2 config...');
    console.log('🔑 Refresh token from Google:', {
      length: tokens.refresh_token?.length,
      preview: tokens.refresh_token?.substring(0, 20) + '...'
    });
    
    await saveOAuth2Config(empresaId, {
      provider: 'gmail',
      email: email,
      refreshToken: tokens.refresh_token
    });
    console.log('✅ Config saved successfully');

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
    console.error("❌ Error stack:", err.stack);
    console.error("❌ Error details:", {
      message: err.message,
      name: err.name,
      code: err.code
    });
    
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
          .error-details {
            background: #f3f4f6;
            padding: 1rem;
            border-radius: 0.5rem;
            margin-top: 1rem;
            font-size: 0.875rem;
            text-align: left;
            color: #374151;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Error</h1>
          <p>Hubo un error al conectar con Gmail. Por favor, inténtalo de nuevo.</p>
          <div class="error-details">
            <strong>Detalles técnicos:</strong><br>
            ${err.message || 'Error desconocido'}
          </div>
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
  console.log('🏁 sendTestEmail CONTROLLER START');
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
    const empresaId = empresa[0].id;

    // Capture the manually generated token to pass to sendEmail
    let manualAccessToken = null;

    // DEBUG: Verify token validity explicitly before Nodemailer
    try {
      const { decrypt } = await import('../utils/encryption.js'); // Import decrypt dynamically
      const config = await getEmailConfig(empresaId);
      
      if (config && config.modo === 'oauth2' && config.oauth2_refresh_token) {
        console.log('🔍 Verifying OAuth2 token manually...');
        
        // DECRYPT TOKEN
        const decryptedToken = decrypt(config.oauth2_refresh_token);

        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        
        oauth2Client.setCredentials({
          refresh_token: decryptedToken
        });

        // Attempt to get access token explicitly
        const { token } = await oauth2Client.getAccessToken();
        console.log('✅ Manual token refresh SUCCESS. Access token generated.');
        console.log('🔑 Access Token Preview:', token?.substring(0, 10) + '...');
        
        // CHECK SCOPES
        const tokenInfo = await oauth2Client.getTokenInfo(token);
        console.log('🛡️ Token Scopes:', tokenInfo.scopes);
        
        if (!tokenInfo.scopes.includes('https://www.googleapis.com/auth/gmail.send')) {
           console.error('❌ CRITICAL: Missing gmail.send scope! User likely unchecked the permission box.');
           throw new Error('Permisos insuficientes. Por favor desconecta y vuelve a conectar, asegurándote de MARCAR todas las casillas de permisos.');
        }

        manualAccessToken = token; // Store for use in sendEmail
      } else if (config && config.modo === 'oauth2' && !config.oauth2_refresh_token) {
        console.error('❌ Config is OAuth2 but NO refresh token found in DB!');
      }
    } catch (tokenErr) {
      console.error('❌ Manual token refresh/verification FAILED:', tokenErr.message);
      if (tokenErr.response) {
        console.error('❌ API Error Response:', JSON.stringify(tokenErr.response.data, null, 2));
      }
      return res.status(500).json({ 
        error: `Error de verificación: ${tokenErr.message}` 
      });
    }

    // Pass the manually validated access token to avoid Nodemailer regeneration issues
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
      `,
      accessToken: manualAccessToken // PASS THE TOKEN HERE
    }, empresaId);

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
