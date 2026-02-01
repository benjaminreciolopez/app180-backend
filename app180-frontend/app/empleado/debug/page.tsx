"use client";

export default function DebugDevice() {
  let device = "";

  if (typeof window !== "undefined") {
    device = localStorage.getItem("device_hash") || "NO EXISTE";
  }

  return (
    <div style={{ padding: 30 }}>
      <h1>DEBUG DEVICE</h1>
      <p>
        <b>device_hash:</b>
      </p>
      <pre
        style={{
          background: "#eee",
          padding: 10,
          borderRadius: 8,
          wordBreak: "break-all",
        }}
      >
        {device}
      </pre>

      <button
        style={{
          marginTop: 20,
          padding: 10,
          background: "red",
          color: "white",
        }}
        onClick={() => {
          localStorage.removeItem("device_hash");
          alert("Borrado. Recarga ahora.");
        }}
      >
        BORRAR device_hash
      </button>
    </div>
  );
}
