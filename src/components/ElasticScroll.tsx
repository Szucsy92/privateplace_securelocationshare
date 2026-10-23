import type { ReactNode } from "react";
import { useElasticOverscroll } from "@/hooks/useElasticOverscroll";
import { cn } from "@/lib/utils";

/** Függőlegesen görgethető terület puha, rugalmas túlhúzással. */
export function ElasticScroll({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useElasticOverscroll<HTMLDivElement>("y");
  return (
    <div ref={ref} className={cn("elastic-scroll-y", className)}>
      <div>{children}</div>
    </div>
  );
}
