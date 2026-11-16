export function Logo({ className = "" }: { className?: string }) {
  return (
    <img src="/logo.png" alt="CITidiano" className={`h-8 w-auto ${className}`} />
  );
}