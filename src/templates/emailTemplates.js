// backend/src/templates/emailTemplates.js

/**
 * Template HTML profesional para invitación de empleado
 * Incluye instrucciones detalladas para instalación PWA
 */
export function getInviteEmailTemplate({ nombre, link, expiresAt, tipo = "nuevo" }) {
  const esCambio = tipo === "cambio";
  
  return {
    subject: esCambio 
      ? "Autorización de nuevo dispositivo – CONTENDO GESTIONES"
      : "Activación de acceso – CONTENDO GESTIONES",
    
    html: `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: white;
      border-radius: 8px;
      padding: 30px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #0f172a;
    }
    h1 {
      color: #0f172a;
      margin: 0;
      font-size: 24px;
    }
    .alert {
      background-color: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 15px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .alert.info {
      background-color: #dbeafe;
      border-left-color: #3b82f6;
    }
    .alert.warning {
      background-color: #fee2e2;
      border-left-color: #ef4444;
    }
    .button {
      display: inline-block;
      background-color: #0f172a;
      color: white !important;
      padding: 12px 30px;
      text-decoration: none;
      border-radius: 6px;
      margin: 20px 0;
      font-weight: 600;
    }
    .steps {
      background-color: #f8fafc;
      padding: 20px;
      border-radius: 6px;
      margin: 20px 0;
    }
    .step {
      margin: 15px 0;
      padding-left: 30px;
      position: relative;
    }
    .step::before {
      content: "→";
      position: absolute;
      left: 0;
      color: #0f172a;
      font-weight: bold;
    }
    .platform {
      background-color: white;
      padding: 15px;
      margin: 10px 0;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
    }
    .platform-title {
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 10px;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #64748b;
      text-align: center;
    }
    .link-box {
      background-color: #f1f5f9;
      padding: 15px;
      border-radius: 6px;
      word-break: break-all;
      margin: 15px 0;
      font-family: monospace;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>CONTENDO GESTIONES</h1>
    </div>

    <p>Hola <strong>${nombre}</strong>,</p>

    ${esCambio ? `
      <div class="alert warning">
        <strong>⚠️ Cambio de dispositivo</strong><br>
        Tu administrador ha autorizado un nuevo dispositivo. Esta acción desactivará cualquier dispositivo anterior que tengas registrado.
      </div>
    ` : `
      <p>Tu administrador te ha dado acceso a <strong>CONTENDO GESTIONES</strong>.</p>
    `}

    <div class="alert">
      <strong>⏰ Importante:</strong> Este enlace caduca en <strong>24 horas</strong>.
    </div>

    <div class="steps">
      <h3 style="margin-top: 0;">📱 Instrucciones de instalación</h3>
      
      <div class="alert info">
        <strong>🔒 Seguridad:</strong> Debes abrir este enlace <strong>desde el móvil</strong> que vas a usar para trabajar. La aplicación quedará vinculada a ese dispositivo.
      </div>

      <div class="step">
        <strong>Paso 1:</strong> Abre este email desde tu móvil (iPhone o Android)
      </div>
      
      <div class="step">
        <strong>Paso 2:</strong> Haz clic en el botón de abajo
      </div>

      <div style="text-align: center;">
        <a href="${link}" class="button">Activar mi acceso</a>
      </div>

      <div class="link-box">
        O copia este enlace:<br>
        ${link}
      </div>

      <div class="step">
        <strong>Paso 3:</strong> Instala la aplicación como PWA según tu dispositivo:
      </div>

      <div class="platform">
        <div class="platform-title">📱 iPhone (Safari)</div>
        <ol style="margin: 5px 0; padding-left: 20px;">
          <li>Toca el botón <strong>Compartir</strong> (cuadrado con flecha hacia arriba)</li>
          <li>Desplázate y selecciona <strong>"Añadir a pantalla de inicio"</strong></li>
          <li>Toca <strong>"Añadir"</strong></li>
        </ol>
      </div>

      <div class="platform">
        <div class="platform-title">🤖 Android (Chrome)</div>
        <ol style="margin: 5px 0; padding-left: 20px;">
          <li>Toca el menú <strong>⋮</strong> (tres puntos)</li>
          <li>Selecciona <strong>"Instalar aplicación"</strong> o <strong>"Añadir a pantalla de inicio"</strong></li>
          <li>Toca <strong>"Instalar"</strong></li>
        </ol>
      </div>

      <div class="step">
        <strong>Paso 4:</strong> Abre la aplicación desde el icono en tu pantalla de inicio
      </div>

      <div class="step">
        <strong>Paso 5:</strong> Cambia tu contraseña inicial por una segura
      </div>
    </div>

    <div class="alert info">
      <strong>💡 Consejo:</strong> Una vez instalada, la aplicación funcionará como una app nativa. Podrás acceder a ella desde el icono en tu pantalla de inicio.
    </div>

    <p>Si tienes problemas con la instalación, contacta con tu administrador.</p>

    <div class="footer">
      <p>Este es un email automático de CONTENDO GESTIONES.</p>
      <p>Por favor, no respondas a este mensaje.</p>
    </div>
  </div>
</body>
</html>
    `,
    
    text: `
Hola ${nombre},

${esCambio 
  ? '⚠️ CAMBIO DE DISPOSITIVO\nTu administrador ha autorizado un nuevo dispositivo. Esta acción desactivará cualquier dispositivo anterior que tengas registrado.\n' 
  : 'Tu administrador te ha dado acceso a CONTENDO GESTIONES.\n'
}

⏰ IMPORTANTE: Este enlace caduca en 24 horas.

📱 INSTRUCCIONES DE INSTALACIÓN:

🔒 Seguridad: Debes abrir este enlace desde el móvil que vas a usar para trabajar. La aplicación quedará vinculada a ese dispositivo.

Paso 1: Abre este email desde tu móvil (iPhone o Android)

Paso 2: Haz clic en este enlace:
${link}

Paso 3: Instala la aplicación como PWA según tu dispositivo:

📱 iPhone (Safari):
1. Toca el botón "Compartir" (cuadrado con flecha hacia arriba)
2. Desplázate y selecciona "Añadir a pantalla de inicio"
3. Toca "Añadir"

🤖 Android (Chrome):
1. Toca el menú ⋮ (tres puntos)
2. Selecciona "Instalar aplicación" o "Añadir a pantalla de inicio"
3. Toca "Instalar"

Paso 4: Abre la aplicación desde el icono en tu pantalla de inicio

Paso 5: Cambia tu contraseña inicial por una segura

💡 Consejo: Una vez instalada, la aplicación funcionará como una app nativa.

Si tienes problemas con la instalación, contacta con tu administrador.

---
Este es un email automático de CONTENDO GESTIONES.
Por favor, no respondas a este mensaje.
    `.trim()
  };
}
