export async function checkGeoPermission(): Promise<
  "granted" | "denied" | "prompt" | "unsupported"
> {
  if (!navigator.permissions) return "unsupported";

  try {
    const res = await navigator.permissions.query({
      // @ts-ignore
      name: "geolocation",
    });
    return res.state;
  } catch {
    return "unsupported";
  }
}
