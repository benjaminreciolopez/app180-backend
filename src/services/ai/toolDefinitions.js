// backend/src/services/ai/toolDefinitions.js
// Auto-extracted from aiAgentService.js

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
      description: "Crea una factura en borrador. Puede ser NORMAL (numerada, oficial) o PROFORMA (sin número oficial, para presupuestos). Requiere cliente_id o nombre_cliente, fecha y al menos una linea con descripcion, cantidad y precio_unitario.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "string", description: "ID del cliente (integer)" },
          nombre_cliente: { type: "string", description: "Nombre del cliente (alternativa a cliente_id)" },
          fecha: { type: "string", description: "Fecha YYYY-MM-DD" },
          tipo_factura: { type: "string", enum: ["NORMAL", "PROFORMA"], description: "Tipo: NORMAL (numerada) o PROFORMA (sin número oficial, para presupuestos). Default: NORMAL" },
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

  // ===== FICHAJES =====
  {
    type: "function",
    function: {
      name: "consultar_fichajes_sospechosos",
      description: "Lista fichajes marcados como sospechosos (ubicación extraña, horario inusual, etc). Incluye datos del empleado y motivo de sospecha.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "crear_fichaje_manual",
      description: "Registra un fichaje manual para un empleado (entrada, salida, descanso). Para corregir errores u olvidos.",
      parameters: {
        type: "object",
        properties: {
          empleado_id: { type: "string", description: "ID del empleado" },
          nombre_empleado: { type: "string", description: "Nombre del empleado (alternativa)" },
          tipo: { type: "string", enum: ["entrada", "salida", "descanso_inicio", "descanso_fin"], description: "Tipo de fichaje" },
          fecha_hora: { type: "string", description: "Fecha y hora YYYY-MM-DD HH:MM" },
          motivo: { type: "string", description: "Motivo del fichaje manual" }
        },
        required: ["tipo", "fecha_hora"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "validar_fichaje",
      description: "Valida o rechaza un fichaje sospechoso. Requiere el ID del fichaje.",
      parameters: {
        type: "object",
        properties: {
          fichaje_id: { type: "string", description: "ID del fichaje" },
          accion: { type: "string", enum: ["confirmar", "rechazar"], description: "Accion a tomar" },
          nota: { type: "string", description: "Nota explicativa (opcional)" }
        },
        required: ["fichaje_id", "accion"]
      }
    }
  },

  // ===== JORNADAS =====
  {
    type: "function",
    function: {
      name: "consultar_jornadas",
      description: "Lista jornadas laborales de empleados con horas trabajadas, descansos, extras e incidencias.",
      parameters: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Fecha específica YYYY-MM-DD" },
          empleado_id: { type: "string", description: "ID del empleado" },
          nombre_empleado: { type: "string", description: "Nombre del empleado" },
          estado: { type: "string", enum: ["abierta", "cerrada", "todos"], description: "Estado de la jornada" }
        }
      }
    }
  },

  // ===== PLANTILLAS =====
  {
    type: "function",
    function: {
      name: "consultar_plantillas",
      description: "Lista las plantillas de jornada laboral configuradas en la empresa.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "crear_plantilla",
      description: "Crea una nueva plantilla de jornada laboral.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre de la plantilla" },
          descripcion: { type: "string", description: "Descripción" },
          tipo: { type: "string", description: "Tipo (default: semanal)" }
        },
        required: ["nombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "asignar_plantilla",
      description: "Asigna una plantilla de jornada a un empleado. Cierra asignaciones anteriores automáticamente.",
      parameters: {
        type: "object",
        properties: {
          plantilla_id: { type: "string", description: "ID de la plantilla" },
          empleado_id: { type: "string", description: "ID del empleado" },
          nombre_empleado: { type: "string", description: "Nombre del empleado" },
          fecha_inicio: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
          fecha_fin: { type: "string", description: "Fecha fin YYYY-MM-DD (opcional, null=indefinido)" }
        },
        required: ["plantilla_id", "fecha_inicio"]
      }
    }
  },

  // ===== NÓMINAS =====
  {
    type: "function",
    function: {
      name: "consultar_nominas",
      description: "Lista nóminas registradas, con filtro por año y mes. Incluye datos de empleado.",
      parameters: {
        type: "object",
        properties: {
          anio: { type: "number", description: "Año (default: actual)" },
          mes: { type: "number", description: "Mes 1-12 (todos si vacío)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "crear_nomina",
      description: "Registra una nómina manualmente con los datos de salario.",
      parameters: {
        type: "object",
        properties: {
          empleado_id: { type: "string", description: "ID del empleado" },
          nombre_empleado: { type: "string", description: "Nombre del empleado" },
          anio: { type: "number", description: "Año" },
          mes: { type: "number", description: "Mes (1-12)" },
          bruto: { type: "number", description: "Salario bruto" },
          seguridad_social_empresa: { type: "number", description: "SS empresa" },
          seguridad_social_empleado: { type: "number", description: "SS empleado" },
          irpf_retencion: { type: "number", description: "Retención IRPF" },
          liquido: { type: "number", description: "Salario líquido/neto" }
        },
        required: ["anio", "mes", "bruto", "liquido"]
      }
    }
  },

  // ===== PARTES DE DÍA =====
  {
    type: "function",
    function: {
      name: "consultar_partes_dia",
      description: "Lista partes de día (registros de trabajo diario) con filtros. Incluye empleado y cliente.",
      parameters: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Fecha específica YYYY-MM-DD" },
          fecha_inicio: { type: "string", description: "Rango inicio YYYY-MM-DD" },
          fecha_fin: { type: "string", description: "Rango fin YYYY-MM-DD" },
          cliente_id: { type: "string", description: "ID del cliente" },
          nombre_cliente: { type: "string", description: "Nombre del cliente" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "validar_parte_dia",
      description: "Valida o rechaza un parte de día de un empleado.",
      parameters: {
        type: "object",
        properties: {
          empleado_id: { type: "string", description: "ID del empleado" },
          nombre_empleado: { type: "string", description: "Nombre del empleado" },
          fecha: { type: "string", description: "Fecha del parte YYYY-MM-DD" },
          validado: { type: "string", enum: ["true", "false"], description: "true=aprobar, false=rechazar" },
          nota: { type: "string", description: "Nota del admin" }
        },
        required: ["fecha", "validado"]
      }
    }
  },

  // ===== KNOWLEDGE BASE (WRITE) =====
  {
    type: "function",
    function: {
      name: "crear_conocimiento",
      description: "Añade una nueva entrada al knowledge base de la empresa. Token = palabra clave, respuesta = contenido.",
      parameters: {
        type: "object",
        properties: {
          token: { type: "string", description: "Palabra clave o tema (ej: 'horario', 'vacaciones')" },
          respuesta: { type: "string", description: "Contenido/respuesta completa" },
          categoria: { type: "string", description: "Categoría (opcional)" },
          prioridad: { type: "number", description: "Prioridad (mayor = más importante, default: 0)" }
        },
        required: ["token", "respuesta"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "actualizar_conocimiento",
      description: "Actualiza una entrada existente del knowledge base.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID de la entrada" },
          token: { type: "string", description: "Nueva palabra clave" },
          respuesta: { type: "string", description: "Nuevo contenido" },
          categoria: { type: "string", description: "Nueva categoría" },
          activo: { type: "string", enum: ["true", "false"], description: "Activar/desactivar" }
        },
        required: ["id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "eliminar_conocimiento",
      description: "Elimina una entrada del knowledge base.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID de la entrada a eliminar" }
        },
        required: ["id"]
      }
    }
  },

  // ===== CONFIGURACIÓN =====
  {
    type: "function",
    function: {
      name: "consultar_configuracion",
      description: "Obtiene la configuración actual de la empresa: datos del emisor, numeración de facturas, VeriFactu, auditoría, etc.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_modulos",
      description: "Lista los módulos activos de la empresa (facturación, fichajes, jornadas, nóminas, etc).",
      parameters: { type: "object", properties: {} }
    }
  },

  // ===== SUGERENCIAS =====
  {
    type: "function",
    function: {
      name: "consultar_sugerencias",
      description: "Lista las sugerencias enviadas por usuarios. Si el usuario es el creador de la app, muestra TODAS las sugerencias de TODOS los usuarios. Si no, solo las de su empresa.",
      parameters: {
        type: "object",
        properties: {
          estado: { type: "string", enum: ["nueva", "leida", "respondida", "cerrada", "todas"], description: "Filtrar por estado (default: todas)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "responder_sugerencia",
      description: "Responde a una sugerencia de un usuario. Solo disponible para el creador de la app. Envía notificación al usuario automáticamente.",
      parameters: {
        type: "object",
        properties: {
          sugerencia_id: { type: "string", description: "ID de la sugerencia (UUID)" },
          respuesta: { type: "string", description: "Texto de la respuesta" }
        },
        required: ["sugerencia_id", "respuesta"]
      }
    }
  },

  // ===== STORAGE =====
  {
    type: "function",
    function: {
      name: "listar_archivos",
      description: "Lista archivos almacenados en una carpeta específica (nóminas, facturas, etc). Incluye espacio usado.",
      parameters: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Carpeta (nominas, facturas, etc). Si vacío, lista todas las carpetas." }
        }
      }
    }
  },

  // ===== AUDITORÍA =====
  {
    type: "function",
    function: {
      name: "consultar_audit_log",
      description: "Consulta el registro de auditoría: acciones realizadas por usuarios (fichajes validados/rechazados, facturas creadas, etc).",
      parameters: {
        type: "object",
        properties: {
          empleado_id: { type: "string", description: "Filtrar por empleado" },
          accion: { type: "string", description: "Tipo de acción (fichaje_validado, fichaje_rechazado, etc)" },
          fecha_desde: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
          fecha_hasta: { type: "string", description: "Fecha fin YYYY-MM-DD" },
          limite: { type: "number", description: "Max resultados (default 20)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_estadisticas_audit",
      description: "Estadísticas de auditoría: acciones por tipo, empleados con más rechazos, actividad diaria (últimos 30 días).",
      parameters: { type: "object", properties: {} }
    }
  },

  // ===== REPORTES AVANZADOS =====
  {
    type: "function",
    function: {
      name: "reporte_rentabilidad",
      description: "Análisis de rentabilidad: ingresos vs gastos por cliente, margen por empleado, beneficio neto.",
      parameters: {
        type: "object",
        properties: {
          fecha_inicio: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
          fecha_fin: { type: "string", description: "Fecha fin YYYY-MM-DD" },
          por: { type: "string", enum: ["cliente", "empleado", "global"], description: "Agrupar por (default: global)" }
        },
        required: ["fecha_inicio", "fecha_fin"]
      }
    }
  },

  // ===== FISCAL (Modelos) =====
  {
    type: "function",
    function: {
      name: "calcular_modelo_fiscal",
      description: "Calcula un borrador de modelo fiscal trimestral. Modelo 303 (IVA), 130 (IRPF), 111 (retenciones nóminas). Genera los cálculos a partir de facturas y gastos registrados.",
      parameters: {
        type: "object",
        properties: {
          modelo: { type: "string", enum: ["303", "130", "111"], description: "Número de modelo fiscal" },
          trimestre: { type: "number", description: "Trimestre (1-4)" },
          anio: { type: "number", description: "Año" }
        },
        required: ["modelo", "trimestre", "anio"]
      }
    }
  },

  // ===== BANCO - MATCHING =====
  {
    type: "function",
    function: {
      name: "consultar_movimientos_banco",
      description: "Lista movimientos bancarios importados con filtros. Incluye estado de match con facturas/gastos.",
      parameters: {
        type: "object",
        properties: {
          estado_match: { type: "string", enum: ["pendiente", "matched", "manual", "descartado", "todos"], description: "Filtrar por estado" },
          fecha_inicio: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
          fecha_fin: { type: "string", description: "Fecha fin YYYY-MM-DD" },
          limite: { type: "number", description: "Max resultados (default 30)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "match_pago_banco",
      description: "Vincula un movimiento bancario con una factura pendiente de cobro, creando el pago automáticamente. El sistema calcula la confianza del match.",
      parameters: {
        type: "object",
        properties: {
          bank_transaction_id: { type: "string", description: "ID del movimiento bancario" },
          factura_id: { type: "string", description: "ID de la factura a vincular" }
        },
        required: ["bank_transaction_id", "factura_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "sugerir_matches_banco",
      description: "Analiza movimientos bancarios pendientes y sugiere matches automáticos con facturas/gastos. Usa algoritmo de confianza (importe, concepto, fechas).",
      parameters: { type: "object", properties: {} }
    }
  },

  // ===== FASE 2: HERRAMIENTAS ADICIONALES =====
  {
    type: "function",
    function: {
      name: "crear_excepcion_jornada",
      description: "Crea una excepción en la plantilla de jornada laboral para un día específico (ej: festivo, día especial, cambio de horario). Modifica el horario habitual de la plantilla para esa fecha concreta.",
      parameters: {
        type: "object",
        properties: {
          plantilla_id: { type: "string", description: "ID de la plantilla de jornada" },
          fecha: { type: "string", description: "Fecha de la excepción (YYYY-MM-DD)" },
          hora_inicio: { type: "string", description: "Nueva hora de inicio (HH:MM)" },
          hora_fin: { type: "string", description: "Nueva hora de fin (HH:MM)" },
          nota: { type: "string", description: "Motivo de la excepción (ej: 'Festivo local', 'Jornada reducida')" },
          activo: { type: "boolean", description: "Si false, el día se marca como libre/festivo. Default true." }
        },
        required: ["plantilla_id", "fecha"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "actualizar_configuracion",
      description: "Actualiza la configuración de la empresa: módulos activos/inactivos, widgets del dashboard, etc.",
      parameters: {
        type: "object",
        properties: {
          modulos: { type: "object", description: "Módulos a activar/desactivar. Ej: {\"facturacion\": true, \"nominas\": false}" },
          dashboard_widgets: { type: "object", description: "Configuración de widgets del dashboard" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "eliminar_archivo",
      description: "Elimina un archivo del almacenamiento de la empresa.",
      parameters: {
        type: "object",
        properties: {
          archivo_id: { type: "string", description: "ID del archivo a eliminar" }
        },
        required: ["archivo_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "exportar_modulo",
      description: "Exporta datos de un módulo en formato resumido. Módulos: facturas, clientes, empleados, gastos, nominas, pagos, trabajos.",
      parameters: {
        type: "object",
        properties: {
          modulo: { type: "string", description: "Nombre del módulo: facturas, clientes, empleados, gastos, nominas, pagos, trabajos" },
          fecha_inicio: { type: "string", description: "Fecha inicio del rango (YYYY-MM-DD)" },
          fecha_fin: { type: "string", description: "Fecha fin del rango (YYYY-MM-DD)" },
          formato: { type: "string", description: "Formato: resumen (default) o detalle" }
        },
        required: ["modulo"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "reporte_desviacion",
      description: "Genera un reporte de desviación de horas: compara horas presupuestadas vs reales por cliente o empleado. Útil para detectar proyectos que se pasan de tiempo.",
      parameters: {
        type: "object",
        properties: {
          agrupacion: { type: "string", description: "Agrupar por: cliente o empleado (default: cliente)" },
          fecha_inicio: { type: "string", description: "Fecha inicio (YYYY-MM-DD)" },
          fecha_fin: { type: "string", description: "Fecha fin (YYYY-MM-DD)" }
        }
      }
    }
  },

  // ===== FASE 3: HERRAMIENTAS FISCALES =====
  {
    type: "function",
    function: {
      name: "consultar_modelos_fiscales",
      description: "Consulta los modelos fiscales generados previamente. Filtra por modelo (303, 130, 111, 115, 349), trimestre y año.",
      parameters: {
        type: "object",
        properties: {
          modelo: { type: "string", description: "Tipo de modelo: 303, 130, 111, 115, 349 (opcional, todos si no se indica)" },
          anio: { type: "number", description: "Año (ej: 2026)" },
          trimestre: { type: "number", description: "Trimestre 1-4 (opcional)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_libro_ventas",
      description: "Genera el libro registro de facturas emitidas para un periodo. Muestra cada factura con base imponible, IVA, total, cliente y fecha.",
      parameters: {
        type: "object",
        properties: {
          fecha_inicio: { type: "string", description: "Fecha inicio (YYYY-MM-DD)" },
          fecha_fin: { type: "string", description: "Fecha fin (YYYY-MM-DD)" },
          trimestre: { type: "number", description: "Trimestre 1-4 (alternativa a fechas)" },
          anio: { type: "number", description: "Año (requerido si se usa trimestre)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_libro_gastos",
      description: "Genera el libro registro de facturas recibidas (gastos) para un periodo. Muestra cada gasto con base imponible, IVA soportado, total y proveedor.",
      parameters: {
        type: "object",
        properties: {
          fecha_inicio: { type: "string", description: "Fecha inicio (YYYY-MM-DD)" },
          fecha_fin: { type: "string", description: "Fecha fin (YYYY-MM-DD)" },
          trimestre: { type: "number", description: "Trimestre 1-4 (alternativa a fechas)" },
          anio: { type: "number", description: "Año (requerido si se usa trimestre)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_libro_nominas",
      description: "Genera el libro registro de nóminas para un periodo. Muestra cada nómina con bruto, IRPF, seguridad social y neto por empleado.",
      parameters: {
        type: "object",
        properties: {
          anio: { type: "number", description: "Año (requerido)" },
          mes: { type: "number", description: "Mes 1-12 (opcional, si no se indica muestra todo el año)" },
          trimestre: { type: "number", description: "Trimestre 1-4 (alternativa a mes)" }
        },
        required: ["anio"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "alertas_fiscales",
      description: "Muestra alertas y plazos fiscales próximos: modelos pendientes de presentar, plazos de Hacienda, y advertencias basadas en los datos de la empresa.",
      parameters: { type: "object", properties: {} }
    }
  },

  // ===== DECLARACIÓN DE LA RENTA =====
  {
    type: "function",
    function: {
      name: "consultar_renta_historica",
      description: "Consulta las declaraciones de la renta importadas. Muestra casillas clave, resultado y datos extraídos de PDFs de rentas anteriores.",
      parameters: {
        type: "object",
        properties: {
          ejercicio: { type: "number", description: "Año fiscal de la renta a consultar. Si no se indica, muestra todas." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_datos_personales_renta",
      description: "Consulta los datos personales y familiares almacenados para la declaración de la renta: estado civil, hijos, ascendientes, vivienda, plan de pensiones, donaciones.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "generar_dossier_prerenta",
      description: "Genera un dossier completo pre-renta para un ejercicio fiscal. Combina datos de CONTENDO (facturas, gastos, nóminas, retenciones, pagos fraccionados) con renta anterior y datos personales. Útil para preparar la declaración anual.",
      parameters: {
        type: "object",
        properties: {
          ejercicio: { type: "number", description: "Año fiscal del dossier (ej: 2025)" }
        },
        required: ["ejercicio"]
      }
    }
  },

  // ===== FASE 4: RECONCILIACIÓN BANCARIA =====
  {
    type: "function",
    function: {
      name: "reconciliar_extracto",
      description: "Realiza una reconciliación completa de un periodo: cruza todos los movimientos bancarios pendientes con facturas/gastos y genera un informe de estado. Los matches con confianza >= 85% se aplican automáticamente.",
      parameters: {
        type: "object",
        properties: {
          fecha_inicio: { type: "string", description: "Fecha inicio del periodo (YYYY-MM-DD)" },
          fecha_fin: { type: "string", description: "Fecha fin del periodo (YYYY-MM-DD)" },
          auto_match: { type: "boolean", description: "Si true, aplica matches automáticos >= 85% confianza. Default: false (solo sugiere)" }
        },
        required: ["fecha_inicio", "fecha_fin"]
      }
    }
  },

  // ===== CONFIGURACIÓN FISCAL (QR) =====
  {
    type: "function",
    function: {
      name: "configurar_facturacion_qr",
      description: "Configura los datos de facturación del emisor (empresa) a partir de datos extraídos de un QR de factura o del texto OCR del documento. Usa esta herramienta cuando el usuario suba un PDF/imagen de factura y quiera configurar su modelo de facturación. Actualiza: NIF, nombre, serie, numeración, etc.",
      parameters: {
        type: "object",
        properties: {
          nif: { type: "string", description: "NIF/CIF del emisor" },
          nombre: { type: "string", description: "Razón social o nombre comercial" },
          serie: { type: "string", description: "Serie de facturación (ej: F, FAC, SERIE-A)" },
          siguiente_numero: { type: "number", description: "Siguiente número de factura a emitir" },
          numeracion_plantilla: { type: "string", description: "Plantilla de numeración (ej: {YYYY}-{NUM})" },
          direccion: { type: "string", description: "Dirección fiscal" },
          poblacion: { type: "string", description: "Población/ciudad" },
          provincia: { type: "string", description: "Provincia" },
          cp: { type: "string", description: "Código postal" },
          telefono: { type: "string", description: "Teléfono" },
          email: { type: "string", description: "Email" },
          iban: { type: "string", description: "IBAN bancario" }
        }
      }
    }
  },

  // ===== CERTIFICADOS DIGITALES (VERIFACTU) =====
  {
    type: "function",
    function: {
      name: "verificar_certificado_renovacion",
      description: "Verifica el estado de renovación de los certificados digitales del usuario (cliente y fabricante). Muestra días restantes hasta caducidad, nivel de urgencia, y link directo para renovar online. Úsala cuando el usuario pregunte por el estado de sus certificados o si necesita renovarlos.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "obtener_instrucciones_renovacion",
      description: "Obtiene instrucciones paso a paso para renovar un certificado digital (FNMT o AEAT). Incluye tiempo estimado, pasos detallados y links directos. Úsala cuando el usuario necesite ayuda específica para renovar su certificado.",
      parameters: {
        type: "object",
        properties: {
          tipo: {
            type: "string",
            enum: ["cliente", "fabricante"],
            description: "Tipo de certificado a renovar: 'cliente' (usuario final) o 'fabricante' (software producer)"
          }
        },
        required: ["tipo"]
      }
    }
  },

  // ===== ASESORÍA =====
  {
    type: "function",
    function: {
      name: "consultar_asesoria_estado",
      description: "Consulta si hay asesoría conectada, mensajes sin leer y tareas pendientes",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "enviar_mensaje_asesoria",
      description: "Envía un mensaje a tu asesor conectado",
      parameters: {
        type: "object",
        properties: {
          contenido: { type: "string", description: "Contenido del mensaje a enviar al asesor" }
        },
        required: ["contenido"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "listar_mensajes_asesoria",
      description: "Lista los últimos mensajes con tu asesor",
      parameters: {
        type: "object",
        properties: {
          limite: { type: "number", description: "Número máximo de mensajes a mostrar (default: 10)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "exportar_para_asesoria",
      description: "Genera y descarga un paquete de datos del trimestre para enviar a tu asesoría. Formatos: excel, csv, zip",
      parameters: {
        type: "object",
        properties: {
          anio: { type: "number", description: "Año del trimestre a exportar" },
          trimestre: { type: "number", description: "Trimestre (1-4)" },
          formato: { type: "string", enum: ["excel", "csv", "zip"], description: "Formato de exportación (default: excel)" }
        },
        required: ["anio", "trimestre"]
      }
    }
  },

  // ===== CONTABILIDAD =====
  {
    type: "function",
    function: {
      name: "crear_asiento_contable",
      description: "Crea un asiento contable manual con líneas en partida doble (debe = haber)",
      parameters: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Fecha del asiento YYYY-MM-DD" },
          concepto: { type: "string", description: "Concepto/descripción del asiento" },
          lineas: {
            type: "array",
            items: {
              type: "object",
              properties: {
                cuenta_codigo: { type: "string", description: "Código de la cuenta contable (ej: '430', '700', '572')" },
                cuenta_nombre: { type: "string", description: "Nombre de la cuenta contable" },
                debe: { type: "number", description: "Importe en el debe" },
                haber: { type: "number", description: "Importe en el haber" },
                concepto: { type: "string", description: "Concepto específico de la línea" }
              },
              required: ["cuenta_codigo"]
            },
            description: "Líneas del asiento en partida doble (mínimo 2)"
          }
        },
        required: ["fecha", "concepto", "lineas"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generar_asientos_periodo",
      description: "Genera automáticamente todos los asientos del trimestre a partir de facturas, gastos y nóminas existentes",
      parameters: {
        type: "object",
        properties: {
          fecha_desde: { type: "string", description: "Fecha inicio del periodo YYYY-MM-DD" },
          fecha_hasta: { type: "string", description: "Fecha fin del periodo YYYY-MM-DD" }
        },
        required: ["fecha_desde", "fecha_hasta"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_balance",
      description: "Muestra el balance de situación de la empresa a una fecha determinada",
      parameters: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Fecha del balance YYYY-MM-DD (default: hoy)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_pyg",
      description: "Muestra la cuenta de Pérdidas y Ganancias del periodo",
      parameters: {
        type: "object",
        properties: {
          fecha_desde: { type: "string", description: "Fecha inicio del periodo YYYY-MM-DD" },
          fecha_hasta: { type: "string", description: "Fecha fin del periodo YYYY-MM-DD" }
        },
        required: ["fecha_desde", "fecha_hasta"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_libro_mayor",
      description: "Muestra los movimientos de una cuenta contable en el libro mayor",
      parameters: {
        type: "object",
        properties: {
          cuenta_codigo: { type: "string", description: "Código de la cuenta contable (ej: '430', '700', '572')" },
          fecha_desde: { type: "string", description: "Fecha inicio YYYY-MM-DD (opcional)" },
          fecha_hasta: { type: "string", description: "Fecha fin YYYY-MM-DD (opcional)" }
        },
        required: ["cuenta_codigo"]
      }
    }
  },

  // --- Tool 93: Crear proforma ---
  {
    type: "function",
    function: {
      name: "crear_proforma",
      description: "Crea una proforma (presupuesto) directamente en estado ACTIVA con número PRO-YYYY-XXXXXX. No consume numeración oficial. Requiere cliente_id, fecha y al menos una línea.",
      parameters: {
        type: "object",
        properties: {
          cliente_id: { type: "integer", description: "ID del cliente" },
          fecha: { type: "string", description: "Fecha en formato YYYY-MM-DD" },
          lineas: {
            type: "array",
            items: {
              type: "object",
              properties: {
                descripcion: { type: "string" },
                cantidad: { type: "number" },
                precio_unitario: { type: "number" },
                iva: { type: "number", description: "Porcentaje de IVA (ej: 21)" }
              },
              required: ["descripcion", "cantidad", "precio_unitario"]
            },
            description: "Líneas de la proforma (mínimo 1)"
          },
          iva_global: { type: "number", description: "IVA global por defecto (ej: 21)" },
          retencion_porcentaje: { type: "number", description: "Porcentaje de retención IRPF (ej: 15)" }
        },
        required: ["cliente_id", "fecha", "lineas"]
      }
    }
  },
  // --- Tool 94: Anular proforma ---
  {
    type: "function",
    function: {
      name: "anular_proforma",
      description: "Anula una proforma activa. La proforma queda anulada permanentemente (sin rectificativa). Se puede reactivar después creando una nueva copia.",
      parameters: {
        type: "object",
        properties: {
          proforma_id: { type: "integer", description: "ID de la proforma a anular" },
          motivo: { type: "string", description: "Motivo de la anulación (obligatorio)" }
        },
        required: ["proforma_id", "motivo"]
      }
    }
  },
  // --- Tool 95: Reactivar proforma ---
  {
    type: "function",
    function: {
      name: "reactivar_proforma",
      description: "Reactiva una proforma anulada creando una NUEVA proforma con nuevo número PRO, copiando el contenido de la anulada. La original permanece anulada para trazabilidad.",
      parameters: {
        type: "object",
        properties: {
          proforma_id: { type: "integer", description: "ID de la proforma anulada a reactivar" }
        },
        required: ["proforma_id"]
      }
    }
  },
  // --- Tool 92: Revisar y corregir cuentas contables con IA ---
  {
    type: "function",
    function: {
      name: "revisar_cuentas_asientos",
      description: "Re-revisa las cuentas contables de los asientos de gastos usando inteligencia artificial. Detecta cuentas PGC incorrectas (ej: un recibo de autónomo asignado a 629 en vez de 642) y las corrige. Puede simular primero para mostrar los cambios antes de aplicarlos.",
      parameters: {
        type: "object",
        properties: {
          simular: { type: "boolean", description: "true = solo muestra los cambios sin aplicarlos, false = aplica las correcciones. Por defecto true para que el usuario revise antes." },
          asiento_ids: {
            type: "array",
            items: { type: "string" },
            description: "IDs específicos de asientos a revisar (opcional). Si se omite, revisa TODOS los asientos de gastos."
          }
        },
        required: []
      }
    }
  },
  // --- Tool 96: Enviar nómina a empleado ---
  {
    type: "function",
    function: {
      name: "enviar_nomina",
      description: "Envía una nómina al empleado por la app (notificación + email). Registra la entrega para control.",
      parameters: {
        type: "object",
        properties: {
          nomina_id: { type: "string", description: "ID de la nómina a enviar (UUID)" },
          nombre_empleado: { type: "string", description: "Nombre del empleado (para buscar la nómina si no tienes el ID)" },
          anio: { type: "number", description: "Año de la nómina" },
          mes: { type: "number", description: "Mes de la nómina (1-12)" }
        },
        required: []
      }
    }
  },
  // --- Tool 97: Consultar entregas de nóminas ---
  {
    type: "function",
    function: {
      name: "consultar_entregas_nominas",
      description: "Consulta el estado de entrega y firma de las nóminas enviadas a empleados. Muestra si están enviadas, recibidas o firmadas.",
      parameters: {
        type: "object",
        properties: {
          anio: { type: "number", description: "Año (por defecto el actual)" },
          mes: { type: "number", description: "Mes 1-12 (opcional, si se omite muestra todos)" },
          estado: { type: "string", enum: ["enviada", "recibida", "firmada"], description: "Filtrar por estado de entrega" }
        },
        required: []
      }
    }
  },
  // --- Tool 98: Analizar riesgo fiscal ---
  {
    type: "function",
    function: {
      name: "analizar_riesgo_fiscal",
      description: "Analiza el riesgo fiscal de la empresa para un trimestre. Devuelve un score de riesgo (0-100), alertas activas con severidad, ratios actuales vs medias del sector y recomendaciones. Útil para saber si la empresa está en zona de riesgo de inspección de Hacienda.",
      parameters: {
        type: "object",
        properties: {
          anio: { type: "number", description: "Año a analizar (por defecto el actual)" },
          trimestre: { type: "number", description: "Trimestre 1-4 (por defecto el actual)" }
        },
        required: []
      }
    }
  },
  // --- Tool 99: Simular impacto fiscal ---
  {
    type: "function",
    function: {
      name: "simular_impacto_fiscal",
      description: "Simula cómo afectaría una operación hipotética (factura o gasto) a los ratios fiscales y al riesgo de inspección. Muestra antes/después del score de riesgo, cambios en ratios, impacto en modelos 303 y 130, y cuánto necesitas facturar para compensar un gasto grande.",
      parameters: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: ["factura", "gasto"], description: "Tipo de operación: 'factura' (venta) o 'gasto' (compra)" },
          base_imponible: { type: "number", description: "Importe base imponible en euros" },
          iva_pct: { type: "number", description: "Porcentaje de IVA (21, 10, 4 o 0). Por defecto 21" },
          anio: { type: "number", description: "Año (por defecto el actual)" },
          trimestre: { type: "number", description: "Trimestre 1-4 (por defecto el actual)" }
        },
        required: ["tipo", "base_imponible"]
      }
    }
  },
];


export { TOOLS };
