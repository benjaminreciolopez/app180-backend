import Anthropic from "@anthropic-ai/sdk";
import { sql } from "../db.js";
import { getCalendarConfig } from "./googleCalendarService.js";
import { syncToGoogle, syncFromGoogle, syncBidirectional } from "./calendarSyncService.js";
import { createGoogleEvent, app180ToGoogleEvent } from "./googleCalendarService.js";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || ""
});

/**
 * Convierte tools del formato OpenAI/Groq al formato Anthropic
 */
function convertToolsToAnthropic(tools) {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters || { type: "object", properties: {} }
  }));
}

const ANTHROPIC_TOOLS = null; // Se inicializa lazy

/**
 * Herramientas disponibles para el agente IA
 */
const TOOLS = [
  // ===== CONSULTA (READ) =====
  {
    type: "function",
    function: {
      name: "consultar_facturas",
      description: "Obtiene facturas de la empresa. SIEMPRE usa esta herramienta antes de responder sobre facturas.",
      parameters: {
        type: "object",
        properties: {
          estado: { type: "string", enum: ["VALIDADA", "BORRADOR", "ANULADA", "TODOS"], description: "Estado de emisión" },
          estado_pago: { type: "string", enum: ["pendiente", "parcial", "pagado", "todos"], description: "Estado de cobro" },
          cliente_id: { type: "string", description: "ID del cliente (UUID)" },
          nombre_cliente: { type: "string", description: "Nombre del cliente (alternativa a cliente_id)" },
          limite: { type: "number", description: "Máximo de facturas (default: 10)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_empleados",
      description: "Obtiene empleados de la empresa. SIEMPRE usa esta herramienta antes de responder sobre empleados.",
      parameters: {
        type: "object",
        properties: {
          activos_solo: { type: "string", enum: ["true", "false"], description: "Si 'true', solo activos" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_clientes",
      description: "Obtiene clientes de la empresa. SIEMPRE usa esta herramienta antes de responder sobre clientes.",
      parameters: {
        type: "object",
        properties: {
          activos_solo: { type: "string", enum: ["true", "false"], description: "Si 'true', solo activos" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "estadisticas_facturacion",
      description: "Estadísticas de facturación: total facturado, pendiente, por estado.",
      parameters: {
        type: "object",
        properties: {
          mes: { type: "number", description: "Mes (1-12)" },
          anio: { type: "number", description: "Año" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "trabajos_pendientes_facturar",
      description: "Lista trabajos completados sin facturar.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "ID del cliente" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_calendario",
      description: "Consulta eventos del calendario en un rango de fechas.",
      parameters: {
        type: "object",
        properties: {
          fecha_inicio: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
          fecha_fin: { type: "string", description: "Fecha fin YYYY-MM-DD" },
          tipo: { type: "string", enum: ["todos", "festivos", "cierres", "laborables"], description: "Tipo de evento" }
        },
        required: ["fecha_inicio", "fecha_fin"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_ausencias",
      description: "Consulta ausencias de empleados en un rango de fechas.",
      parameters: {
        type: "object",
        properties: {
          fecha_inicio: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
          fecha_fin: { type: "string", description: "Fecha fin YYYY-MM-DD" },
          empleado_id: { type: "string", description: "ID del empleado" },
          tipo: { type: "string", enum: ["todos", "vacaciones", "baja_medica"], description: "Tipo" }
        },
        required: ["fecha_inicio", "fecha_fin"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_conocimiento",
      description: "Busca en la base de conocimientos manuales, procedimientos o información específica de la empresa. Úsala si no encuentras respuesta con las otras herramientas o para preguntas generales.",
      parameters: {
        type: "object",
        properties: {
          busqueda: { type: "string", description: "Término de búsqueda, palabra clave o pregunta breve" }
        },
        required: ["busqueda"]
      }
    }
  },

  // ===== CALENDARIO (WRITE) =====
  {
    type: "function",
    function: {
      name: "crear_evento_calendario",
      description: "Crea evento en el calendario (sincroniza con Google Calendar si configurado).",
      parameters: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Fecha YYYY-MM-DD" },
          nombre: { type: "string", description: "Nombre del evento" },
          tipo: { type: "string", enum: ["festivo_local", "festivo_empresa", "cierre_empresa"], description: "Tipo" },
          es_laborable: { type: "string", enum: ["true", "false"], description: "Si laborable (default: false)" },
          descripcion: { type: "string", description: "Descripción" }
        },
        required: ["fecha", "nombre", "tipo"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "eliminar_evento_calendario",
      description: "Elimina un evento del calendario.",
      parameters: {
        type: "object",
        properties: {
          evento_id: { type: "string", description: "ID del evento a eliminar" }
        },
        required: ["evento_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "sincronizar_google_calendar",
      description: "Fuerza sincronización con Google Calendar.",
      parameters: {
        type: "object",
        properties: {
          direccion: { type: "string", enum: ["to_google", "from_google", "bidirectional"], description: "Dirección" }
        }
      }
    }
  },

  // ===== FACTURAS (WRITE) =====
  {
    type: "function",
    function: {
      name: "crear_factura",
      description: "Crea una factura en borrador. Requiere cliente_id o nombre_cliente, fecha y al menos una linea con descripcion, cantidad y precio_unitario.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "ID del cliente (integer)" },
          nombre_cliente: { type: "string", description: "Nombre del cliente (alternativa a cliente_id)" },
          fecha: { type: "string", description: "Fecha YYYY-MM-DD" },
          lineas: {
            type: "array",
            items: {
              type: "object",
              properties: {
                descripcion: { type: "string" },
                cantidad: { type: "number" },
                precio_unitario: { type: "number" },
                iva: { type: "number", description: "Porcentaje IVA (ej: 21)" }
              },
              required: ["descripcion", "cantidad", "precio_unitario"]
            },
            description: "Lineas de la factura"
          },
          iva_global: { type: "number", description: "IVA global si todas las lineas tienen el mismo" }
        },
        required: ["cliente_id", "fecha", "lineas"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "actualizar_factura",
      description: "Actualiza una factura en borrador. Solo borradores pueden modificarse.",
      parameters: {
        type: "object",
        properties: {
          factura_id: { type: "string", description: "ID de la factura (integer)" },
          cliente_id: { type: "string", description: "Nuevo cliente_id" },
          fecha: { type: "string", description: "Nueva fecha YYYY-MM-DD" },
          lineas: {
            type: "array",
            items: {
              type: "object",
              properties: {
                descripcion: { type: "string" },
                cantidad: { type: "number" },
                precio_unitario: { type: "number" },
                iva: { type: "number" }
              }
            },
            description: "Nuevas lineas (reemplaza las anteriores)"
          }
        },
        required: ["factura_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "validar_factura",
      description: "Valida una factura borrador (la convierte en definitiva con numero). ACCION IRREVERSIBLE que requiere confirmacion.",
      parameters: {
        type: "object",
        properties: {
          factura_id: { type: "string", description: "ID de la factura" }
        },
        required: ["factura_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "anular_factura",
      description: "Anula una factura validada. ACCION PELIGROSA que requiere confirmacion.",
      parameters: {
        type: "object",
        properties: {
          factura_id: { type: "string", description: "ID de la factura a anular" }
        },
        required: ["factura_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "eliminar_factura",
      description: "Elimina una factura borrador. ACCION PELIGROSA que requiere confirmacion.",
      parameters: {
        type: "object",
        properties: {
          factura_id: { type: "string", description: "ID de la factura borrador a eliminar" }
        },
        required: ["factura_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "enviar_factura_email",
      description: "Envia una factura validada por email con PDF adjunto.",
      parameters: {
        type: "object",
        properties: {
          factura_id: { type: "string", description: "ID de la factura" },
          destinatario: { type: "string", description: "Email del destinatario" },
          asunto: { type: "string", description: "Asunto del email (opcional)" }
        },
        required: ["factura_id", "destinatario"]
      }
    }
  },

  // ===== CLIENTES (WRITE) =====
  {
    type: "function",
    function: {
      name: "crear_cliente",
      description: "Crea un nuevo cliente.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre del cliente" },
          email: { type: "string", description: "Email" },
          telefono: { type: "string", description: "Telefono" },
          nif_cif: { type: "string", description: "NIF/CIF" },
          direccion: { type: "string", description: "Direccion" },
          notas: { type: "string", description: "Notas" }
        },
        required: ["nombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "actualizar_cliente",
      description: "Actualiza datos de un cliente existente.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "ID del cliente" },
          nombre_cliente: { type: "string", description: "Nombre del cliente (alternativa a cliente_id)" },
          nombre: { type: "string" },
          email: { type: "string" },
          telefono: { type: "string" },
          nif_cif: { type: "string" },
          direccion: { type: "string" },
          notas: { type: "string" }
        },
        required: ["cliente_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "desactivar_cliente",
      description: "Desactiva un cliente. ACCION que requiere confirmacion.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "ID del cliente a desactivar" },
          nombre_cliente: { type: "string", description: "Nombre del cliente (alternativa a cliente_id)" }
        },
        required: []
      }
    }
  },

  // ===== PAGOS (WRITE) =====
  {
    type: "function",
    function: {
      name: "crear_pago",
      description: "Registra un cobro/pago de un cliente.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "ID del cliente" },
          nombre_cliente: { type: "string", description: "Nombre del cliente (alternativa a cliente_id)" },
          importe: { type: "number", description: "Importe del pago" },
          metodo: { type: "string", enum: ["transferencia", "efectivo", "tarjeta", "bizum", "otro"], description: "Metodo de pago" },
          fecha_pago: { type: "string", description: "Fecha del pago YYYY-MM-DD" },
          referencia: { type: "string", description: "Referencia o concepto" }
        },
        required: ["cliente_id", "importe", "metodo"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "eliminar_pago",
      description: "Elimina un pago registrado. ACCION PELIGROSA que requiere confirmacion.",
      parameters: {
        type: "object",
        properties: {
          pago_id: { type: "string", description: "ID del pago a eliminar" }
        },
        required: ["pago_id"]
      }
    }
  },

  // ===== EMPLEADOS (WRITE) =====
  {
    type: "function",
    function: {
      name: "actualizar_empleado",
      description: "Actualiza datos de un empleado.",
      parameters: {
        type: "object",
        properties: {
          empleado_id: { type: "string", description: "ID del empleado" },
          nombre_empleado: { type: "string", description: "Nombre del empleado (alternativa a empleado_id)" },
          nombre: { type: "string" },
          activo: { type: "string", enum: ["true", "false"] }
        },
        required: []
      }
    }
  },

  // ===== TRABAJOS (WRITE) =====
  {
    type: "function",
    function: {
      name: "crear_trabajo",
      description: "Registra un trabajo realizado (work log). Si el usuario dice 'he trabajado X horas', usa horas. Si dice 'hoy', usa la fecha actual. IMPORTANTE: Si es un trabajo nuevo, pide: 1. Trabajo/Descrip. Completa, 2. Concepto corto factura. 3. Detalles adicionales (opcional).",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "ID del cliente (UUID)" },
          nombre_cliente: { type: "string", description: "Nombre del cliente (alternativa a cliente_id)" },
          descripcion: { type: "string", description: "Trabajo / Descripción completa del trabajo realizado (detalle técnico)" },
          concepto_facturacion: { type: "string", description: "Descripción corta para poner en la factura (ej: Arreglo de cristal)" },
          detalles: { type: "string", description: "Detalles adicionales u observaciones (opcional)" },
          fecha: { type: "string", description: "Fecha YYYY-MM-DD (default: hoy)" },
          horas: { type: "number", description: "Duración en horas (ej: 9)" },
          minutos: { type: "number", description: "Duración en minutos (ej: 540)" },
          precio: { type: "number", description: "Valor/precio manual (opcional)" }
        },
        required: ["descripcion"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_historial_trabajos",
      description: "Obtiene los últimos trabajos realizados para un cliente. Úsala para que el usuario pueda seleccionar un trabajo previo antes de registrar uno nuevo.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "ID del cliente (UUID)" },
          nombre_cliente: { type: "string", description: "Nombre del cliente (alternativa a cliente_id)" },
          limite: { type: "string", description: "Nº de trabajos a recuperar (default: '5')" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "marcar_trabajo_cobrado",
      description: "Marca un trabajo como COBRADO DIRECTAMENTE (sin factura). Úsala cuando el usuario diga que ya ha cobrado un trabajo pero no hay factura oficial.",
      parameters: {
        type: "object",
        properties: {
          trabajo_id: { type: "string", description: "ID del trabajo (UUID)" },
          metodo_pago: { type: "string", description: "Método de pago (efectivo, bizum, transferencia, etc.)" }
        },
        required: ["trabajo_id"]
      }
    }
  },

  // ===== GASTOS Y COMPRAS (WRITE) =====
  {
    type: "function",
    function: {
      name: "registrar_gasto",
      description: "Registra un gasto o compra (materiales, combustible, etc.).",
      parameters: {
        type: "object",
        properties: {
          proveedor: { type: "string", description: "Nombre del proveedor o establecimiento" },
          descripcion: { type: "string", description: "Concepto del gasto" },
          total: { type: "number", description: "Importe total del ticket/factura" },
          base_imponible: { type: "number", description: "Base imponible (opcional)" },
          iva_importe: { type: "number", description: "Importe de IVA (opcional)" },
          iva_porcentaje: { type: "number", description: "Porcentaje de IVA (ej: 21)" },
          fecha: { type: "string", description: "Fecha YYYY-MM-DD (default: hoy)" },
          categoria: { type: "string", description: "Categoría (material, combustible, herramientas, etc.)" },
          metodo_pago: { type: "string", description: "Método de pago" }
        },
        required: ["descripcion", "total"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "registrar_factura_existente",
      description: "Registra una factura que ya existe físicamente/legalmente (ej: para recuperar datos borrados por error).",
      parameters: {
        type: "object",
        properties: {
          numero_factura: { type: "string", description: "Número de la factura real" },
          nombre_cliente: { type: "string", description: "Nombre del cliente" },
          fecha_emision: { type: "string", description: "Fecha YYYY-MM-DD" },
          total: { type: "number", description: "Importe total de la factura" },
          estado_pago: { type: "string", description: "Estado de pago (pagado, pendiente)" }
        },
        required: ["numero_factura", "nombre_cliente", "total"]
      }
    }
  },

  // ===== ANÁLISIS FINANCIERO 360 =====
  {
    type: "function",
    function: {
      name: "consultar_resumen_financiero",
      description: "Muestra el beneficio real del negocio cruzando ingresos (facturas + cobros directos) y gastos.",
      parameters: {
        type: "object",
        properties: {
          periodo: { type: "string", description: "Periodo a consultar (mes_actual, mes_anterior, año_actual)" }
        }
      }
    }
  },

  // ===== AUSENCIAS (WRITE) =====
  {
    type: "function",
    function: {
      name: "crear_ausencia",
      description: "Crea una ausencia (vacaciones, baja medica, etc.) para un empleado.",
      parameters: {
        type: "object",
        properties: {
          empleado_id: { type: "string", description: "ID del empleado" },
          tipo: { type: "string", enum: ["vacaciones", "baja_medica", "asuntos_propios", "permiso"], description: "Tipo de ausencia" },
          fecha_inicio: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
          fecha_fin: { type: "string", description: "Fecha fin YYYY-MM-DD" },
          motivo: { type: "string", description: "Motivo o comentario" }
        },
        required: ["empleado_id", "tipo", "fecha_inicio", "fecha_fin"]
      }
    }
  },

  // ===== META-HERRAMIENTA: CONSULTAR REQUISITOS =====
  {
    type: "function",
    function: {
      name: "consultar_requisitos",
      description: "Devuelve qué datos/parámetros necesita una acción antes de ejecutarla. SIEMPRE usa esta herramienta cuando el usuario pregunte '¿qué necesitas para...?' o '¿qué datos hacen falta?'. NUNCA llames directamente a una herramienta de escritura si no tienes los datos reales del usuario.",
      parameters: {
        type: "object",
        properties: {
          accion: {
            type: "string",
            description: "Nombre de la herramienta sobre la que quieres saber los requisitos",
            enum: [
              "crear_factura", "actualizar_factura", "validar_factura", "anular_factura",
              "eliminar_factura", "enviar_factura_email", "crear_cliente", "actualizar_cliente",
              "desactivar_cliente", "crear_pago", "eliminar_pago", "actualizar_empleado",
              "crear_trabajo", "crear_ausencia", "crear_evento_calendario",
              "eliminar_evento_calendario", "facturar_trabajos_pendientes", "cierre_mensual"
            ]
          }
        },
        required: ["accion"]
      }
    }
  },

  // ===== NUEVOS SKILLS: ANALYTICS FINANCIERO =====
  {
    type: "function",
    function: {
      name: "top_clientes",
      description: "Ranking de los mejores clientes por facturación. Úsala cuando pregunten por los clientes más importantes o top clientes.",
      parameters: {
        type: "object",
        properties: {
          limite: { type: "number", description: "Nº de clientes a mostrar (default: 5)" },
          periodo: { type: "string", enum: ["mes", "trimestre", "anio", "todo"], description: "Periodo a analizar (default: todo)" },
          criterio: { type: "string", enum: ["facturado", "pendiente", "pagado"], description: "Criterio de ranking (default: facturado)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "resumen_ejecutivo",
      description: "Dashboard completo del negocio: facturación, cobros, clientes, empleados, trabajos pendientes. Úsala cuando pregunten '¿cómo va el negocio?' o quieran un resumen general.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_deuda",
      description: "Consulta facturas vencidas y clientes morosos. Úsala cuando pregunten '¿quién me debe?' o sobre impagos.",
      parameters: {
        type: "object",
        properties: {
          dias_vencido: { type: "number", description: "Días de antigüedad mínima (default: 30)" },
          cliente_id: { type: "string", description: "Filtrar por cliente específico" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_pagos",
      description: "Lista pagos/cobros registrados. Úsala cuando pregunten por pagos recibidos.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "Filtrar por cliente" },
          fecha_desde: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
          fecha_hasta: { type: "string", description: "Fecha fin YYYY-MM-DD" },
          limite: { type: "number", description: "Máximo de pagos (default: 20)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "comparar_periodos",
      description: "Compara facturación entre dos meses. Úsala cuando pregunten 'este mes vs anterior' o comparativas.",
      parameters: {
        type: "object",
        properties: {
          periodo_a: { type: "string", description: "Primer periodo YYYY-MM" },
          periodo_b: { type: "string", description: "Segundo periodo YYYY-MM" }
        },
        required: ["periodo_a", "periodo_b"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "tendencia_facturacion",
      description: "Evolución de facturación de los últimos N meses con tendencia. Úsala para análisis de tendencias.",
      parameters: {
        type: "object",
        properties: {
          meses: { type: "number", description: "Número de meses hacia atrás (default: 6)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "clientes_en_riesgo",
      description: "Detecta clientes con señales de impago o abandono: facturas >60 días sin pagar, sin actividad >90 días.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "alertas_negocio",
      description: "Alertas proactivas: facturas vencidas, borradores antiguos, trabajos sin facturar, ausencias próximas. Úsala cuando pregunten '¿algún problema?' o '¿qué tengo pendiente?'.",
      parameters: { type: "object", properties: {} }
    }
  },

  // ===== NUEVOS SKILLS: RRHH/JORNADAS =====
  {
    type: "function",
    function: {
      name: "consultar_fichajes",
      description: "Consulta fichajes (entradas/salidas) de empleados. Úsala cuando pregunten sobre horas fichadas o asistencia.",
      parameters: {
        type: "object",
        properties: {
          empleado_id: { type: "string", description: "ID del empleado" },
          fecha_inicio: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
          fecha_fin: { type: "string", description: "Fecha fin YYYY-MM-DD" }
        },
        required: ["fecha_inicio", "fecha_fin"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "resumen_horas_empleado",
      description: "Resumen de horas trabajadas por empleado en un periodo. Si no se indica empleado, muestra ranking de todo el equipo.",
      parameters: {
        type: "object",
        properties: {
          empleado_id: { type: "string", description: "ID del empleado (opcional, todos si vacío)" },
          fecha_inicio: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
          fecha_fin: { type: "string", description: "Fecha fin YYYY-MM-DD" }
        },
        required: ["fecha_inicio", "fecha_fin"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_ausencias_resumen",
      description: "Resumen de ausencias por tipo: vacaciones usadas, bajas médicas, permisos. Para saber el saldo de vacaciones.",
      parameters: {
        type: "object",
        properties: {
          empleado_id: { type: "string", description: "ID del empleado (opcional, todos si vacío)" },
          anio: { type: "number", description: "Año a consultar (default: actual)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "productividad_empleado",
      description: "Productividad: horas trabajadas, valor generado, clientes atendidos, ratio valor/hora.",
      parameters: {
        type: "object",
        properties: {
          empleado_id: { type: "string", description: "ID del empleado (opcional, todos si vacío)" },
          fecha_inicio: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
          fecha_fin: { type: "string", description: "Fecha fin YYYY-MM-DD" }
        },
        required: ["fecha_inicio", "fecha_fin"]
      }
    }
  },

  // ===== NUEVOS SKILLS: AUTOMATIZACIÓN =====
  {
    type: "function",
    function: {
      name: "facturar_trabajos_pendientes",
      description: "Crea una factura borrador con todos los trabajos pendientes de un cliente. Puedes usar nombre_cliente si no tienes el ID. ACCION que modifica datos.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "ID del cliente" },
          nombre_cliente: { type: "string", description: "Nombre del cliente (alternativa a cliente_id)" },
          iva: { type: "number", description: "Porcentaje de IVA (default: 21)" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "cierre_mensual",
      description: "Resumen completo de cierre de mes: facturado, cobrado, pendiente, horas equipo, trabajos sin facturar, borradores.",
      parameters: {
        type: "object",
        properties: {
          mes: { type: "number", description: "Mes (1-12)" },
          anio: { type: "number", description: "Año" }
        }
      }
    }
  },
];

// ============================
// EJECUTAR HERRAMIENTAS
// ============================

function coerceBooleans(args) {
  const result = { ...args };
  for (const key of Object.keys(result)) {
    if (result[key] === "true") result[key] = true;
    else if (result[key] === "false") result[key] = false;
  }
  return result;
}

/**
 * Parsea una tool call fallida de Groq (error tool_use_failed)
 * y coerce los tipos string→number según el schema de la herramienta.
 * Devuelve { name, args } o null si no se puede recuperar.
 */
function parseFailedGeneration(errorMessage) {
  try {
    const jsonStr = errorMessage.replace(/^\d+\s*/, '');
    const errorBody = JSON.parse(jsonStr);
    const failedGen = errorBody?.error?.failed_generation;
    if (!failedGen || errorBody?.error?.code !== 'tool_use_failed') return null;

    const match = failedGen.match(/<function=(\w+)>\s*(\{[\s\S]*?\})\s*<\/function>/);
    if (!match) return null;

    const [, name, argsJson] = match;
    const args = JSON.parse(argsJson);

    const tool = TOOLS.find(t => t.function.name === name);
    if (tool) {
      const props = tool.function.parameters.properties || {};
      for (const [key, schema] of Object.entries(props)) {
        if (schema.type === 'number' && typeof args[key] === 'string') {
          const num = Number(args[key]);
          if (!isNaN(num)) args[key] = num;
        }
      }
    }

    for (const [key, val] of Object.entries(args)) {
      if (key.endsWith('_id') && typeof val === 'string' && !UUID_RE.test(val) && !INT_RE.test(val)) {
        console.warn(`[AI] Argumento placeholder o nombre detectado en campo ID: ${key}="${val}" - se intentará resolver`);
        // Si el valor no es un ID válido, lo tratamos como un nombre para intentar resolverlo
        const baseKey = key.replace('_id', '');
        args[`nombre_${baseKey}`] = val;
        delete args[key];
      }
    }

    return { name, args };
  } catch {
    return null;
  }
}

/**
 * Resuelve nombre_cliente → cliente_id y nombre_empleado → empleado_id
 * buscando en la BD por coincidencia parcial (ILIKE).
 */
async function resolveIds(args, empresaId) {
  // Rechazar nombres genéricos antes de buscar en BD
  const GENERIC_NAME_RE = /^(nombre|cliente|empleado|el cliente|la empresa|usuario|persona|test|ejemplo|prueba)/i;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Si cliente_id viene con un nombre (no UUID), moverlo a nombre_cliente
  if (args.cliente_id && typeof args.cliente_id === 'string' && !UUID_RE.test(args.cliente_id) && !/^\d+$/.test(args.cliente_id)) {
    args.nombre_cliente = args.cliente_id;
    delete args.cliente_id;
  }
  // Lo mismo para empleado_id
  if (args.empleado_id && typeof args.empleado_id === 'string' && !UUID_RE.test(args.empleado_id) && !/^\d+$/.test(args.empleado_id)) {
    args.nombre_empleado = args.empleado_id;
    delete args.empleado_id;
  }

  if (args.nombre_cliente && GENERIC_NAME_RE.test(args.nombre_cliente.trim())) {
    return { error: `"${args.nombre_cliente}" no es un nombre real de cliente. Pregunta al usuario el nombre específico.` };
  }
  if (args.nombre_empleado && GENERIC_NAME_RE.test(args.nombre_empleado.trim())) {
    return { error: `"${args.nombre_empleado}" no es un nombre real de empleado. Pregunta al usuario el nombre específico.` };
  }

  if (args.nombre_cliente && !args.cliente_id) {
    const clientes = await sql`
      SELECT id, nombre FROM clients_180
      WHERE empresa_id = ${empresaId} AND activo = true
        AND nombre ILIKE ${'%' + args.nombre_cliente + '%'}
      LIMIT 5
    `;
    if (clientes.length === 1) {
      args.cliente_id = clientes[0].id;
      console.log(`[AI] Resuelto cliente: "${args.nombre_cliente}" → ${args.cliente_id} (${clientes[0].nombre})`);
    } else if (clientes.length > 1) {
      return { error: `Se encontraron ${clientes.length} clientes con "${args.nombre_cliente}": ${clientes.map(c => c.nombre).join(', ')}. Especifica cuál.` };
    } else {
      return { error: `No se encontró ningún cliente activo con el nombre "${args.nombre_cliente}".` };
    }
    delete args.nombre_cliente;
  }
  if (args.nombre_empleado && !args.empleado_id) {
    const empleados = await sql`
      SELECT id, nombre FROM empleados_180
      WHERE empresa_id = ${empresaId} AND activo = true
        AND nombre ILIKE ${'%' + args.nombre_empleado + '%'}
      LIMIT 5
    `;
    if (empleados.length === 1) {
      args.empleado_id = empleados[0].id;
      console.log(`[AI] Resuelto empleado: "${args.nombre_empleado}" → ${args.empleado_id} (${empleados[0].nombre})`);
    } else if (empleados.length > 1) {
      return { error: `Se encontraron ${empleados.length} empleados con "${args.nombre_empleado}": ${empleados.map(e => e.nombre).join(', ')}. Especifica cuál.` };
    } else {
      return { error: `No se encontró ningún empleado activo con el nombre "${args.nombre_empleado}".` };
    }
    delete args.nombre_empleado;
  }
  return null;
}

/**
 * Meta-herramienta: devuelve los requisitos de una acción en lenguaje natural.
 */
function consultarRequisitos({ accion }) {
  const tool = TOOLS.find(t => t.function.name === accion);
  if (!tool) return { error: `Herramienta "${accion}" no encontrada.` };

  const params = tool.function.parameters;
  const props = params.properties || {};
  const required = params.required || [];

  const campos = Object.entries(props).map(([key, schema]) => {
    const obligatorio = required.includes(key);
    const desc = schema.description || key;
    const tipo = schema.type === 'array' ? 'lista' : schema.type === 'number' ? 'número' : schema.type;
    const opciones = schema.enum ? ` (opciones: ${schema.enum.join(', ')})` : '';
    return `- **${key}** (${tipo}${obligatorio ? ', OBLIGATORIO' : ', opcional'}): ${desc}${opciones}`;
  });

  return {
    herramienta: accion,
    descripcion: tool.function.description,
    parametros: campos.join('\n'),
    nota: "Pide al usuario los datos obligatorios antes de ejecutar la acción. Puedes usar nombre_cliente o nombre_empleado en vez de IDs."
  };
}

/**
 * Detecta valores placeholder/genéricos en los argumentos.
 * Devuelve un mensaje de error si detecta placeholders, o null si todo ok.
 */
function detectPlaceholders(args, nombreHerramienta) {
  const PLACEHOLDER_PATTERNS = [
    /^nombre\s+del?\s+(cliente|empleado|empresa|usuario)/i,
    /^id\s+del?\s+(cliente|empleado|factura|pago)/i,
    /^datos?\s+del?\s/i,
    /^(el|la|los|las|un|una)\s+(cliente|empleado|nombre|id|factura)/i,
    /^<[^>]+>$/,  // <valor>
    /^\[.+\]$/,   // [valor]
    /^{.+}$/,     // {valor}
    /^(ejemplo|test|prueba|sample|placeholder|xxx|yyy|zzz)$/i,
    /^(tu|su|mi)\s+(nombre|cliente|id)/i,
    /^aqui\s+(va|el|la)/i,
    /^insertar?\s/i,
    /^completar?\s/i,
  ];

  for (const [key, val] of Object.entries(args)) {
    if (typeof val !== 'string') continue;
    const trimmed = val.trim();
    if (!trimmed) continue;

    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(trimmed)) {
        console.warn(`[AI] Placeholder detectado en ${nombreHerramienta}: ${key}="${val}"`);
        return {
          error: `El parámetro "${key}" contiene un valor genérico ("${val}"). Necesito el dato real del usuario. Pregúntale directamente.`,
          sugerencia: `Pregunta al usuario: ¿Cuál es el ${key.replace(/_/g, ' ')} que quieres usar?`
        };
      }
    }
  }

  return null;
}

async function ejecutarHerramienta(nombreHerramienta, argumentos, empresaId) {
  const args = coerceBooleans(argumentos);

  // Meta-herramienta: consultar requisitos (no necesita validación)
  if (nombreHerramienta === 'consultar_requisitos') {
    return consultarRequisitos(args);
  }

  // 🛡️ Detectar placeholders ANTES de ejecutar
  const placeholderError = detectPlaceholders(args, nombreHerramienta);
  if (placeholderError) {
    return placeholderError;
  }

  // Resolver nombres → IDs automáticamente
  const resolveError = await resolveIds(args, empresaId);
  if (resolveError) {
    console.log(`[AI] Error resolviendo IDs para ${nombreHerramienta}:`, resolveError);
    return resolveError;
  }

  console.log(`[AI] Ejecutando: ${nombreHerramienta}`, args);

  try {
    switch (nombreHerramienta) {
      // Lectura
      case "consultar_facturas": return await consultarFacturas(args, empresaId);
      case "consultar_empleados": return await consultarEmpleados(args, empresaId);
      case "consultar_clientes": return await consultarClientes(args, empresaId);
      case "estadisticas_facturacion": return await estadisticasFacturacion(args, empresaId);
      case "trabajos_pendientes_facturar": return await trabajosPendientesFacturar(args, empresaId);
      case "consultar_calendario": return await consultarCalendario(args, empresaId);
      case "consultar_ausencias": return await consultarAusencias(args, empresaId);
      case "consultar_conocimiento": return await consultarConocimiento(args, empresaId);
      // Calendario
      case "crear_evento_calendario": return await crearEventoCalendario(args, empresaId);
      case "eliminar_evento_calendario": return await eliminarEventoCalendario(args, empresaId);
      case "sincronizar_google_calendar": return await sincronizarGoogleCalendar(args, empresaId);
      // Facturas
      case "crear_factura": return await crearFactura(args, empresaId);
      case "actualizar_factura": return await actualizarFactura(args, empresaId);
      case "validar_factura": return await validarFactura(args, empresaId);
      case "anular_factura": return await anularFactura(args, empresaId);
      case "eliminar_factura": return await eliminarFacturaBorrador(args, empresaId);
      case "enviar_factura_email": return await enviarFacturaEmail(args, empresaId);
      // Clientes
      case "crear_cliente": return await crearCliente(args, empresaId);
      case "actualizar_cliente": return await actualizarCliente(args, empresaId);
      case "desactivar_cliente": return await desactivarCliente(args, empresaId);
      // Pagos
      case "crear_pago": return await crearPago(args, empresaId);
      case "eliminar_pago": return await eliminarPago(args, empresaId);
      // Empleados
      case "actualizar_empleado": return await actualizarEmpleado(args, empresaId);
      // Trabajos
      case "crear_trabajo": return await crearTrabajo(args, empresaId);
      case "consultar_historial_trabajos": return await consultarHistorialTrabajos(args, empresaId);
      case "marcar_trabajo_cobrado": return await marcarTrabajoCobrado(args, empresaId);
      // Gastos
      case "registrar_gasto": return await registrarGasto(args, empresaId);
      case "registrar_factura_existente": return await registrarFacturaExistente(args, empresaId);
      // Análisis Avanzado
      case "consultar_resumen_financiero": return await consultarResumenFinanciero(args, empresaId);
      // Ausencias
      case "crear_ausencia": return await crearAusencia(args, empresaId);
      // Nuevos skills: Analytics financiero
      case "top_clientes": return await topClientes(args, empresaId);
      case "resumen_ejecutivo": return await resumenEjecutivo(args, empresaId);
      case "consultar_deuda": return await consultarDeuda(args, empresaId);
      case "consultar_pagos": return await consultarPagos(args, empresaId);
      case "comparar_periodos": return await compararPeriodos(args, empresaId);
      case "tendencia_facturacion": return await tendenciaFacturacion(args, empresaId);
      case "clientes_en_riesgo": return await clientesEnRiesgo(args, empresaId);
      case "alertas_negocio": return await alertasNegocio(args, empresaId);
      // Nuevos skills: RRHH
      case "consultar_fichajes": return await consultarFichajes(args, empresaId);
      case "resumen_horas_empleado": return await resumenHorasEmpleado(args, empresaId);
      case "consultar_ausencias_resumen": return await consultarAusenciasResumen(args, empresaId);
      case "productividad_empleado": return await productividadEmpleado(args, empresaId);
      // Nuevos skills: Automatización
      case "facturar_trabajos_pendientes": return await facturarTrabajosPendientes(args, empresaId);
      case "cierre_mensual": return await cierreMensual(args, empresaId);
      default: return { error: "Herramienta no encontrada" };
    }
  } catch (err) {
    console.error(`[AI] Error en herramienta ${nombreHerramienta}:`, err);
    return { error: err.message || "Error ejecutando herramienta" };
  }
}

// ============================
// HERRAMIENTAS DE LECTURA
// ============================

async function consultarFacturas({ estado = "TODOS", estado_pago = "todos", cliente_id, limite = 10 }, empresaId) {
  let query = sql`
    SELECT f.id, f.numero, f.fecha, f.total, f.estado, f.pagado, f.estado_pago, c.nombre as cliente_nombre
    FROM factura_180 f LEFT JOIN clients_180 c ON f.cliente_id = c.id
    WHERE f.empresa_id = ${empresaId}
  `;
  if (estado !== "TODOS") query = sql`${query} AND f.estado = ${estado}`;
  if (estado_pago !== "todos") query = sql`${query} AND COALESCE(f.estado_pago, 'pendiente') = ${estado_pago}`;
  if (cliente_id) query = sql`${query} AND f.cliente_id = ${cliente_id}`;
  query = sql`${query} ORDER BY f.fecha DESC LIMIT ${limite}`;
  const facturas = await query;
  return {
    total: facturas.length,
    facturas: facturas.map(f => ({
      id: f.id, numero: f.numero || "Borrador", fecha: f.fecha, cliente: f.cliente_nombre,
      total: Number(f.total), pagado: Number(f.pagado || 0),
      saldo: Number(f.total) - Number(f.pagado || 0),
      estado: f.estado, estado_pago: f.estado_pago || "pendiente"
    }))
  };
}

async function consultarEmpleados({ activos_solo = true }, empresaId) {
  let query = sql`
    SELECT e.id, e.nombre, e.activo, e.tipo_trabajo, u.email
    FROM employees_180 e
    LEFT JOIN users_180 u ON e.user_id = u.id
    WHERE e.empresa_id = ${empresaId}`;
  if (activos_solo) query = sql`${query} AND e.activo = true`;
  query = sql`${query} ORDER BY e.nombre ASC`;
  const empleados = await query;
  return { total: empleados.length, empleados: empleados.map(e => ({ id: e.id, nombre: e.nombre, email: e.email, tipo: e.tipo_trabajo, activo: e.activo })) };
}

async function consultarClientes({ activos_solo = true }, empresaId) {
  let query = sql`SELECT id, nombre, email, telefono, activo FROM clients_180 WHERE empresa_id = ${empresaId}`;
  if (activos_solo) query = sql`${query} AND activo = true`;
  query = sql`${query} ORDER BY nombre ASC`;
  const clientes = await query;
  return { total: clientes.length, clientes: clientes.map(c => ({ id: c.id, nombre: c.nombre, email: c.email, telefono: c.telefono, activo: c.activo })) };
}

async function estadisticasFacturacion({ mes, anio }, empresaId) {
  const now = new Date();
  const m = mes || (now.getMonth() + 1);
  const a = anio || now.getFullYear();
  const stats = await sql`
    SELECT COUNT(*) as total_facturas, COALESCE(SUM(total), 0) as total_facturado,
           COALESCE(SUM(pagado), 0) as total_cobrado, COALESCE(SUM(total - COALESCE(pagado, 0)), 0) as total_pendiente
    FROM factura_180 WHERE empresa_id = ${empresaId} AND estado = 'VALIDADA'
      AND EXTRACT(MONTH FROM fecha) = ${m} AND EXTRACT(YEAR FROM fecha) = ${a}
  `;
  const porEstado = await sql`
    SELECT COALESCE(estado_pago, 'pendiente') as estado, COUNT(*) as cantidad, COALESCE(SUM(total), 0) as importe
    FROM factura_180 WHERE empresa_id = ${empresaId} AND estado = 'VALIDADA'
      AND EXTRACT(MONTH FROM fecha) = ${m} AND EXTRACT(YEAR FROM fecha) = ${a}
    GROUP BY estado_pago
  `;
  return {
    periodo: `${m}/${a}`, total_facturas: Number(stats[0].total_facturas),
    total_facturado: Number(stats[0].total_facturado), total_cobrado: Number(stats[0].total_cobrado),
    total_pendiente: Number(stats[0].total_pendiente),
    por_estado: porEstado.map(e => ({ estado: e.estado, cantidad: Number(e.cantidad), importe: Number(e.importe) }))
  };
}

async function trabajosPendientesFacturar({ cliente_id }, empresaId) {
  let query = sql`
    SELECT w.id, w.descripcion, w.fecha, w.valor, c.nombre as cliente_nombre
    FROM work_logs_180 w LEFT JOIN clients_180 c ON w.cliente_id = c.id
    WHERE w.empresa_id = ${empresaId} AND w.factura_id IS NULL
  `;
  if (cliente_id) query = sql`${query} AND w.cliente_id = ${cliente_id}`;
  query = sql`${query} ORDER BY w.fecha DESC LIMIT 20`;
  const trabajos = await query;
  return {
    total: trabajos.length,
    total_valor: trabajos.reduce((sum, t) => sum + Number(t.valor || 0), 0),
    trabajos: trabajos.map(t => ({ descripcion: t.descripcion, fecha: t.fecha, cliente: t.cliente_nombre, valor: Number(t.valor || 0) }))
  };
}

async function consultarCalendario({ fecha_inicio, fecha_fin, tipo = "todos" }, empresaId) {
  let query = sql`
    SELECT id, fecha, tipo, nombre, descripcion, es_laborable, origen
    FROM calendario_empresa_180
    WHERE empresa_id = ${empresaId} AND fecha >= ${fecha_inicio} AND fecha <= ${fecha_fin} AND activo = true
  `;
  if (tipo === "festivos") query = sql`${query} AND tipo IN ('festivo_local', 'festivo_nacional', 'festivo_empresa', 'convenio')`;
  else if (tipo === "cierres") query = sql`${query} AND tipo IN ('cierre_empresa', 'no_laborable')`;
  else if (tipo === "laborables") query = sql`${query} AND es_laborable = true`;
  query = sql`${query} ORDER BY fecha ASC`;
  const eventos = await query;
  return { total: eventos.length, rango: { desde: fecha_inicio, hasta: fecha_fin }, eventos: eventos.map(e => ({ id: e.id, fecha: e.fecha, tipo: e.tipo, nombre: e.nombre, descripcion: e.descripcion, es_laborable: e.es_laborable })) };
}

async function consultarAusencias({ fecha_inicio, fecha_fin, empleado_id, tipo = "todos" }, empresaId) {
  let query = sql`
    SELECT a.id, a.tipo, a.fecha_inicio, a.fecha_fin, a.estado, a.comentario_empleado, a.motivo, e.nombre as empleado_nombre
    FROM ausencias_180 a LEFT JOIN employees_180 e ON a.empleado_id = e.id
    WHERE a.empresa_id = ${empresaId} AND a.fecha_inicio <= ${fecha_fin} AND a.fecha_fin >= ${fecha_inicio}
  `;
  if (empleado_id) query = sql`${query} AND a.empleado_id = ${empleado_id}`;
  if (tipo !== "todos") query = sql`${query} AND a.tipo = ${tipo}`;
  query = sql`${query} ORDER BY a.fecha_inicio ASC`;
  const ausencias = await query;
  return { total: ausencias.length, rango: { desde: fecha_inicio, hasta: fecha_fin }, ausencias: ausencias.map(a => ({ empleado: a.empleado_nombre, tipo: a.tipo, desde: a.fecha_inicio, hasta: a.fecha_fin, estado: a.estado, motivo: a.motivo || a.comentario_empleado })) };
}

async function consultarConocimiento({ busqueda }, empresaId) {
  const term = busqueda.trim();
  const hits = await sql`
    SELECT token, respuesta, prioridad,
      CASE
        WHEN LOWER(token) = LOWER(${term}) THEN 3
        WHEN ${term} ILIKE ('%' || token || '%') THEN 2
        WHEN token ILIKE ${'%' + term + '%'} THEN 1
        ELSE 0
      END as relevancia
    FROM conocimiento_180
    WHERE empresa_id = ${empresaId}
      AND activo = true
      AND (
        LOWER(token) = LOWER(${term})
        OR ${term} ILIKE ('%' || token || '%')
        OR token ILIKE ${'%' + term + '%'}
      )
    ORDER BY relevancia DESC, prioridad DESC
    LIMIT 1
  `;
  if (hits.length === 0) return { mensaje: null };
  return { respuesta_directa: hits[0].respuesta, tema: hits[0].token };
}

// ============================
// HERRAMIENTAS DE ESCRITURA - CALENDARIO
// ============================

async function crearEventoCalendario({ fecha, nombre, tipo, es_laborable = false, descripcion = "" }, empresaId) {
  const result = await sql`
    INSERT INTO calendario_empresa_180 (empresa_id, fecha, tipo, nombre, descripcion, es_laborable, origen, activo, confirmado)
    VALUES (${empresaId}, ${fecha}, ${tipo}, ${nombre}, ${descripcion}, ${es_laborable}, 'ai_agent', true, true)
    RETURNING id
  `;
  const calendarConfig = await getCalendarConfig(empresaId);
  let sincronizado = false;
  if (calendarConfig && calendarConfig.sync_enabled) {
    try {
      const googleEventData = app180ToGoogleEvent({ id: result[0].id, fecha, tipo, nombre, descripcion, es_laborable });
      await createGoogleEvent(empresaId, googleEventData);
      await sql`
        INSERT INTO calendar_event_mapping_180 (empresa_id, app180_source, app180_event_id, google_calendar_id, google_event_id, sync_direction)
        VALUES (${empresaId}, 'calendario_empresa', ${result[0].id}, ${calendarConfig.calendar_id || 'primary'}, ${result[0].id}, 'to_google')
        ON CONFLICT (empresa_id, app180_source, app180_event_id) DO NOTHING
      `;
      sincronizado = true;
    } catch (syncErr) { console.error("[AI] Error sync Google:", syncErr); }
  }
  return { success: true, mensaje: `Evento "${nombre}" creado para el ${fecha}${sincronizado ? ' y sincronizado con Google Calendar' : ''}`, evento: { id: result[0].id, fecha, nombre, tipo } };
}

async function eliminarEventoCalendario({ evento_id }, empresaId) {
  const [evento] = await sql`SELECT id, nombre, fecha FROM calendario_empresa_180 WHERE id = ${evento_id} AND empresa_id = ${empresaId}`;
  if (!evento) return { error: "Evento no encontrado" };
  await sql`UPDATE calendario_empresa_180 SET activo = false WHERE id = ${evento_id} AND empresa_id = ${empresaId}`;
  return { success: true, mensaje: `Evento "${evento.nombre}" del ${evento.fecha} eliminado.` };
}

async function sincronizarGoogleCalendar({ direccion = "bidirectional" }, empresaId) {
  const dateFrom = new Date().toISOString().split('T')[0];
  const dateTo = (() => { const d = new Date(); d.setMonth(d.getMonth() + 12); return d.toISOString().split('T')[0]; })();
  let stats;
  if (direccion === "to_google") stats = await syncToGoogle(empresaId, { dateFrom, dateTo, userId: null });
  else if (direccion === "from_google") stats = await syncFromGoogle(empresaId, { dateFrom, dateTo, userId: null });
  else stats = await syncBidirectional(empresaId, { dateFrom, dateTo, userId: null });
  return { success: true, mensaje: "Sincronización completada", estadisticas: stats };
}

// ============================
// HERRAMIENTAS DE ESCRITURA - FACTURAS
// ============================

async function crearFactura({ cliente_id, fecha, lineas, iva_global = 0 }, empresaId) {
  const [cliente] = await sql`SELECT id, nombre FROM clients_180 WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
  if (!cliente) return { error: "Cliente no encontrado" };
  if (!Array.isArray(lineas) || lineas.length === 0) return { error: "Debe incluir al menos una linea" };

  let createdId;
  let total;
  await sql.begin(async (tx) => {
    let subtotal = 0;
    let iva_total = 0;
    const [factura] = await tx`
      INSERT INTO factura_180 (empresa_id, cliente_id, fecha, estado, iva_global, subtotal, iva_total, total, created_at)
      VALUES (${empresaId}, ${cliente_id}, ${fecha}::date, 'BORRADOR', ${iva_global || 0}, 0, 0, 0, now())
      RETURNING id
    `;
    createdId = factura.id;

    for (const linea of lineas) {
      const descripcion = (linea.descripcion || "").trim();
      if (!descripcion) continue;
      const cantidad = parseFloat(linea.cantidad || 0);
      const precio_unitario = parseFloat(linea.precio_unitario || 0);
      const iva_pct = parseFloat(linea.iva || iva_global || 0);
      const base = cantidad * precio_unitario;
      const importe_iva = base * iva_pct / 100;
      subtotal += base;
      iva_total += importe_iva;
      await tx`
        INSERT INTO lineafactura_180 (factura_id, descripcion, cantidad, precio_unitario, total, iva_percent)
        VALUES (${factura.id}, ${descripcion}, ${cantidad}, ${precio_unitario}, ${base + importe_iva}, ${iva_pct})
      `;
    }
    total = Math.round((subtotal + iva_total) * 100) / 100;
    await tx`
      UPDATE factura_180 SET subtotal = ${Math.round(subtotal * 100) / 100},
        iva_total = ${Math.round(iva_total * 100) / 100}, total = ${total}
      WHERE id = ${factura.id}
    `;
  });

  return { success: true, mensaje: `Factura borrador creada para ${cliente.nombre}. Total: ${total.toFixed(2)} EUR. ID: ${createdId}`, factura: { id: createdId, cliente: cliente.nombre, total, estado: "BORRADOR" } };
}

async function actualizarFactura({ factura_id, cliente_id, fecha, lineas }, empresaId) {
  const [factura] = await sql`SELECT * FROM factura_180 WHERE id = ${factura_id} AND empresa_id = ${empresaId}`;
  if (!factura) return { error: "Factura no encontrada" };
  if (factura.estado !== "BORRADOR") return { error: "Solo se pueden editar facturas en borrador" };

  await sql.begin(async (tx) => {
    if (cliente_id || fecha) {
      await tx`
        UPDATE factura_180 SET
          cliente_id = ${cliente_id || factura.cliente_id},
          fecha = ${fecha ? sql`${fecha}::date` : factura.fecha}
        WHERE id = ${factura_id}
      `;
    }
    if (Array.isArray(lineas) && lineas.length > 0) {
      await tx`DELETE FROM lineafactura_180 WHERE factura_id = ${factura_id}`;
      let subtotal = 0, iva_total = 0;
      const iva_global = factura.iva_global || 0;
      for (const linea of lineas) {
        const descripcion = (linea.descripcion || "").trim();
        if (!descripcion) continue;
        const cantidad = parseFloat(linea.cantidad || 0);
        const precio_unitario = parseFloat(linea.precio_unitario || 0);
        const iva_pct = parseFloat(linea.iva || iva_global || 0);
        const base = cantidad * precio_unitario;
        const importe_iva = base * iva_pct / 100;
        subtotal += base;
        iva_total += importe_iva;
        await tx`
          INSERT INTO lineafactura_180 (factura_id, descripcion, cantidad, precio_unitario, total, iva_percent)
          VALUES (${factura_id}, ${descripcion}, ${cantidad}, ${precio_unitario}, ${base + importe_iva}, ${iva_pct})
        `;
      }
      await tx`
        UPDATE factura_180 SET subtotal = ${Math.round(subtotal * 100) / 100},
          iva_total = ${Math.round(iva_total * 100) / 100},
          total = ${Math.round((subtotal + iva_total) * 100) / 100}
        WHERE id = ${factura_id}
      `;
    }
  });

  return { success: true, mensaje: `Factura borrador #${factura_id} actualizada.` };
}

async function validarFactura({ factura_id }, empresaId) {
  const [factura] = await sql`SELECT * FROM factura_180 WHERE id = ${factura_id} AND empresa_id = ${empresaId}`;
  if (!factura) return { error: "Factura no encontrada" };
  if (factura.estado !== "BORRADOR") return { error: "Solo se pueden validar facturas en borrador" };

  // Generar numero: F-YYYY-NNNN
  const year = new Date().getFullYear();
  const [max] = await sql`
    SELECT MAX(CAST(SUBSTRING(numero FROM '[0-9]+$') AS INTEGER)) as ultimo
    FROM factura_180 WHERE empresa_id = ${empresaId}
      AND estado IN ('VALIDADA', 'ANULADA')
      AND numero LIKE ${'F-' + year + '-%'}
  `;
  const siguiente = (Number(max?.ultimo) || 0) + 1;
  const numero = `F-${year}-${String(siguiente).padStart(4, '0')}`;

  await sql`
    UPDATE factura_180 SET estado = 'VALIDADA', numero = ${numero}, fecha = ${new Date().toISOString().split('T')[0]}::date
    WHERE id = ${factura_id} AND empresa_id = ${empresaId}
  `;

  return { success: true, mensaje: `Factura validada con numero ${numero}. Total: ${Number(factura.total).toFixed(2)} EUR.` };
}

async function anularFactura({ factura_id }, empresaId) {
  const [factura] = await sql`SELECT * FROM factura_180 WHERE id = ${factura_id} AND empresa_id = ${empresaId}`;
  if (!factura) return { error: "Factura no encontrada" };
  if (factura.estado !== "VALIDADA") return { error: "Solo se pueden anular facturas validadas" };

  await sql`UPDATE factura_180 SET estado = 'ANULADA' WHERE id = ${factura_id} AND empresa_id = ${empresaId}`;

  return { success: true, mensaje: `Factura ${factura.numero} anulada correctamente.` };
}

async function eliminarFacturaBorrador({ factura_id }, empresaId) {
  const [factura] = await sql`SELECT id, estado, total FROM factura_180 WHERE id = ${factura_id} AND empresa_id = ${empresaId}`;
  if (!factura) return { error: "Factura no encontrada" };
  if (factura.estado !== "BORRADOR") return { error: "Solo se pueden eliminar facturas en borrador" };

  await sql.begin(async (tx) => {
    await tx`UPDATE work_logs_180 SET factura_id = NULL WHERE factura_id = ${factura_id} AND empresa_id = ${empresaId}`;
    await tx`DELETE FROM lineafactura_180 WHERE factura_id = ${factura_id}`;
    await tx`DELETE FROM factura_180 WHERE id = ${factura_id} AND empresa_id = ${empresaId}`;
  });

  return { success: true, mensaje: `Factura borrador #${factura_id} eliminada.` };
}

async function enviarFacturaEmail({ factura_id, destinatario, asunto }, empresaId) {
  const [factura] = await sql`
    SELECT f.*, c.nombre as cliente_nombre FROM factura_180 f
    LEFT JOIN clients_180 c ON f.cliente_id = c.id
    WHERE f.id = ${factura_id} AND f.empresa_id = ${empresaId}
  `;
  if (!factura) return { error: "Factura no encontrada" };
  if (factura.estado !== "VALIDADA") return { error: "Solo se pueden enviar facturas validadas" };

  // Importar servicio de email dinamicamente
  try {
    const emailService = await import("./emailService.js");
    const { generarPdfFactura } = await import("./facturaPdfService.js");

    const pdfBuffer = await generarPdfFactura(factura_id, empresaId);
    const subject = asunto || `Factura ${factura.numero} - APP180`;

    await emailService.enviarEmail({
      empresaId,
      to: destinatario,
      subject,
      html: `<p>Adjunta encontrará la factura ${factura.numero}.</p>`,
      attachments: [{ filename: `Factura_${factura.numero}.pdf`, content: pdfBuffer }]
    });

    return { success: true, mensaje: `Factura ${factura.numero} enviada por email a ${destinatario}.` };
  } catch (err) {
    console.error("[AI] Error enviando email:", err);
    return { error: `Error enviando email: ${err.message}` };
  }
}

// ============================
// HERRAMIENTAS DE ESCRITURA - CLIENTES
// ============================

async function crearCliente({ nombre, email, telefono, nif_cif, direccion, notas }, empresaId) {
  // Generar codigo automatico
  const [seq] = await sql`
    SELECT last_num FROM cliente_seq_180 WHERE empresa_id = ${empresaId}
  `;
  let nextNum = 1;
  if (seq) {
    nextNum = (seq.last_num || 0) + 1;
    await sql`UPDATE cliente_seq_180 SET last_num = ${nextNum} WHERE empresa_id = ${empresaId}`;
  } else {
    await sql`INSERT INTO cliente_seq_180 (empresa_id, last_num) VALUES (${empresaId}, 1)`;
  }
  const codigo = `CLI-${String(nextNum).padStart(5, '0')}`;

  const [cliente] = await sql`
    INSERT INTO clients_180 (empresa_id, nombre, codigo, email, telefono, nif_cif, direccion, notas, activo)
    VALUES (${empresaId}, ${nombre}, ${codigo}, ${email || null}, ${telefono || null}, ${nif_cif || null}, ${direccion || null}, ${notas || null}, true)
    RETURNING id, nombre, codigo
  `;

  return { success: true, mensaje: `Cliente "${nombre}" creado con codigo ${codigo}.`, cliente: { id: cliente.id, nombre: cliente.nombre, codigo: cliente.codigo } };
}

async function actualizarCliente({ cliente_id, nombre, email, telefono, nif_cif, direccion, notas }, empresaId) {
  const [cliente] = await sql`SELECT id, nombre FROM clients_180 WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
  if (!cliente) return { error: "Cliente no encontrado" };

  const updates = {};
  if (nombre !== undefined) updates.nombre = nombre;
  if (email !== undefined) updates.email = email;
  if (telefono !== undefined) updates.telefono = telefono;
  if (nif_cif !== undefined) updates.nif_cif = nif_cif;
  if (direccion !== undefined) updates.direccion = direccion;
  if (notas !== undefined) updates.notas = notas;

  if (Object.keys(updates).length === 0) return { error: "No hay campos para actualizar" };

  await sql`
    UPDATE clients_180 SET
      nombre = COALESCE(${updates.nombre || null}, nombre),
      email = COALESCE(${updates.email || null}, email),
      telefono = COALESCE(${updates.telefono || null}, telefono),
      nif_cif = COALESCE(${updates.nif_cif || null}, nif_cif),
      direccion = COALESCE(${updates.direccion || null}, direccion),
      notas = COALESCE(${updates.notas || null}, notas)
    WHERE id = ${cliente_id} AND empresa_id = ${empresaId}
  `;

  return { success: true, mensaje: `Cliente "${cliente.nombre}" actualizado.` };
}

async function desactivarCliente({ cliente_id }, empresaId) {
  const [cliente] = await sql`SELECT nombre FROM clients_180 WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
  if (!cliente) return { error: "Cliente no encontrado" };
  await sql`UPDATE clients_180 SET activo = false WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
  return { success: true, mensaje: `Cliente "${cliente.nombre}" desactivado.` };
}

// ============================
// HERRAMIENTAS DE ESCRITURA - PAGOS
// ============================

async function crearPago({ cliente_id, importe, metodo, fecha_pago, referencia }, empresaId) {
  const [cliente] = await sql`SELECT id, nombre FROM clients_180 WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
  if (!cliente) return { error: "Cliente no encontrado" };
  if (Number(importe) <= 0) return { error: "Importe debe ser mayor que 0" };

  const metodosValidos = ["transferencia", "efectivo", "tarjeta", "bizum", "otro"];
  if (!metodosValidos.includes(metodo)) return { error: `Metodo invalido. Usa: ${metodosValidos.join(', ')}` };

  const [pago] = await sql`
    INSERT INTO payments_180 (empresa_id, cliente_id, importe, metodo, fecha_pago, referencia)
    VALUES (${empresaId}, ${cliente_id}, ${importe}, ${metodo}, ${fecha_pago || new Date().toISOString().split('T')[0]}, ${referencia || null})
    RETURNING id
  `;

  return { success: true, mensaje: `Pago de ${Number(importe).toFixed(2)} EUR registrado para ${cliente.nombre}. ID: ${pago.id}. Metodo: ${metodo}.` };
}

async function eliminarPago({ pago_id }, empresaId) {
  const [pago] = await sql`SELECT id, importe, cliente_id FROM payments_180 WHERE id = ${pago_id} AND empresa_id = ${empresaId}`;
  if (!pago) return { error: "Pago no encontrado" };

  await sql.begin(async (tx) => {
    // Revertir imputaciones
    const allocations = await tx`SELECT * FROM payment_allocations_180 WHERE payment_id = ${pago_id} AND empresa_id = ${empresaId}`;
    for (const alloc of allocations) {
      if (alloc.factura_id) {
        await tx`
          UPDATE factura_180 SET pagado = GREATEST(0, COALESCE(pagado, 0) - ${alloc.importe}),
            estado_pago = CASE WHEN GREATEST(0, COALESCE(pagado, 0) - ${alloc.importe}) <= 0 THEN 'pendiente'
              WHEN GREATEST(0, COALESCE(pagado, 0) - ${alloc.importe}) < total THEN 'parcial' ELSE 'pagado' END
          WHERE id = ${alloc.factura_id} AND empresa_id = ${empresaId}
        `;
      }
    }
    await tx`DELETE FROM payment_allocations_180 WHERE payment_id = ${pago_id} AND empresa_id = ${empresaId}`;
    await tx`DELETE FROM payments_180 WHERE id = ${pago_id} AND empresa_id = ${empresaId}`;
  });

  return { success: true, mensaje: `Pago de ${Number(pago.importe).toFixed(2)} EUR eliminado y imputaciones revertidas.` };
}

// ============================
// HERRAMIENTAS DE ESCRITURA - EMPLEADOS
// ============================

async function actualizarEmpleado({ empleado_id, nombre, activo }, empresaId) {
  const [empleado] = await sql`SELECT id, nombre FROM employees_180 WHERE id = ${empleado_id} AND empresa_id = ${empresaId}`;
  if (!empleado) return { error: "Empleado no encontrado" };

  if (nombre !== undefined) {
    await sql`UPDATE employees_180 SET nombre = ${nombre} WHERE id = ${empleado_id} AND empresa_id = ${empresaId}`;
  }
  if (activo !== undefined) {
    await sql`UPDATE employees_180 SET activo = ${activo} WHERE id = ${empleado_id} AND empresa_id = ${empresaId}`;
  }

  return { success: true, mensaje: `Empleado "${empleado.nombre}" actualizado.` };
}

// ============================
// HERRAMIENTAS DE ESCRITURA - TRABAJOS
// ============================

async function crearTrabajo({ cliente_id, descripcion, concepto_facturacion, detalles, fecha, horas, minutos, precio }, empresaId) {
  const fechaTrabajo = fecha || new Date().toISOString().split('T')[0];
  const valor = precio || null;
  // Aceptar horas como alternativa a minutos
  const totalMinutos = minutos || (horas ? Math.round(horas * 60) : 0);

  let clienteNombre = null;
  if (cliente_id) {
    const [c] = await sql`SELECT id, nombre FROM clients_180 WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
    if (!c) return { error: "Cliente no encontrado" };
    clienteNombre = c.nombre;
  }

  const [trabajo] = await sql`
    INSERT INTO work_logs_180 (empresa_id, cliente_id, descripcion, concepto_facturacion, detalles, fecha, minutos, valor)
    VALUES (${empresaId}, ${cliente_id || null}, ${descripcion}, ${concepto_facturacion || null}, ${detalles || null}, ${fechaTrabajo}::date, ${totalMinutos}, ${valor})
    RETURNING id
  `;

  const horasDisplay = totalMinutos >= 60 ? `${Math.floor(totalMinutos / 60)}h ${totalMinutos % 60 > 0 ? `${totalMinutos % 60}min` : ''}` : `${totalMinutos} min`;
  return { success: true, mensaje: `Trabajo registrado${clienteNombre ? ` para ${clienteNombre}` : ''}. Duración: ${horasDisplay.trim()}. Fecha: ${fechaTrabajo}. ID: ${trabajo.id}` };
}

async function consultarHistorialTrabajos({ cliente_id, limite = 5 }, empresaId) {
  if (!cliente_id) return { error: "ID del cliente es necesario para consultar el historial." };

  const limitNum = parseInt(String(limite)) || 5;

  const trabajos = await sql`
    SELECT id, fecha, descripcion, concepto_facturacion, detalles
    FROM work_logs_180
    WHERE empresa_id = ${empresaId} AND cliente_id = ${cliente_id}
    ORDER BY fecha DESC, created_at DESC
    LIMIT ${limitNum}
  `;

  if (trabajos.length === 0) return { mensaje: "No hay trabajos registrados anteriormente para este cliente." };

  return {
    total: trabajos.length,
    trabajos: trabajos.map(t => ({
      id: t.id,
      fecha: t.fecha,
      trabajo: t.descripcion,
      concepto_corto: t.concepto_facturacion || "No indicado",
      detalles: t.detalles || ""
    })),
    instruccion: "Muestra esta tabla al usuario y pregúntale si quiere usar uno de estos como base o prefiere registrar un TRABAJO NUEVO."
  };
}

async function marcarTrabajoCobrado({ trabajo_id, metodo_pago }, empresaId) {
  const [trabajo] = await sql`
    UPDATE work_logs_180
    SET estado_pago = 'pagado', 
        metodo_pago_directo = ${metodo_pago || 'efectivo'},
        pagado_at = NOW()
    WHERE id = ${trabajo_id} AND empresa_id = ${empresaId}
    RETURNING id, descripcion
  `;
  if (!trabajo) return { error: "Trabajo no encontrado." };
  return { success: true, mensaje: `Trabajo "${trabajo.descripcion}" marcado como COBRADO DIRECTAMENTE.` };
}

// ============================
// HERRAMIENTAS DE ESCRITURA - GASTOS
// ============================

async function registrarGasto({ proveedor, descripcion, total, base_imponible, iva_importe, iva_porcentaje, fecha, categoria, metodo_pago }, empresaId) {
  const fechaGasto = fecha || new Date().toISOString().split('T')[0];
  const [gasto] = await sql`
    INSERT INTO purchases_180 (
      empresa_id, proveedor, descripcion, total, base_imponible, 
      iva_importe, iva_porcentaje, fecha_compra, categoria, metodo_pago, activo
    ) VALUES (
      ${empresaId}, ${proveedor || null}, ${descripcion}, ${total}, 
      ${base_imponible || total}, ${iva_importe || 0}, ${iva_porcentaje || 0}, 
      ${fechaGasto}, ${categoria || 'general'}, ${metodo_pago || 'otro'}, true
    ) RETURNING id
  `;
  return { success: true, mensaje: `Gasto registrado: "${descripcion}" por un total de ${total}€. ID: ${gasto.id}` };
}

async function registrarFacturaExistente({ numero_factura, nombre_cliente, fecha_emision, total, estado_pago }, empresaId) {
  const fecha = fecha_emision || new Date().toISOString().split('T')[0];

  // Buscar cliente
  const [cliente] = await sql`
    SELECT id FROM clients_180 WHERE nombre ILIKE ${'%' + nombre_cliente + '%'} AND empresa_id = ${empresaId} LIMIT 1
  `;
  if (!cliente) return { error: `No se encontró al cliente "${nombre_cliente}".` };

  const [idExistente] = await sql`
    SELECT id FROM invoices_180 WHERE numero_factura = ${numero_factura} AND empresa_id = ${empresaId}
  `;
  if (idExistente) return { error: `La factura ${numero_factura} ya está registrada.` };

  const [factura] = await sql`
    INSERT INTO invoices_180 (
      empresa_id, numero_factura, cliente_id, fecha_emision, total, estado_pago, estado_emision, activo
    ) VALUES (
      ${empresaId}, ${numero_factura}, ${cliente.id}, ${fecha}, ${total}, 
      ${estado_pago || 'pendiente'}, 'VALIDADA', true
    ) RETURNING id
  `;

  return { success: true, mensaje: `Factura ${numero_factura} recuperada con éxito. ID: ${factura.id}` };
}

// ============================
// HERRAMIENTAS DE ANÁLISIS AVANZADO
// ============================

async function consultarResumenFinanciero({ periodo = 'mes_actual' }, empresaId) {
  let startDate, endDate;
  const now = new Date();

  if (periodo === 'mes_actual') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (periodo === 'mes_anterior') {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    endDate = new Date(now.getFullYear(), now.getMonth(), 0);
  } else {
    startDate = new Date(now.getFullYear(), 0, 1);
    endDate = new Date(now.getFullYear(), 11, 31);
  }

  // 1. Ingresos por Facturas (Pagadas o Parcialmente)
  const [ingresosFacturas] = await sql`
    SELECT COALESCE(SUM(total), 0) as total
    FROM invoices_180
    WHERE empresa_id = ${empresaId} 
      AND fecha_emision BETWEEN ${startDate} AND ${endDate}
      AND estado_pago IN ('pagado', 'parcial')
  `;

  // 2. Ingresos por Cobros Directos (Trabajos pagados sin factura)
  const [ingresosDirectos] = await sql`
    SELECT COALESCE(SUM(valor), 0) as total
    FROM work_logs_180
    WHERE empresa_id = ${empresaId}
      AND pagado_at BETWEEN ${startDate} AND ${endDate}
      AND estado_pago = 'pagado'
  `;

  // 3. Gastos
  const [gastos] = await sql`
    SELECT COALESCE(SUM(total), 0) as total
    FROM purchases_180
    WHERE empresa_id = ${empresaId}
      AND fecha_compra BETWEEN ${startDate} AND ${endDate}
      AND activo = true
  `;

  const totalIngresos = Number(ingresosFacturas.total) + Number(ingresosDirectos.total);
  const totalGastos = Number(gastos.total);
  const beneficio = totalIngresos - totalGastos;

  return {
    periodo: `${startDate.toLocaleDateString()} al ${endDate.toLocaleDateString()}`,
    ingresos: {
      facturados: Number(ingresosFacturas.total),
      cobros_directos: Number(ingresosDirectos.total),
      total: totalIngresos
    },
    gastos: totalGastos,
    beneficio_neto: beneficio,
    mensaje: beneficio >= 0 ? "El negocio está en positivo." : "Atención: Los gastos superan a los ingresos en este periodo."
  };
}

// ============================
// HERRAMIENTAS DE ESCRITURA - AUSENCIAS
// ============================

async function crearAusencia({ empleado_id, tipo, fecha_inicio, fecha_fin, motivo }, empresaId) {
  const [empleado] = await sql`SELECT id, nombre FROM employees_180 WHERE id = ${empleado_id} AND empresa_id = ${empresaId}`;
  if (!empleado) return { error: "Empleado no encontrado" };

  const [ausencia] = await sql`
    INSERT INTO ausencias_180 (empresa_id, empleado_id, tipo, fecha_inicio, fecha_fin, motivo, estado)
    VALUES (${empresaId}, ${empleado_id}, ${tipo}, ${fecha_inicio}::date, ${fecha_fin}::date, ${motivo || null}, 'aprobada')
    RETURNING id
  `;

  const tipoLabel = { vacaciones: "Vacaciones", baja_medica: "Baja médica", asuntos_propios: "Asuntos propios", permiso: "Permiso" };
  return { success: true, mensaje: `${tipoLabel[tipo] || tipo} registrada para ${empleado.nombre} del ${fecha_inicio} al ${fecha_fin}. ID: ${ausencia.id}` };
}

// ============================
// NUEVOS SKILLS: ANALYTICS FINANCIERO
// ============================

async function topClientes({ limite = 5, periodo = "todo", criterio = "facturado" }, empresaId) {
  const now = new Date();
  let dateFilter = sql``;
  if (periodo === "mes") {
    dateFilter = sql`AND EXTRACT(MONTH FROM f.fecha) = ${now.getMonth() + 1} AND EXTRACT(YEAR FROM f.fecha) = ${now.getFullYear()}`;
  } else if (periodo === "trimestre") {
    const trimStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    dateFilter = sql`AND f.fecha >= ${trimStart.toISOString().split('T')[0]}`;
  } else if (periodo === "anio") {
    dateFilter = sql`AND EXTRACT(YEAR FROM f.fecha) = ${now.getFullYear()}`;
  }

  const orderCol = criterio === "pendiente" ? "total_pendiente" : criterio === "pagado" ? "total_cobrado" : "total_facturado";

  const rows = await sql`
    SELECT c.id, c.nombre,
      COALESCE(SUM(f.total), 0) as total_facturado,
      COALESCE(SUM(f.pagado), 0) as total_cobrado,
      COALESCE(SUM(f.total - COALESCE(f.pagado, 0)), 0) as total_pendiente,
      COUNT(f.id) as num_facturas
    FROM clients_180 c
    LEFT JOIN factura_180 f ON f.cliente_id = c.id AND f.empresa_id = ${empresaId} AND f.estado = 'VALIDADA' ${dateFilter}
    WHERE c.empresa_id = ${empresaId} AND c.activo = true
    GROUP BY c.id, c.nombre
    HAVING COALESCE(SUM(f.total), 0) > 0
    ORDER BY ${sql(orderCol)} DESC
    LIMIT ${limite}
  `;

  return {
    periodo, criterio, total_clientes: rows.length,
    ranking: rows.map((r, i) => ({
      posicion: i + 1, nombre: r.nombre, total_facturado: Number(r.total_facturado),
      total_cobrado: Number(r.total_cobrado), total_pendiente: Number(r.total_pendiente),
      num_facturas: Number(r.num_facturas)
    }))
  };
}

async function resumenEjecutivo(_args, empresaId) {
  const now = new Date();
  const mesActual = now.getMonth() + 1;
  const anioActual = now.getFullYear();

  const [stats] = await sql`
    SELECT
      COALESCE(SUM(CASE WHEN estado = 'VALIDADA' THEN total ELSE 0 END), 0) as total_facturado,
      COALESCE(SUM(CASE WHEN estado = 'VALIDADA' THEN COALESCE(pagado, 0) ELSE 0 END), 0) as total_cobrado,
      COALESCE(SUM(CASE WHEN estado = 'VALIDADA' THEN total - COALESCE(pagado, 0) ELSE 0 END), 0) as total_pendiente,
      COUNT(CASE WHEN estado = 'VALIDADA' THEN 1 END) as facturas_validadas,
      COUNT(CASE WHEN estado = 'BORRADOR' THEN 1 END) as facturas_borrador
    FROM factura_180
    WHERE empresa_id = ${empresaId}
      AND EXTRACT(MONTH FROM fecha) = ${mesActual} AND EXTRACT(YEAR FROM fecha) = ${anioActual}
  `;

  const [clientes] = await sql`SELECT COUNT(*) as total FROM clients_180 WHERE empresa_id = ${empresaId} AND activo = true`;
  const [empleados] = await sql`SELECT COUNT(*) as total FROM employees_180 WHERE empresa_id = ${empresaId} AND activo = true`;
  const [trabajosPend] = await sql`SELECT COUNT(*) as total, COALESCE(SUM(valor), 0) as valor FROM work_logs_180 WHERE empresa_id = ${empresaId} AND factura_id IS NULL`;

  const [vencidas] = await sql`
    SELECT COUNT(*) as total, COALESCE(SUM(total - COALESCE(pagado, 0)), 0) as importe
    FROM factura_180 WHERE empresa_id = ${empresaId} AND estado = 'VALIDADA'
      AND COALESCE(estado_pago, 'pendiente') != 'pagado' AND fecha < NOW() - INTERVAL '30 days'
  `;

  return {
    periodo: `${mesActual}/${anioActual}`,
    facturacion: {
      total_facturado: Number(stats.total_facturado), total_cobrado: Number(stats.total_cobrado),
      total_pendiente: Number(stats.total_pendiente), facturas_validadas: Number(stats.facturas_validadas),
      facturas_borrador: Number(stats.facturas_borrador)
    },
    empresa: { clientes_activos: Number(clientes.total), empleados_activos: Number(empleados.total) },
    pendientes: {
      trabajos_sin_facturar: Number(trabajosPend.total), valor_sin_facturar: Number(trabajosPend.valor),
      facturas_vencidas: Number(vencidas.total), importe_vencido: Number(vencidas.importe)
    }
  };
}

async function consultarDeuda({ dias_vencido = 30, cliente_id }, empresaId) {
  let query = sql`
    SELECT f.id, f.numero, f.fecha, f.total, COALESCE(f.pagado, 0) as pagado,
      f.total - COALESCE(f.pagado, 0) as saldo, c.nombre as cliente_nombre, c.email,
      EXTRACT(DAY FROM NOW() - f.fecha)::int as dias_antiguedad
    FROM factura_180 f
    LEFT JOIN clients_180 c ON f.cliente_id = c.id
    WHERE f.empresa_id = ${empresaId} AND f.estado = 'VALIDADA'
      AND COALESCE(f.estado_pago, 'pendiente') != 'pagado'
      AND f.fecha < NOW() - INTERVAL '1 day' * ${dias_vencido}
  `;
  if (cliente_id) query = sql`${query} AND f.cliente_id = ${cliente_id}`;
  query = sql`${query} ORDER BY f.fecha ASC LIMIT 30`;

  const deudas = await query;
  const totalDeuda = deudas.reduce((sum, d) => sum + Number(d.saldo), 0);

  return {
    total_facturas_vencidas: deudas.length, total_deuda: totalDeuda,
    dias_minimo: dias_vencido,
    deudas: deudas.map(d => ({
      factura: d.numero || `Borrador #${d.id}`, fecha: d.fecha, cliente: d.cliente_nombre,
      total: Number(d.total), pagado: Number(d.pagado), saldo: Number(d.saldo),
      dias_antiguedad: d.dias_antiguedad
    }))
  };
}

async function consultarPagos({ cliente_id, fecha_desde, fecha_hasta, limite = 20 }, empresaId) {
  let query = sql`
    SELECT p.id, p.importe, p.metodo, p.fecha_pago, p.referencia, c.nombre as cliente_nombre
    FROM payments_180 p
    LEFT JOIN clients_180 c ON p.cliente_id = c.id
    WHERE p.empresa_id = ${empresaId}
  `;
  if (cliente_id) query = sql`${query} AND p.cliente_id = ${cliente_id}`;
  if (fecha_desde) query = sql`${query} AND p.fecha_pago >= ${fecha_desde}`;
  if (fecha_hasta) query = sql`${query} AND p.fecha_pago <= ${fecha_hasta}`;
  query = sql`${query} ORDER BY p.fecha_pago DESC LIMIT ${limite}`;

  const pagos = await query;
  const totalImporte = pagos.reduce((sum, p) => sum + Number(p.importe), 0);

  return {
    total_pagos: pagos.length, total_importe: totalImporte,
    pagos: pagos.map(p => ({
      id: p.id, cliente: p.cliente_nombre, importe: Number(p.importe),
      metodo: p.metodo, fecha: p.fecha_pago, referencia: p.referencia
    }))
  };
}

async function compararPeriodos({ periodo_a, periodo_b }, empresaId) {
  async function getStats(periodo) {
    const [anio, mes] = periodo.split('-').map(Number);
    const [s] = await sql`
      SELECT COUNT(*) as num_facturas,
        COALESCE(SUM(total), 0) as facturado,
        COALESCE(SUM(COALESCE(pagado, 0)), 0) as cobrado,
        COALESCE(SUM(total - COALESCE(pagado, 0)), 0) as pendiente
      FROM factura_180
      WHERE empresa_id = ${empresaId} AND estado = 'VALIDADA'
        AND EXTRACT(MONTH FROM fecha) = ${mes} AND EXTRACT(YEAR FROM fecha) = ${anio}
    `;
    return { periodo, num_facturas: Number(s.num_facturas), facturado: Number(s.facturado), cobrado: Number(s.cobrado), pendiente: Number(s.pendiente) };
  }

  const a = await getStats(periodo_a);
  const b = await getStats(periodo_b);
  const variacion = a.facturado > 0 ? ((b.facturado - a.facturado) / a.facturado * 100) : (b.facturado > 0 ? 100 : 0);

  return {
    periodo_a: a, periodo_b: b,
    variacion_facturado_pct: Math.round(variacion * 10) / 10,
    variacion_cobrado_pct: a.cobrado > 0 ? Math.round((b.cobrado - a.cobrado) / a.cobrado * 1000) / 10 : 0
  };
}

async function tendenciaFacturacion({ meses = 6 }, empresaId) {
  const rows = await sql`
    SELECT TO_CHAR(fecha, 'YYYY-MM') as mes,
      COUNT(*) as num_facturas,
      COALESCE(SUM(total), 0) as facturado,
      COALESCE(SUM(COALESCE(pagado, 0)), 0) as cobrado,
      COALESCE(SUM(total - COALESCE(pagado, 0)), 0) as pendiente
    FROM factura_180
    WHERE empresa_id = ${empresaId} AND estado = 'VALIDADA'
      AND fecha >= NOW() - INTERVAL '1 month' * ${meses}
    GROUP BY TO_CHAR(fecha, 'YYYY-MM')
    ORDER BY mes ASC
  `;

  const tendencia = rows.map(r => ({
    mes: r.mes, num_facturas: Number(r.num_facturas),
    facturado: Number(r.facturado), cobrado: Number(r.cobrado), pendiente: Number(r.pendiente)
  }));

  // Calculate trend
  let tendenciaTexto = "estable";
  if (tendencia.length >= 2) {
    const ultimosMeses = tendencia.slice(-3);
    const primerMes = ultimosMeses[0]?.facturado || 0;
    const ultimoMes = ultimosMeses[ultimosMeses.length - 1]?.facturado || 0;
    if (primerMes > 0) {
      const cambio = ((ultimoMes - primerMes) / primerMes) * 100;
      tendenciaTexto = cambio > 10 ? "creciente" : cambio < -10 ? "decreciente" : "estable";
    }
  }

  return { meses_analizados: meses, tendencia: tendenciaTexto, datos: tendencia };
}

async function clientesEnRiesgo(_args, empresaId) {
  // Clients with invoices >60 days unpaid
  const morosos = await sql`
    SELECT c.id, c.nombre,
      COUNT(f.id) as facturas_pendientes,
      COALESCE(SUM(f.total - COALESCE(f.pagado, 0)), 0) as deuda_total,
      MIN(f.fecha) as factura_mas_antigua
    FROM clients_180 c
    JOIN factura_180 f ON f.cliente_id = c.id AND f.empresa_id = ${empresaId}
    WHERE c.empresa_id = ${empresaId} AND f.estado = 'VALIDADA'
      AND COALESCE(f.estado_pago, 'pendiente') != 'pagado'
      AND f.fecha < NOW() - INTERVAL '60 days'
    GROUP BY c.id, c.nombre
    ORDER BY deuda_total DESC LIMIT 10
  `;

  // Clients with no activity in 90 days
  const inactivos = await sql`
    SELECT c.id, c.nombre,
      MAX(COALESCE(f.fecha, w.fecha)) as ultima_actividad
    FROM clients_180 c
    LEFT JOIN factura_180 f ON f.cliente_id = c.id AND f.empresa_id = ${empresaId}
    LEFT JOIN work_logs_180 w ON w.cliente_id = c.id AND w.empresa_id = ${empresaId}
    WHERE c.empresa_id = ${empresaId} AND c.activo = true
    GROUP BY c.id, c.nombre
    HAVING MAX(COALESCE(f.fecha, w.fecha)) < NOW() - INTERVAL '90 days'
       OR MAX(COALESCE(f.fecha, w.fecha)) IS NULL
    ORDER BY ultima_actividad ASC NULLS FIRST
    LIMIT 10
  `;

  return {
    morosos: morosos.map(m => ({
      nombre: m.nombre, facturas_pendientes: Number(m.facturas_pendientes),
      deuda_total: Number(m.deuda_total), factura_mas_antigua: m.factura_mas_antigua
    })),
    inactivos: inactivos.map(i => ({ nombre: i.nombre, ultima_actividad: i.ultima_actividad })),
    total_en_riesgo: morosos.length + inactivos.length
  };
}

async function alertasNegocio(_args, empresaId) {
  const alertas = [];

  // Facturas vencidas >30 días
  const [vencidas] = await sql`
    SELECT COUNT(*) as total, COALESCE(SUM(total - COALESCE(pagado, 0)), 0) as importe
    FROM factura_180 WHERE empresa_id = ${empresaId} AND estado = 'VALIDADA'
      AND COALESCE(estado_pago, 'pendiente') != 'pagado'
      AND fecha < NOW() - INTERVAL '30 days'
  `;
  if (Number(vencidas.total) > 0) {
    alertas.push({ tipo: "urgente", icono: "🔴", mensaje: `${vencidas.total} facturas vencidas (>30 días) por ${Number(vencidas.importe).toFixed(2)} €` });
  }

  // Borradores sin validar >7 días
  const [borradores] = await sql`
    SELECT COUNT(*) as total
    FROM factura_180 WHERE empresa_id = ${empresaId} AND estado = 'BORRADOR'
      AND created_at < NOW() - INTERVAL '7 days'
  `;
  if (Number(borradores.total) > 0) {
    alertas.push({ tipo: "aviso", icono: "🟡", mensaje: `${borradores.total} borradores sin validar (>7 días)` });
  }

  // Trabajos sin facturar >15 días
  const [trabajos] = await sql`
    SELECT COUNT(*) as total, COALESCE(SUM(valor), 0) as valor
    FROM work_logs_180 WHERE empresa_id = ${empresaId} AND factura_id IS NULL
      AND fecha < NOW() - INTERVAL '15 days'
  `;
  if (Number(trabajos.total) > 0) {
    alertas.push({ tipo: "aviso", icono: "🟡", mensaje: `${trabajos.total} trabajos sin facturar (>15 días) por ${Number(trabajos.valor).toFixed(2)} €` });
  }

  // Ausencias próximas (7 días)
  const ausencias = await sql`
    SELECT a.tipo, a.fecha_inicio, e.nombre
    FROM ausencias_180 a JOIN employees_180 e ON a.empleado_id = e.id
    WHERE a.empresa_id = ${empresaId} AND a.estado = 'aprobada'
      AND a.fecha_inicio BETWEEN NOW() AND NOW() + INTERVAL '7 days'
    ORDER BY a.fecha_inicio ASC LIMIT 5
  `;
  for (const a of ausencias) {
    alertas.push({ tipo: "info", icono: "📅", mensaje: `${a.nombre}: ${a.tipo} desde ${a.fecha_inicio}` });
  }

  if (alertas.length === 0) {
    alertas.push({ tipo: "ok", icono: "✅", mensaje: "Todo en orden. No hay alertas pendientes." });
  }

  return { total_alertas: alertas.length, alertas };
}

// ============================
// NUEVOS SKILLS: RRHH
// ============================

async function consultarFichajes({ empleado_id, fecha_inicio, fecha_fin }, empresaId) {
  let query = sql`
    SELECT f.id, f.tipo, f.fecha, f.created_at as hora, e.nombre as empleado_nombre, f.sospechoso
    FROM fichajes_180 f
    JOIN employees_180 e ON f.empleado_id = e.id
    WHERE f.empresa_id = ${empresaId} AND f.fecha >= ${fecha_inicio} AND f.fecha <= ${fecha_fin}
  `;
  if (empleado_id) query = sql`${query} AND f.empleado_id = ${empleado_id}`;
  query = sql`${query} ORDER BY f.fecha ASC, f.created_at ASC LIMIT 100`;

  const fichajes = await query;
  const sospechosos = fichajes.filter(f => f.sospechoso).length;

  return {
    total: fichajes.length, sospechosos,
    fichajes: fichajes.map(f => ({
      empleado: f.empleado_nombre, tipo: f.tipo, fecha: f.fecha,
      hora: new Date(f.hora).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
      sospechoso: f.sospechoso || false
    }))
  };
}

async function resumenHorasEmpleado({ empleado_id, fecha_inicio, fecha_fin }, empresaId) {
  let query = sql`
    SELECT e.id, e.nombre,
      COUNT(j.id) as dias_trabajados,
      COALESCE(SUM(j.minutos_trabajados), 0) as minutos_totales,
      COALESCE(SUM(j.minutos_extra), 0) as minutos_extra,
      COALESCE(SUM(j.minutos_descanso), 0) as minutos_descanso
    FROM employees_180 e
    LEFT JOIN jornadas_180 j ON j.empleado_id = e.id AND j.empresa_id = ${empresaId}
      AND j.fecha >= ${fecha_inicio} AND j.fecha <= ${fecha_fin}
    WHERE e.empresa_id = ${empresaId} AND e.activo = true
  `;
  if (empleado_id) query = sql`${query} AND e.id = ${empleado_id}`;
  query = sql`${query} GROUP BY e.id, e.nombre ORDER BY minutos_totales DESC`;

  const rows = await query;
  return {
    periodo: { desde: fecha_inicio, hasta: fecha_fin },
    empleados: rows.map(r => ({
      nombre: r.nombre,
      dias_trabajados: Number(r.dias_trabajados),
      horas_trabajadas: Math.round(Number(r.minutos_totales) / 60 * 10) / 10,
      horas_extra: Math.round(Number(r.minutos_extra) / 60 * 10) / 10,
      horas_descanso: Math.round(Number(r.minutos_descanso) / 60 * 10) / 10,
      promedio_diario: Number(r.dias_trabajados) > 0
        ? Math.round(Number(r.minutos_totales) / Number(r.dias_trabajados) / 60 * 10) / 10
        : 0
    }))
  };
}

async function consultarAusenciasResumen({ empleado_id, anio }, empresaId) {
  const year = anio || new Date().getFullYear();
  let query = sql`
    SELECT e.nombre,
      COUNT(CASE WHEN a.tipo = 'vacaciones' THEN 1 END) as vacaciones,
      COUNT(CASE WHEN a.tipo = 'baja_medica' THEN 1 END) as bajas_medicas,
      COUNT(CASE WHEN a.tipo = 'asuntos_propios' THEN 1 END) as asuntos_propios,
      COUNT(CASE WHEN a.tipo = 'permiso' THEN 1 END) as permisos,
      SUM(CASE WHEN a.tipo = 'vacaciones' THEN (a.fecha_fin - a.fecha_inicio + 1) ELSE 0 END) as dias_vacaciones_usados
    FROM employees_180 e
    LEFT JOIN ausencias_180 a ON a.empleado_id = e.id AND a.empresa_id = ${empresaId}
      AND EXTRACT(YEAR FROM a.fecha_inicio) = ${year} AND a.estado = 'aprobada'
    WHERE e.empresa_id = ${empresaId} AND e.activo = true
  `;
  if (empleado_id) query = sql`${query} AND e.id = ${empleado_id}`;
  query = sql`${query} GROUP BY e.id, e.nombre ORDER BY e.nombre ASC`;

  const rows = await query;
  return {
    anio: year,
    empleados: rows.map(r => ({
      nombre: r.nombre,
      vacaciones: Number(r.vacaciones), dias_vacaciones_usados: Number(r.dias_vacaciones_usados),
      bajas_medicas: Number(r.bajas_medicas), asuntos_propios: Number(r.asuntos_propios),
      permisos: Number(r.permisos)
    }))
  };
}

async function productividadEmpleado({ empleado_id, fecha_inicio, fecha_fin }, empresaId) {
  let query = sql`
    SELECT e.id, e.nombre,
      COALESCE(SUM(j.minutos_trabajados), 0) as minutos_trabajados,
      (SELECT COALESCE(SUM(w.valor), 0) FROM work_logs_180 w WHERE w.empresa_id = ${empresaId} AND w.employee_id = e.id AND w.fecha >= ${fecha_inicio} AND w.fecha <= ${fecha_fin}) as valor_generado,
      (SELECT COUNT(DISTINCT w.cliente_id) FROM work_logs_180 w WHERE w.empresa_id = ${empresaId} AND w.employee_id = e.id AND w.fecha >= ${fecha_inicio} AND w.fecha <= ${fecha_fin}) as clientes_atendidos,
      (SELECT COUNT(*) FROM work_logs_180 w WHERE w.empresa_id = ${empresaId} AND w.employee_id = e.id AND w.fecha >= ${fecha_inicio} AND w.fecha <= ${fecha_fin}) as trabajos_completados
    FROM employees_180 e
    LEFT JOIN jornadas_180 j ON j.empleado_id = e.id AND j.empresa_id = ${empresaId}
      AND j.fecha >= ${fecha_inicio} AND j.fecha <= ${fecha_fin}
    WHERE e.empresa_id = ${empresaId} AND e.activo = true
  `;
  if (empleado_id) query = sql`${query} AND e.id = ${empleado_id}`;
  query = sql`${query} GROUP BY e.id, e.nombre ORDER BY valor_generado DESC`;

  const rows = await query;
  return {
    periodo: { desde: fecha_inicio, hasta: fecha_fin },
    empleados: rows.map(r => {
      const horas = Number(r.minutos_trabajados) / 60;
      const valor = Number(r.valor_generado);
      return {
        nombre: r.nombre, horas_trabajadas: Math.round(horas * 10) / 10,
        valor_generado: valor, clientes_atendidos: Number(r.clientes_atendidos),
        trabajos_completados: Number(r.trabajos_completados),
        valor_por_hora: horas > 0 ? Math.round(valor / horas * 100) / 100 : 0
      };
    })
  };
}

// ============================
// NUEVOS SKILLS: AUTOMATIZACIÓN
// ============================

async function facturarTrabajosPendientes({ cliente_id, iva = 21 }, empresaId) {
  const [cliente] = await sql`SELECT id, nombre FROM clients_180 WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
  if (!cliente) return { error: "Cliente no encontrado" };

  const trabajos = await sql`
    SELECT id, descripcion, fecha, minutos, valor
    FROM work_logs_180
    WHERE empresa_id = ${empresaId} AND cliente_id = ${cliente_id} AND factura_id IS NULL
    ORDER BY fecha ASC
  `;

  if (trabajos.length === 0) return { mensaje: `No hay trabajos pendientes de facturar para ${cliente.nombre}.` };

  let createdId;
  let total;
  await sql.begin(async (tx) => {
    let subtotal = 0;
    let iva_total = 0;

    const [factura] = await tx`
      INSERT INTO factura_180 (empresa_id, cliente_id, fecha, estado, iva_global, subtotal, iva_total, total, created_at)
      VALUES (${empresaId}, ${cliente_id}, ${new Date().toISOString().split('T')[0]}::date, 'BORRADOR', ${iva}, 0, 0, 0, now())
      RETURNING id
    `;
    createdId = factura.id;

    for (const t of trabajos) {
      const desc = t.descripcion || "Trabajo";
      const valor = Number(t.valor || 0);
      const base = valor > 0 ? valor : (Number(t.minutos || 0) / 60);
      const importe_iva = base * iva / 100;
      subtotal += base;
      iva_total += importe_iva;

      await tx`
        INSERT INTO lineafactura_180 (factura_id, descripcion, cantidad, precio_unitario, total, iva_percent)
        VALUES (${factura.id}, ${`${desc} (${t.fecha})`}, 1, ${base}, ${base + importe_iva}, ${iva})
      `;

      await tx`UPDATE work_logs_180 SET factura_id = ${factura.id} WHERE id = ${t.id} AND empresa_id = ${empresaId}`;
    }

    total = Math.round((subtotal + iva_total) * 100) / 100;
    await tx`
      UPDATE factura_180 SET subtotal = ${Math.round(subtotal * 100) / 100},
        iva_total = ${Math.round(iva_total * 100) / 100}, total = ${total}
      WHERE id = ${factura.id}
    `;
  });

  return {
    success: true,
    mensaje: `Factura borrador creada para ${cliente.nombre} con ${trabajos.length} trabajos. Total: ${total.toFixed(2)} € (IVA ${iva}%). ID: ${createdId}`,
    factura: { id: createdId, cliente: cliente.nombre, trabajos: trabajos.length, total, estado: "BORRADOR" }
  };
}

async function cierreMensual({ mes, anio }, empresaId) {
  const now = new Date();
  const m = mes || (now.getMonth() + 1);
  const a = anio || now.getFullYear();

  const [facturacion] = await sql`
    SELECT
      COUNT(CASE WHEN estado = 'VALIDADA' THEN 1 END) as validadas,
      COUNT(CASE WHEN estado = 'BORRADOR' THEN 1 END) as borradores,
      COALESCE(SUM(CASE WHEN estado = 'VALIDADA' THEN total ELSE 0 END), 0) as facturado,
      COALESCE(SUM(CASE WHEN estado = 'VALIDADA' THEN COALESCE(pagado, 0) ELSE 0 END), 0) as cobrado,
      COALESCE(SUM(CASE WHEN estado = 'VALIDADA' THEN total - COALESCE(pagado, 0) ELSE 0 END), 0) as pendiente
    FROM factura_180 WHERE empresa_id = ${empresaId}
      AND EXTRACT(MONTH FROM fecha) = ${m} AND EXTRACT(YEAR FROM fecha) = ${a}
  `;

  const [horas] = await sql`
    SELECT COALESCE(SUM(minutos_trabajados), 0) as minutos, COUNT(DISTINCT empleado_id) as empleados
    FROM jornadas_180 WHERE empresa_id = ${empresaId}
      AND EXTRACT(MONTH FROM fecha) = ${m} AND EXTRACT(YEAR FROM fecha) = ${a}
  `;

  const [trabajosPend] = await sql`
    SELECT COUNT(*) as total, COALESCE(SUM(valor), 0) as valor
    FROM work_logs_180 WHERE empresa_id = ${empresaId} AND factura_id IS NULL
      AND EXTRACT(MONTH FROM fecha) = ${m} AND EXTRACT(YEAR FROM fecha) = ${a}
  `;

  const [nuevosClientes] = await sql`
    SELECT COUNT(*) as total FROM clients_180
    WHERE empresa_id = ${empresaId}
      AND EXTRACT(MONTH FROM created_at) = ${m} AND EXTRACT(YEAR FROM created_at) = ${a}
  `;

  return {
    periodo: `${String(m).padStart(2, '0')}/${a}`,
    facturacion: {
      facturas_validadas: Number(facturacion.validadas), facturas_borrador: Number(facturacion.borradores),
      total_facturado: Number(facturacion.facturado), total_cobrado: Number(facturacion.cobrado),
      total_pendiente: Number(facturacion.pendiente),
      ratio_cobro: Number(facturacion.facturado) > 0 ? Math.round(Number(facturacion.cobrado) / Number(facturacion.facturado) * 100) : 0
    },
    equipo: {
      empleados_activos: Number(horas.empleados),
      horas_trabajadas: Math.round(Number(horas.minutos) / 60 * 10) / 10
    },
    pendientes: {
      trabajos_sin_facturar: Number(trabajosPend.total),
      valor_sin_facturar: Number(trabajosPend.valor)
    },
    crecimiento: { nuevos_clientes: Number(nuevosClientes.total) }
  };
}

// ============================
// MEMORIA
// ============================

async function cargarMemoria(empresaId, userId, limite = 3) {
  try {
    const memoria = await sql`
      SELECT mensaje, respuesta FROM contendo_memory_180
      WHERE empresa_id = ${empresaId} AND user_id = ${userId}
      ORDER BY created_at DESC LIMIT ${limite}
    `;
    return [...memoria].reverse().flatMap(m => [
      { role: "user", content: m.mensaje },
      { role: "assistant", content: m.respuesta }
    ]);
  } catch { return []; }
}

async function guardarConversacion(empresaId, userId, userRole, mensaje, respuesta) {
  try {
    await sql`
      INSERT INTO contendo_memory_180 (empresa_id, user_id, role, mensaje, respuesta, metadata)
      VALUES (${empresaId}, ${userId}, ${userRole}, ${mensaje}, ${respuesta}, ${JSON.stringify({ timestamp: new Date().toISOString() })})
    `;
  } catch (err) { console.error("[AI] Error guardando memoria:", err); }
}

// ============================
// SYSTEM PROMPTS
// ============================

function buildSystemPrompt(userRole, userContext = {}) {
  const hoy = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const { userName, userId } = userContext;

  let prompt = `Eres CONTENDO, el asistente inteligente de APP180, una plataforma de gestión empresarial. Responde siempre en español, de forma natural y profesional.

CONTEXTO ACTUAL:
- Fecha de hoy: ${hoy}
- Usuario actual: ${userName || 'desconocido'} (${userRole === 'admin' ? 'administrador' : 'empleado'})
- ID del usuario: ${userId || 'desconocido'}
- Cuando el usuario diga "hoy", "ayer", "esta semana", usa estas referencias de fecha.
- Cuando el usuario diga "he trabajado" o "trabajé", se refiere A SÍ MISMO. Si necesitas empleado_id, usa "${userId || ''}".

TU PERSONALIDAD:
- Eres amable, cercano y profesional. Hablas con naturalidad.
- Cuando te saludan ("hola", "buenas", "qué tal", etc.), responde con un saludo cordial y ofrece tu ayuda. NO llames a ninguna herramienta para saludos.
- Si te dan las gracias o se despiden, responde con amabilidad.

SOBRE APP180 (lo que puedes hacer):

📊 CONSULTAS:
- Facturas: estado, cobro, listados, estadísticas mensuales
- Clientes: listados, ranking top clientes, clientes en riesgo
- Empleados: listados, fichajes, horas trabajadas, productividad
- Pagos: listado de cobros recibidos
- Deuda: facturas vencidas y morosos
- Ausencias: consulta y resumen por empleado
- Calendario: festivos, cierres, eventos
- Conocimiento: procedimientos y FAQ de la empresa

📈 ANÁLISIS:
- Resumen ejecutivo del negocio
- Comparar periodos (mes vs mes)
- Tendencia de facturación
- Clientes en riesgo de impago
- Alertas proactivas de problemas
- Cierre mensual completo
- Productividad por empleado

✏️ ACCIONES:
- Crear facturas, validar, anular, enviar por email
- Crear y gestionar clientes
- Registrar pagos/cobros
- Registrar trabajos (work logs)
- Crear ausencias (vacaciones, bajas)
- Crear/eliminar eventos del calendario
- Facturar automáticamente todos los trabajos pendientes de un cliente

CUÁNDO USAR HERRAMIENTAS:
- "¿Qué necesitas para...?" / "¿Cómo hago...?" → consultar_requisitos (SIEMPRE)
- Facturas → consultar_facturas, estadisticas_facturacion
- Top clientes → top_clientes
- "¿Cómo va el negocio?" → resumen_ejecutivo
- "¿Quién me debe?" → consultar_deuda
- Pagos recibidos → consultar_pagos
- "Este mes vs anterior" → comparar_periodos
- Tendencias → tendencia_facturacion
- Riesgo de impago → clientes_en_riesgo
- "¿Algún problema?" → alertas_negocio
- Cierre de mes → cierre_mensual
- Fichajes/asistencia → consultar_fichajes
- Horas trabajadas → resumen_horas_empleado
- Productividad → productividad_empleado
- Ausencias/vacaciones → consultar_ausencias o consultar_ausencias_resumen
- Empleados → consultar_empleados
- Clientes → consultar_clientes
- Trabajos sin facturar → trabajos_pendientes_facturar
- "Factura todo lo de X" → facturar_trabajos_pendientes
- Calendario → consultar_calendario
- Info empresa → consultar_conocimiento

RESOLUCIÓN AUTOMÁTICA DE NOMBRES:
- Puedes usar nombre_cliente en vez de cliente_id en CUALQUIER herramienta. El sistema buscará automáticamente el ID.
- Si el sistema te devuelve un error sobre IDs (ej: UUID inválido), es porque has puesto un nombre donde iba un ID. No lo hagas, pero si sucede, el sistema intentará resolverlo por ti.

FLUJO DE TRABAJOS (WORK LOGS):
1. Cuando el usuario diga que ha trabajado para un cliente, SIEMPRE consulta primero su historial con consultar_historial_trabajos.
2. Presenta los últimos trabajos en una tabla Markdown clara.
3. Pregunta al usuario: "¿Deseas seleccionar uno de estos trabajos previos o registrar un **TRABAJO NUEVO**?".
4. Si elige uno previo, usa sus datos. Si elige "NUEVO", solicita:
   - **Trabajo / Descripción completa**: El detalle técnico de lo que se ha hecho.
   - **Descripción corta factura**: Un resumen para la facturación (ej: "Mantenimiento preventivo").
   - **Detalles adicionales** (opcional).
5. Si el usuario dice que ya se lo han pagado "en mano" o "por bizum", usa marcar_trabajo_cobrado.

GESTIÓN DE GASTOS (NIVEL DIOS):
1. Siempre que el usuario mencione una compra, ticket o gasto, usa registrar_gasto.
2. Si el usuario quiere ver cómo va de dinero real, usa consultar_resumen_financiero. Este es el nivel más alto de análisis: combina facturas oficiales y cobros directos contra todos los gastos.

REGLAS DE DATOS:
1. NUNCA inventes datos, cifras, nombres o importes. Solo responde con lo que devuelvan las herramientas.
2. Si una herramienta devuelve total: 0 o lista vacía, di claramente: "No hay [tipo de dato] registrados actualmente."
3. Si la pregunta es ambigua, pregunta al usuario qué necesita exactamente.
4. Para acciones de escritura, usa nombre_cliente o nombre_empleado directamente. El sistema resolverá los IDs automáticamente.
5. NUNCA llames a una herramienta de ESCRITURA con datos inventados o genéricos. Si te falta algo, PREGUNTA.

ESTADOS DE FACTURA:
- Emisión: VALIDADA, BORRADOR, ANULADA
- Cobro: pendiente, parcial, pagado
- "Pendientes de cobro" = estado_pago="pendiente"

El usuario es ${userRole === 'admin' ? 'administrador con acceso completo' : 'empleado'}${userName ? ` (${userName})` : ''}.

FORMATO: Usa Markdown. Importes en € con 2 decimales. Fechas en formato DD/MM/YYYY.`;

  return prompt;
}

// ============================
// CHAT PRINCIPAL
// ============================

export async function chatConAgente({ empresaId, userId, userRole, mensaje, historial = [] }) {
  try {
    console.log(`[AI] Chat - Empresa: ${empresaId}, Mensaje: ${mensaje}`);

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.length < 10) {
      return { mensaje: "El servicio de IA no está configurado. Contacta al administrador." };
    }

    const memoriaReciente = await cargarMemoria(empresaId, userId, 3);

    // ==========================================
    // CONTROL DE TOKENS (SISTEMA DE CRÉDITOS)
    // ==========================================
    const [empresaCfg] = await sql`
      SELECT c.ai_tokens, e.user_id as creator_id
      FROM empresa_config_180 c
      JOIN empresa_180 e ON c.empresa_id = e.id
      WHERE c.empresa_id = ${empresaId}
    `;

    const esCreador = empresaCfg?.creator_id === userId;
    const tokensDisponibles = empresaCfg?.ai_tokens || 0;

    if (!esCreador && tokensDisponibles <= 0) {
      return { mensaje: "Has agotado tu saldo de tokens de IA para este periodo. Contacta con soporte para ampliar tu plan." };
    }

    // Obtener nombre del usuario para contexto
    const [userInfo] = await sql`SELECT nombre FROM users_180 WHERE id = ${userId} LIMIT 1`;
    const userName = userInfo?.nombre || null;

    const systemPrompt = buildSystemPrompt(userRole, { userName, userId });

    // Convertir historial al formato Anthropic (sin role: "system")
    const anthropicMessages = [];
    for (const m of [...memoriaReciente, ...historial]) {
      if (m.role === "system") continue;
      if (m.role === "user" || m.role === "assistant") {
        anthropicMessages.push({ role: m.role, content: m.content });
      }
    }
    anthropicMessages.push({ role: "user", content: mensaje });

    // Convertir tools al formato Anthropic (lazy init)
    const anthropicTools = convertToolsToAnthropic(TOOLS);

    // Primera llamada con tools
    let response;
    try {
      response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        messages: anthropicMessages,
        tools: anthropicTools,
        tool_choice: { type: "auto" },
        temperature: 0.3,
      });
    } catch (apiErr) {
      console.error("[AI] Error API Anthropic:", apiErr.message);

      // Fallback a knowledge base
      const fallback = await consultarConocimiento({ busqueda: mensaje }, empresaId);
      if (fallback.respuesta_directa) {
        await guardarConversacion(empresaId, userId, userRole, mensaje, fallback.respuesta_directa);
        return { mensaje: fallback.respuesta_directa };
      }
      return { mensaje: "No pude procesar tu mensaje en este momento. Inténtalo de nuevo en unos minutos." };
    }

    // Tools de escritura que modifican datos
    const WRITE_TOOLS = new Set([
      'crear_factura', 'actualizar_factura', 'validar_factura', 'anular_factura',
      'eliminar_factura', 'enviar_factura_email', 'crear_cliente', 'actualizar_cliente',
      'desactivar_cliente', 'crear_pago', 'eliminar_pago', 'actualizar_empleado',
      'crear_trabajo', 'crear_ausencia', 'crear_evento_calendario', 'eliminar_evento_calendario',
      'facturar_trabajos_pendientes'
    ]);
    let accionRealizada = false;

    // Procesar tool calls (máximo 5 iteraciones - Claude es más fiable)
    let iterations = 0;
    while (response.stop_reason === "tool_use" && iterations < 5) {
      iterations++;

      // Extraer tool_use blocks de la respuesta
      const toolUseBlocks = response.content.filter(b => b.type === "tool_use");
      console.log(`[AI] Iteración ${iterations}: ${toolUseBlocks.length} herramientas`);

      // Añadir respuesta del assistant al historial
      anthropicMessages.push({ role: "assistant", content: response.content });

      // Ejecutar cada tool y construir tool_results
      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        const resultado = await ejecutarHerramienta(toolUse.name, toolUse.input || {}, empresaId);

        if (WRITE_TOOLS.has(toolUse.name) && resultado?.success) {
          accionRealizada = true;
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(resultado),
        });
      }

      // Añadir resultados como mensaje user
      anthropicMessages.push({ role: "user", content: toolResults });

      // Siguiente llamada
      try {
        response = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: systemPrompt,
          messages: anthropicMessages,
          tools: anthropicTools,
          tool_choice: { type: "auto" },
          temperature: 0.1,
        });
      } catch (apiErr) {
        console.error("[AI] Error API Anthropic (tool loop):", apiErr.message);
        return { mensaje: "Error al procesar los datos. Inténtalo de nuevo." };
      }
    }

    // Extraer texto de la respuesta final
    const textBlocks = response.content.filter(b => b.type === "text");
    const respuestaFinal = textBlocks.map(b => b.text).join("\n") || "No pude generar una respuesta.";
    await guardarConversacion(empresaId, userId, userRole, mensaje, respuestaFinal);

    // Descontar tokens si no es el creador
    if (!esCreador) {
      const tokensUsados = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
      if (tokensUsados > 0) {
        await sql`
          UPDATE empresa_config_180
          SET ai_tokens = GREATEST(0, ai_tokens - ${tokensUsados})
          WHERE empresa_id = ${empresaId}
        `;
        console.log(`[AI] Tokens descontados: ${tokensUsados}. Empresa: ${empresaId}`);
      }
    }

    return { mensaje: respuestaFinal, accion_realizada: accionRealizada };

  } catch (error) {
    console.error("[AI] Error general:", error);
    return { mensaje: "Ha ocurrido un error inesperado. Inténtalo de nuevo más tarde." };
  }
}
