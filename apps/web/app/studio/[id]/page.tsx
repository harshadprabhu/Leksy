"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Studio } from "@/components/studio/Studio";
import { auth } from "@/lib/api";

export default function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!auth.token) router.replace("/login");
    else setOk(true);
  }, [router]);
  return ok ? <Studio id={id} /> : null;
}
