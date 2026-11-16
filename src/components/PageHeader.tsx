import type { ReactNode } from "react";
export function PageHeader({ eyebrow, title, desc, action }: { eyebrow: string; title: ReactNode; desc?: string; action?: ReactNode }) {
  return (
    <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="eyebrow mb-3">{eyebrow}</p>
        <h1 className="text-4xl font-light leading-[1.05] md:text-5xl">{title}</h1>
        {desc && <p className="mt-3 max-w-xl text-muted-foreground">{desc}</p>}
      </div>
      {action}
    </div>
  );
}
export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div>
      <div className="text-5xl font-bold tracking-tighter md:text-6xl">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}
