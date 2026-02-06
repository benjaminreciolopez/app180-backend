"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function SetupPage() {
  const router = useRouter();

  useEffect(() => {
    // Setup is now done via Google Sign-In on /login
    // Redirect to login page
    router.replace("/login");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-500">Redirigiendo al registro...</p>
    </div>
  );
}
