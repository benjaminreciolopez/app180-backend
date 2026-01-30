import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import { sql } from '../db.js';
import { encrypt, decrypt } from '../utils/encryption.js';

// Ensure nodemailer is properly imported
const { createTransport } = nodemailer;

/**
 * Email Service
 * Handles email sending using OAuth2 (Gmail) or SMTP configuration
 */

/**
 * Get email configuration for an empresa
 * @param {string} empresaId - UUID of the empresa
 * @returns {Object|null} - Email configuration or null if not configured
 */
export async function getEmailConfig(empresaId) {
  const config = await sql`
    SELECT * FROM empresa_email_config_180
    WHERE empresa_id = ${empresaId}
  `;
  
  return config[0] || null;
}

/**
 * Get nodemailer transporter for an empresa
 * @param {string} empresaId - UUID of the empresa
 * @returns {Promise<nodemailer.Transporter>} - Configured transporter
 */
export async function getEmailTransporter(empresaId, accessToken = null) {
  const config = await getEmailConfig(empresaId);
  
  if (!config || config.modo === 'disabled') {
    // Fallback to environment variables (legacy)
    return createLegacyTransporter();
  }
  
  if (config.modo === 'oauth2') {
    // Inject the explicit access token if provided
    if (accessToken) {
      config.accessToken = accessToken;
    }
    return await createOAuth2Transporter(config);
  }
  
  if (config.modo === 'smtp') {
    return createSMTPTransporter(config);
  }
  
  throw new Error('Modo de email no válido');
}

// ... (createLegacyTransporter, createOAuth2Transporter, createSMTPTransporter unchanged)

export async function sendEmail({ to, subject, text, html, accessToken }, empresaId = null) {
  try {
    let transporter;
    let fromEmail;
    let fromName = 'CONTENDO GESTIONES';
    
    if (empresaId) {
      const config = await getEmailConfig(empresaId);
      transporter = await getEmailTransporter(empresaId, accessToken); // Pass accessToken here
      
      if (config) {
        fromEmail = config.from_email || config.oauth2_email || config.smtp_user;
        fromName = config.from_name || fromName;
      } else {
        fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
      }
    } else {
      // Legacy mode: use environment variables
      transporter = createLegacyTransporter();
      fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
    }
    
    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      html,
      text: text || (html ? html.replace(/<[^>]*>/g, '') : '') // Strip HTML for text version
    };
    
    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully:', result.messageId);
    
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('❌ Error sending email:', error);
    throw error;
  }
}

/**
 * Save OAuth2 configuration for an empresa
 * @param {string} empresaId - UUID of the empresa
 * @param {Object} oauth2Data - { provider, email, refreshToken }
 * @returns {Promise<Object>} - Saved configuration
 */
export async function saveOAuth2Config(empresaId, { provider, email, refreshToken }) {
  console.log('📥 saveOAuth2Config called');
  console.log('🔑 Input refresh token:', {
    length: refreshToken?.length,
    preview: refreshToken?.substring(0, 20) + '...'
  });
  
  const encryptedToken = encrypt(refreshToken);
  
  console.log('🔐 Encrypted token:', {
    length: encryptedToken?.length,
    preview: encryptedToken?.substring(0, 20) + '...'
  });
  
  const result = await sql`
    INSERT INTO empresa_email_config_180 (
      empresa_id,
      modo,
      oauth2_provider,
      oauth2_email,
      oauth2_refresh_token,
      oauth2_connected_at,
      from_email
    ) VALUES (
      ${empresaId},
      'oauth2',
      ${provider},
      ${email},
      ${encryptedToken},
      NOW(),
      ${email}
    )
    ON CONFLICT (empresa_id)
    DO UPDATE SET
      modo = 'oauth2',
      oauth2_provider = ${provider},
      oauth2_email = ${email},
      oauth2_refresh_token = ${encryptedToken},
      oauth2_connected_at = NOW(),
      from_email = ${email},
      updated_at = NOW()
    RETURNING *
  `;
  
  console.log('✅ Saved to database, row ID:', result[0]?.id);
  
  return result[0];
}

/**
 * Disconnect OAuth2 for an empresa
 * @param {string} empresaId - UUID of the empresa
 */
export async function disconnectOAuth2(empresaId) {
  await sql`
    UPDATE empresa_email_config_180
    SET 
      modo = 'disabled',
      oauth2_provider = NULL,
      oauth2_email = NULL,
      oauth2_refresh_token = NULL,
      oauth2_connected_at = NULL,
      updated_at = NOW()
    WHERE empresa_id = ${empresaId}
  `;
}
