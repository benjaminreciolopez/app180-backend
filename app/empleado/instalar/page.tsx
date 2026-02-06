export const dynamic = "force-dynamic";
export const revalidate = 0; // sin cache

import InstalarCliente from "./InstalarCliente";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  return <InstalarCliente token={params?.token} />;
}
