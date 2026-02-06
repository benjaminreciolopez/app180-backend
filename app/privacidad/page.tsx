import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 font-sans text-gray-800">
      <div className="max-w-3xl mx-auto bg-white shadow-xl rounded-2xl p-8 md:p-12">
        <div className="mb-8">
          <Link 
            href="/" 
            className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver al Inicio
          </Link>
        </div>

        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6 border-b pb-4">
          Política de Privacidad
        </h1>

        <div className="prose prose-blue max-w-none space-y-6">
          <p className="text-sm text-gray-500">Última actualización: {new Date().toLocaleDateString('es-ES')}</p>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">1. Introducción</h2>
            <p>
              Bienvenido a <strong>CONTENDO GESTIONES ("nosotros", "nuestro application").</strong> 
              Respetamos su privacidad y nos comprometemos a proteger sus datos personales. 
              Esta política de privacidad le informará sobre cómo cuidamos sus datos personales cuando visita nuestra aplicación y le informará sobre sus derechos de privacidad.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">2. Datos que recopilamos</h2>
            <p>
              Podemos recopilar, usar, almacenar y transferir diferentes tipos de datos personales sobre usted, que hemos agrupado de la siguiente manera:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong>Datos de Identidad:</strong> incluye nombre, apellidos, nombre de usuario o identificador similar.</li>
              <li><strong>Datos de Contacto:</strong> incluye dirección de correo electrónico.</li>
              <li><strong>Datos Técnicos:</strong> incluye dirección IP, datos de inicio de sesión, tipo y versión del navegador, configuración de zona horaria y ubicación.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">3. Cómo usamos sus datos personales</h2>
            <p>
              Solo usaremos sus datos personales cuando la ley nos lo permita. Más comúnmente, usaremos sus datos personales en las siguientes circunstancias:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Para registrarlo como nuevo usuario.</li>
              <li>Para gestionar nuestra relación con usted.</li>
              <li>Para permitirle enviar correos electrónicos a través de nuestros servicios (integración con Gmail).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">4. Uso de Servicios de Google</h2>
            <p>
              Nuestra aplicación utiliza servicios de Google (Gmail API) para permitir el envío de correos electrónicos. 
              El uso y la transferencia a cualquier otra aplicación de la información recibida de las API de Google cumplirán con la 
              <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline mx-1">
                Política de datos de usuario de los servicios API de Google
              </a>, incluidos los requisitos de uso limitado.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">5. Seguridad de los datos</h2>
            <p>
              Hemos implementado medidas de seguridad adecuadas para evitar que sus datos personales se pierdan accidentalmente, se usen o se acceda a ellos de forma no autorizada.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">6. Contacto</h2>
            <p>
              Si tiene alguna pregunta sobre esta política de privacidad, contáctenos a través de nuestro soporte.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
