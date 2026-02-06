'use client';

import { useState, useEffect } from 'react';
import { api } from '@/services/api';
import { showSuccess, showError } from '@/lib/toast';
import { Mail, CheckCircle2, XCircle, Send, Loader2 } from 'lucide-react';

interface EmailConfig {
  modo: 'disabled' | 'oauth2' | 'smtp';
  configured: boolean;
  oauth2_provider?: string;
  oauth2_email?: string;
  oauth2_connected_at?: string;
  from_name?: string;
  from_email?: string;
}

export default function EmailConfigPanel() {
  const [config, setConfig] = useState<EmailConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  useEffect(() => {
    loadConfig();
    
    // Listen for OAuth success message from popup
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'oauth-success') {
        showSuccess('Gmail conectado correctamente');
        loadConfig();
      } else if (event.data.type === 'oauth-error') {
        showError('Error al conectar con Gmail');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  async function loadConfig() {
    try {
      const res = await api.get('/admin/email-config');
      setConfig(res.data);
    } catch (err) {
      console.error('Error loading email config:', err);
      showError('Error al cargar configuración de email');
    } finally {
      setLoading(false);
    }
  }

  async function handleConnectGmail() {
    if (connecting) return;
    setConnecting(true);

    try {
      const res = await api.post('/admin/email-config/oauth2/start', {
        provider: 'gmail'
      });

      const { authUrl } = res.data;

      // Open popup
      const width = 500;
      const height = 600;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      window.open(
        authUrl,
        'Google OAuth',
        `width=${width},height=${height},left=${left},top=${top}`
      );
    } catch (err: any) {
      console.error('Error starting OAuth:', err);
      showError(err?.response?.data?.error || 'Error al iniciar conexión con Gmail');
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (disconnecting) return;
    
    if (!confirm('¿Estás seguro de que quieres desconectar Gmail?')) {
      return;
    }

    setDisconnecting(true);

    try {
      await api.post('/admin/email-config/oauth2/disconnect');
      showSuccess('Gmail desconectado correctamente');
      loadConfig();
    } catch (err: any) {
      console.error('Error disconnecting:', err);
      showError(err?.response?.data?.error || 'Error al desconectar Gmail');
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSendTest() {
    if (sendingTest) return;
    setSendingTest(true);

    try {
      const res = await api.post('/admin/email-config/test');
      showSuccess(res.data.message || 'Email de prueba enviado correctamente');
    } catch (err: any) {
      console.error('Error sending test email:', err);
      showError(err?.response?.data?.error || 'Error al enviar email de prueba');
    } finally {
      setSendingTest(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status Card */}
      <div className="border rounded-lg p-4 bg-gray-50">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${
              config?.modo === 'oauth2' ? 'bg-green-100' : 'bg-gray-200'
            }`}>
              <Mail className={`w-5 h-5 ${
                config?.modo === 'oauth2' ? 'text-green-600' : 'text-gray-500'
              }`} />
            </div>
            
            <div>
              <h4 className="font-medium text-gray-900">
                {config?.modo === 'oauth2' ? 'Gmail Conectado' : 'Email No Configurado'}
              </h4>
              
              {config?.modo === 'oauth2' && config.oauth2_email && (
                <div className="mt-1 space-y-1">
                  <p className="text-sm text-gray-600 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    {config.oauth2_email}
                  </p>
                  {config.oauth2_connected_at && (
                    <p className="text-xs text-gray-500">
                      Conectado el {new Date(config.oauth2_connected_at).toLocaleDateString('es-ES', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                      })}
                    </p>
                  )}
                </div>
              )}
              
              {config?.modo === 'disabled' && (
                <p className="text-sm text-gray-600 mt-1 flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-gray-400" />
                  Conecta tu cuenta de Gmail para enviar invitaciones por email
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {config?.modo === 'disabled' && (
          <button
            onClick={handleConnectGmail}
            disabled={connecting}
            className="btn-primary flex items-center gap-2"
          >
            {connecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Conectando...
              </>
            ) : (
              <>
                <Mail className="w-4 h-4" />
                Conectar con Gmail
              </>
            )}
          </button>
        )}

        {config?.modo === 'oauth2' && (
          <>
            <button
              onClick={handleSendTest}
              disabled={sendingTest}
              className="btn-primary flex items-center gap-2"
            >
              {sendingTest ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Enviar Email de Prueba
                </>
              )}
            </button>

            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="btn-outline flex items-center gap-2"
            >
              {disconnecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Desconectando...
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4" />
                  Desconectar
                </>
              )}
            </button>
          </>
        )}
      </div>

      {/* Info */}
      <div className="text-xs text-gray-500 bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="font-medium text-blue-900 mb-1">ℹ️ Información</p>
        <p>
          Al conectar Gmail, podrás enviar invitaciones y notificaciones directamente desde tu cuenta.
          Solo necesitas hacer click en "Conectar con Gmail" y autorizar el acceso.
        </p>
      </div>
    </div>
  );
}
