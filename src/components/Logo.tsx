// Logo do CITidiano: versão clara no tema claro e versão de fundo escuro no tema escuro
export function Logo({ className = "" }: { className?: string }) {
  return (
    <>
      <img src="/logo.png" alt="CITidiano" className={`h-8 w-auto dark:hidden ${className}`} />
      <img src="/logo-escura.png" alt="CITidiano" className={`hidden h-8 w-auto dark:block ${className}`} />
    </>
  );
}
