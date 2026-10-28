// Small shared pieces for the interface: one icon set (drawn, 1.75 stroke), section frame, switch, segmented control.
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;
const Svg = (p: IconProps & { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p} />
);

export const IconCube = (p: IconProps) => <Svg {...p}><path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></Svg>;
export const IconUpload = (p: IconProps) => <Svg {...p}><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></Svg>;
export const IconPrinter = (p: IconProps) => <Svg {...p}><path d="M7 9V4h10v5" /><rect x="3.5" y="9" width="17" height="8" rx="2" /><path d="M7 14h10v6H7z" /></Svg>;
export const IconRuler = (p: IconProps) => <Svg {...p}><rect x="2.5" y="8" width="19" height="8" rx="1.5" /><path d="M6.5 8v3M10 8v4.5M13.5 8v3M17 8v4.5" /></Svg>;
export const IconPlate = (p: IconProps) => <Svg {...p}><path d="m3 15 9-5 9 5-9 5-9-5Z" /><path d="M3 15v2.2l9 5 9-5V15" /></Svg>;
export const IconFilter = (p: IconProps) => <Svg {...p}><path d="M4 6h16M7 12h10M10 18h4" /></Svg>;
export const IconLayers = (p: IconProps) => <Svg {...p}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></Svg>;
export const IconPalette = (p: IconProps) => <Svg {...p}><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.8 0-1.4-1.2-1.6-1.2-2.8 0-.9.7-1.4 1.6-1.4H17a4 4 0 0 0 4-4C21 6.8 17 3 12 3Z" /><circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none" /><circle cx="10" cy="7.2" r="1" fill="currentColor" stroke="none" /><circle cx="14.5" cy="7.2" r="1" fill="currentColor" stroke="none" /></Svg>;
export const IconDownload = (p: IconProps) => <Svg {...p}><path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5" /><path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" /></Svg>;
export const IconCheck = (p: IconProps) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
export const IconAlert = (p: IconProps) => <Svg {...p}><path d="M12 4 2.8 19.5h18.4L12 4Z" /><path d="M12 10v4.5M12 17.2v.1" /></Svg>;
export const IconChevron = (p: IconProps) => <Svg {...p}><path d="m9 6 6 6-6 6" /></Svg>;
export const IconFile = (p: IconProps) => <Svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /></Svg>;
export const IconX = (p: IconProps) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const IconRotate = (p: IconProps) => <Svg {...p}><path d="M20 11a8 8 0 1 0-2.3 6" /><path d="M20 4v7h-7" /></Svg>;

/** A titled block inside a panel. The title carries its own weight: no label above it. */
export function Section({ icon, title, children, aside }: { icon: ReactNode; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section px-5 py-4" aria-label={title}>
      <header className="mb-3 flex items-center gap-2.5 text-ink">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent">{icon}</span>
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        {aside && <div className="ml-auto text-xs text-muted">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

/** A labelled on/off row. */
export function SwitchRow({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`flex items-start gap-3 py-1.5 ${disabled ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-ink">{label}</div>
        {hint && <div className="text-xs leading-snug text-muted">{hint}</div>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="switch mt-0.5" onClick={() => onChange(!checked)} />
    </div>
  );
}

export function Segmented<T extends string | number>({ label, value, options, onChange }: {
  label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="seg">
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Honest status line with an icon and words, never colour alone. */
export function Notice({ tone, children }: { tone: "warn" | "bad" | "ok" | "muted"; children: ReactNode }) {
  const color = { warn: "text-warn", bad: "text-bad", ok: "text-ok", muted: "text-muted" }[tone];
  const Icon = tone === "ok" ? IconCheck : tone === "muted" ? IconFile : IconAlert;
  return (
    <p role="status" className={`mt-2 flex items-start gap-2 text-xs leading-snug ${color}`}>
      <Icon width={15} height={15} className="mt-px flex-none" />
      <span className="text-ink-2">{children}</span>
    </p>
  );
}
