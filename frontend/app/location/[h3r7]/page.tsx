"use client";
import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";

function Redirect() {
  const router = useRouter();
  const params = useSearchParams();
  const { h3r7 } = useParams<{ h3r7: string }>();

  useEffect(() => {
    if (!h3r7) return;
    const qs = params.toString();
    router.replace(`/report/${h3r7}${qs ? `?${qs}` : ""}`);
  }, [router, params, h3r7]);

  return null;
}

export default function LocationPage() {
  return (
    <Suspense>
      <Redirect />
    </Suspense>
  );
}
