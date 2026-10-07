import { Suspense } from "react";
import Reader from "./reader";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <ReaderLoader params={params} />
    </Suspense>
  );
}

async function ReaderLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Reader id={id} />;
}
