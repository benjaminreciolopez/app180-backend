// backend/src/services/sepaService.js
// Generador de remesas SEPA Credit Transfer (pain.001.001.03)
// para pagar nóminas masivamente desde el banco de la empresa.
//
// Salida: XML conforme a ISO 20022 que el banco acepta para subir
// como pago múltiple. Cada nómina es una transacción individual.

import { randomUUID } from "crypto";

function escapeXml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cleanIban(iban) {
  if (!iban) return "";
  return String(iban).replace(/\s+/g, "").toUpperCase();
}

function bicFromIban(iban) {
  // Best-effort: si no tenemos BIC explícito, dejamos el campo vacío.
  // Bancos españoles modernos no exigen BIC para SEPA doméstico (SCT inst).
  return null;
}

function fmtAmount(n) {
  // SEPA exige decimales con punto, máximo 2 decimales
  return Number(n || 0).toFixed(2);
}

function fmtDateISO(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function fmtDateTime(d = new Date()) {
  return d.toISOString().slice(0, 19);
}

/**
 * Genera el XML SEPA Credit Transfer para un lote de nóminas.
 *
 * @param {Object} args
 * @param {Object} args.emisor             { nombre, nif, iban }
 * @param {Date|string} args.fechaPago     Fecha en la que el banco debe ejecutar la transferencia
 * @param {string} args.referencia         Referencia interna del lote (ej: "NOMINAS-2026-04")
 * @param {Array}  args.transacciones      Array de { id, beneficiario_nombre, beneficiario_nif?, beneficiario_iban, importe, concepto }
 * @returns {{ xml: string, totalImporte: number, numTransacciones: number, msgId: string }}
 */
export function generarSepaCreditTransfer({ emisor, fechaPago, referencia, transacciones }) {
  if (!emisor?.nombre || !emisor?.iban) {
    throw new Error("Datos de emisor incompletos (nombre, IBAN requeridos)");
  }
  if (!Array.isArray(transacciones) || transacciones.length === 0) {
    throw new Error("Lote vacío: no hay transacciones");
  }

  const emisorIban = cleanIban(emisor.iban);
  const emisorNombre = escapeXml(emisor.nombre.substring(0, 70));
  const fechaPagoStr = typeof fechaPago === "string" ? fechaPago : fmtDateISO(fechaPago);
  const ahora = fmtDateTime();

  const msgId = `MSG-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const pmtInfId = `PMT-${Date.now()}`;
  const refLote = escapeXml((referencia || `NOMINAS-${fechaPagoStr}`).substring(0, 35));

  const transTx = transacciones.filter((t) => {
    const importe = Number(t.importe);
    return t.beneficiario_iban && t.beneficiario_nombre && importe > 0;
  });
  if (transTx.length === 0) {
    throw new Error("Ninguna transacción válida (faltan IBAN/nombre/importe)");
  }

  const totalImporte = transTx.reduce((acc, t) => acc + Number(t.importe || 0), 0);

  const txBlocks = transTx
    .map((t, i) => {
      const txId = `TX-${i + 1}-${(t.id || randomUUID().slice(0, 8))}`.substring(0, 35);
      const ibanBnf = cleanIban(t.beneficiario_iban);
      const nombreBnf = escapeXml(String(t.beneficiario_nombre).substring(0, 70));
      const concepto = escapeXml(String(t.concepto || `Nómina ${refLote}`).substring(0, 140));
      return `
    <CdtTrfTxInf>
      <PmtId>
        <EndToEndId>${escapeXml(txId)}</EndToEndId>
      </PmtId>
      <Amt>
        <InstdAmt Ccy="EUR">${fmtAmount(t.importe)}</InstdAmt>
      </Amt>
      <Cdtr>
        <Nm>${nombreBnf}</Nm>
      </Cdtr>
      <CdtrAcct>
        <Id><IBAN>${ibanBnf}</IBAN></Id>
      </CdtrAcct>
      <RmtInf>
        <Ustrd>${concepto}</Ustrd>
      </RmtInf>
    </CdtTrfTxInf>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${escapeXml(msgId)}</MsgId>
      <CreDtTm>${ahora}</CreDtTm>
      <NbOfTxs>${transTx.length}</NbOfTxs>
      <CtrlSum>${fmtAmount(totalImporte)}</CtrlSum>
      <InitgPty>
        <Nm>${emisorNombre}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${escapeXml(pmtInfId)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${transTx.length}</NbOfTxs>
      <CtrlSum>${fmtAmount(totalImporte)}</CtrlSum>
      <PmtTpInf>
        <SvcLvl><Cd>SEPA</Cd></SvcLvl>
      </PmtTpInf>
      <ReqdExctnDt>${fechaPagoStr}</ReqdExctnDt>
      <Dbtr>
        <Nm>${emisorNombre}</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id><IBAN>${emisorIban}</IBAN></Id>
      </DbtrAcct>
      <DbtrAgt>
        <FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>
      </DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>${txBlocks}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`;

  return {
    xml,
    totalImporte,
    numTransacciones: transTx.length,
    msgId,
  };
}
