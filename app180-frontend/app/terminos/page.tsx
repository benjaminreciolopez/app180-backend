import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function TermsPage() {
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
          Términos y Condiciones
        </h1>

        <div className="prose prose-blue max-w-none space-y-6">
          <p className="text-sm text-gray-500">Última actualización: {new Date().toLocaleDateString('es-ES')}</p>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">1. Aceptación de los Términos</h2>
            <p>
              Al acceder y utilizar <strong>CONTENDO GESTIONES</strong>, usted acepta cumplir y estar sujeto a los siguientes términos y condiciones de uso. 
              Si no está de acuerdo con alguna parte de estos términos, no podrá acceder al servicio.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">2. Descripción del Servicio</h2>
            <p>
              Proporcionamos una plataforma de gestión empresarial que incluye control horario, gestión de empleados y envío de comunicaciones por correo electrónico.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">3. Cuentas de Usuario</h2>
            <p>
              Cuando crea una cuenta con nosotros, debe proporcionarnos información que sea precisa, completa y actual en todo momento. 
              El incumplimiento de esto constituye una violación de los términos, que puede resultar en la terminación inmediata de su cuenta.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">4. Propiedad Intelectual</h2>
            <p>
              El servicio y su contenido original, características y funcionalidad son y seguirán siendo propiedad exclusiva de CONTENDO GESTIONES y sus licenciantes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">5. Enlaces a otros sitios web</h2>
            <p>
              Nuestro servicio puede contener enlaces a sitios web o servicios de terceros (como Google) que no son propiedad ni están controlados por nosotros. 
              No tenemos control ni asumimos responsabilidad por el contenido, las políticas de privacidad o las prácticas de sitios web o servicios de terceros.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">6. Terminación</h2>
            <p>
              Podemos terminar o suspender su acceso inmediatamente, sin previo aviso ni responsabilidad, por cualquier motivo, incluso si incumple los Términos.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">7. Cambios</h2>
            <p>
              Nos reservamos el derecho, a nuestra sola discreción, de modificar o reemplazar estos Términos en cualquier momento.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">8. Contacto</h2>
            <p>
              Si tiene alguna pregunta sobre estos Términos, por favor contáctenos.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
