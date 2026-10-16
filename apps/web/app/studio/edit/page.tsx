"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Studio } from "@/components/studio/Studio";
import { auth } from "@/lib/api";

function Inner() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!auth.token) router.replace("/login");
    else setOk(true);
  }, [router]);
  if (!id) return <div className="empty">No template selected.</div>;
  return ok ? <Studio id={id} /> : null;
}

export default function StudioPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
