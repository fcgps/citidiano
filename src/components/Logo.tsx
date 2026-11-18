// Logo do CITidiano: versão clara no tema claro e versão de fundo escuro no tema escuro.
// `size` = classe de altura (padrão h-8), para usar a logo maior em títulos.
export function Logo({ className = "", size = "h-8" }: { className?: string; size?: string }) {
  return (
    <>
      <img src="/logo.png" alt="CITidiano" className={`${size} w-auto dark:hidden ${className}`} />
      <img src="/logo-escura.png" alt="CITidiano" className={`hidden ${size} w-auto dark:block ${className}`} />
    </>
  );
}
