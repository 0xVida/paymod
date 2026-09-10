import Image from "next/image";

type Props = {
  size?: number;
  variant?: "theme" | "dark";
  className?: string;
};

export default function Logo({ size = 26, variant = "theme", className }: Props) {
  const classes = ["logo", variant === "dark" ? "logo-pinned-dark" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} style={{ width: size, height: size }}>
      <Image
        className="logo-dark"
        src="/logo1.png"
        alt="Paymod"
        width={size}
        height={size}
        priority
      />
      {variant === "theme" && (
        <Image
          className="logo-light"
          src="/logo2.png"
          alt="Paymod"
          width={size}
          height={size}
          priority
        />
      )}
    </span>
  );
}
