"use client";
import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function Redirect() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    router.replace(`/dna?${params.toString()}`);
  }, [router, params]);
  return null;
}

export default function EmbeddingPage() {
  return <Suspense><Redirect /></Suspense>;
}
