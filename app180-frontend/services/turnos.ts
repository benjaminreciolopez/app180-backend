import { api } from "./api";

export async function getTurnos() {
  const res = await api.get("/turnos");
  return res.data;
}

export async function getTurno(id: string) {
  const res = await api.get(`/turnos/detalle/${id}`);
  return res.data;
}

export async function createTurno(data: {
  nombre: string;
  descripcion?: string;
  tipo_turno: string;
}) {
  const res = await api.post("/turnos", data);
  return res.data;
}

export async function updateTurno(
  id: string,
  data: {
    nombre: string;
    descripcion?: string;
    tipo_turno: string;
  }
) {
  const res = await api.put(`/turnos/${id}`, data);
  return res.data;
}

export async function deleteTurno(id: string) {
  const res = await api.delete(`/turnos/${id}`);
  return res.data;
}
