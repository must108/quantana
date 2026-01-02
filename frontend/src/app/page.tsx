"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Notebook } from "lucide-react";
import { VscGraphLine } from "react-icons/vsc";
import { Gi3dMeeple } from "react-icons/gi";

export default function Page() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 dark:to-muted/10 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border bg-card text-card-foreground shadow-sm p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <Gi3dMeeple className="h-8 w-8" />
          </div>
          <div className="text-lg font-semibold tracking-tight items-center">
            Quantana
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <Link href="/about" className="w-full">
            <Button className="w-full rounded-xl justify-start gap-2">
              <Notebook className="h-4 w-4" />
              About
            </Button>
          </Link>

          <Link href="/simulation" className="w-full">
            <Button
              variant="outline"
              className="w-full rounded-xl justify-start gap-2"
            >
              <VscGraphLine className="h-4 w-4" />
              Simulation
            </Button>
          </Link>
        </div>

        <div className="mt-6 text-xs text-muted-foreground text-center">
          Simulated quantum data generated with IBM Qiskit!
        </div>
      </div>
    </div>
  );
}
