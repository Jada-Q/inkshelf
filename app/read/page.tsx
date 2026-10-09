"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Reader from "./reader";

/* 用查询参数 ?id= 而非动态路由段，才能静态导出（Capacitor 离线包）。 */
function ReaderFromQuery() {
  const id = useSearchParams().get("id") ?? "";
  return <Reader id={id} />;
}

export default function ReadPage() {
  return (
    <Suspense fallback={null}>
      <ReaderFromQuery />
    </Suspense>
  );
}
