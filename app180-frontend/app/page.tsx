"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle, Shield, Clock, Users } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white font-sans text-gray-900">
      {/* HEADER */}
      <header className="fixed w-full bg-white/80 backdrop-blur-md z-50 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                CONTENDO GESTIONES
              </span>
            </div>
            <nav className="hidden md:flex space-x-8">
              <a href="#features" className="text-gray-600 hover:text-blue-600 transition-colors">Características</a>
              <Link href="/privacidad" className="text-gray-600 hover:text-blue-600 transition-colors">Privacidad</Link>
              <Link href="/terminos" className="text-gray-600 hover:text-blue-600 transition-colors">Términos</Link>
            </nav>
            <div>
              <Link 
                href="/setup" 
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 transition-all shadow-md hover:shadow-lg"
              >
                Registro
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="pt-32 pb-20 bg-gradient-to-b from-blue-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-6xl font-extrabold text-gray-900 tracking-tight mb-6">
            Gestión Empresarial <span className="text-blue-600">Inteligente</span>
          </h1>
          <p className="max-w-2xl mx-auto text-xl text-gray-500 mb-10">
            Plataforma integral para el control de jornadas, gestión de empleados y comunicación eficiente. 
            Simplifica la administración de tu empresa con tecnología moderna.
          </p>
          <div className="flex justify-center space-x-4">
            <Link 
              href="/login" 
              className="px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 md:text-lg shadow-xl hover:shadow-2xl transition-all hover:-translate-y-1"
            >
              Iniciar Sesión
            </Link>
          </div>
        </div>
      </section>

      {/* FEATURES SECTION */}
      <section id="features" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">
              Todo lo que necesitas para tu gestión
            </h2>
            <p className="mt-4 text-xl text-gray-500">
              Herramientas diseñadas para optimizar el flujo de trabajo diario.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="p-6 bg-gray-50 rounded-xl hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4 text-blue-600">
                <Clock className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Control Horario</h3>
              <p className="text-gray-500">
                Registro preciso de jornadas laborales, control de pausas y geolocalización de fichajes.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-6 bg-gray-50 rounded-xl hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4 text-green-600">
                <Users className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Gestión de Empleados</h3>
              <p className="text-gray-500">
                Administración centralizada de personal, documentos y asignación de clientes.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-6 bg-gray-50 rounded-xl hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4 text-purple-600">
                <Shield className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Auditoría y Seguridad</h3>
              <p className="text-gray-500">
                Registro detallado de acciones y seguridad robusta para proteger tus datos.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-gray-50 border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="mb-4 md:mb-0">
              <span className="font-bold text-gray-900 text-lg">CONTENDO GESTIONES</span>
              <p className="text-gray-500 text-sm mt-1">© {new Date().getFullYear()} Todos los derechos reservados.</p>
            </div>
            <div className="flex space-x-6">
              <Link href="/privacidad" className="text-gray-500 hover:text-gray-900 text-sm">
                Política de Privacidad
              </Link>
              <Link href="/terminos" className="text-gray-500 hover:text-gray-900 text-sm">
                Términos y Condiciones
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
