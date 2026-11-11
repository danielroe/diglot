import type { ReactNode } from "react";

export default function Card({
  title = "Card title",
  children,
  footer = "Default footer",
}: {
  title?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
      <footer>{footer}</footer>
    </section>
  );
}
