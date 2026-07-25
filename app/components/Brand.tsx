import Image from "next/image";
import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="HoodiePad home">
      <Image className="brand-logo" src="/hoodie-logo.jpg" alt="" width={40} height={40} priority unoptimized />
      <span>HoodiePad</span>
    </Link>
  );
}
