"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

const QuantumDashboard = dynamic(
  () => import("@/components/quantum/QuantumDashboard"),
  { 
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 dark:to-muted/10 flex items-center justify-center">
        <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
          Loading quantum telemetry...
        </div>
      </div>
    )
  }
);

export default function Page() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 dark:to-muted/10 flex items-center justify-center">
        <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
          Initializing...
        </div>
      </div>
    }>
      <QuantumDashboard />
    </Suspense>
  );
}