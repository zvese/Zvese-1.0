import Link from "next/link";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  showSlogan?: boolean;
}

export function Logo({ className, showSlogan = false }: LogoProps) {
  return (
    <Link href="/" className={cn("group flex flex-col", className)}>
      <span className="text-xl font-bold tracking-tight text-foreground transition-colors group-hover:text-primary sm:text-2xl">
        {siteConfig.name}
      </span>
      {showSlogan && (
        <span className="text-xs font-medium text-muted-foreground sm:text-sm">
          {siteConfig.slogan}
        </span>
      )}
    </Link>
  );
}
