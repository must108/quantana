"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Gi3dMeeple } from "react-icons/gi";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Page() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 dark:to-muted/10">
        <div className="mx-auto max-w-5xl px-4 py-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex w-full items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                <Gi3dMeeple className="h-8 w-8" />
              </div>
              <div className="min-w-0 flex items-center gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-lg font-semibold tracking-tight">About</h1>
                </div>
                <div>
                    <Link href="/">
                    <Button variant="outline" className="w-full sm:w-auto">
                        Home
                    </Button>
                    </Link>
                </div>
              </div>
            </div>
          </div>

          <Separator className="my-6" />

          <div className="grid grid-cols-1 gap-4">
            <Card className="rounded-2xl bg-card text-card-foreground border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-foreground">
                  What is Quantana?
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Quantana is a <span className="text-foreground font-medium">quantum system observability</span>{" "}
                  platform for understanding how quantum systems behave over time.
                </p>

                <p>
                  Quantum hardware is inherently noisy and unstable, quantum drift and various other factors can degrade performance. 
                  Quantana helps you{" "}
                  <span className="text-foreground font-medium">see drift early</span>, track system health, surface alerts,
                  and understand what’s changing, before it becomes a blocker for quantum research or quantum development.
                  Quantana allows you to see real-time telemetry visualizations, drift and anomaly monitoring, health scores and alerts.
                  It allows for a full view of your quantum system.
                  The name, and the concept, are both inspired by <span className="text-foreground font-medium">Grafana</span>, an
                  observability platform used in software engineering.
                </p>
              </CardContent>
            </Card>

            {/* Icon / Meeple */}
            <Card className="rounded-2xl bg-card text-card-foreground border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-foreground">
                  What is the icon?
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground leading-relaxed">
                <p>
                  That icon is Meeple, a little guy used as a figure in board games. The use of Meeple as the logo is purely for fun!
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
