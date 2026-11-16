export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-tight text-xl ${className}`}>
      <span className="text-gradient font-extrabold">CITi</span>diano
    </span>
  );
}
