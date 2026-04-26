// backend/src/services/ai/asesorToolDefinitions.js
// Tools del agente IA del portal asesor — orientadas a multi-cliente.

const ASESOR_TOOLS = [
  // ===== DESCUBRIMIENTO DE CLIENTES =====
  {
    type: "function",
    function: {
      name: "listar_mis_clientes",
      description: "Lista los clientes vinculados activos a la asesoría del asesor. Devuelve nombre, empresa_id, NIF, tipo de contribuyente, fecha de alta. Usa esta herramienta como primer paso cuando el asesor pregunta '¿qué clientes tengo?', '¿quiénes son mis clientes?', o cuando necesitas el empresa_id de algún cliente y no lo tienes.",
      parameters: {
        type: "object",
        properties: {
          incluir_inactivos: { type: "string", enum: ["true", "false"], description: "Si 'true', incluye también vínculos pausados/cancelados" },
          limite: { type: "number", description: "Máximo de clientes a devolver (default: 50)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "buscar_cliente",
      description: "Busca un cliente concreto por nombre, NIF o razón social entre los vinculados a la asesoría. Devuelve coincidencias con sus empresa_id. Útil cuando el asesor menciona un cliente y necesitas resolver su empresa_id.",
      parameters: {
        type: "object",
        properties: {
          consulta: { type: "string", description: "Texto a buscar: nombre comercial, razón social o NIF" }
        },
        required: ["consulta"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "info_cliente",
      description: "Devuelve información básica + KPIs principales de un cliente concreto: nombre, NIF, tipo contribuyente, total facturación trimestre, deuda pendiente, modelos fiscales presentados/pendientes en el periodo actual.",
      parameters: {
        type: "object",
        properties: {
          empresa_id: { type: "string", description: "ID de la empresa cliente (UUID)" }
        },
        required: ["empresa_id"]
      }
    }
  },

  // ===== ANÁLISIS TRANSVERSAL =====
  {
    type: "function",
    function: {
      name: "comparar_clientes_fiscal",
      description: "Compara la situación fiscal de 2-5 clientes en un trimestre concreto. Para cada cliente devuelve: facturación, IVA repercutido/soportado, IRPF retenido, modelo 303/130 calculado y estado.",
      parameters: {
        type: "object",
        properties: {
          empresa_ids: { type: "array", items: { type: "string" }, description: "Array de empresa_id (2 a 5 clientes)" },
          trimestre: { type: "number", enum: [1, 2, 3, 4], description: "Trimestre (1-4)" },
          year: { type: "number", description: "Año (default: año actual)" }
        },
        required: ["empresa_ids", "trimestre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "top_clientes_riesgo",
      description: "Devuelve los clientes con mayor riesgo fiscal o financiero. Combina señales: modelos pendientes de presentar, facturación con cobro pendiente, ratio gasto/ingreso anómalo, datos incompletos. Ordena por nivel de riesgo descendente.",
      parameters: {
        type: "object",
        properties: {
          limite: { type: "number", description: "Número de clientes a devolver (default: 10)" },
          tipo_riesgo: { type: "string", enum: ["fiscal", "cobros", "datos", "todos"], description: "Tipo de riesgo a priorizar (default: 'todos')" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_clientes_estado_modelos",
      description: "Devuelve el estado de presentación de modelos fiscales (303, 130, 111, 115, 349) de TODOS los clientes en un trimestre. Útil para responder '¿quién tiene el 303 sin presentar?' o '¿qué clientes me quedan por modelo X?'.",
      parameters: {
        type: "object",
        properties: {
          modelo: { type: "string", enum: ["303", "130", "111", "115", "349", "390", "180", "190", "347", "todos"], description: "Modelo a consultar (default: 'todos')" },
          trimestre: { type: "number", enum: [1, 2, 3, 4], description: "Trimestre (1-4). Para modelos anuales (390/180/190/347), úsalo como referencia del año." },
          year: { type: "number", description: "Año (default: año actual)" },
          solo_pendientes: { type: "string", enum: ["true", "false"], description: "Si 'true', solo devuelve los que faltan por presentar" }
        },
        required: ["trimestre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "ranking_facturacion_clientes",
      description: "Ranking de clientes por facturación en un periodo. Útil para '¿cuáles son mis mayores clientes?', 'top facturación trimestre actual'.",
      parameters: {
        type: "object",
        properties: {
          year: { type: "number", description: "Año (default: año actual)" },
          trimestre: { type: "number", enum: [1, 2, 3, 4], description: "Trimestre opcional. Si se omite, año completo." },
          limite: { type: "number", description: "Top N (default: 10)" }
        }
      }
    }
  },

  // ===== WRAPPERS DE LECTURA POR CLIENTE =====
  {
    type: "function",
    function: {
      name: "consultar_facturas_cliente",
      description: "Consulta facturas de un cliente vinculado concreto. Mismo comportamiento que la herramienta del modo empresa pero requiere empresa_id explícito.",
      parameters: {
        type: "object",
        properties: {
          empresa_id: { type: "string", description: "ID del cliente (UUID)" },
          estado: { type: "string", enum: ["VALIDADA", "BORRADOR", "ANULADA", "TODOS"] },
          estado_pago: { type: "string", enum: ["pendiente", "parcial", "pagado", "todos"] },
          limite: { type: "number" }
        },
        required: ["empresa_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_modelos_fiscales_cliente",
      description: "Consulta el historial de modelos fiscales calculados/presentados de un cliente concreto.",
      parameters: {
        type: "object",
        properties: {
          empresa_id: { type: "string", description: "ID del cliente (UUID)" },
          year: { type: "number", description: "Año (default: año actual)" },
          modelo: { type: "string", enum: ["303", "130", "111", "115", "349", "390", "180", "190", "347", "todos"] }
        },
        required: ["empresa_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_resumen_financiero_cliente",
      description: "Resumen financiero (ingresos, gastos, beneficio neto, IVA neto) de un cliente concreto en un periodo.",
      parameters: {
        type: "object",
        properties: {
          empresa_id: { type: "string", description: "ID del cliente (UUID)" },
          year: { type: "number", description: "Año (default: año actual)" },
          trimestre: { type: "number", enum: [1, 2, 3, 4], description: "Trimestre opcional" }
        },
        required: ["empresa_id"]
      }
    }
  },

  // ===== HUMAN-IN-THE-LOOP =====
  {
    type: "function",
    function: {
      name: "solicitar_aclaracion",
      description: "Pausa la conversación para preguntar al asesor cuando hay ambigüedad: varios clientes con nombre similar, parámetros incompletos, etc. Devuelve la pregunta y opciones al frontend.",
      parameters: {
        type: "object",
        properties: {
          pregunta: { type: "string", description: "Pregunta clara al asesor" },
          opciones: { type: "array", items: { type: "string" }, description: "Lista corta de opciones (opcional)" },
          contexto: { type: "string", description: "Por qué necesitas la aclaración (opcional)" }
        },
        required: ["pregunta"]
      }
    }
  }
];

export { ASESOR_TOOLS };
